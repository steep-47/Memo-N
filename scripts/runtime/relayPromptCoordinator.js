import { APP } from '../../core/manager.js';
import { oai_settings } from '/scripts/openai.js';

const TABLE_PROMPT_MARKER = '# dataTable 世界状态记忆';
const RECORD_MARKER = '[Memo-N record envelope v1]';
const OUTPUT_HEADING = '# 输出';
const BEGIN = 'MEMO_N_EDIT_BEGIN';
const END = 'MEMO_N_EDIT_END';

const RELAY_OUTPUT = `# 输出\n- 本轮使用Memo-N中转站一次API协议：先输出完整正常正文，再在正文末尾追加一个且仅一个纯文本记录块。\n- 正文必须完整保留原本要求的状态栏、选项、角色留言等结构；不得为了记录块省略任何正文组成部分。\n- 记录块格式：\n${BEGIN}\nupdateRow(0,0,{1:"08:30"})\n${END}\n- 唯一允许的表格操作是insertRow(tableIndex,{columnIndex:value,...})、updateRow(tableIndex,rowIndex,{columnIndex:value,...})、deleteRow(tableIndex,rowIndex)。\n- updateRow/deleteRow只能使用当前表格第一列真实存在的rowIndex；空表首次记录只能insertRow。\n- 无任何事实变化时块内只写NO_CHANGE。\n- ${END}之后不得再输出任何字符；不得使用XML/HTML标签、JSON变更信封、SQL、Markdown代码围栏或解释。\n- 日期、时间、地点、当前场景人物任一发生变化时必须维护表0。`;

const RELAY_RECORD_CONTRACT = `${RECORD_MARKER}\n本轮使用中转站纯文本记录协议。先正常输出给用户看的完整回复，保持原有正文、状态栏、选项和角色留言格式；不要把正文包进JSON，也不得为了记录省略任何正文组成部分。\n完整回复结束后必须追加且只追加一个纯文本机器块：\n${BEGIN}\nupdateRow(0,0,{1:"08:30"})\n${END}\n只有当前表格里真实存在的rowIndex才能用于updateRow/deleteRow；空表首次记录只能insertRow。唯一允许的操作是insertRow(tableIndex,{columnIndex:value,...})、updateRow(tableIndex,rowIndex,{columnIndex:value,...})、deleteRow(tableIndex,rowIndex)。\n没有任何事实变化时输出：\n${BEGIN}\nNO_CHANGE\n${END}\n不得输出<tableEdit>或其他XML/HTML标签，不得使用SQL，不得解释机器块，不得放进Markdown代码围栏。${END}之后不得再输出任何字符。\n日期、时间、地点、当前场景人物发生变化时必须维护表0。`;

function relayRequestInfo(data) {
    const source = String(data?.chat_completion_source ?? oai_settings?.chat_completion_source ?? '').trim().toLowerCase();
    const customUrl = String(data?.custom_url ?? oai_settings?.custom_url ?? '').trim();
    const reverseProxy = String(data?.reverse_proxy ?? oai_settings?.reverse_proxy ?? '').trim();
    return { relay: source === 'custom' || Boolean(customUrl) || Boolean(reverseProxy), source, customUrl: Boolean(customUrl), reverseProxy: Boolean(reverseProxy) };
}

function rewriteMemoPrompt(message) {
    const content = String(message?.content ?? '');
    if (!content.includes(TABLE_PROMPT_MARKER)) return false;
    const index = content.lastIndexOf(OUTPUT_HEADING);
    if (index >= 0) message.content = `${content.slice(0, index).trimEnd()}\n${RELAY_OUTPUT}`;
    else message.content = `${content.trimEnd()}\n${RELAY_OUTPUT}`;
    return true;
}

function rewriteRecordContract(message) {
    const content = String(message?.content ?? '');
    if (!content.includes(RECORD_MARKER)) return false;
    message.content = RELAY_RECORD_CONTRACT;
    return true;
}

function coordinateRelayPrompt(data) {
    if (!data || typeof data !== 'object') return;
    const endpoint = relayRequestInfo(data);
    if (!endpoint.relay || !Array.isArray(data.messages)) return;

    let rewritten = 0;
    let contracts = 0;
    for (const message of data.messages) {
        if (rewriteMemoPrompt(message)) rewritten++;
        if (rewriteRecordContract(message)) contracts++;
    }

    console.log(`[Memo-N] 中转站提示已协调：纯文本哨兵｜tablePrompt=${rewritten}｜recordContract=${contracts}｜source=${endpoint.source || 'unknown'}｜customUrl=${endpoint.customUrl}｜reverseProxy=${endpoint.reverseProxy}`);
}

const event = APP.event_types.CHAT_COMPLETION_SETTINGS_READY;
APP.eventSource.on(event, coordinateRelayPrompt);
APP.eventSource.makeLast?.(event, coordinateRelayPrompt);

console.log('[Memo-N] 中转站提示协调器已加载：纯文本哨兵；不改写user消息');
