import { APP, USER } from '../../core/manager.js';
import { ROUTE, getProviderRoute } from './providerRoute.js';
import { changesToStrictCalls, parseRecordEnvelope } from '../engine/recordEnvelope.js';

const MARKER = '[Memo-N record envelope v1]';

const CONTRACT = `${MARKER}
本轮为DeepSeek直连记录协议。最终响应必须只输出一个JSON对象，JSON外不得出现任何字符：
{"reply":"完整正常回复","changes":[{"op":"insert|update|delete","table":0,"row":0,"cells":[{"column":0,"value":"值"}]}]}
reply必须完整保留正文、状态栏、行动选项和伊依自然反应；changes只记录剧情世界七表中本轮已经确认的新事实或变化，没有变化时为[]。
insert的row必须为null；update/delete的row必须是当前表格真实存在的整数rowIndex；delete的cells必须为[]；cells中的column必须是列号整数，value只能是字符串或数字。
伊依不是剧情世界实体，禁止把伊依写入#0/#3/#4/#5/#6世界记录；伊依只使用独立长期记忆库。
禁止输出tableEdit、Markdown代码围栏、解释或额外字段。`;

function onRequest(data) {
    if (!data || typeof data !== 'object' || getProviderRoute(data) !== ROUTE.DEEPSEEK || !Array.isArray(data.messages)) return;
    data.messages = data.messages.filter(message => !String(message?.content ?? '').includes(MARKER));
    data.messages.push({ role: 'system', content: CONTRACT });
    delete data.json_schema;
    // DeepSeek 官方 OpenAI 兼容接口支持 JSON Output；只约束外层为 JSON object，不使用 json_schema。
    data.response_format = { type: 'json_object' };
    globalThis.__memoNDeepSeekAdapter = { at: Date.now(), request: true };
    console.log('[Memo-N] DeepSeek独立JSON记录适配器已接管请求');
}

function syncSwipe(chat) {
    const id = Number(chat?.swipe_id);
    if (Array.isArray(chat?.swipes) && Number.isInteger(id) && id >= 0 && id < chat.swipes.length) chat.swipes[id] = chat.mes;
}

function reasoningText(chat) {
    const swipeId = Number(chat?.swipe_id);
    const swipeReasoning = Number.isInteger(swipeId) && swipeId >= 0
        ? chat?.swipe_info?.[swipeId]?.extra?.reasoning
        : '';
    return String(swipeReasoning || chat?.extra?.reasoning || '').trim();
}

function envelopeToTableEdit(envelope) {
    const calls = changesToStrictCalls(envelope.changes);
    if (calls.length === 1 && calls[0] === 'NO_CHANGE') return '<tableEdit><!-- NO_CHANGE --></tableEdit>';
    return `<tableEdit><!--\n${calls.join('\n')}\n--></tableEdit>`;
}

function onGenerationEnd() {
    if (getProviderRoute({}) !== ROUTE.DEEPSEEK) return;
    const chat = USER?.getContext?.()?.chat;
    if (!Array.isArray(chat) || !chat.length) return;
    let piece = null;
    for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i]?.is_user === false) { piece = chat[i]; break; }
    }
    if (!piece) return;

    const content = String(piece.mes ?? '').trim();
    const reasoning = reasoningText(piece);
    const contentEnvelope = content ? parseRecordEnvelope(content) : null;
    const reasoningEnvelope = reasoning ? parseRecordEnvelope(reasoning) : null;
    const envelope = contentEnvelope?.ok ? contentEnvelope : reasoningEnvelope?.ok ? reasoningEnvelope : null;
    if (!envelope) return;

    piece.mes = `${envelope.reply}\n\n${envelopeToTableEdit(envelope)}`;
    syncSwipe(piece);
    globalThis.__memoNDeepSeekAdapter = { at: Date.now(), request: true, converted: true, changes: envelope.changes.length };
    console.log(`[Memo-N] DeepSeek JSON信封已转换为稳定执行块｜changes=${envelope.changes.length}`);
}

const requestEvent = APP.event_types.CHAT_COMPLETION_SETTINGS_READY;
APP.eventSource.on(requestEvent, onRequest);
APP.eventSource.makeLast?.(requestEvent, onRequest);

const endEvent = APP.event_types.GENERATION_ENDED;
APP.eventSource.on(endEvent, onGenerationEnd);
APP.eventSource.makeFirst?.(endEvent, onGenerationEnd);

console.log('[Memo-N] DeepSeek独立记录适配器已加载');
