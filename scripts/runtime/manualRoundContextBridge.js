import { EDITOR, USER } from '../../core/manager.js';
import { reloadCurrentChat } from '/script.js';
import { TableTwoStepSummary } from './separateTableUpdate.js?v=memon85';

const INSTALL_FLAG = '__memoNManualRoundContextBridgeV2';
const TABLE_EDIT_BLOCK_RE = /<tableEdit\b[^>]*>[\s\S]*?<\/tableEdit>/gi;

function stripTableEditBlocks(text) {
    return String(text ?? '')
        .replace(TABLE_EDIT_BLOCK_RE, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

async function hideManualRecordBlock(piece) {
    if (!piece) return false;
    const current = String(piece.mes ?? '');
    const blocks = current.match(TABLE_EDIT_BLOCK_RE);
    if (!Array.isArray(blocks) || blocks.length === 0) return false;

    // 手动更新的执行记录仍绑定到当前消息/Swipe，但不再混入玩家可见正文。
    const machineBlock = blocks[blocks.length - 1];
    const visible = stripTableEditBlocks(current);

    if (!piece.extra || typeof piece.extra !== 'object') piece.extra = {};
    piece.extra.memo_n_manual_table_edit = machineBlock;
    piece.mes = visible;

    const swipeId = Number(piece.swipe_id);
    if (Array.isArray(piece.swipes) && Number.isInteger(swipeId) && swipeId >= 0 && swipeId < piece.swipes.length) {
        piece.swipes[swipeId] = visible;
    }
    if (Number.isInteger(swipeId) && swipeId >= 0) {
        if (!Array.isArray(piece.swipe_info)) piece.swipe_info = [];
        if (!piece.swipe_info[swipeId] || typeof piece.swipe_info[swipeId] !== 'object') piece.swipe_info[swipeId] = {};
        if (!piece.swipe_info[swipeId].extra || typeof piece.swipe_info[swipeId].extra !== 'object') piece.swipe_info[swipeId].extra = {};
        piece.swipe_info[swipeId].extra.memo_n_manual_table_edit = machineBlock;
    }

    await Promise.resolve(USER.saveChat?.());
    const activePiece = USER.getChatPiece?.()?.piece;
    if (activePiece === piece) reloadCurrentChat();
    console.log('[Memo-N] 手动更新机器记录已转存为隐藏元数据，正文保持纯净');
    return true;
}

function install() {
    if (globalThis[INSTALL_FLAG]) return;
    globalThis[INSTALL_FLAG] = true;

    // 手动更新使用新版“按对话轮”上下文算法。
    // 捕获阶段接管按钮，避免旧 absoluteRefresh 模块仍引用缓存中的按AI条数实现。
    document.addEventListener('click', event => {
        const target = event.target?.closest?.('#trigger_step_by_step_button');
        if (!target) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const targetPiece = USER.getChatPiece?.()?.piece;
        Promise.resolve(TableTwoStepSummary('manual'))
            .then(async result => {
                if (result === true && targetPiece) await hideManualRecordBlock(targetPiece);
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
    });

    console.log('[Memo-N] 手动更新已切换为按完整对话轮读取上下文，并隐藏机器记录块');
}

install();

export { hideManualRecordBlock, stripTableEditBlocks };
