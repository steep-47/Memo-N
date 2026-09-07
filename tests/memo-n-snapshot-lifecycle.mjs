import { purgeMemoTableState } from '../scripts/runtime/memoSnapshotLifecycle.js';

const piece = {
    memo_n_hash_sheets: { role: [['current']] },
    dataTable: [{ old: true }],
    extra: { keep: true, memo_n_swipe_hash_sheets: { role: [['message-extra']] } },
    swipe_info: [
        {
            keep: 'swipe-0',
            memo_n_swipe_hash_sheets: { role: [['legacy-direct']] },
            extra: { keep: 0, memo_n_swipe_hash_sheets: { role: [['swipe-0']] } },
        },
        {
            keep: 'swipe-1',
            extra: { keep: 1, memo_n_swipe_hash_sheets: { role: [['swipe-1']] } },
        },
    ],
};

if (!purgeMemoTableState(piece)) throw new Error('存在Memo表格状态时错误报告为无变化');
if ('memo_n_hash_sheets' in piece || 'dataTable' in piece) throw new Error('消息主表格或旧版表格未清空');
if ('memo_n_swipe_hash_sheets' in piece.extra) throw new Error('消息extra严格Swipe快照未清空');
for (const swipe of piece.swipe_info) {
    if ('memo_n_swipe_hash_sheets' in swipe || 'memo_n_swipe_hash_sheets' in swipe.extra) throw new Error('swipe_info中仍残留可复活表格的快照');
}
if (piece.extra.keep !== true || piece.swipe_info[0].keep !== 'swipe-0' || piece.swipe_info[1].extra.keep !== 1) throw new Error('清空表格时破坏了无关消息或Swipe数据');
if (purgeMemoTableState(piece)) throw new Error('重复清空空状态不应报告变化');

console.log('memo-n snapshot lifecycle PASS: current=1, message-extra=1, per-swipe=3, legacy=1, unrelated-data-preserved=1');
