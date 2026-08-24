import { APP, USER } from '../../core/manager.js';
import { ROUTE, getProviderRoute } from './providerRoute.js';

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
    if (getProviderRoute({}) !== ROUTE.CUSTOM) return;
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

const endEvent = APP.event_types.GENERATION_ENDED;
APP.eventSource.on(endEvent, recoverTruncatedEnvelope);
APP.eventSource.makeFirst?.(endEvent, recoverTruncatedEnvelope);

console.log('[Memo-N] CUSTOM恢复桥已加载：仅处理截断恢复，不再改写正常请求或JSON Schema');