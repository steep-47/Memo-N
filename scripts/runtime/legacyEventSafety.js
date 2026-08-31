import { APP, USER } from '../../core/manager.js';
import { handleEditStrInMessage, updateSheetsView } from '../../index.js';
import { getMemoTableEditChannel } from './memoResponseChannels.js';

const INSTALL_FLAG = '__memoNLegacyEventSafetyInstalled';

function strictSwipeSnapshot(chat) {
    const swipeId = Number(chat?.swipe_id);
    if (!Number.isInteger(swipeId) || swipeId < 0) return null;
    return chat?.swipe_info?.[swipeId]?.extra?.memo_n_swipe_hash_sheets
        || chat?.swipe_info?.[swipeId]?.memo_n_swipe_hash_sheets
        || null;
}

async function safeMessageSwiped(chatId) {
    const chat = USER?.getContext?.()?.chat?.[Number(chatId)];
    if (!chat || chat.is_user === true) return;

    // 新版Memo-N的Swipe由 swipeSnapshotRestore 先恢复该Swipe保存的完整严格快照。
    // 有完整快照时绝不能再让旧 index.js 从上一条消息基线重放tableEdit，否则会覆盖刚恢复的Swipe状态。
    if (strictSwipeSnapshot(chat)) {
        await updateSheetsView(Number(chatId));
        return;
    }

    // 兼容非常旧的聊天：没有严格Swipe快照时，只有消息本身/旧思考区确实还带tableEdit才允许旧重放逻辑。
    if (USER?.tableBaseSetting?.isExtensionAble === false || USER?.tableBaseSetting?.isAiWriteTable === false) return;
    const channel = getMemoTableEditChannel(chat);
    if (!Array.isArray(channel.matches) || channel.matches.length === 0) {
        await updateSheetsView(Number(chatId));
        return;
    }
    handleEditStrInMessage(chat);
    await updateSheetsView(Number(chatId));
}

async function safeMessageEdited(chatId) {
    if (USER?.tableBaseSetting?.isExtensionAble === false || USER?.tableBaseSetting?.isAiWriteTable === false) return;
    const id = Number(chatId);
    const chat = USER?.getContext?.()?.chat?.[id];
    if (!chat || chat.is_user === true) return;

    // 用户编辑的是可见正文，不是隐藏reasoning。普通一次API剥离机器块后，纯正文编辑必须完全不碰表格。
    // 只有可见消息内容本身仍明确带tableEdit（旧聊天/独立记录本地机器块）时才允许重放。
    const channel = getMemoTableEditChannel(chat);
    if (channel.source !== 'content' || !Array.isArray(channel.matches) || channel.matches.length === 0) return;
    handleEditStrInMessage(chat, id);
    await updateSheetsView(id);
}

function removeLegacyNamedListener(event, legacyName) {
    const list = APP?.eventSource?.events?.[event];
    if (!Array.isArray(list)) return 0;
    let removed = 0;
    for (const listener of [...list]) {
        if (listener === safeMessageSwiped || listener === safeMessageEdited) continue;
        if (listener?.name !== legacyName) continue;
        APP.eventSource.removeListener(event, listener);
        removed++;
    }
    return removed;
}

function quarantineLegacyHandlers() {
    const swiped = APP.event_types.MESSAGE_SWIPED;
    const edited = APP.event_types.MESSAGE_EDITED;
    const removedSwipe = swiped ? removeLegacyNamedListener(swiped, 'onMessageSwiped') : 0;
    const removedEdit = edited ? removeLegacyNamedListener(edited, 'onMessageEdited') : 0;
    if (removedSwipe || removedEdit) console.log(`[Memo-N] 已隔离旧消息事件处理器：swipe=${removedSwipe} edit=${removedEdit}`);
}

if (!globalThis[INSTALL_FLAG]) {
    globalThis[INSTALL_FLAG] = true;
    const swiped = APP.event_types.MESSAGE_SWIPED;
    const edited = APP.event_types.MESSAGE_EDITED;
    if (swiped) APP.eventSource.on(swiped, safeMessageSwiped);
    if (edited) APP.eventSource.on(edited, safeMessageEdited);

    // index.js 在 jQuery ready 回调里注册旧监听，可能晚于loader本模块求值；多阶段只做“移除旧具名函数”，不会重复注册本安全监听。
    quarantineLegacyHandlers();
    queueMicrotask(quarantineLegacyHandlers);
    setTimeout(quarantineLegacyHandlers, 0);
    setTimeout(quarantineLegacyHandlers, 250);
    setTimeout(quarantineLegacyHandlers, 1000);
    window.addEventListener('load', quarantineLegacyHandlers, { once: true });
}

console.log('[Memo-N] 旧Swipe/消息编辑事件安全隔离已加载：严格Swipe快照优先，纯正文编辑不再回滚表格');
