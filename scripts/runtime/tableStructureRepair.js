import { BASE, EDITOR, USER } from '../../core/manager.js';
import { updateSystemMessageTableStatus } from '../renderer/tablePushToChat.js';

const guardedSheets = new WeakSet();

function normalize(value) { return String(value ?? '').trim(); }
function clone(value) {
    if (value === undefined) return undefined;
    try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value)); }
}
function currentStructures() {
    return Array.isArray(USER?.tableBaseSetting?.tableStructure) ? USER.tableBaseSetting.tableStructure : [];
}
function structureForSheet(sheet, enabledIndex = -1) {
    const structures = currentStructures();
    return structures.find(item => item?.tableName === sheet?.name)
        || structures.find(item => Number(item?.tableIndex) === Number(enabledIndex))
        || null;
}
function standardHeaders(sheet, enabledIndex = -1) {
    const structure = structureForSheet(sheet, enabledIndex);
    return Array.isArray(structure?.columns) ? structure.columns.map(normalize).filter(Boolean) : [];
}
function splitValueSheet(valueSheet) {
    if (!Array.isArray(valueSheet) || !Array.isArray(valueSheet[0])) return { headers:[], rows:[], hasIndexColumn:true };
    const first = valueSheet[0];
    const hasIndexColumn = first.length > 0 && normalize(first[0]) === '';
    const headers = (hasIndexColumn ? first.slice(1) : first).map(normalize);
    const rows = valueSheet.slice(1).map(row => {
        const source = Array.isArray(row) ? row : [];
        return hasIndexColumn ? source.slice(1) : source.slice();
    });
    return { headers, rows, hasIndexColumn };
}
function rowMap(headers, row) {
    const map = new Map();
    headers.forEach((header, index) => {
        if (!header) return;
        const value = row?.[index] ?? '';
        if (!map.has(header) || normalize(map.get(header)) === '') map.set(header, value);
    });
    return map;
}
function currentSnapshot(sheet) {
    const valueSheet = sheet?.getContent?.(true);
    if (!Array.isArray(valueSheet) || !valueSheet.length) return { headers:(sheet?.getHeader?.() || []).map(normalize), rows:[] };
    return splitValueSheet(valueSheet);
}
function conformValueSheetToSchema(sheet, valueSheet, enabledIndex = -1) {
    const required = standardHeaders(sheet, enabledIndex);
    if (!required.length) return valueSheet;
    const old = currentSnapshot(sheet);
    const incoming = splitValueSheet(valueSheet);
    if (!incoming.headers.length) return valueSheet;
    const extras = old.headers.filter(header => header && !required.includes(header));
    const targetHeaders = [...required, ...extras];
    const rows = incoming.rows.map((row, rowIndex) => {
        const incomingMap = rowMap(incoming.headers, row);
        const oldMap = rowMap(old.headers, old.rows[rowIndex] || []);
        return targetHeaders.map(header => {
            const direct = incomingMap.get(header);
            if (direct !== undefined && normalize(direct) !== '') return direct;
            const previous = oldMap.get(header);
            return previous !== undefined ? previous : (direct ?? '');
        });
    });
    return [['', ...targetHeaders], ...rows.map(row => ['', ...row])];
}
function installWorldMemorySchemaGuard(sheet, enabledIndex = -1) {
    if (!sheet || guardedSheets.has(sheet) || !standardHeaders(sheet, enabledIndex).length) return false;
    const original = sheet.rebuildHashSheetByValueSheet;
    if (typeof original !== 'function') return false;
    sheet.rebuildHashSheetByValueSheet = function memoSchemaGuard(valueSheet, ...args) {
        return original.call(this, conformValueSheetToSchema(this, valueSheet, enabledIndex), ...args);
    };
    guardedSheets.add(sheet);
    return true;
}
function installCurrentWorldMemoryGuards() {
    const sheets = (BASE.getChatSheets?.() || []).filter(sheet => sheet?.enable !== false);
    sheets.forEach((sheet, index) => installWorldMemorySchemaGuard(sheet, index));
}
function repairMissingColumnsBeforeCleanup({ notify = true } = {}) {
    const { piece } = USER.getChatPiece?.() || {};
    if (!piece) return [];
    const sheets = (BASE.getChatSheets?.() || []).filter(sheet => sheet?.enable !== false);
    const backups = new Map();
    for (const sheet of sheets) {
        const data = sheet?.filterSavingData?.();
        if (!data || typeof data !== 'object') throw new Error(`无法备份表格 ${sheet?.name || '未知表'}`);
        backups.set(sheet, clone(data));
    }
    const pieceBackup = {
        hadHash: Object.prototype.hasOwnProperty.call(piece, 'memo_n_hash_sheets'),
        hash: clone(piece.memo_n_hash_sheets),
        extra: clone(piece.extra ?? {}),
    };
    const repaired = [];
    try {
        sheets.forEach((sheet, enabledIndex) => {
            const required = standardHeaders(sheet, enabledIndex);
            if (!required.length) return;
            const rawHeaders = (sheet.getHeader?.() || []).map(normalize);
            const extras = rawHeaders.filter(header => header && !required.includes(header));
            const targetHeaders = [...required, ...extras];
            const needsRepair = rawHeaders.length !== targetHeaders.length || rawHeaders.some((header, index) => header !== targetHeaders[index]);
            if (needsRepair) {
                const value = sheet.getContent?.(true) || [];
                const parsed = splitValueSheet(value);
                const rows = parsed.rows.map(row => {
                    const values = rowMap(parsed.headers, row);
                    return targetHeaders.map(header => values.get(header) ?? '');
                });
                sheet.rebuildHashSheetByValueSheet([['', ...targetHeaders], ...rows.map(row => ['', ...row])]);
                if (sheet.save(piece, true) === false) throw new Error(`保存表格 ${sheet.name} 失败`);
                repaired.push({ tableIndex:enabledIndex, tableName:sheet.name, headers:targetHeaders });
            }
            installWorldMemorySchemaGuard(sheet, enabledIndex);
        });
    } catch (error) {
        const rollbackFailures = [];
        for (const [sheet, data] of backups) {
            try { sheet.loadJson(clone(data)); }
            catch (rollbackError) { rollbackFailures.push(`${sheet?.name || '未知表'}: ${rollbackError?.message || rollbackError}`); }
        }
        if (pieceBackup.hadHash) piece.memo_n_hash_sheets = clone(pieceBackup.hash); else delete piece.memo_n_hash_sheets;
        piece.extra = clone(pieceBackup.extra);
        throw new Error(`${error?.message || error}${rollbackFailures.length ? `；回滚异常：${rollbackFailures.join('；')}` : ''}`);
    }
    if (repaired.length) {
        USER.saveChat?.();
        try { BASE.refreshContextView?.(); updateSystemMessageTableStatus?.(); } catch (error) { console.warn('[Memo] 表头修复已提交，但视图刷新失败', error); }
        if (notify) EDITOR.success(`已按当前模板修复 ${repaired.length} 张表的表头`);
    }
    return repaired;
}

const WORLD_MEMORY_HEADERS = Object.fromEntries(currentStructures().map(item => [item?.tableName, Array.isArray(item?.columns) ? [...item.columns] : []]));

export { WORLD_MEMORY_HEADERS, conformValueSheetToSchema, installCurrentWorldMemoryGuards, installWorldMemorySchemaGuard, repairMissingColumnsBeforeCleanup };
