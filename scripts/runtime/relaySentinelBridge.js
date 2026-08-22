import { APP, USER } from '../../core/manager.js';
import { oai_settings } from '/scripts/openai.js';

const TABLE_MARKER = '# dataTable 世界状态记忆';
const RECORD_MARKER = '[Memo-N record envelope v1]';
const OUTPUT_HEADING = '# 输出';
const BEGIN = 'MEMO_N_EDIT_BEGIN';
const END = 'MEMO_N_EDIT_END';

const OUTPUT = `# 输出\n- 本轮使用Memo-N中转站一次API协议：先输出完整正常正文，再在正文末尾追加一个且仅一个纯文本记录块。\n- 正文必须完整保留原本要求的状态栏、选项、角色留言等结构；不得为了记录省略正文组成部分。\n- 记录块格式固定为：\n${BEGIN}\nupdateRow(0,0,{1:"08:30"})\n${END}\n- 唯一允许的表格操作是insertRow(tableIndex,{columnIndex:value,...})、updateRow(tableIndex,rowIndex,{columnIndex:value,...})、deleteRow(tableIndex,rowIndex)。\n- updateRow/deleteRow只能使用当前表格第一列真实存在的rowIndex；空表首次记录只能insertRow。\n- 无任何事实变化时记录块正文只写NO_CHANGE。\n- ${END}之后不得再输出任何字符；不得使用XML/HTML标签、JSON变更信封、SQL、Markdown代码围栏或解释。\n- 日期、时间、地点、当前场景人物任一发生变化时必须维护表0。`;

const CONTRACT = `${RECORD_MARKER}\n本轮使用中转站纯文本记录协议。先正常输出给用户看的完整回复，保持原有正文、状态栏、选项和角色留言格式；不要把正文包进JSON，也不得为了记录省略任何正文组成部分。\n完整回复结束后必须追加且只追加一个纯文本机器块：\n${BEGIN}\nupdateRow(0,0,{1:"08:30"})\n${END}\n只有当前表格里真实存在的rowIndex才能用于updateRow/deleteRow；空表首次记录只能insertRow。唯一允许的操作是insertRow(tableIndex,{columnIndex:value,...})、updateRow(tableIndex,rowIndex,{columnIndex:value,...})、deleteRow(tableIndex,rowIndex)。\n没有任何事实变化时输出：\n${BEGIN}\nNO_CHANGE\n${END}\n不得输出<tableEdit>或任何XML/HTML标签，不得使用SQL，不得解释机器块，不得放进Markdown代码围栏。${END}之后不得再输出任何字符。\n日期、时间、地点、当前场景人物发生变化时必须维护表0。`;

function isRelay(data) {
    const source = String(data?.chat_completion_source ?? oai_settings?.chat_completion_source ?? '').trim().toLowerCase();
    if (source === 'custom') return false;
    const customUrl = String(data?.custom_url ?? oai_settings?.custom_url ?? '').trim();
    const reverseProxy = String(data?.reverse_proxy ?? oai_settings?.reverse_proxy ?? '').trim();
    return Boolean(customUrl) || Boolean(reverseProxy);
}

function rewriteRequest(data) {
    if (!data || typeof data !== 'object' || !isRelay(data) || !Array.isArray(data.messages)) return;
    let tableCount = 0;
    let contractCount = 0;
    for (const message of data.messages) {
        const content = String(message?.content ?? '');
        if (content.includes(TABLE_MARKER)) {
            const index = content.lastIndexOf(OUTPUT_HEADING);
            message.content = index >= 0 ? `${content.slice(0, index).trimEnd()}\n${OUTPUT}` : `${content.trimEnd()}\n${OUTPUT}`;
            tableCount++;
        }
        if (String(message?.content ?? '').includes(RECORD_MARKER)) {
            message.content = CONTRACT;
            contractCount++;
        }
    }
    delete data.json_schema;
    globalThis.__memoNSentinelRequest = { at: Date.now(), tableCount, contractCount };
    console.log(`[Memo-N] 非CUSTOM中转最终协议=纯文本哨兵｜tablePrompt=${tableCount}｜recordContract=${contractCount}`);
}

function convertOne(text) {
    const raw = String(text ?? '');
    const begin = raw.indexOf(BEGIN);
    if (begin < 0) return { text: raw, found: false };
    const end = raw.indexOf(END, begin + BEGIN.length);
    if (end < 0) return { text: raw, found: false };
    if (raw.indexOf(BEGIN, end + END.length) >= 0) return { text: raw, found: false };
    const body = raw.slice(begin + BEGIN.length, end).trim();
    if (!body) return { text: raw, found: false };
    if (raw.slice(end + END.length).trim()) return { text: raw, found: false };
    const machine = `<tableEdit><!--\n${body}\n--></tableEdit>`;
    return { text: `${raw.slice(0, begin).trimEnd()}\n${machine}`.trim(), found: true };
}

function convertLatestResponse() {
    if (String(oai_settings?.chat_completion_source ?? '').trim().toLowerCase() === 'custom') return;
    const chat = USER?.getContext?.()?.chat;
    if (!Array.isArray(chat) || !chat.length) return;
    let piece = null;
    for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i]?.is_user === false) { piece = chat[i]; break; }
    }
    if (!piece) return;

    const content = convertOne(piece.mes);
    if (content.found) {
        piece.mes = content.text;
        const swipeId = Number(piece.swipe_id);
        if (Array.isArray(piece.swipes) && Number.isInteger(swipeId) && swipeId >= 0 && swipeId < piece.swipes.length) piece.swipes[swipeId] = piece.mes;
        console.log('[Memo-N] 正文哨兵已转换为内部tableEdit');
        return;
    }

    const swipeId = Number(piece.swipe_id);
    if (Number.isInteger(swipeId) && swipeId >= 0 && piece?.swipe_info?.[swipeId]?.extra) {
        const converted = convertOne(piece.swipe_info[swipeId].extra.reasoning);
        if (converted.found) {
            piece.swipe_info[swipeId].extra.reasoning = converted.text;
            console.log('[Memo-N] reasoning哨兵已转换为内部tableEdit');
            return;
        }
    }
    if (piece?.extra) {
        const converted = convertOne(piece.extra.reasoning);
        if (converted.found) {
            piece.extra.reasoning = converted.text;
            console.log('[Memo-N] reasoning哨兵已转换为内部tableEdit');
        }
    }
}

const requestEvent = APP.event_types.CHAT_COMPLETION_SETTINGS_READY;
APP.eventSource.on(requestEvent, rewriteRequest);
APP.eventSource.makeLast?.(requestEvent, rewriteRequest);

const endEvent = APP.event_types.GENERATION_ENDED;
APP.eventSource.on(endEvent, convertLatestResponse);
APP.eventSource.makeFirst?.(endEvent, convertLatestResponse);

console.log('[Memo-N] 非CUSTOM中转纯文本哨兵桥已加载；CUSTOM保留原生JSON Schema');
