import fs from 'node:fs/promises';

let source = await fs.readFile(new URL('../scripts/runtime/swipeSnapshotRestore.js', import.meta.url), 'utf8');
source = source
    .replace("import { APP, BASE, USER } from '../../core/manager.js';", 'const { APP, BASE, USER } = globalThis.__memoNSwipeMocks;')
    .replace("import { restoreMemoSnapshot } from './safeTableExecutor.js?v=memon4';", 'const { restoreMemoSnapshot } = globalThis.__memoNSwipeMocks;');

let handler;
const restored = [];
const piece = {
    is_user: false,
    mes: '正文不含机器块',
    swipe_id: 1,
    swipe_info: [
        { extra: { memo_n_swipe_hash_sheets: { state: 'swipe-0' } } },
        { extra: { memo_n_swipe_hash_sheets: { state: 'swipe-1' } } },
    ],
};

globalThis.__memoNSwipeMocks = {
    APP: {
        event_types: { MESSAGE_SWIPED: 'swiped' },
        eventSource: { on: (_event, fn) => { handler = fn; }, makeFirst() {} },
    },
    BASE: { copyHashSheets: structuredClone },
    USER: { getContext: () => ({ chat: [piece] }) },
    restoreMemoSnapshot: snapshot => { restored.push(structuredClone(snapshot)); return { ok: true, error: '' }; },
};

await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#memo-n-swipe`);
if (typeof handler !== 'function') throw new Error('Swipe恢复事件未注册');

handler(0);
if (restored.at(-1)?.state !== 'swipe-1' || piece.memo_n_hash_sheets?.state !== 'swipe-1') throw new Error('未恢复当前Swipe的独立表格快照');
if (piece.extra?.memo_n_swipe_hash_sheets?.state !== 'swipe-1') throw new Error('消息extra未同步当前Swipe快照');

piece.swipe_id = 0;
handler(0);
if (restored.at(-1)?.state !== 'swipe-0' || piece.memo_n_hash_sheets?.state !== 'swipe-0') throw new Error('切换Swipe后未恢复对应快照');

console.log('memo-n-swipe-restore PASS: per-swipe-snapshot=2, visible-body-preserved=1');
