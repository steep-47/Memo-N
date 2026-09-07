import { EDITOR, USER } from '../../core/manager.js';
import { reloadCurrentChat } from '/script.js';
import { TableTwoStepSummary } from './separateTableUpdate.js?v=0.14';

const INSTALL_FLAG = '__memoNManualRoundContextBridgeV3';
const TABLE_EDIT_BLOCK_RE = /<tableEdit\b[^>]*>[\s\S]*?<\/tableEdit>/gi;
const OP_LINE_RE = /^\s*(?:insertRow|updateRow|deleteRow)\s*\([\s\S]*\)\s*;?\s*$/;

function trailingTableEdit(text) {
    const source = String(text ?? '');
    const matches = [...source.matchAll(TABLE_EDIT_BLOCK_RE)];
    const last = matches.at(-1);
    if (!last || last.index === undefined) return null;
    const end = last.index + last[0].length;
    if (source.slice(end).trim()) return null;
    return { block: last[0], visible: source.slice(0, last.index).replace(/\s+$/, '').trim() };
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
    const visible = lines.slice(0, start + 1).join('\n').replace(/\s+$/, '').trim();
    if (!block) return null;
    return {
        block: `<tableEdit><!--\n${block}\n--></tableEdit>`,
        visible,
    };
}

function trailingMachineRecord(text, { allowBare = false, legacy = false } = {}) {
    return trailingTableEdit(text)
        || (allowBare ? trailingBareOperations(text, legacy ? 2 : 1) : null);
}

function livePieceAt(index) {
    const chat = USER.getContext?.()?.chat;
    if (Array.isArray(chat) && Number.isInteger(index) && index >= 0 && index < chat.length) return chat[index];
    return USER.getChatPiece?.()?.piece ?? null;
}

async function hideManualRecordBlock(piece, { allowBare = false, legacy = false, reload = true } = {}) {
    if (!piece) return false;
    const swipeId = Number(piece.swipe_id);
    const activeSwipe = Array.isArray(piece.swipes) && Number.isInteger(swipeId) && swipeId >= 0 && swipeId < piece.swipes.length
        ? String(piece.swipes[swipeId] ?? '')
        : '';

    const fromMes = trailingMachineRecord(piece.mes, { allowBare, legacy });
    const fromSwipe = trailingMachineRecord(activeSwipe, { allowBare, legacy });
    const record = fromMes || fromSwipe;
    if (!record) return false;

    const machineBlock = record.block;
    const visible = fromMes ? fromMes.visible : String(piece.mes ?? '').trim();

    if (!piece.extra || typeof piece.extra !== 'object') piece.extra = {};
    piece.extra.memo_n_manual_table_edit = machineBlock;
    piece.mes = visible;

    if (Array.isArray(piece.swipes) && Number.isInteger(swipeId) && swipeId >= 0 && swipeId < piece.swipes.length) {
        piece.swipes[swipeId] = fromSwipe ? fromSwipe.visible : visible;
    }
    if (Number.isInteger(swipeId) && swipeId >= 0) {
        if (!Array.isArray(piece.swipe_info)) piece.swipe_info = [];
        if (!piece.swipe_info[swipeId] || typeof piece.swipe_info[swipeId] !== 'object') piece.swipe_info[swipeId] = {};
        if (!piece.swipe_info[swipeId].extra || typeof piece.swipe_info[swipeId].extra !== 'object') piece.swipe_info[swipeId].extra = {};
        piece.swipe_info[swipeId].extra.memo_n_manual_table_edit = machineBlock;
    }

    await Promise.resolve(USER.saveChat?.());
    if (reload) reloadCurrentChat();
    console.log('[Memo-N] 手动更新机器记录已转存为隐藏元数据，正文保持纯净');
    return true;
}

async function hideAfterManualReload(targetIndex) {
    // manualSummaryChat 成功路径自身会 reloadCurrentChat；重载会替换消息对象。
    // 因此不能继续修改点击前捕获的旧 piece，而要按原消息索引重新取得当前真实对象。
    for (const delay of [0, 80, 250, 600]) {
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        const livePiece = livePieceAt(targetIndex);
        if (!livePiece) continue;
        if (await hideManualRecordBlock(livePiece, { allowBare: true, reload: false })) {
            reloadCurrentChat();
            return true;
        }
    }
    return false;
}

function cleanupLegacyVisibleRecord() {
    const chat = USER.getContext?.()?.chat;
    const activePiece = USER.getChatPiece?.()?.piece;
    if (!activePiece) return;
    const index = Array.isArray(chat) ? chat.indexOf(activePiece) : -1;
    const piece = index >= 0 ? livePieceAt(index) : activePiece;
    hideManualRecordBlock(piece, { allowBare: true, legacy: true })
        .catch(error => console.warn('[Memo-N] 清理旧手动记录显示失败', error));
}

function install() {
    if (globalThis[INSTALL_FLAG]) return;
    globalThis[INSTALL_FLAG] = true;

    document.addEventListener('click', event => {
        const target = event.target?.closest?.('#trigger_step_by_step_button');
        if (!target) return;
        event.preventDefault();
        event.stopImmediatePropagation();

        const chat = USER.getContext?.()?.chat;
        const targetPiece = USER.getChatPiece?.()?.piece;
        const targetIndex = Array.isArray(chat) ? chat.indexOf(targetPiece) : -1;

        Promise.resolve(TableTwoStepSummary('manual'))
            .then(async result => {
                if (result === false || result === 'stale' || result === 'detached') return;
                await hideAfterManualReload(targetIndex);
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

        cleanupLegacyVisibleRecord();
        setTimeout(cleanupLegacyVisibleRecord, 250);
    });

    console.log('[Memo-N] 手动更新按完整对话轮读取，并在聊天重载后重新定位真实消息隐藏机器记录');
}

install();

export { hideManualRecordBlock, hideAfterManualReload, trailingMachineRecord, trailingTableEdit, trailingBareOperations };
