import { APP } from '../../core/manager.js';
import { oai_settings } from '/scripts/openai.js';

const MARKER = '[Memo-N record envelope v1]';
const TABLE_MARKER = '# dataTable 世界状态记忆';
let lastRequestSummary = null;

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
    return {
        index,
        role: String(message?.role ?? ''),
        chars: content.length,
        memoContract,
        tablePrompt,
        asksTableEdit: /tableEdit/i.test(content),
        asksJson: /JSON变更信封|只能是一个JSON对象|json_schema/i.test(content),
    };
}

function ensurePanel() {
    let panel = document.getElementById('memo-n-relay-debug-panel');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'memo-n-relay-debug-panel';
    panel.style.cssText = 'position:fixed;left:10px;right:10px;bottom:12px;z-index:2147483646;background:rgba(20,20,24,.96);color:#f3f3f3;border:1px solid rgba(255,255,255,.18);border-radius:12px;padding:10px 12px;font-size:12px;line-height:1.45;box-shadow:0 8px 30px rgba(0,0,0,.35);max-height:42vh;overflow:auto;display:none;';
    panel.innerHTML = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px"><b style="flex:1">Memo-N 中转站调试</b><button data-copy style="padding:4px 8px">复制</button><button data-close style="padding:4px 8px">关闭</button></div><pre data-body style="white-space:pre-wrap;word-break:break-word;margin:0;font:inherit"></pre>';
    panel.querySelector('[data-close]').addEventListener('click', () => { panel.style.display = 'none'; });
    panel.querySelector('[data-copy]').addEventListener('click', async () => {
        const text = panel.querySelector('[data-body]').textContent || '';
        try { await navigator.clipboard.writeText(text); panel.querySelector('[data-copy]').textContent = '已复制'; setTimeout(() => panel.querySelector('[data-copy]').textContent = '复制', 1200); }
        catch (_) { try { prompt('复制下面内容', text); } catch (_) {} }
    });
    document.body.appendChild(panel);
    return panel;
}

function showPanel(result = null) {
    if (!lastRequestSummary) return;
    const panel = ensurePanel();
    const r = lastRequestSummary;
    const lines = [
        `source: ${r.endpoint.source}`,
        `reverse_proxy: ${r.endpoint.reverseProxy ? '是' : '否'}  custom_url: ${r.endpoint.customUrl ? '是' : '否'}`,
        `messages: ${r.messageCount}  Memo相关: ${r.memoMessages}`,
        `json_schema残留: ${r.jsonSchemaPresent ? '是' : '否'}`,
        `dataTable主提示: ${r.tablePromptFound ? '有' : '无'}  tableEdit要求: ${r.tablePromptTableEdit ? '有' : '无'}  JSON要求: ${r.tablePromptJson ? '有' : '无'}`,
        `recordEngine末尾协议: ${r.contractFound ? '有' : '无'}  tableEdit要求: ${r.contractTableEdit ? '有' : '无'}  JSON要求: ${r.contractJson ? '有' : '无'}`,
    ];
    if (result) {
        lines.push(`本轮正文含tableEdit: ${result.contentTableEdit ? '有' : '无'}`);
        lines.push(`本轮reasoning含tableEdit: ${result.reasoningTableEdit ? '有' : '无'}`);
        lines.push(`最终结果: ${result.found ? '找到记录块' : '没有记录块'}`);
    } else {
        lines.push('最终结果: 等待本轮回复…');
    }
    panel.querySelector('[data-body]').textContent = lines.join('\n');
    panel.style.display = 'block';
}

function logRelayRequest(data) {
    if (!data || typeof data !== 'object') return;
    const endpoint = requestInfo(data);
    if (!endpoint.relay) return;
    const messages = Array.isArray(data.messages) ? data.messages : [];
    const summaries = messages.map(summarizeMessage).filter(item => item.memoContract || item.tablePrompt);
    const table = summaries.filter(item => item.tablePrompt);
    const contract = summaries.filter(item => item.memoContract);
    lastRequestSummary = {
        endpoint,
        messageCount: messages.length,
        memoMessages: summaries.length,
        jsonSchemaPresent: Boolean(data.json_schema),
        tablePromptFound: table.length > 0,
        tablePromptTableEdit: table.some(item => item.asksTableEdit),
        tablePromptJson: table.some(item => item.asksJson),
        contractFound: contract.length > 0,
        contractTableEdit: contract.some(item => item.asksTableEdit),
        contractJson: contract.some(item => item.asksJson),
    };
    console.log('[Memo-N][debug] 中转站最终请求摘要', lastRequestSummary);
    showPanel();
}

function inspectRendered(chatId) {
    if (!lastRequestSummary) return;
    const chat = APP.getContext?.()?.chat?.[chatId];
    if (!chat || chat.is_user) return;
    const content = String(chat.mes ?? '');
    const swipeId = Number(chat.swipe_id);
    const reasoning = String((Number.isInteger(swipeId) && swipeId >= 0 ? chat?.swipe_info?.[swipeId]?.extra?.reasoning : '') || chat?.extra?.reasoning || '');
    const result = {
        contentTableEdit: /<tableEdit\b/i.test(content),
        reasoningTableEdit: /<tableEdit\b/i.test(reasoning),
    };
    result.found = result.contentTableEdit || result.reasoningTableEdit;
    showPanel(result);
}

const requestEvent = APP.event_types.CHAT_COMPLETION_SETTINGS_READY;
APP.eventSource.on(requestEvent, logRelayRequest);
APP.eventSource.makeLast?.(requestEvent, logRelayRequest);

const renderedEvent = APP.event_types.CHARACTER_MESSAGE_RENDERED;
APP.eventSource.on(renderedEvent, inspectRendered);
APP.eventSource.makeFirst?.(renderedEvent, inspectRendered);

console.log('[Memo-N][debug] 手机中转站调试面板已加载；不打印API Key或完整聊天正文');
