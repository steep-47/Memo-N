import { APP, BASE } from '../../core/manager.js';
import { ROUTE, getProviderRoute } from './providerRoute.js';

const RECORD_MARKER = '[Memo-N record envelope v1]';
const GUARD_MARKER = '[Memo-N DeepSeek JSON最终校验]';

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
    if (!sheets.length) return '当前没有可写入表格；changes必须为[]。';
    return sheets.map((sheet, table) => {
        const headers = (sheet?.getHeader?.() ?? []).map(value => String(value ?? '').trim()).filter(Boolean);
        return `#${table} ${String(sheet?.name ?? `表${table}`)}：${headers.map((header, column) => `${column}=${header}`).join('，')}`;
    }).join('\n');
}

function reinforceDeepSeekJson(data) {
    if (!isManagedRecordRequest(data)) return;

    // 当前 Chat Completion API / 模型会直接拒绝 response_format/json_schema，
    // 因此 DeepSeek 模式只使用提示词约束 JSON，不再发送任何结构化输出 API 字段。
    delete data.json_schema;
    delete data.response_format;

    if (!Array.isArray(data.messages)) return;
    data.messages = data.messages.filter(message => !String(message?.content ?? '').includes(GUARD_MARKER));
    data.messages.push({
        role: 'system',
        content: `${GUARD_MARKER}\n下面“当前实际表格映射”覆盖前文任何旧的七表名称或列号描述：\n${tableMapText()}\n\n本轮最终输出必须严格是一个 JSON 对象，不能输出顶层数组，也不能在 JSON 前后输出任何正文、Markdown 或解释。第一个字符必须是 {，最后一个字符必须是 }。固定结构：\n{"reply":"完整正常正文","changes":[]}\nreply 必须包含原本要求的全部正文、状态栏、选项和留言；这些内容都必须放在 reply 字符串里面。changes 只能引用上面的真实 table/column。没有可确认变化时 changes 为 []。`,
    });

    globalThis.__memoNDeepSeekJsonGuardProbe = Object.freeze({
        at: Date.now(),
        tableCount: currentWorldSheets().length,
        jsonSchema: false,
        responseFormat: false,
        promptOnlyJson: true,
    });

    console.log('[Memo-N] DeepSeek JSON兼容模式：已移除当前API不支持的response_format/json_schema，仅保留最终JSON提示约束');
}

APP.eventSource.on(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, reinforceDeepSeekJson);
APP.eventSource.makeLast?.(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, reinforceDeepSeekJson);

console.log('[Memo-N] DeepSeek JSON兼容守卫已加载：不再发送response_format/json_schema');
