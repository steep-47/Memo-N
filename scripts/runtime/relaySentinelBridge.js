import { APP, USER } from '../../core/manager.js';
import { ROUTE, getProviderRoute } from './providerRoute.js';

const BEGIN = 'MEMO_N_EDIT_BEGIN';
const END = 'MEMO_N_EDIT_END';

function convertOne(text) {
    const raw = String(text ?? '');
    const begin = raw.indexOf(BEGIN);
    if (begin < 0) return { text: raw, found: false };
    const end = raw.indexOf(END, begin + BEGIN.length);
    if (end < 0) return { text: raw, found: false };
    if (raw.indexOf(BEGIN, begin + BEGIN.length) >= 0) return { text: raw, found: false };
    if (raw.indexOf(END, end + END.length) >= 0) return { text: raw, found: false };
    const body = raw.slice(begin + BEGIN.length, end).trim();
    if (!body || raw.slice(end + END.length).trim()) return { text: raw, found: false };
    const machine = `<tableEdit><!--\n${body}\n--></tableEdit>`;
    return { text: `${raw.slice(0, begin).trimEnd()}\n${machine}`.trim(), found: true };
}

function convertLatestResponse() {
    if (getProviderRoute({}) !== ROUTE.RELAY) return;
    const chat = USER?.getContext?.()?.chat;
    if (!Array.isArray(chat) || !chat.length) return;
    let piece = null;
    for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i]?.is_user === false) { piece = chat[i]; break; }
    }
    if (!piece) return;

    const content = convertOne(piece.mes);
    if (content.found) {
        piece.mes = content.text;
        const swipeId = Number(piece.swipe_id);
        if (Array.isArray(piece.swipes) && Number.isInteger(swipeId) && swipeId >= 0 && swipeId < piece.swipes.length) piece.swipes[swipeId] = piece.mes;
        console.log('[Memo-N] 中转站纯文本记录块已转换为内部tableEdit');
        return;
    }

    const swipeId = Number(piece.swipe_id);
    if (Number.isInteger(swipeId) && swipeId >= 0 && piece?.swipe_info?.[swipeId]?.extra) {
        const converted = convertOne(piece.swipe_info[swipeId].extra.reasoning);
        if (converted.found) {
            piece.swipe_info[swipeId].extra.reasoning = converted.text;
            console.log('[Memo-N] 中转站reasoning记录块已转换为内部tableEdit');
            return;
        }
    }
    if (piece?.extra) {
        const converted = convertOne(piece.extra.reasoning);
        if (converted.found) {
            piece.extra.reasoning = converted.text;
            console.log('[Memo-N] 中转站reasoning记录块已转换为内部tableEdit');
        }
    }
}

const endEvent = APP.event_types.GENERATION_ENDED;
APP.eventSource.on(endEvent, convertLatestResponse);
APP.eventSource.makeFirst?.(endEvent, convertLatestResponse);

console.log('[Memo-N] 中转站哨兵桥已加载：仅负责响应转换，不再改写请求或记录规则');