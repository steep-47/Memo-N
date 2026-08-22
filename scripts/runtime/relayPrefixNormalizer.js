import { APP } from '../../core/manager.js';

function normalizePrefixTableEdit(chatId) {
    const chat = APP.getContext?.()?.chat?.[chatId];
    if (!chat || chat.is_user) return;
    const text = String(chat.mes ?? '');
    const regex = /<tableEdit\b[^>]*>[\s\S]*?<\/tableEdit>/ig;
    const matches = [...text.matchAll(regex)];
    if (matches.length !== 1) return;
    const match = matches[0];
    const before = text.slice(0, match.index).trim();
    const after = text.slice((match.index ?? 0) + match[0].length).trim();
    if (!after) return; // 已经是旧的尾部tableEdit格式，不处理。
    // 新协议期望tableEdit在正文前；搬到正文尾部，让现有recordEngine继续使用成熟解析与事务逻辑。
    const body = [before, after].filter(Boolean).join('\n\n').trim();
    chat.mes = `${body}\n\n${match[0]}`.trim();
    const swipeId = Number(chat.swipe_id);
    if (Array.isArray(chat.swipes) && Number.isInteger(swipeId) && swipeId >= 0 && swipeId < chat.swipes.length) {
        chat.swipes[swipeId] = chat.mes;
    }
    console.log('[Memo-N] 已将中转站前置tableEdit归一到正文尾部，交给现有事务引擎处理');
}

const event = APP.event_types.CHARACTER_MESSAGE_RENDERED;
APP.eventSource.on(event, normalizePrefixTableEdit);
APP.eventSource.makeFirst?.(event, normalizePrefixTableEdit);

console.log('[Memo-N] 中转站前置tableEdit归一器已加载');
