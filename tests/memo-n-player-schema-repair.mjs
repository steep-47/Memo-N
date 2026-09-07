import fs from 'node:fs/promises';

let source = await fs.readFile(new URL('../scripts/runtime/tableStructureRepair.js', import.meta.url), 'utf8');
source = source
    .replace("import { BASE, EDITOR, USER } from '../../core/manager.js';", 'const { BASE, EDITOR, USER } = globalThis.__memoSchemaMocks;')
    .replace("import { updateSystemMessageTableStatus } from '../renderer/tablePushToChat.js';", 'const { updateSystemMessageTableStatus } = globalThis.__memoSchemaMocks;')
    .replace("import { ensureSevenTableWorld } from './sevenTableMigration.js?v=memon80';", 'const { ensureSevenTableWorld } = globalThis.__memoSchemaMocks;');

const oldHeaders = ['姓名','性别','种族','年龄','修为','灵根/体质','灵力','神识','身体状态','灵石','钱财','技能/术法','擅长','其他状态'];
const rows = [
    ['', ...oldHeaders],
    ['', '陈尘','男','人族','14','','未测','','','','','3','','','出身商户'],
    ['', ...oldHeaders],
    ['', '陈尘','男','人族','14','','未测','','','','','','','','灵根未测，出身商户，尚未接触修炼'],
];

class FakeSheet {
    constructor() {
        this.name = '角色状态表';
        this.uid = 'role';
        this.enable = true;
        this.rows = structuredClone(rows);
    }
    getHeader() { return this.rows[0].slice(1); }
    getRowCount() { return this.rows.length; }
    getContent() { return structuredClone(this.rows); }
    getCellsByRowIndex(rowIndex) { return this.rows[rowIndex]?.map(value => ({ data: { value } })); }
    rebuildHashSheetByValueSheet(valueSheet) { this.rows = structuredClone(valueSheet); }
    filterSavingData() { return { name: this.name, uid: this.uid, rows: structuredClone(this.rows) }; }
    loadJson(data) { this.rows = structuredClone(data.rows); }
    save(piece) {
        piece.memo_n_hash_sheets ??= {};
        piece.memo_n_hash_sheets[this.uid] = structuredClone(this.rows);
        return true;
    }
}

const sheet = new FakeSheet();
const piece = {
    memo_n_hash_sheets: { old: '保留其他表快照' },
    extra: { keep: true, memo_n_swipe_hash_sheets: { stale: true } },
    swipe_id: 0,
    swipe_info: [{ keep: true, extra: { memo_n_swipe_hash_sheets: { stale: true } } }],
};
let contextRefreshes = 0;
let tableRefreshes = 0;
let statusRefreshes = 0;
let saves = 0;
globalThis.__memoSchemaMocks = {
    BASE: {
        getChatSheets: () => [sheet],
        refreshContextView: () => { contextRefreshes++; },
        refreshTempView: value => { if (value === true) tableRefreshes++; },
    },
    USER: {
        tableBaseSetting: { tableStructure: [{ tableIndex: 1, tableName: '角色状态表', columns: oldHeaders }] },
        getChatPiece: () => ({ piece }),
        saveChat: () => { saves++; },
    },
    EDITOR: { success() {} },
    updateSystemMessageTableStatus: () => { statusRefreshes++; },
    ensureSevenTableWorld() {},
};

const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#memo-n-player-schema-repair`;
const { repairMissingColumnsBeforeCleanup } = await import(moduleUrl);
const repaired = repairMissingColumnsBeforeCleanup({ notify: false });

if (repaired.length !== 1 || repaired[0].tableName !== '角色状态表') throw new Error('角色状态表未进入确定性结构修复');
if (repaired[0].removedHeaderRows !== 1 || repaired[0].mergedDuplicateRows !== 1) throw new Error(`重复表头/同名玩家行未按预期清理：${JSON.stringify(repaired[0])}`);
if (sheet.getHeader().at(-1) !== '外貌特征') throw new Error('角色状态表未补入外貌特征列');
if (sheet.getRowCount() !== 2) throw new Error(`角色状态表应只保留一条玩家数据，实际=${sheet.getRowCount() - 1}`);
if (sheet.rows[1][1] !== '陈尘' || sheet.rows[1][11] !== '3' || !String(sheet.rows[1][14]).includes('尚未接触修炼')) throw new Error(`同名玩家重复行合并时丢失了原有字段：${JSON.stringify(sheet.rows[1])}`);
if (sheet.rows[1].at(-1) !== '') throw new Error('外貌特征缺少事实时不应编造内容');
if (JSON.stringify(piece.extra.memo_n_swipe_hash_sheets) !== JSON.stringify(piece.memo_n_hash_sheets)) throw new Error('消息extra仍保留旧结构Swipe快照');
if (JSON.stringify(piece.swipe_info[0].extra.memo_n_swipe_hash_sheets) !== JSON.stringify(piece.memo_n_hash_sheets)) throw new Error('当前swipe_info仍保留旧结构快照');
if (piece.swipe_info[0].keep !== true || piece.extra.keep !== true) throw new Error('同步Swipe快照时破坏了无关extra数据');
if (contextRefreshes !== 1 || tableRefreshes !== 1 || statusRefreshes !== 1 || saves !== 1) throw new Error('结构修复后未完整保存并刷新活动表格视图');

console.log('memo-n player schema repair PASS: appearance-column=1, header-echo-removed=1, duplicate-player-merged=1, swipe-snapshots-synced=2, active-view-refreshed=1');
