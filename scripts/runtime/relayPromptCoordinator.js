import { APP } from '../../core/manager.js';
import { oai_settings } from '/scripts/openai.js';

const TABLE_PROMPT_MARKER = '# dataTable 世界状态记忆';
const OUTPUT_HEADING = '# 输出';
const USER_REMINDER_MARKER = '[Memo-N relay final reminder]';
const RELAY_OUTPUT = `# 输出\n- 本轮使用Memo-N中转站一次API协议：先输出完整正常正文，再在正文末尾追加一个且仅一个<tableEdit>记录块。\n- 唯一允许的表格操作是insertRow(tableIndex,{columnIndex:value,...})、updateRow(tableIndex,rowIndex,{columnIndex:value,...})、deleteRow(tableIndex,rowIndex)。\n- updateRow/deleteRow只能使用当前表格第一列真实存在的rowIndex；空表首次记录只能insertRow。\n- 无任何事实变化时必须输出<tableEdit><!-- NO_CHANGE --></tableEdit>。有变化时输出<tableEdit><!-- 函数调用 --></tableEdit>。\n- <tableEdit>之后不得再输出任何字符；不得使用JSON变更信封、SQL、Markdown代码围栏或解释。\n- 日期、时间、地点、当前场景人物任一发生变化时必须维护表0。`;
const FINAL_USER_REMINDER = `${USER_REMINDER_MARKER}\n保持原有用户请求与正文写作要求不变。完成完整正文后，最后必须输出且只输出一个<tableEdit><!-- ... --></tableEdit>记录块；若七表无变化也必须输出<tableEdit><!-- NO_CHANGE --></tableEdit>。不得省略tableEdit，块后不得再输出任何字符。`;

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

function reinforceLastUserMessage(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (String(message?.role ?? '').toLowerCase() !== 'user') continue;
        const content = String(message?.content ?? '');
        if (!content.includes(USER_REMINDER_MARKER)) message.content = `${content.trimEnd()}\n\n${FINAL_USER_REMINDER}`;
        return true;
    }
    return false;
}

function coordinateRelayPrompt(data) {
    if (!data || typeof data !== 'object') return;
    const endpoint = relayRequestInfo(data);
    if (!endpoint.relay || !Array.isArray(data.messages)) return;

    let rewritten = 0;
    for (const message of data.messages) if (rewriteMemoPrompt(message)) rewritten++;
    const reinforced = reinforceLastUserMessage(data.messages);

    if (rewritten) {
        console.log(`[Memo-N] 中转站提示已协调并强化最后user消息｜count=${rewritten}｜reinforced=${reinforced}｜source=${endpoint.source || 'unknown'}｜customUrl=${endpoint.customUrl}｜reverseProxy=${endpoint.reverseProxy}`);
    } else {
        console.warn(`[Memo-N] 中转站提示协调器未找到dataTable主提示；最后user强化=${reinforced}，保留recordEngine末尾tableEdit协议作为兜底`);
    }
}

const event = APP.event_types.CHAT_COMPLETION_SETTINGS_READY;
APP.eventSource.on(event, coordinateRelayPrompt);
APP.eventSource.makeLast?.(event, coordinateRelayPrompt);

console.log('[Memo-N] 中转站提示协调器已加载：仅中转站改写dataTable输出段并强化最后user收尾要求，直连不变');
