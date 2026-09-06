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
