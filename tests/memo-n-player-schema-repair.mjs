import fs from 'node:fs/promises';

let source = await fs.readFile(new URL('../scripts/runtime/tableStructureRepair.js', import.meta.url), 'utf8');
source = source
    .replace("import { BASE, EDITOR, USER } from '../../core/manager.js';", 'const { BASE, EDITOR, USER } = globalThis.__memoSchemaMocks;')
    .replace("import { updateSystemMessageTableStatus } from '../renderer/tablePushToChat.js';", 'const { updateSystemMessageTableStatus } = globalThis.__memoSchemaMocks;')
    .replace("import { ensureSevenTableWorld } from './sevenTableMigration.js?v=memon82';", 'const { ensureSevenTableWorld } = globalThis.__memoSchemaMocks;');

const oldHeaders = ['姓名','性别','种族','年龄','修为','灵根/体质','灵力','神识','身体状态','灵石','钱财','技能/术法','擅长','其他状态','外貌特征'];
const expectedHeaders = [...oldHeaders, '身份/所属', '别名/称号'];
const rows = [
    ['', ...oldHeaders],
    ['', '陈尘','男','人族','14','','未测','','','','','3','','','出身商户','左眉梢淡旧疤'],
    ['', ...oldHeaders],
    ['', '陈尘','男','人族','14','','未测','','','','','','','','灵根未测，尚未接触修炼',''],
];

class FakeSheet {
    constructor(headers = oldHeaders, dataRows = rows.slice(1), uid = 'role') {
        this.name = '角色状态表';
        this.uid = uid;
        this.enable = true;
        this.rows = [['', ...headers], ...structuredClone(dataRows)];
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

function rowObject(sheet, rowIndex = 1) {
    const headers = sheet.getHeader();
    const row = sheet.rows[rowIndex].slice(1);
    return Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']));
}

const sheet = new FakeSheet();
let activeSheets = [sheet];
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
        getChatSheets: () => activeSheets,
        refreshContextView: () => { contextRefreshes++; },
        refreshTempView: value => { if (value === true) tableRefreshes++; },
    },
    USER: {
        tableBaseSetting: { tableStructure: [{ tableIndex: 1, tableName: '角色状态表', columns: expectedHeaders }] },
        getChatPiece: () => { throw new Error('显式piece修复不应回退读取其他消息'); },
        saveChat: () => { saves++; },
    },
    EDITOR: { success() {} },
    updateSystemMessageTableStatus: () => { statusRefreshes++; },
    ensureSevenTableWorld() {},
};

const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#memo-n-player-schema-repair`;
const { repairMissingColumnsBeforeCleanup } = await import(moduleUrl);
const repaired = repairMissingColumnsBeforeCleanup({ notify: false, piece });

if (repaired.length !== 1 || repaired[0].tableName !== '角色状态表') throw new Error('角色状态表未进入确定性结构修复');
if (repaired[0].removedHeaderRows !== 1 || repaired[0].mergedDuplicateRows !== 1) throw new Error(`重复表头/同名玩家行未按预期清理：${JSON.stringify(repaired[0])}`);
if (JSON.stringify(sheet.getHeader()) !== JSON.stringify(expectedHeaders)) throw new Error(`角色状态表标准表头错误：${JSON.stringify(sheet.getHeader())}`);
if (JSON.stringify(sheet.getHeader().slice(0, oldHeaders.length)) !== JSON.stringify(oldHeaders)) throw new Error('新增字段破坏了既有15列索引顺序');
if (sheet.getRowCount() !== 2) throw new Error(`角色状态表应只保留一条玩家数据，实际=${sheet.getRowCount() - 1}`);

