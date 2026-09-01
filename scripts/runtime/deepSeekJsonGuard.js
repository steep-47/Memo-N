import { APP, BASE, USER } from '../../core/manager.js';
import { ROUTE, getProviderRoute } from './providerRoute.js';

const RECORD_MARKER = '[Memo-N record envelope v1]';
const GUARD_MARKER = '[Memo-N DeepSeek JSON兼容块 v4]';
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
    data.messages = data.messages.filter(message => {
        const content = String(message?.content ?? '');
        return !content.includes(RECORD_MARKER) && !content.includes('[Memo-N DeepSeek JSON兼容块');
    });
    data.messages.push({
        role: 'system',
        content: `${GUARD_MARKER}\n输出正常正文之前，先完成一次很短的Memo记录头。记录头不是正文，不要省略，也不要把正文塞进JSON。\n\n回复必须从下面两行开始：\n${BLOCK_BEGIN}\n[]\n${BLOCK_END}\n\n其中BEGIN/END之间只能放一个合法JSON数组。若本轮有明确表格变化，把[]替换为变化数组；没有变化就保持[]。之后立即继续原本要求的完整正常正文、状态栏、选项和留言。\n\n变化元素格式：\n{"op":"insert|update|delete","table":0,"row":null,"cells":[{"column":0,"value":"值"}]}\ninsert的row为null；update/delete的row只能抄当前表格真实存在的行号；delete的cells为[]。\n\n当前实际表格映射：\n${tableMapText()}\n\n优先保证记录头完整闭合；正文保持原角色卡/预设要求。不要输出tableEdit、Markdown代码围栏、第二份机器块或{\"reply\":...}信封。`,
    });

    globalThis.__memoNDeepSeekJsonGuardProbe = Object.freeze({
        at: Date.now(),
        tableCount: currentWorldSheets().length,
        jsonSchema: false,
        responseFormat: false,
        legacyEnvelopeRemoved: true,
        taggedJsonBlock: true,
    });

    console.log('[Memo-N] DeepSeek兼容模式：前置短JSON变化块 + 正常正文');
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

    if (!parsed) {
        if (!content) return;
        // DeepSeek偶尔完全忽略记录头并直接输出正文。此时绝不能把正文交给JSON解析器，
        // 也不能从正文猜表格变化；安全降级为“正文保留 + 本轮无机器记录”。
        chat.mes = JSON.stringify({ reply: content, changes: [] });
        console.warn('[Memo-N] DeepSeek未返回可解析记录头：已保留正文并安全降级为空变化，不自动重试');
        return;
    }

    const reply = (fromContent ? parsed.visible : content).trim();
    if (!reply) return;

    chat.mes = JSON.stringify({ reply, changes: parsed.changes });
    console.log(`[Memo-N] DeepSeek前置JSON变化块已转换为内部记录信封｜source=${fromContent ? 'content' : 'reasoning'}｜changes=${parsed.changes.length}`);
}

globalThis.__memoNNormalizeDeepSeekReply = normalizeDeepSeekReplyBeforeRecordEngine;

APP.eventSource.on(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, reinforceDeepSeekJson);
APP.eventSource.makeLast?.(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, reinforceDeepSeekJson);

console.log('[Memo-N] DeepSeek JSON兼容守卫已加载：短记录头 + 正文安全降级');
