import { APP, USER } from '../../core/manager.js';
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
            reply: { type: 'string' },
        },
        required: ['changes', 'reply'],
    },
};

const OUTPUT = `# 输出\n- 本轮由Memo-N使用CUSTOM端点原生JSON Schema强约束。最终响应必须是一个JSON对象，JSON外不得出现任何字符。\n- 为保证记录链优先完整，字段顺序必须先changes、后reply：{"changes":[{"op":"insert|update|delete","table":0,"row":0,"cells":[{"column":0,"value":"值"}]}],"reply":"完整正常正文"}。\n- changes必须先完整生成，只记录本轮正文已经明确确认的事实变化；没有变化时必须为[]。\n- reply随后生成，并完整保留原预设要求的正文、状态栏、选项、角色留言等全部结构。\n- insert的row必须为null；update/delete的row只能使用当前表格第一列真实存在的rowIndex；delete的cells必须为[]；空表首次记录只能insert。\n- cells中的column为列号整数，value只能是字符串或数字；不得重复column。\n- 日期、时间、地点、当前场景人物任一发生变化时必须维护表0。\n- 不得输出tableEdit、MEMO_N_EDIT、SQL、Markdown代码围栏或额外字段。`;

const CONTRACT = `${RECORD_MARKER}\n本轮使用SillyTavern CUSTOM OpenAI兼容端点的原生JSON Schema结构化输出。\n最终响应必须严格符合Memo-N已经附加到请求中的json_schema；JSON外不得出现任何字符。\n必须先完整生成changes字段，再生成reply字段。changes是记录链，优先级高于reply；禁止在changes完整闭合前开始reply。\nchanges只记录本轮正文已经明确确认的事实变化；没有变化时changes必须为[]。\nreply字段随后包含给用户看的完整正常回复，并完整保留原预设要求的正文、状态栏、选项和角色留言。\ninsert的row必须为null；update/delete的row必须是当前表格真实存在的整数rowIndex；delete的cells必须为[]；空表首次记录只能insert。\n日期、时间、地点、当前场景人物发生变化时必须维护表0。\n禁止输出tableEdit、MEMO_N_EDIT、SQL、Markdown代码围栏、解释或额外字段。`;

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

    data.json_schema = structuredClone(schema);
    globalThis.__memoNCustomStructured = { at: Date.now(), tableCount, contractCount, schema: true, recordFirst: true };
    console.log(`[Memo-N] CUSTOM原生JSON Schema已恢复（changes优先）｜tablePrompt=${tableCount}｜recordContract=${contractCount}`);
}

function findBalancedArray(text, start) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) { escaped = false; continue; }
            if (ch === '\\') { escaped = true; continue; }
            if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === '[') depth++;
        if (ch === ']') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function decodePartialReply(raw) {
    const marker = '"reply"';
    const key = raw.indexOf(marker);
    if (key < 0) return '';
    const colon = raw.indexOf(':', key + marker.length);
    if (colon < 0) return '';
    const firstQuote = raw.indexOf('"', colon + 1);
    if (firstQuote < 0) return '';
    let body = raw.slice(firstQuote + 1);
    while (body.length && /\\(?:u[0-9a-fA-F]{0,3})?$/.test(body)) body = body.slice(0, -1);
    for (let cut = body.length; cut >= Math.max(0, body.length - 12); cut--) {
        try { return JSON.parse(`"${body.slice(0, cut).replace(/"$/,'')}"`); } catch (_) {}
    }
    return '';
}

function recoverTruncatedEnvelope() {
    if (String(oai_settings?.chat_completion_source ?? '').trim().toLowerCase() !== 'custom') return;
    const chat = USER?.getContext?.()?.chat;
    if (!Array.isArray(chat) || !chat.length) return;
    let piece = null;
    for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i]?.is_user === false) { piece = chat[i]; break; }
    }
    if (!piece) return;

    const raw = String(piece.mes ?? '').trim();
    if (!raw.startsWith('{') || !raw.includes('"changes"')) return;
    try { JSON.parse(raw); return; } catch (_) {}

    const key = raw.indexOf('"changes"');
    const arrayStart = raw.indexOf('[', key);
    if (arrayStart < 0) return;
    const arrayEnd = findBalancedArray(raw, arrayStart);
    if (arrayEnd < 0) return;

    let changes;
    try { changes = JSON.parse(raw.slice(arrayStart, arrayEnd + 1)); } catch (_) { return; }
    const reply = decodePartialReply(raw) || '[本轮正文生成被中转站截断；Memo-N已优先保全并执行本轮记录。]';
    piece.mes = JSON.stringify({ changes, reply });
    const swipeId = Number(piece.swipe_id);
    if (Array.isArray(piece.swipes) && Number.isInteger(swipeId) && swipeId >= 0 && swipeId < piece.swipes.length) piece.swipes[swipeId] = piece.mes;
    globalThis.__memoNRecoveredTruncatedCustom = { at: Date.now(), changes: changes.length, replyRecovered: !reply.startsWith('[本轮正文生成被中转站截断') };
    console.warn(`[Memo-N] CUSTOM响应尾部截断，但changes已完整：已重建信封并优先保全${changes.length}项记录`);
}

const requestEvent = APP.event_types.CHAT_COMPLETION_SETTINGS_READY;
APP.eventSource.on(requestEvent, enforceNativeStructuredOutput);
APP.eventSource.makeLast?.(requestEvent, enforceNativeStructuredOutput);

const endEvent = APP.event_types.GENERATION_ENDED;
APP.eventSource.on(endEvent, recoverTruncatedEnvelope);
APP.eventSource.makeFirst?.(endEvent, recoverTruncatedEnvelope);

console.log('[Memo-N] CUSTOM结构化输出桥已加载：changes优先；完整JSON正常解包；尾部截断时优先保全记录');
