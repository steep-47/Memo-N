import { APP } from '../../core/manager.js';
import { oai_settings } from '/scripts/openai.js';

const MARKER = '[Memo-N record envelope v1]';
const TABLE_MARKER = '# dataTable 世界状态记忆';

function requestInfo(data) {
    const source = String(data?.chat_completion_source ?? oai_settings?.chat_completion_source ?? '').trim().toLowerCase();
    const customUrl = String(data?.custom_url ?? oai_settings?.custom_url ?? '').trim();
    const reverseProxy = String(data?.reverse_proxy ?? oai_settings?.reverse_proxy ?? '').trim();
    return { relay: source === 'custom' || Boolean(customUrl) || Boolean(reverseProxy), source: source || 'unknown', customUrl: Boolean(customUrl), reverseProxy: Boolean(reverseProxy) };
}

function summarizeMessage(message, index) {
    const content = String(message?.content ?? '');
    const memoContract = content.includes(MARKER);
    const tablePrompt = content.includes(TABLE_MARKER);
    const asksTableEdit = /<tableEdit>/i.test(content) || /tableEdit/i.test(content);
    const asksJson = /JSON变更信封|只能是一个JSON对象|json_schema/i.test(content);
    return {
        index,
        role: String(message?.role ?? ''),
        chars: content.length,
        memoContract,
        tablePrompt,
        asksTableEdit,
        asksJson,
        tail: (memoContract || tablePrompt) ? content.slice(-500) : '',
    };
}

function logRelayRequest(data) {
    if (!data || typeof data !== 'object') return;
    const endpoint = requestInfo(data);
    if (!endpoint.relay) return;
    const messages = Array.isArray(data.messages) ? data.messages : [];
    const summaries = messages.map(summarizeMessage).filter(item => item.memoContract || item.tablePrompt);
    console.groupCollapsed?.('[Memo-N][debug] 中转站最终请求摘要');
    console.log('[Memo-N][debug] endpoint', endpoint);
    console.log('[Memo-N][debug] messageCount', messages.length, 'memoMessages', summaries.length, 'jsonSchemaPresent', Boolean(data.json_schema));
    for (const item of summaries) console.log('[Memo-N][debug] message', item);
    console.groupEnd?.();
}

const event = APP.event_types.CHAT_COMPLETION_SETTINGS_READY;
APP.eventSource.on(event, logRelayRequest);
APP.eventSource.makeLast?.(event, logRelayRequest);

console.log('[Memo-N][debug] 中转站安全调试日志已加载；不打印API Key或完整聊天正文');
