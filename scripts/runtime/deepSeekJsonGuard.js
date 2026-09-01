import { APP, BASE, USER } from '../../core/manager.js';
import { ROUTE, getProviderRoute } from './providerRoute.js';

const RECORD_MARKER = '[Memo-N record envelope v1]';

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

function buildSchema() {
    const sheets = currentWorldSheets();
    const maxTable = Math.max(0, sheets.length - 1);
    return {
        name: 'memo_n_record_envelope',
        strict: true,
        value: {
            type: 'object',
            additionalProperties: false,
            properties: {
                reply: { type: 'string' },
                changes: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            op: { type: 'string', enum: ['insert', 'update', 'delete'] },
                            table: { type: 'integer', minimum: 0, maximum: maxTable },
                            row: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
                            cells: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    additionalProperties: false,
                                    properties: {
                                        column: { type: 'integer', minimum: 0 },
                                        value: { anyOf: [{ type: 'string' }, { type: 'number' }] },
                                    },
                                    required: ['column', 'value'],
                                },
                            },
                        },
                        required: ['op', 'table', 'row', 'cells'],
                    },
                },
            },
            required: ['reply', 'changes'],
        },
    };
}

function reinforceDeepSeekJson(data) {
    if (!isManagedRecordRequest(data)) return;

    // SillyTavern 的 Chat Completion 扩展负载原生识别 json_schema；
    // 同时保留 DeepSeek 原生 json_object 提示，避免只写 response_format 时约束未真正落到请求。
    data.json_schema = buildSchema();
    data.response_format = { type: 'json_object' };

    const messages = Array.isArray(data.messages) ? data.messages : [];
    messages.push({
        role: 'system',
        content: `[Memo-N DeepSeek JSON最终校验]\n下面“当前实际表格映射”覆盖前文任何旧的七表名称或列号描述：\n${tableMapText()}\n最终响应必须从字符 { 开始、以字符 } 结束，且只能是一个JSON对象：{"reply":"完整正常正文","changes":[]}。reply内可以包含原本要求的状态栏、选项、列表或其他正文格式，但这些内容必须作为JSON字符串的一部分，不能直接出现在JSON对象外。changes只能引用上面的真实table/column；没有可确认变化时使用空数组。禁止顶层数组、Markdown代码围栏、tableEdit和JSON外文字。`,
    });

    globalThis.__memoNDeepSeekJsonGuardProbe = Object.freeze({
        at: Date.now(),
        tableCount: currentWorldSheets().length,
        jsonSchema: true,
        jsonObject: true,
    });
}

APP.eventSource.on(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, reinforceDeepSeekJson);
APP.eventSource.makeLast?.(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, reinforceDeepSeekJson);

console.log('[Memo-N] DeepSeek JSON最终校验已加载：使用SillyTavern json_schema + DeepSeek json_object，且按当前真实表格动态约束');
