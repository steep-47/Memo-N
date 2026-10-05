import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

// Expected injected failures should not print data-URL stack traces.
console.warn = () => {};
console.error = () => {};

const source = await fs.readFile(new URL('../scripts/runtime/stableTableCleanup.js', import.meta.url), 'utf8');
let piece, chat, rows, apiHook, popupHook, saveHook, calls, notices;
let silent = true;
let inventory = false, rawResponse;
const sheet = {
    name: '背包表',
    getHeader: () => inventory ? ['物品名', '数量', '状态/品质'] : [],
    getRowCount: () => rows.length + 1,
    getCellsByRowIndex: row => [{}, ...rows[row - 1].map(value => ({ data: { value } }))],
    filterSavingData: () => ({ rows }),
    loadJson: data => { rows = structuredClone(data.rows); },
};
const mocks = {
    BASE: { sheetsData: { context: [] }, getChatSheets: () => [sheet], getLastSheetsPiece: () => ({ piece }), refreshContextView() { throw Error('view error'); } },
    USER: { getContext: () => ({ chat }), get tableBaseSetting() { return { bool_silent_refresh: silent }; }, saveChat: async () => saveHook?.() },
    EDITOR: Object.fromEntries(['info', 'warning', 'error', 'success'].map(type => [type, message => notices.push([type, message])])),
    getTablePromptByPiece: () => {  return JSON.stringify(rows); },
    getTableEditTag: raw => ({ matches: [raw] }),
    parseMemoTableEdit: raw => ({ ok: true, noChange: raw[0].includes('NO_CHANGE') }),
    executeMemoTableEdit: () => {
        calls++;
        mocks.BASE.sheetsData.context = [{ state: "after" }];
        rows.shift();
        piece.memo_n_hash_sheets = { state: 'after' };
        piece.extra.memo_n_swipe_hash_sheets = { state: 'after' };
        piece.swipe_info[0].extra.memo_n_swipe_hash_sheets = { state: 'after' };
        return { ok: true, count: 1 };
    },
    handleMainAPIRequest: async () => { await apiHook?.(); return rawResponse; },
    handleCustomAPIRequest: async () => { throw Error('wrong transport'); },
    estimateTokenCount: async () => 1,
    ensureSevenTableWorld() {}, repairMissingColumnsBeforeCleanup() {}, updateSystemMessageTableStatus() {},
};
mocks.EDITOR.POPUP_TYPE = { CONFIRM: 'confirm' };
mocks.EDITOR.callGenericPopup = async () => { await popupHook?.(); return true; };
globalThis.__cleanupMocks = mocks;
globalThis.window = {};
const stripped = source.replace(/^import[^\n]+\n/gm, '');
const moduleSource = `const {${Object.keys(mocks).join(',')}}=globalThis.__cleanupMocks;\n${stripped}`;
const { runStableCleanup } = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);
function reset() {
    rows = [['耗尽物品', 0], ['工具', 1]];
    piece = { mes: '正文', swipe_id: 0, memo_n_hash_sheets: { state: 'before' }, extra: { memo_n_swipe_hash_sheets: { state: 'before' } }, swipe_info: [{ extra: { memo_n_swipe_hash_sheets: { state: 'before' } } }] };
    chat = [piece]; mocks.BASE.sheetsData.context = [{ state: 'before' }]; calls = 0; notices = []; apiHook = popupHook = saveHook = undefined; silent = true; inventory = false;
    rawResponse = '<tableEdit><!-- deleteRow(2,0,"耗尽物品") --></tableEdit>';
}
reset();
await runStableCleanup();
assert.equal(calls, 1);
assert.deepEqual(rows, [['工具', 1]]);
assert.equal(notices.at(-1)[0], 'success', '视图失败不能吞掉保存成功提示');

reset();
const before = structuredClone(piece);
saveHook = () => { throw Error('disk unavailable'); };
await runStableCleanup();
assert.deepEqual(mocks.BASE.sheetsData.context, [{ state: 'before' }], '保存失败恢复持久化表格内容');
assert.deepEqual(piece, before, '保存失败恢复消息及Swipe快照');
assert.deepEqual(rows, [['耗尽物品', 0], ['工具', 1]], '保存失败恢复完整表格');
assert.equal(notices.at(-1)[0], 'error');

for (const phase of ['api', 'popup']) {
    reset(); silent = phase !== 'popup';
    const mutate = () => { rows.unshift(['新物品', 2]); };
    if (phase === 'api') apiHook = mutate; else popupHook = mutate;
    await runStableCleanup();
    assert.equal(calls, 0, `${phase}等待期间变化不得使用旧行号`);
    assert.equal(rows[0][0], '新物品');
}

reset();
apiHook = () => { piece.swipe_id = 1; };
await runStableCleanup(); assert.equal(calls, 0, '同聊天Swipe变化作废');

reset();
apiHook = () => { chat = [{ mes: '新聊天' }]; };
await runStableCleanup(); assert.equal(calls, 0, '换聊天不能执行');

reset();
saveHook = () => { rows.push(['保存期间新增', 3]); throw Error('disk unavailable'); };
await runStableCleanup();
assert.equal(rows.at(-1)[0], '保存期间新增', '保存期间新记录不得被旧备份覆盖');
assert.equal(notices.at(-1)[0], 'error');

reset();
let release;
apiHook = () => new Promise(resolve => { release = resolve; });
const first = runStableCleanup();
while (!release) await new Promise(resolve => setTimeout(resolve, 0));
await runStableCleanup();
assert.equal(notices.at(-1)[0], 'warning', '重复点击不重复请求');
release(); await first;
assert.equal(calls, 1);
console.log('cleanup transaction PASS: persistence rollback, stale API/confirmation/Swipe, chat switch, concurrent changes, dedupe, view failure');

for (const outcome of ['NO_CHANGE', 'failed']) {
    reset(); inventory = true;
    rows = [['耗尽物品', 0, '已耗尽'], ['工具', 1, '已使用']];
    rawResponse = '<tableEdit><!-- NO_CHANGE --></tableEdit>';
    apiHook = () => {
        assert.deepEqual(rows, [['工具', 1, '已使用']], '调用AI之前已保存明确失效库存清理');
        if (outcome === 'failed') throw Error('API failed');
    };
    await runStableCleanup();
    assert.equal(calls, 1);
    assert.deepEqual(rows, [['工具', 1, '已使用']], 'AI失败或无变化不能阻止明确库存清理');
}
reset(); inventory = true;
rows = [['耗尽物品', 0, '已耗尽'], ['工具', 1, '已使用']];
let apiCalled = false;
apiHook = () => { apiCalled = true; };
saveHook = () => { throw Error('disk unavailable'); };
await runStableCleanup();
assert.equal(apiCalled, false, '本地保存失败不得继续AI整理');
assert.equal(rows[0][0], '耗尽物品', '本地清理保存失败原子回滚');
console.log('cleanup flow PASS: deterministic phase before API, NO_CHANGE/API failure independent, local save rollback');
