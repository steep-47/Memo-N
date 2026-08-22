import { APP, EDITOR } from '../../core/manager.js';
import { oai_settings } from '/scripts/openai.js';

const MARKER = '[Memo-N record envelope v1]';
const TABLE_MARKER = '# dataTable 世界状态记忆';
const USER_REMINDER_MARKER = '[Memo-N relay final reminder]';
let lastRequestSummary = null;
let requestSerial = 0;

function requestInfo(data) {
    const source = String(data?.chat_completion_source ?? oai_settings?.chat_completion_source ?? '').trim().toLowerCase();
    const customUrl = String(data?.custom_url ?? oai_settings?.custom_url ?? '').trim();
    const reverseProxy = String(data?.reverse_proxy ?? oai_settings?.reverse_proxy ?? '').trim();
    return { relay: source === 'custom' || Boolean(customUrl) || Boolean(reverseProxy), source: source || 'unknown', customUrl: Boolean(customUrl), reverseProxy: Boolean(reverseProxy) };
}

function summarizeMessage(message) {
    const content = String(message?.content ?? '');
    return {
        memoContract: content.includes(MARKER),
        tablePrompt: content.includes(TABLE_MARKER),
        userReminder: content.includes(USER_REMINDER_MARKER),
        asksTableEdit: /tableEdit/i.test(content),
        asksJson: /JSON变更信封|只能是一个JSON对象|json_schema/i.test(content),
    };
}

function codeFor(summary, outcome = null) {
    if (!summary) return 'DBG P0 T0 E0 U0 J0 O?';
    return `DBG P${summary.endpoint.relay ? 1 : 0} T${summary.tablePromptTableEdit ? 1 : 0} E${summary.contractTableEdit ? 1 : 0} U${summary.userReminder ? 1 : 0} J${summary.jsonSchemaPresent ? 1 : 0} O${outcome === null ? '?' : outcome ? 1 : 0}`;
}

function logRelayRequest(data) {
    if (!data || typeof data !== 'object') return;
    const endpoint = requestInfo(data);
    if (!endpoint.relay) return;
    const messages = Array.isArray(data.messages) ? data.messages : [];
    const summaries = messages.map(summarizeMessage);
    const table = summaries.filter(item => item.tablePrompt);
    const contract = summaries.filter(item => item.memoContract);
    lastRequestSummary = {
        serial: ++requestSerial,
        at: Date.now(),
        endpoint,
        messageCount: messages.length,
        jsonSchemaPresent: Boolean(data.json_schema),
        tablePromptFound: table.length > 0,
        tablePromptTableEdit: table.some(item => item.asksTableEdit),
        tablePromptJson: table.some(item => item.asksJson),
        contractFound: contract.length > 0,
        contractTableEdit: contract.some(item => item.asksTableEdit),
        contractJson: contract.some(item => item.asksJson),
        userReminder: summaries.some(item => item.userReminder && item.asksTableEdit),
    };
    globalThis.__memoNRelayDebug = { ...lastRequestSummary, code: codeFor(lastRequestSummary, null) };
    console.log('[Memo-N][debug] 中转站最终请求摘要', globalThis.__memoNRelayDebug);
}

function inspectRendered(chatId) {
    const summary = lastRequestSummary;
    if (!summary || Date.now() - summary.at > 300000) return;
    const chat = APP.getContext?.()?.chat?.[chatId];
    if (!chat || chat.is_user) return;
    const content = String(chat.mes ?? '');
    const swipeId = Number(chat.swipe_id);
    const reasoning = String((Number.isInteger(swipeId) && swipeId >= 0 ? chat?.swipe_info?.[swipeId]?.extra?.reasoning : '') || chat?.extra?.reasoning || '');
    const found = /<tableEdit\b/i.test(content) || /<tableEdit\b/i.test(reasoning);
    const code = codeFor(summary, found);
    globalThis.__memoNRelayDebug = { ...summary, foundTableEdit: found, code };
    console.log('[Memo-N][debug] 中转站本轮结果', globalThis.__memoNRelayDebug);
    setTimeout(() => {
        EDITOR.info(`Memo-N诊断：${code}`,'',5000);
    }, 250);
}

const requestEvent = APP.event_types.CHAT_COMPLETION_SETTINGS_READY;
APP.eventSource.on(requestEvent, logRelayRequest);
APP.eventSource.makeLast?.(requestEvent, logRelayRequest);

const renderedEvent = APP.event_types.CHARACTER_MESSAGE_RENDERED;
APP.eventSource.on(renderedEvent, inspectRendered);
APP.eventSource.makeFirst?.(renderedEvent, inspectRendered);

console.log('[Memo-N][debug] 手机诊断Toast已加载；P=中转站 T=dataTable要求tableEdit E=末尾协议tableEdit U=最后user强化 J=json_schema残留 O=实际输出tableEdit');
