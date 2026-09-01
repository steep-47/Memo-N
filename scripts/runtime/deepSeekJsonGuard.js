import { APP, BASE, USER } from '../../core/manager.js';
import { ROUTE, getProviderRoute } from './providerRoute.js';

const RECORD_MARKER = '[Memo-N record envelope v1]';
const GUARD_MARKER = '[Memo-N 当前表格记录协议 v5]';
const BLOCK_BEGIN = 'MEMO_N_DEEPSEEK_JSON_BEGIN';
const BLOCK_END = 'MEMO_N_DEEPSEEK_JSON_END';
let pendingDeepSeek = false;

function isManagedRecordRequest(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.messages)) return false;
    return data.messages.some(message => String(message?.content ?? '').includes(RECORD_MARKER));
}
function currentWorldSheets() {
    try {
        return (BASE.getChatSheets?.() ?? [])
            .filter(sheet => sheet?.enable !== false)
            .filter(sheet => sheet?.sendToContext !== false);
    } catch (_) { return []; }
}
function tableMapText() {
    const sheets = currentWorldSheets();
    if (!sheets.length) return '当前没有可写入表格；本轮必须表示无变化。';
    return sheets.map((sheet, table) => {
        const headers = (sheet?.getHeader?.() ?? []).map(value => String(value ?? '').trim()).filter(Boolean);
        return `#${table} ${String(sheet?.name ?? `表${table}`)}：${headers.map((header, column) => `${column}=${header}`).join('，')}`;
    }).join('\n');
}
function removeOlderContracts(messages) {
    return messages.filter(message => {
        const content = String(message?.content ?? '');
        return !content.includes(RECORD_MARKER)
            && !content.includes('[Memo-N DeepSeek JSON兼容块')
            && !content.includes(GUARD_MARKER);
    });
}
function deepSeekContract() {
    return `${GUARD_MARKER}\n本轮记录接口为DeepSeek。输出正常正文之前，先完成一个很短的Memo记录头；不要把正文塞进JSON。\n\n回复必须从以下机器块开始：\n${BLOCK_BEGIN}\n[]\n${BLOCK_END}\n\nBEGIN/END之间只能是合法JSON数组。没有明确变化保持[]；有变化时元素格式为：\n{"op":"insert|update|delete","table":0,"row":null,"cells":[{"column":0,"value":"值"}]}\ninsert的row必须为null；update/delete的row只能抄当前表格真实存在的rowIndex；delete的cells必须为[]。\n机器块闭合后立即继续原本要求的完整正常正文、状态栏、行动选项和伊依内容。\n\n当前实际表格映射：\n${tableMapText()}\n\n禁止tableEdit、Markdown代码围栏、第二份机器块和{\"reply\":...}信封。`;
}
function relayContract() {
    return `${GUARD_MARKER}\n本轮记录接口为中转站。真正开始输出时，第一段必须先给出且只给出一个完整<tableEdit>机器块，闭合后立即继续原本要求的完整正常正文、状态栏、行动选项和伊依内容。\n格式：\n<tableEdit><!--\nupdateRow(0,0,{1:\"08:30\"})\n--></tableEdit>\n只允许insertRow(tableIndex,{columnIndex:value,...})、updateRow(tableIndex,rowIndex,{columnIndex:value,...})、deleteRow(tableIndex,rowIndex)。没有变化也必须先输出<tableEdit><!-- NO_CHANGE --></tableEdit>。\nupdate/delete只能使用当前表第一列真实存在的rowIndex；空表首次记录只能insert。\n\n当前实际表格映射：\n${tableMapText()}\n\n禁止JSON记录信封、tagged JSON、SQL、Markdown代码围栏和解释。`;
}
function reinforceRecordProtocol(data) {
    if (!isManagedRecordRequest(data)) return;
    const route = getProviderRoute(data);
    pendingDeepSeek = route === ROUTE.DEEPSEEK;
    delete data.json_schema;
    delete data.response_format;
    data.messages = removeOlderContracts(data.messages);
    data.messages.push({ role:'system', content:route === ROUTE.DEEPSEEK ? deepSeekContract() : relayContract() });
    globalThis.__memoNRecordProtocolProbe = Object.freeze({
        at:Date.now(), route, tableCount:currentWorldSheets().length,
        jsonSchema:false, responseFormat:false, legacyEnvelopeRemoved:true,
        protocol:route === ROUTE.DEEPSEEK ? 'deepseek_short_json_leading' : 'relay_tableedit_leading',
    });
    console.log(`[Memo-N] 当前表格记录协议已最终覆盖：route=${route}｜tables=${currentWorldSheets().length}`);
}
function latestAssistant() {
    const chat = USER?.getContext?.()?.chat;
    if (!Array.isArray(chat)) return null;
    for (let i = chat.length - 1; i >= 0; i--) if (chat[i]?.is_user === false) return chat[i];
    return null;
}
function reasoningText(chat) {
    const swipeId = Number(chat?.swipe_id);
    const swipeReasoning = Number.isInteger(swipeId) && swipeId >= 0 ? chat?.swipe_info?.[swipeId]?.extra?.reasoning : '';
    return String(swipeReasoning || chat?.extra?.reasoning || '').trim();
}
function extractBlock(text) {
    const source = String(text ?? '');
    const start = source.indexOf(BLOCK_BEGIN);
    if (start < 0) return null;
    const payloadStart = start + BLOCK_BEGIN.length;
    const end = source.indexOf(BLOCK_END, payloadStart);
    if (end < 0 || source.indexOf(BLOCK_BEGIN, payloadStart) >= 0) return null;
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
        chat.mes = JSON.stringify({ reply:content, changes:[] });
        console.warn('[Memo-N] DeepSeek未返回机器记录头：正文保留、变化按空处理，不猜测、不重试');
        return;
    }
    const reply = (fromContent ? parsed.visible : content).trim();
    if (!reply) return;
    chat.mes = JSON.stringify({ reply, changes:parsed.changes });
    console.log(`[Memo-N] DeepSeek前置变化块已转换为内部严格信封｜changes=${parsed.changes.length}`);
}

globalThis.__memoNNormalizeDeepSeekReply = normalizeDeepSeekReplyBeforeRecordEngine;
APP.eventSource.on(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, reinforceRecordProtocol);
APP.eventSource.makeLast?.(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, reinforceRecordProtocol);
console.log('[Memo-N] 当前表格双路由记录守卫已加载');
