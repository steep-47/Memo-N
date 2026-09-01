import { APP, BASE, USER } from '../../core/manager.js';
import { ROUTE, getProviderRoute } from './providerRoute.js';

const RECORD_MARKER = '[Memo-N record envelope v1]';
const GUARD_MARKER = '[Memo-N DeepSeek JSON兼容块 v3]';
const BLOCK_BEGIN = 'MEMO_N_DEEPSEEK_JSON_BEGIN';
const BLOCK_END = 'MEMO_N_DEEPSEEK_JSON_END';
let pendingDeepSeek = false;

function isManagedRecordRequest(data) {
    if (!data || typeof data !== 'object') return false;
    if (getProviderRoute(data) !== ROUTE.DEEPSEEK) return false;
    const messages = Array.isArray(data.messages) ? data.messages : [];
    return messages.some(message => String(message?.content ?? '').includes(RECORD_MARKER));
}

function currentWorldSheets() {
    try {
        return (BASE.getChatSheets?.() ?? [])
            .filter(sheet => sheet?.enable !== false)
            .filter(sheet => sheet?.sendToContext !== false);
    } catch (_) {
        return [];
    }
}

function tableMapText() {
    const sheets = currentWorldSheets();
    if (!sheets.length) return '当前没有可写入表格；记录数组必须为[]。';
    return sheets.map((sheet, table) => {
        const headers = (sheet?.getHeader?.() ?? []).map(value => String(value ?? '').trim()).filter(Boolean);
        return `#${table} ${String(sheet?.name ?? `表${table}`)}：${headers.map((header, column) => `${column}=${header}`).join('，')}`;
    }).join('\n');
}

function reinforceDeepSeekJson(data) {
    if (!isManagedRecordRequest(data)) return;
    pendingDeepSeek = true;

    delete data.json_schema;
    delete data.response_format;

    if (!Array.isArray(data.messages)) return;
    // recordEngine 先注入的“整篇 reply+changes JSON”与兼容块协议互相冲突。
    // DeepSeek 路径在最终发送前必须删除旧协议，只保留一个机器格式要求。
    data.messages = data.messages.filter(message => {
        const content = String(message?.content ?? '');
        return !content.includes(RECORD_MARKER) && !content.includes(GUARD_MARKER);
    });
    data.messages.push({
        role: 'system',
        content: `${GUARD_MARKER}\n本轮只使用下面这一种记录格式。不要把完整正文放进JSON。\n\n实际输出必须严格按顺序：\n${BLOCK_BEGIN}\n[]\n${BLOCK_END}\n然后立刻输出原本要求的完整正常正文、状态栏、选项和留言。\n\nBEGIN/END 中间只能是一个合法JSON数组，表示本轮表格变化；没有变化就写[]。数组元素固定格式：\n{"op":"insert|update|delete","table":0,"row":null,"cells":[{"column":0,"value":"值"}]}\ninsert 的 row 必须为 null；update/delete 的 row 必须使用当前表格真实存在的行号；delete 的 cells 必须为 []。\n\n当前实际表格映射：\n${tableMapText()}\n\n机器块必须完整闭合并位于正文之前。正文保持原角色卡/预设要求。禁止 tableEdit、Markdown代码围栏、额外机器块、第二份JSON，也禁止输出 {"reply":...} 信封。`,
    });

    globalThis.__memoNDeepSeekJsonGuardProbe = Object.freeze({
        at: Date.now(),
        tableCount: currentWorldSheets().length,
        jsonSchema: false,
        responseFormat: false,
        legacyEnvelopeRemoved: true,
        taggedJsonBlock: true,
    });

    console.log('[Memo-N] DeepSeek兼容模式：已删除旧整包JSON协议，仅保留前置JSON变化块 + 正常正文');
}

function latestAssistant() {
    const chat = USER?.getContext?.()?.chat;
    if (!Array.isArray(chat)) return null;
    for (let i = chat.length - 1; i >= 0; i--) if (chat[i]?.is_user === false) return chat[i];
    return null;
}

function reasoningText(chat) {
    const swipeId = Number(chat?.swipe_id);
    const swipeReasoning = Number.isInteger(swipeId) && swipeId >= 0
        ? chat?.swipe_info?.[swipeId]?.extra?.reasoning
        : '';
    return String(swipeReasoning || chat?.extra?.reasoning || '').trim();
}

function extractBlock(text) {
    const source = String(text ?? '');
    const start = source.indexOf(BLOCK_BEGIN);
    if (start < 0) return null;
    const payloadStart = start + BLOCK_BEGIN.length;
    const end = source.indexOf(BLOCK_END, payloadStart);
    if (end < 0) return null;
    if (source.indexOf(BLOCK_BEGIN, payloadStart) >= 0) return null;
    const raw = source.slice(payloadStart, end).trim();
    let changes;
    try { changes = JSON.parse(raw); } catch (_) { return null; }
    if (!Array.isArray(changes)) return null;
    const visible = `${source.slice(0, start)}${source.slice(end + BLOCK_END.length)}`.trim();
    return { changes, visible };
}

function normalizeDeepSeekReplyBeforeRecordEngine() {
    if (!pendingDeepSeek) return;
    pendingDeepSeek = false;

    const chat = latestAssistant();
    if (!chat) return;

    const content = String(chat.mes ?? '').trim();
    const fromContent = extractBlock(content);
    const fromReasoning = fromContent ? null : extractBlock(reasoningText(chat));
    const parsed = fromContent || fromReasoning;
    if (!parsed) return;

    const reply = (fromContent ? parsed.visible : content).trim();
    if (!reply) return;

    chat.mes = JSON.stringify({ reply, changes: parsed.changes });
    console.log(`[Memo-N] DeepSeek前置JSON变化块已转换为内部记录信封｜source=${fromContent ? 'content' : 'reasoning'}｜changes=${parsed.changes.length}`);
}

globalThis.__memoNNormalizeDeepSeekReply = normalizeDeepSeekReplyBeforeRecordEngine;

APP.eventSource.on(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, reinforceDeepSeekJson);
APP.eventSource.makeLast?.(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, reinforceDeepSeekJson);

console.log('[Memo-N] DeepSeek JSON兼容守卫已加载：单一前置JSON变化块协议');
