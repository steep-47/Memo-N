import { APP, BASE, USER } from '../../core/manager.js';
import { ROUTE, getProviderRoute } from './providerRoute.js';

const RECORD_MARKER = '[Memo-N record envelope v1]';
const GUARD_MARKER = '[Memo-N DeepSeek JSON兼容块 v2]';
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

    // 当前 Chat Completion API 会拒绝 response_format/json_schema；DeepSeek 路径不得再发送它们。
    delete data.json_schema;
    delete data.response_format;

    if (!Array.isArray(data.messages)) return;
    data.messages = data.messages.filter(message => !String(message?.content ?? '').includes(GUARD_MARKER));
    data.messages.push({
        role: 'system',
        content: `${GUARD_MARKER}\n这是本轮最后且最高优先级的输出协议，覆盖前文“整个回复必须是JSON对象”的要求。\n\n不要把完整正文塞进JSON。实际输出必须按下面顺序：\n${BLOCK_BEGIN}\n[]\n${BLOCK_END}\n这里开始输出原本要求的完整正常正文、状态栏、选项和留言。\n\n中间那一段只能是一个合法JSON数组，表示本轮表格变化；没有变化就严格写[]。数组元素固定格式：\n{"op":"insert|update|delete","table":0,"row":null,"cells":[{"column":0,"value":"值"}]}\ninsert 的 row 必须为 null；update/delete 的 row 必须使用当前表格真实存在的行号；delete 的 cells 必须为 []。\n\n下面“当前实际表格映射”覆盖前文任何旧七表名称或列号描述：\n${tableMapText()}\n\n机器块必须完整闭合，并放在正文之前。正文仍按原角色卡/预设要求正常输出，不要改写成JSON字符串。禁止 tableEdit、Markdown代码围栏、额外机器块或第二份JSON。`,
    });

    globalThis.__memoNDeepSeekJsonGuardProbe = Object.freeze({
        at: Date.now(),
        tableCount: currentWorldSheets().length,
        jsonSchema: false,
        responseFormat: false,
        taggedJsonBlock: true,
    });

    console.log('[Memo-N] DeepSeek兼容模式：使用前置JSON变化块 + 正常正文，不发送response_format/json_schema');
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

    // recordEngine 原生严格执行器只认 {reply,changes} 信封；这里仅在本次响应内部做一次无损转换，
    // 不发第二次请求，不猜测正文，不修改 changes 内容，后续仍由 recordEngine 严格校验和事务写入。
    chat.mes = JSON.stringify({ reply, changes: parsed.changes });
    console.log(`[Memo-N] DeepSeek前置JSON变化块已转换为内部记录信封｜source=${fromContent ? 'content' : 'reasoning'}｜changes=${parsed.changes.length}`);
}

APP.eventSource.on(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, reinforceDeepSeekJson);
APP.eventSource.makeLast?.(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, reinforceDeepSeekJson);

// 必须在 recordEngine 的 GENERATION_ENDED 严格解析之前完成兼容转换。
APP.eventSource.on(APP.event_types.GENERATION_ENDED, normalizeDeepSeekReplyBeforeRecordEngine);
APP.eventSource.makeFirst?.(APP.event_types.GENERATION_ENDED, normalizeDeepSeekReplyBeforeRecordEngine);

console.log('[Memo-N] DeepSeek JSON兼容守卫已加载：前置JSON变化块 + 正常正文');
