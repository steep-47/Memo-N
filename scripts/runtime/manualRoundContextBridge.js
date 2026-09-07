import { EDITOR, USER } from '../../core/manager.js';
import { reloadCurrentChat } from '/script.js';
import { TableTwoStepSummary } from './separateTableUpdate.js?v=0.15';

const INSTALL_FLAG = '__memoNManualRoundContextBridgeV4';
const TABLE_EDIT_BLOCK_RE = /<tableEdit\b[^>]*>[\s\S]*?<\/tableEdit>/gi;
const OP_LINE_RE = /^\s*(?:insertRow|updateRow|deleteRow)\s*\([\s\S]*\)\s*;?\s*$/;

function trailingTableEdit(text) {
    const source = String(text ?? '');
    const matches = [...source.matchAll(TABLE_EDIT_BLOCK_RE)];
    const last = matches.at(-1);
    if (!last || last.index === undefined) return null;
    const end = last.index + last[0].length;
    if (source.slice(end).trim()) return null;
    return {
        block: last[0],
        visible: source.slice(0, last.index).replace(/\s+$/, '').trim(),
    };
}

function trailingBareOperations(text, minCount = 1) {
    const source = String(text ?? '');
    const lines = source.split(/\r?\n/);
    let end = lines.length - 1;
    while (end >= 0 && !lines[end].trim()) end -= 1;
    if (end < 0) return null;

    let start = end;
    let count = 0;
    while (start >= 0 && OP_LINE_RE.test(lines[start])) {
        count += 1;
        start -= 1;
    }
    if (count < minCount) return null;

    const block = lines.slice(start + 1, end + 1).join('\n').trim();
    if (!block) return null;
    return {
        block: `<tableEdit><!--\n${block}\n--></tableEdit>`,
        visible: lines.slice(0, start + 1).join('\n').replace(/\s+$/, '').trim(),
    };
}

function trailingMachineRecord(text, { allowBare = false, legacy = false } = {}) {
    return trailingTableEdit(text)
        || (allowBare ? trailingBareOperations(text, legacy ? 2 : 1) : null);
}

function storeHiddenRecord(piece, machineBlock) {
    if (!piece.extra || typeof piece.extra !== 'object') piece.extra = {};
    piece.extra.memo_n_manual_table_edit = machineBlock;

    const swipeId = Number(piece.swipe_id);
    if (Number.isInteger(swipeId) && swipeId >= 0) {
        if (!Array.isArray(piece.swipe_info)) piece.swipe_info = [];
        if (!piece.swipe_info[swipeId] || typeof piece.swipe_info[swipeId] !== 'object') piece.swipe_info[swipeId] = {};
        if (!piece.swipe_info[swipeId].extra || typeof piece.swipe_info[swipeId].extra !== 'object') piece.swipe_info[swipeId].extra = {};
        piece.swipe_info[swipeId].extra.memo_n_manual_table_edit = machineBlock;
    }
}

function sanitizePieceInMemory(piece, { allowBare = false, legacy = false } = {}) {
    if (!piece) return false;

    const swipeId = Number(piece.swipe_id);
    const activeSwipe = Array.isArray(piece.swipes) && Number.isInteger(swipeId) && swipeId >= 0 && swipeId < piece.swipes.length
        ? String(piece.swipes[swipeId] ?? '')
        : '';

    const fromMes = trailingMachineRecord(piece.mes, { allowBare, legacy });
    const fromSwipe = trailingMachineRecord(activeSwipe, { allowBare, legacy });
    const record = fromMes || fromSwipe;
    if (!record) return false;

    storeHiddenRecord(piece, record.block);

    if (fromMes) piece.mes = fromMes.visible;
    if (Array.isArray(piece.swipes) && Number.isInteger(swipeId) && swipeId >= 0 && swipeId < piece.swipes.length) {
        piece.swipes[swipeId] = fromSwipe ? fromSwipe.visible : String(piece.mes ?? '').trim();
    }

    return true;
}

async function withHiddenManualSave(targetPiece, task) {
    const originalSaveChat = USER.saveChat;
    if (typeof originalSaveChat !== 'function') return await task();

    const guardedSaveChat = (...args) => {
        try {
            // separateTableUpdate 会先把已验证的机器块追加到 piece.mes，再调用 USER.saveChat。
            // 在真正持久化之前把它迁入隐藏元数据，避免任何 reload/渲染阶段看到机器操作。
            sanitizePieceInMemory(targetPiece, { allowBare: true });
        } catch (error) {
            console.warn('[Memo-N] 手动记录保存前隐藏失败', error);
        }
        return originalSaveChat(...args);
    };

    USER.saveChat = guardedSaveChat;
    try {
        return await task();
    } finally {
        if (USER.saveChat === guardedSaveChat) USER.saveChat = originalSaveChat;
    }
}

async function cleanupLegacyVisibleRecords() {
    const chat = USER.getContext?.()?.chat;
    if (!Array.isArray(chat) || !chat.length) return false;

    let changed = false;
    for (const piece of chat) {
        if (!piece || piece.is_user !== false || !piece.memo_n_hash_sheets) continue;
        if (sanitizePieceInMemory(piece, { allowBare: true, legacy: true })) changed = true;
    }

    if (!changed) return false;
    await Promise.resolve(USER.saveChat?.());
    reloadCurrentChat();
    console.log('[Memo-N] 已清理旧版手动更新残留的可见机器记录');
    return true;
}

function install() {
    if (globalThis[INSTALL_FLAG]) return;
    globalThis[INSTALL_FLAG] = true;

    document.addEventListener('click', event => {
        const target = event.target?.closest?.('#trigger_step_by_step_button');
        if (!target) return;
        event.preventDefault();
        event.stopImmediatePropagation();

        const targetPiece = USER.getChatPiece?.()?.piece;
        Promise.resolve(withHiddenManualSave(targetPiece, () => TableTwoStepSummary('manual')))
            .then(result => {
                if (result === false || result === 'stale' || result === 'detached') return;
                // 正常情况下保存前已经清理；这里仅作为当前内存对象的无保存兜底。
                sanitizePieceInMemory(targetPiece, { allowBare: true });
            })
            .catch(error => {
                console.error('[Memo-N][manual-round-context] 手动更新启动失败', error);
                EDITOR.error(`手动更新启动失败：${error?.message || error}`);
            });
    }, true);

    jQuery(() => {
        const input = $('#separateReadContextLayers');
        const label = $('label[for="separateReadContextLayers"]');
        label.text('上下文轮数');
        label.attr('title', '1轮 = 当前待记录AI回复之前的用户消息 + 当前待记录AI回复；AI回复本身作为本轮待记录内容单独发送');
        input.attr('title', '按对话轮读取。1轮会带上触发当前AI回复的用户消息，当前AI回复本身不重复放入上下文。');

        cleanupLegacyVisibleRecords().catch(error => console.warn('[Memo-N] 清理旧手动记录显示失败', error));
        setTimeout(() => cleanupLegacyVisibleRecords().catch(() => {}), 500);
    });

    console.log('[Memo-N] 手动更新机器记录已改为保存前迁入隐藏元数据');
}

install();

export {
    cleanupLegacyVisibleRecords,
    sanitizePieceInMemory,
    trailingBareOperations,
    trailingMachineRecord,
    trailingTableEdit,
    withHiddenManualSave,
};
