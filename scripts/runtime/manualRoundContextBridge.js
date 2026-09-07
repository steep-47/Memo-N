import { EDITOR, USER } from '../../core/manager.js';
import { reloadCurrentChat } from '/script.js';
import { TableTwoStepSummary } from './separateTableUpdate.js?v=0.16';

const INSTALL_FLAG = '__memoNManualRoundContextBridgeV5';
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

function trailingBareOperations(text, minCount = 2) {
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

function trailingMachineRecord(text) {
    return trailingTableEdit(text) || trailingBareOperations(text, 2);
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

function sanitizePieceInMemory(piece) {
    if (!piece || piece.is_user === true) return false;

    const swipeId = Number(piece.swipe_id);
    const activeSwipe = Array.isArray(piece.swipes) && Number.isInteger(swipeId) && swipeId >= 0 && swipeId < piece.swipes.length
        ? String(piece.swipes[swipeId] ?? '')
        : '';

    const fromMes = trailingMachineRecord(piece.mes);
    const fromSwipe = trailingMachineRecord(activeSwipe);
    const record = fromMes || fromSwipe;
    if (!record) return false;

    storeHiddenRecord(piece, record.block);
    if (fromMes) piece.mes = fromMes.visible;
    if (Array.isArray(piece.swipes) && Number.isInteger(swipeId) && swipeId >= 0 && swipeId < piece.swipes.length) {
        piece.swipes[swipeId] = fromSwipe ? fromSwipe.visible : String(piece.mes ?? '').trim();
    }
    return true;
}

async function cleanupLegacyVisibleRecords() {
    const chat = USER.getContext?.()?.chat;
    if (!Array.isArray(chat) || !chat.length) return false;

    let changed = false;
    for (const piece of chat) {
        // 正常记录的 tableEdit 在正文开头，后面还有剧情，因此不会命中“末尾机器块”。
        // 旧手动补记则位于助手消息末尾；裸函数串至少要求连续两条，避免误伤普通文本。
        if (sanitizePieceInMemory(piece)) changed = true;
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
        Promise.resolve(TableTwoStepSummary('manual'))
            .then(async result => {
                if (result === false || result === 'stale' || result === 'detached') return;
                // 0.16 起源头已不再把机器块写进正文；这里只保留兼容性兜底。
                if (sanitizePieceInMemory(targetPiece)) {
                    await Promise.resolve(USER.saveChat?.());
                    reloadCurrentChat();
                }
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

    console.log('[Memo-N] 手动更新按对话轮读取；机器记录由源头隐藏，旧残留兼容清理已加载');
}

install();

export {
    cleanupLegacyVisibleRecords,
    sanitizePieceInMemory,
    trailingBareOperations,
    trailingMachineRecord,
    trailingTableEdit,
};
