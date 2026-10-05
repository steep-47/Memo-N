import fs from 'node:fs/promises';

let source = await fs.readFile(new URL('../scripts/runtime/safeTableExecutor.js', import.meta.url), 'utf8');
source = source
    .replace("import { BASE, USER } from '../../core/manager.js';", 'const { BASE, USER } = globalThis.__memoNSafeMocks;')
    .replace("import { Cell } from '../../core/table/cell.js';", 'const { Cell } = globalThis.__memoNSafeMocks;')
    .replace("import JSON5 from '../../utils/json5.min.mjs';", 'const { JSON5 } = globalThis.__memoNSafeMocks;');

class MockSheet {
    constructor(name, columns) {
        this.name = name;
        this.columns = columns;
        this.rows = [];
        this.enable = true;
        this.sendToContext = true;
    }

    getHeader() { return this.columns; }
    getRowCount() { return this.rows.length + 1; }
    filterSavingData() { return { rows: structuredClone(this.rows) }; }
    loadJson(value) { this.rows = structuredClone(value?.rows || []); }
    save(piece) { piece.saved = true; return true; }

    findCellByPosition(row, column) {
        if (column === 0) {
            return {
                newAction: action => {
                    if (action === 'insertDownRow') this.rows.push(Array(this.columns.length).fill(''));
                    else if (action === 'deleteSelfRow') this.rows.splice(row - 1, 1);
                },
            };
        }
        const dataRow = row - 1;
        const dataColumn = column - 1;
        if (!this.rows[dataRow] || dataColumn < 0 || dataColumn >= this.columns.length) return null;
        return { newAction: (_action, payload) => { this.rows[dataRow][dataColumn] = payload.value; } };
    }

    getCellsByRowIndex(row) {
        const dataRow = row - 1;
        if (!this.rows[dataRow]) return null;
        return [{}, ...this.rows[dataRow].map((_value, column) => ({
            data: {
                get value() { return this.rows?.[dataRow]?.[column]; },
                set value(value) { this.rows[dataRow][column] = value; },
                rows: this.rows,
            },
        }))];
    }
}

const names = ['当前状态表','角色状态表','背包表','当前任务与约定表','人物主表','人物发展表','历史事件表'];
const sheets = names.map(name => new MockSheet(name, ['第一列', '第二列']));
const taskSheet = sheets[3];

globalThis.__memoNSafeMocks = {
    BASE: {
        getChatSheets: () => sheets,
        copyHashSheets: structuredClone,
        sheetsData: { context: [] },
    },
    USER: { getChatPiece: () => ({ piece: {} }) },
    Cell: { CellAction: { editCell: 'editCell', insertDownRow: 'insertDownRow', deleteSelfRow: 'deleteSelfRow' } },
    JSON5: { parse: JSON.parse },
};

const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#memo-n-safe-executor`);
const { parseMemoTableEdit, executeMemoTableEdit } = module;

let parsed = parseMemoTableEdit('deleteRow(3,0)\ninsertRow(3,{0:"采细辛柴胡"})');
if (!parsed.ok || parsed.noChange || parsed.actions.length !== 1 || parsed.actions[0]?.type !== 'insert') {
    throw new Error('空表冗余删除没有安全折叠，或误删了同批插入');
}

const piece = {};
let result = executeMemoTableEdit('deleteRow(3,0)\ninsertRow(3,{0:"采细辛柴胡"})', piece);
if (!result.ok || result.count !== 1 || taskSheet.rows.length !== 1 || taskSheet.rows[0][0] !== '采细辛柴胡') {
    throw new Error('空表删除拖累了合法插入');
}

taskSheet.rows = [];
result = executeMemoTableEdit('deleteRow(3,0)', {});
if (!result.ok || !result.noChange || result.changed || taskSheet.rows.length !== 0) {
    throw new Error('纯空表删除没有按已满足删除处理');
}

taskSheet.rows = [['现有任务', '进行中']];
parsed = parseMemoTableEdit('deleteRow(3,1)');
if (parsed.ok || !parsed.error.includes('当前数据行数=1')) {
    throw new Error('非空表越界删除被错误放宽');
}

taskSheet.rows = [];
parsed = parseMemoTableEdit('updateRow(3,0,{1:"完成"})');
if (parsed.ok || !parsed.error.includes('当前数据行数=0')) {
    throw new Error('空表越界更新被错误放宽');
}

result = executeMemoTableEdit('insertRow(3,{0:"不应写入"})\nupdateRow(3,0,{1:"错误更新"})', {});
if (result.ok || taskSheet.rows.length !== 0) {
    throw new Error('非法更新没有保持整批原子拒绝');
}

