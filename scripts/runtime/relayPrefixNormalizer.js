import { APP } from '../../core/manager.js';

function canonicalTableEdit(block) {
    return String(block || '')
        .replace(/\s+/g, ' ')
        .replace(/>\s+</g, '><')
        .trim();
}

function normalizePrefixTableEdit(chatId) {
    const chat = APP.getContext?.()?.chat?.[chatId];
    if (!chat || chat.is_user) return;
    let text = String(chat.mes ?? '');
    const regex = /<tableEdit\b[^>]*>[\s\S]*?<\/tableEdit>/ig;
    let matches = [...text.matchAll(regex)];

    // 模型偶尔会把同一个前置记录块在正文后再重复一次。
    // 只有内容完全相同才安全去重；内容不同则保留给严格解析器报错，绝不猜测应该执行哪一个。
    if (matches.length > 1) {
        const canonical = matches.map(match => canonicalTableEdit(match[0]));
        const allIdentical = canonical.every(value => value === canonical[0]);
        if (!allIdentical) {
            console.warn(`[Memo-N] 检测到${matches.length}个内容不同的tableEdit，拒绝自动合并`);
            return;
        }
        const keep = matches[0][0];
        let kept = false;
        text = text.replace(regex, block => {
            if (!kept) { kept = true; return keep; }
            return '';
        }).replace(/\n{3,}/g, '\n\n').trim();
        chat.mes = text;
        const dedupeSwipeId = Number(chat.swipe_id);
        if (Array.isArray(chat.swipes) && Number.isInteger(dedupeSwipeId) && dedupeSwipeId >= 0 && dedupeSwipeId < chat.swipes.length) {
            chat.swipes[dedupeSwipeId] = chat.mes;
        }
        console.log(`[Memo-N] 已安全去重${matches.length}个完全相同的tableEdit记录块`);
        matches = [...text.matchAll(regex)];
    }

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

console.log('[Memo-N] 中转站前置tableEdit归一器已加载：相同重复块安全去重，不同块拒绝合并');
