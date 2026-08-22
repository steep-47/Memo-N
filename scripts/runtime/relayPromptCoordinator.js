import { APP } from '../../core/manager.js';
import { oai_settings } from '/scripts/openai.js';

const TABLE_PROMPT_MARKER = '# dataTable 世界状态记忆';
const RECORD_MARKER = '[Memo-N record envelope v1]';
const OUTPUT_HEADING = '# 输出';
const RELAY_OUTPUT = `# 输出\n- 本轮使用Memo-N中转站一次API协议。正文必须完整保留原预设要求的状态栏、选项、角色留言等结构，不得为了记录省略或改写正文组成部分。\n- 如果当前模型/API提供隐藏的reasoning/思考通道：请在隐藏思考中生成一个且仅一个<tableEdit>记录块，最终正文中不要出现tableEdit。\n- 如果当前请求没有可用的隐藏reasoning通道：才在完整正文全部结束后追加一个且仅一个<tableEdit>记录块，块后不得再输出任何字符。\n- 唯一允许的表格操作是insertRow(tableIndex,{columnIndex:value,...})、updateRow(tableIndex,rowIndex,{columnIndex:value,...})、deleteRow(tableIndex,rowIndex)。\n- updateRow/deleteRow只能使用当前表格第一列真实存在的rowIndex；空表首次记录只能insertRow。\n- 无任何事实变化时记录块必须为<tableEdit><!-- NO_CHANGE --></tableEdit>。有变化时使用<tableEdit><!-- 函数调用 --></tableEdit>。\n- 不得使用JSON变更信封、SQL、Markdown代码围栏或解释记录块。\n- 日期、时间、地点、当前场景人物任一发生变化时必须维护表0。`;
const RELAY_RECORD_CONTRACT = `${RECORD_MARKER}\n本轮使用中转站兼容协议，记录与正文分离。\n优先规则：如果当前模型/API存在隐藏reasoning/思考通道，请在隐藏思考中先生成且只生成一个<tableEdit>机器块；最终给用户看的正文完全按原预设输出，正文中不要出现tableEdit，也不得因此省略状态栏、选项、角色留言等内容。\n仅当没有可用的隐藏reasoning通道时，才在完整正文结束后追加且只追加一个<tableEdit>机器块，块后不得再输出任何字符。\n记录块示例：\n<tableEdit><!--\nupdateRow(0,0,{1:\"08:30\"})\n--></tableEdit>\n只有当前表格里真实存在的rowIndex才能用于updateRow/deleteRow；空表首次记录只能insertRow。唯一允许的操作是insertRow(tableIndex,{columnIndex:value,...})、updateRow(tableIndex,rowIndex,{columnIndex:value,...})、deleteRow(tableIndex,rowIndex)。\n没有任何事实变化时必须生成<tableEdit><!-- NO_CHANGE --></tableEdit>。不得使用SQL、JSON、Markdown代码围栏或解释机器块。\n日期、时间、地点、当前场景人物发生变化时必须维护表0。`;

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

    console.log(`[Memo-N] 中转站提示已协调：优先隐藏reasoning记录，不改user消息｜tablePrompt=${rewritten}｜recordContract=${contracts}｜source=${endpoint.source || 'unknown'}｜customUrl=${endpoint.customUrl}｜reverseProxy=${endpoint.reverseProxy}`);
}

const event = APP.event_types.CHAT_COMPLETION_SETTINGS_READY;
APP.eventSource.on(event, coordinateRelayPrompt);
APP.eventSource.makeLast?.(event, coordinateRelayPrompt);

console.log('[Memo-N] 中转站提示协调器已加载：reasoning优先记录，正文结构保持原预设；直连不变');
