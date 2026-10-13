import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

let source = await fs.readFile(new URL('../scripts/runtime/stableTableCleanup.js', import.meta.url), 'utf8');
source = source.replace(/^import[^\n]*\n/gm, '').replace(/export\s*\{[^}]*\};?/g, '');

let rows = [['重复A'], ['重复B']];
let piece = {
    mes:'剧情正文', swipe_id:0,
    memo_n_hash_sheets:{version:0}, extra:{version:0}, swipe_info:[{version:0}],
};
const chat = [piece];
let preflightCalls = 0;
let saveCalls = 0;
let failSave = false;
const notices = [];
const sheet = {
    name:'历史事件表',
    filterSavingData: () => ({ rows }),
    loadJson: data => { rows = structuredClone(data.rows); },
};
const mocks = {
    BASE:{
        sheetsData:{context:[]},
        getChatSheets: () => [sheet],
        getLastSheetsPiece: () => ({piece}),
        refreshContextView(){},
    },
    USER:{
        getContext: () => ({chat}),
        tableBaseSetting:{ bool_silent_refresh:true, clear_up_stairs:9, use_main_api:true },
        async saveChat(){saveCalls++;if(failSave)throw Error('save failed');},
    },
    EDITOR:{
        POPUP_TYPE:{CONFIRM:'confirm'},
        async callGenericPopup(){return true;},
        info: x => notices.push(['info',x]),
        warning: x => notices.push(['warning',x]),
        error: x => notices.push(['error',x]),
        success: x => notices.push(['success',x]),
    },
    getTableEditTag: value => ({matches:[value]}),
    getTablePromptByPiece: () => JSON.stringify(rows),
    handleMainAPIRequest: async () => '<tableEdit><!-- deleteRow(6,0,"") --></tableEdit>',
    handleCustomAPIRequest: async () => { throw Error('unexpected API route'); },
    estimateTokenCount: async () => 10,
    updateSystemMessageTableStatus(){},
    ensureSevenTableWorld(){preflightCalls++;},
    repairMissingColumnsBeforeCleanup(){preflightCalls++;},
    parseMemoTableEdit: () => ({ok:true,noChange:false,actions:[{type:'delete'}]}),
    executeMemoTableEdit: () => {
        rows.shift();
        piece.memo_n_hash_sheets.version++;
        piece.extra.version++;
        return {ok:true,count:1};
    },
};
globalThis.window = {};
const moduleFactory = new Function(
    'mocks',
    `const {${Object.keys(mocks).join(',')}} = mocks;\n${source}\nreturn {runStableCleanup,stepCleanupHistory};`,
);
const {runStableCleanup,stepCleanupHistory} = moduleFactory(mocks);

await runStableCleanup('redundancy');
assert.equal(preflightCalls,0,'redundancy must not run general repair preflight');
assert.equal(rows.length,1);

await stepCleanupHistory(-1);
assert.equal(rows.length,2,'undo restores original rows');
assert.equal(piece.memo_n_hash_sheets.version,0,'undo restores original snapshot');
await stepCleanupHistory(1);
assert.equal(rows.length,1,'redo restores merged table');

piece.mes = '正文被用户修改';
await stepCleanupHistory(-1);
assert.equal(rows.length,1,'refuse undo after message text changes');
assert.equal(notices.at(-1)[0],'warning');

piece.mes = '剧情正文';
piece.swipe_info[0].version++;
await stepCleanupHistory(-1);
assert.equal(rows.length,1,'refuse undo after swipe metadata changes');
piece.swipe_info[0].version--;

failSave = true;
await stepCleanupHistory(-1);
assert.equal(rows.length,1,'failed undo save rolls back restored rows');
assert.equal(notices.at(-1)[0],'error');
failSave = false;
await stepCleanupHistory(-1);
assert.equal(rows.length,2,'failed undo does not change history index');
assert.ok(saveCalls >= 5,'transactions attempted persistence');
console.log('memo-n-cleanup-undo-safety PASS: redundancy preflight isolation, undo, redo, stale text and swipe guard, save failure');