console.log('memo-n-safe-executor PASS: empty-delete-idempotent=2, mixed-insert-preserved=1, nonempty-delete-strict=1, update-strict=2');

// Reproduce the uploaded round: valid inserts plus an update of a new NPC.
const npc = sheets[4];
const development = sheets[5];
for (const sheet of sheets) sheet.rows = [];
result = executeMemoTableEdit('insertRow(0,{0:"18:30"})\ninsertRow(5,{0:"代安池"})\nupdateRow(4,0,{0:"代安池",1:"女"},"代安池")', {});
if (!result.ok || result.count !== 3 || npc.rows[0]?.[0] !== '代安池' || development.rows.length !== 1 || result.corrections?.length !== 1) {
    throw new Error('真实空表首个NPC误用update未被安全恢复');
}
for (const call of [
    'updateRow(4,1,{0:"乙"},"乙")',
    'updateRow(4,0,{0:"乙"},"乙")',
]) {
    if (parseMemoTableEdit(call).ok) throw new Error('非空表越界或身份不匹配被放宽');
}
npc.rows = [];
for (const call of [
    'updateRow(4,0,{1:"女"},"代安池")',
    'updateRow(4,0,{0:"代安池"})',
    'updateRow(4,0,{0:"代安池"},"别人")',
    'updateRow(4,1,{0:"代安池"},"代安池")',
    'updateRow(4,0,{0:"代安池",2:"越界"},"代安池")',
    'updateRow(4,0,{0:"代安池",1:null},"代安池")',
    'updateRow(4,0,{0:"代安池"},"代安池")\ninsertRow(4,{0:"代安池"})',
]) {
    const before = JSON.stringify(sheets.map(s => s.rows));
    if (executeMemoTableEdit(call, {}).ok || JSON.stringify(sheets.map(s => s.rows)) !== before) {
        throw new Error(`不明确或重复操作未保持整批拒绝：${call}`);
    }
}
const originalSave = npc.save;
npc.save = () => { throw new Error('模拟保存失败'); };
result = executeMemoTableEdit('updateRow(4,0,{0:"代安池"},"代安池")', {});
npc.save = originalSave;
if (result.ok || npc.rows.length) throw new Error('纠错插入保存失败后未回滚');
console.log('memo-n-safe-executor recovery PASS: real-round, identity, bounds, duplicate, invalid-field, rollback');

for (const sheet of sheets) sheet.rows = [];
result = executeMemoTableEdit('insertRow(5,{0:"文十七",1:""赤红灵气"、腕间暗红线条秘术"})', {});
if (!result.ok || sheets[5].rows[0][1] !== '"赤红灵气"、腕间暗红线条秘术' || result.corrections?.length !== 1) {
    throw new Error('明确的字符串开头引用引号未完整保留');
}
for (const value of ['', '「赤红灵气」、秘术', '"赤红灵气"、秘术', '路径\\文件', 'a"b\\c']) {
    sheets[0].rows = [];
    result = executeMemoTableEdit(`insertRow(0,{0:${JSON.stringify(value)}})`, {});
    if (!result.ok || sheets[0].rows[0][0] !== value || result.corrections?.length) {
        throw new Error('合法值被兼容处理改写');
    }
}
for (const call of [
    'insertRow(0,{0:"前缀"赤红灵气"文字"})',
    'insertRow(0,{0:""赤红灵气"文字"})',
    'insertRow(0,{0:""赤红灵气"、文字})',
    'insertRow(0,{0:""赤红灵气"、文字" 1:"漏逗号"})',
    'insertRow(0,{0:""赤红灵气"、文字",2:"越界"})',
    'insertRow(0,{0:""赤红灵气"、文字",1:null})',
]) {
    for (const sheet of sheets) sheet.rows = [];
    if (executeMemoTableEdit(call, {}).ok || sheets.some(sheet=>sheet.rows.length)) {
        throw new Error('不明确或非法数据被放宽：'+call);
    }
}
console.log('memo-n-safe-executor quoted-prefix PASS: content preserved, valid quotes and escapes untouched, ambiguous input refused');
const escapedValue = '字面量：{0:""原样"、内容"}，路径\\文件';
sheets[0].rows=[];
result=executeMemoTableEdit(`insertRow(0,{0:${JSON.stringify(escapedValue)},1:""引用"、说明"})`,{});
if(!result.ok || sheets[0].rows[0][0]!==escapedValue || sheets[0].rows[0][1] !== '"引用"、说明')throw Error('修复其他字段时改写了合法字符串内部文本');
console.log('quoted-prefix mixed escaping PASS');
