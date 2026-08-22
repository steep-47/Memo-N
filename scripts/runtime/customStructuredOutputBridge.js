import { APP } from '../../core/manager.js';
import { oai_settings } from '/scripts/openai.js';

const TABLE_MARKER = '# dataTable 世界状态记忆';
const RECORD_MARKER = '[Memo-N record envelope v1]';
const OUTPUT_HEADING = '# 输出';

const schema = {
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
                        table: { type: 'integer', minimum: 0 },
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

const OUTPUT = `# 输出\n- 本轮由Memo-N使用CUSTOM端点原生JSON Schema强约束。最终响应必须是一个JSON对象，JSON外不得出现任何字符。\n- 格式固定为：{"reply":"完整正常正文","changes":[{"op":"insert|update|delete","table":0,"row":0,"cells":[{"column":0,"value":"值"}]}]}。\n- reply必须完整保留原预设要求的正文、状态栏、选项、角色留言等全部结构，不得为了记录省略正文。\n- changes只记录本轮正文已经明确确认的事实变化；没有变化时必须为[]。\n- insert的row必须为null；update/delete的row只能使用当前表格第一列真实存在的rowIndex；delete的cells必须为[]；空表首次记录只能insert。\n- cells中的column为列号整数，value只能是字符串或数字；不得重复column。\n- 日期、时间、地点、当前场景人物任一发生变化时必须维护表0。\n- 不得输出tableEdit、MEMO_N_EDIT、SQL、Markdown代码围栏或额外字段。`;

const CONTRACT = `${RECORD_MARKER}\n本轮使用SillyTavern CUSTOM OpenAI兼容端点的原生JSON Schema结构化输出。\n最终响应必须严格符合Memo-N已经附加到请求中的json_schema；JSON外不得出现任何字符。\nreply字段必须包含给用户看的完整正常回复，并完整保留原预设要求的正文、状态栏、选项和角色留言。\nchanges字段只记录本轮正文已经明确确认的事实变化。没有变化时changes必须为[]。\ninsert的row必须为null；update/delete的row必须是当前表格真实存在的整数rowIndex；delete的cells必须为[]；空表首次记录只能insert。\n日期、时间、地点、当前场景人物发生变化时必须维护表0。\n禁止输出tableEdit、MEMO_N_EDIT、SQL、Markdown代码围栏、解释或额外字段。`;

function sourceOf(data) {
    return String(data?.chat_completion_source ?? oai_settings?.chat_completion_source ?? '').trim().toLowerCase();
}

function enforceNativeStructuredOutput(data) {
    if (!data || typeof data !== 'object' || sourceOf(data) !== 'custom' || !Array.isArray(data.messages)) return;

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

    // SillyTavern 2026-04-30 起会把 CUSTOM 的 json_schema 转译成
    // OpenAI 标准 response_format:{type:'json_schema',...}，流式路径也会透传。
    data.json_schema = structuredClone(schema);
    globalThis.__memoNCustomStructured = { at: Date.now(), tableCount, contractCount, schema: true };
    console.log(`[Memo-N] CUSTOM原生JSON Schema已恢复｜tablePrompt=${tableCount}｜recordContract=${contractCount}`);
}

const event = APP.event_types.CHAT_COMPLETION_SETTINGS_READY;
APP.eventSource.on(event, enforceNativeStructuredOutput);
APP.eventSource.makeLast?.(event, enforceNativeStructuredOutput);

console.log('[Memo-N] CUSTOM结构化输出桥已加载：CUSTOM使用原生json_schema；非CUSTOM中转仍走哨兵兜底');
