import { APP, USER } from '../../core/manager.js';
import { ROUTE, getProviderRoute } from './providerRoute.js';

const BLOCK_BEGIN = 'MEMO_N_DEEPSEEK_JSON_BEGIN';
const BLOCK_END = 'MEMO_N_DEEPSEEK_JSON_END';
let pendingDeepSeek = false;

function reinforceDeepSeekProtocol(data) {
    if (!data || getProviderRoute(data) !== ROUTE.DEEPSEEK) {
        pendingDeepSeek = false;
        return;
    }
    // DeepSeek当前正式协议由recordEngine统一注入JSON envelope。
    // 本模块只保留历史短JSON块的响应兼容转换，不再改写任何请求，尤其不参与relay。
    pendingDeepSeek = true;
}

function latestAssistant() {
    const chat = USER?.getContext?.()?.chat;
    if (!Array.isArray(chat)) return null;
    for (let i = chat.length - 1; i >= 0; i--) if (chat[i]?.is_user === false) return chat[i];
    return null;
}
function reasoningText(chat) {
    const swipeId = Number(chat?.swipe_id);
    const swipeReasoning = Number.isInteger(swipeId) && swipeId >= 0 ? chat?.swipe_info?.[swipeId]?.extra?.reasoning : '';
    return String(swipeReasoning || chat?.extra?.reasoning || '').trim();
}
function extractBlock(text) {
    const source = String(text ?? '');
    const start = source.indexOf(BLOCK_BEGIN);
    if (start < 0) return null;
    const payloadStart = start + BLOCK_BEGIN.length;
    const end = source.indexOf(BLOCK_END, payloadStart);
    if (end < 0 || source.indexOf(BLOCK_BEGIN, payloadStart) >= 0) return null;
    const raw = source.slice(payloadStart, end).trim();
    let changes;
    try { changes = JSON.parse(raw); } catch (_) { return null; }
    if (!Array.isArray(changes)) return null;
    const visible = `${source.slice(0, start)}${source.slice(end + BLOCK_END.length)}`.trim();
    return { changes, visible };
}
function normalizeDeepSeekReplyBeforeRecordEngine() {
    if (!pendingDeepSeek) return;
    pendingDeepSeek = false;
    const chat = latestAssistant();
    if (!chat) return;
    const content = String(chat.mes ?? '').trim();
    const fromContent = extractBlock(content);
    const fromReasoning = fromContent ? null : extractBlock(reasoningText(chat));
    const parsed = fromContent || fromReasoning;
    if (!parsed) return;
    const reply = (fromContent ? parsed.visible : content).trim();
    if (!reply) return;
    chat.mes = JSON.stringify({ reply, changes: parsed.changes });
    console.log(`[Memo-N] DeepSeek历史短JSON块已转换为内部严格信封｜changes=${parsed.changes.length}`);
}

globalThis.__memoNNormalizeDeepSeekReply = normalizeDeepSeekReplyBeforeRecordEngine;
APP.eventSource.on(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, reinforceDeepSeekProtocol);
APP.eventSource.makeLast?.(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, reinforceDeepSeekProtocol);
console.log('[Memo-N] DeepSeek兼容守卫已隔离：不再参与中转站请求');