const current = rowObject(sheet);
if (current['姓名'] !== '陈尘' || current['钱财'] !== '3') throw new Error(`同名玩家重复行合并时丢失了原有字段：${JSON.stringify(current)}`);
if (current['外貌特征'] !== '左眉梢淡旧疤') throw new Error(`旧外貌特征在新增两列时丢失：${JSON.stringify(current)}`);
if (current['身份/所属'] !== '' || current['别名/称号'] !== '') throw new Error('新增身份/称号字段缺少事实时不应编造内容');
if (JSON.stringify(piece.extra.memo_n_swipe_hash_sheets) !== JSON.stringify(piece.memo_n_hash_sheets)) throw new Error('消息extra仍保留旧结构Swipe快照');
if (JSON.stringify(piece.swipe_info[0].extra.memo_n_swipe_hash_sheets) !== JSON.stringify(piece.memo_n_hash_sheets)) throw new Error('当前swipe_info仍保留旧结构快照');
if (piece.swipe_info[0].keep !== true || piece.extra.keep !== true) throw new Error('同步Swipe快照时破坏了无关extra数据');

piece.memo_n_hash_sheets.imported = [['imported-current-data']];
const syncOnly = repairMissingColumnsBeforeCleanup({ notify: false, piece, syncSnapshot: true });
if (syncOnly.length !== 0) throw new Error('表头已经正确时不应产生虚假修复记录');
if (piece.extra.memo_n_swipe_hash_sheets.imported?.[0]?.[0] !== 'imported-current-data') throw new Error('导入后未在无表头变化时同步消息Swipe快照');
if (piece.swipe_info[0].extra.memo_n_swipe_hash_sheets.imported?.[0]?.[0] !== 'imported-current-data') throw new Error('导入后未在无表头变化时同步当前swipe_info');

const aliasHeaders = [...expectedHeaders];
aliasHeaders[15] = '身份';
aliasHeaders[16] = '称号';
const aliasRow = ['', '陈尘','男','人族','14','','未测','','','','','','','','','','青云宗外门弟子','青禾'];
const aliasSheet = new FakeSheet(aliasHeaders, [aliasRow], 'role-alias');
const aliasPiece = { memo_n_hash_sheets: {}, extra: {}, swipe_id: 0, swipe_info: [{ extra: {} }] };
activeSheets = [aliasSheet];
const aliasRepair = repairMissingColumnsBeforeCleanup({ notify: false, piece: aliasPiece });
if (aliasRepair.length !== 1) throw new Error('身份/称号旧别名表头未进入归一修复');
if (JSON.stringify(aliasSheet.getHeader()) !== JSON.stringify(expectedHeaders)) throw new Error('身份/称号旧表头未归一为标准名称');
const aliasCurrent = rowObject(aliasSheet);
if (aliasCurrent['身份/所属'] !== '青云宗外门弟子' || aliasCurrent['别名/称号'] !== '青禾') throw new Error(`旧身份/称号字段迁移丢失数据：${JSON.stringify(aliasCurrent)}`);

const profileSource = await fs.readFile(new URL('../scripts/runtime/playerProfileSchema.js', import.meta.url), 'utf8');
if (!profileSource.includes("'身份/所属','别名/称号'")) throw new Error('玩家资料结构运行时未声明新增两列');
const layoutSource = await fs.readFile(new URL('../scripts/ui/pinchZoom.js', import.meta.url), 'utf8');
const firstOrder = "['姓名'], ['性别'], ['种族'], ['年龄']";
const secondOrder = "['姓名'], ['灵力'], ['神识'], ['技能/术法'], ['擅长']";
if (!layoutSource.includes(firstOrder) || !layoutSource.includes(secondOrder)) throw new Error('角色状态表信息密度展示分组缺失或顺序异常');
for (const header of ['外貌特征','身份/所属','别名/称号','身体状态','其他状态','灵石','钱财']) {
    if (!layoutSource.includes(header)) throw new Error(`角色状态表展示分组漏掉字段：${header}`);
}

if (contextRefreshes !== 2 || tableRefreshes !== 2 || statusRefreshes !== 2 || saves !== 3) throw new Error(`结构修复保存/刷新次数异常：${JSON.stringify({contextRefreshes,tableRefreshes,statusRefreshes,saves})}`);

console.log('memo-n player schema repair PASS: old15-preserved=1, appearance-preserved=1, identity-alias-added=2, alias-migration=2, swipe-snapshots-synced=3, density-layout-checked=1');
