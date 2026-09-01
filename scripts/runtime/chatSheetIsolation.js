import { APP, DERIVED } from '../../core/manager.js';

const INSTALL_FLAG = '__memoNChatSheetIsolationInstalled';

function resetChatSheetInstances() {
    try {
        // chatMetadata.memo_n_sheets 本身已经按当前聊天隔离；真正可能串档的是 DERIVED 中按 uid
        // 长期复用的 Sheet 实例。不同聊天使用同一套模板时 uid 相同，旧实例不能带到新聊天。
        DERIVED.any.chatSheetMap = {};
        DERIVED.any.waitingTable = null;
        DERIVED.any.waitingTableIdMap = null;
        DERIVED.any.waitingPiece = null;
        DERIVED.any.renderDeep = null;
        console.log('[Memo-N] 聊天切换：已清空派生Sheet实例缓存，下一次读取从当前聊天metadata重建');
    } catch (error) {
        console.error('[Memo-N] 聊天切换Sheet实例隔离失败', error);
    }
}

if (!globalThis[INSTALL_FLAG]) {
    globalThis[INSTALL_FLAG] = true;
    const changed = APP?.event_types?.CHAT_CHANGED;
    if (changed) {
        // 只注册一次；makeFirst 负责调整同一个命名函数的既有监听顺序。
        // 不再先 on() 再 makeFirst()，避免某些事件实现把它当成两次独立注册而重复执行。
        APP.eventSource.on(changed, resetChatSheetInstances);
        APP.eventSource.makeFirst?.(changed, resetChatSheetInstances);
    } else {
        console.warn('[Memo-N] 当前SillyTavern未暴露CHAT_CHANGED事件；未安装聊天切换Sheet缓存隔离监听');
    }
}

console.log('[Memo-N] 聊天分档Sheet实例隔离已加载');
