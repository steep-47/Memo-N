import { BASE, EDITOR, USER } from '../../core/manager.js';
import { updateSystemMessageTableStatus } from '../renderer/tablePushToChat.js';

const guardedSheets = new WeakSet();
const COLUMN_ALIASES = Object.freeze({
    '角色特征表格': Object.freeze({
        '喜欢的事物（作品、角色、物品等）': '喜欢的事物',
        '其他重要信息': '备注',
        '住所': '备注',
    }),
    '重要物品表格': Object.freeze({ '拥有者': '拥有人' }),
});

function normalize(value) { return String(value ?? '').trim(); }
function clone(value) {
    if (value === undefined) return undefined;
    try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value)); }
}
function currentStructures() {
    return Array.isArray(USER?.tableBaseSetting?.tableStructure) ? USER.tableBaseSetting.tableStructure : [];
}
function structureForSheet(sheet) {
    const name = normalize(sheet?.name);
    if (!name) return null;
    return currentStructures().find(item => normalize(item?.tableName) === name) || null;
}
function standardHeaders(sheet) {
    const structure = structureForSheet(sheet);
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
function mergeCell(previous, next) {
    const a = normalize(previous), b = normalize(next);
    if (!a) return next ?? '';
    if (!b || a === b) return previous;
    return `${previous}；${next}`;
}
function rowMap(headers, row, sheetName = '') {
    const map = new Map();
    const aliases = COLUMN_ALIASES[normalize(sheetName)] || {};
    headers.forEach((header, index) => {
        if (!header) return;
        const target = aliases[header] || header;
        const value = row?.[index] ?? '';
        map.set(target, map.has(target) ? mergeCell(map.get(target), value) : value);
    });
    return map;
}
function currentSnapshot(sheet) {
    const valueSheet = sheet?.getContent?.(true);
    if (!Array.isArray(valueSheet) || !valueSheet.length) return { headers:(sheet?.getHeader?.() || []).map(normalize), rows:[] };
    return splitValueSheet(valueSheet);
}
function conformValueSheetToSchema(sheet, valueSheet) {
    const required = standardHeaders(sheet);
    if (!required.length) return valueSheet;
    const old = currentSnapshot(sheet);
    const incoming = splitValueSheet(valueSheet);
    if (!incoming.headers.length) return valueSheet;
    const rows = incoming.rows.map((row, rowIndex) => {
        const incomingMap = rowMap(incoming.headers, row, sheet.name);
        const oldMap = rowMap(old.headers, old.rows[rowIndex] || [], sheet.name);
        return required.map(header => {
            const direct = incomingMap.get(header);
            if (direct !== undefined && normalize(direct) !== '') return direct;
            const previous = oldMap.get(header);
            return previous !== undefined ? previous : (direct ?? '');
        });
    });
    return [['', ...required], ...rows.map(row => ['', ...row])];
}
function installWorldMemorySchemaGuard(sheet) {
    if (!sheet || guardedSheets.has(sheet) || !standardHeaders(sheet).length) return false;
    const original = sheet.rebuildHashSheetByValueSheet;
    if (typeof original !== 'function') return false;
    sheet.rebuildHashSheetByValueSheet = function memoSchemaGuard(valueSheet, ...args) {
        return original.call(this, conformValueSheetToSchema(this, valueSheet), ...args);
    };
    guardedSheets.add(sheet);
    return true;
}
function installCurrentWorldMemoryGuards() {
    const sheets = (BASE.getChatSheets?.() || []).filter(sheet => sheet?.enable !== false);
    sheets.forEach(sheet => installWorldMemorySchemaGuard(sheet));
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
        sheets.forEach(sheet => {
            const required = standardHeaders(sheet);
            if (!required.length) return;
            const rawHeaders = (sheet.getHeader?.() || []).map(normalize);
            const needsRepair = rawHeaders.length !== required.length || rawHeaders.some((header, index) => header !== required[index]);
            if (needsRepair) {
                const parsed = splitValueSheet(sheet.getContent?.(true) || []);
                const rows = parsed.rows.map(row => {
                    const values = rowMap(parsed.headers, row, sheet.name);
                    return required.map(header => values.get(header) ?? '');
                });
                sheet.rebuildHashSheetByValueSheet([['', ...required], ...rows.map(row => ['', ...row])]);
                if (sheet.save(piece, true) === false) throw new Error(`保存表格 ${sheet.name} 失败`);
                repaired.push({ tableName:sheet.name, headers:[...required] });
            }
            installWorldMemorySchemaGuard(sheet);
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
        if (notify) EDITOR.success(`已按当前六表模板修复 ${repaired.length} 张表的表头`);
    }
    return repaired;
}

// Do not read USER during module initialization: this module is in index.js's static import cycle.
const WORLD_MEMORY_HEADERS = {};
function syncWorldMemoryHeaders() {
    for (const key of Object.keys(WORLD_MEMORY_HEADERS)) delete WORLD_MEMORY_HEADERS[key];
    for (const item of currentStructures()) {
        const name = normalize(item?.tableName);
        if (!name) continue;
        WORLD_MEMORY_HEADERS[name] = Array.isArray(item?.columns) ? [...item.columns] : [];
    }
    return WORLD_MEMORY_HEADERS;
}
const originalInstallCurrentWorldMemoryGuards = installCurrentWorldMemoryGuards;
installCurrentWorldMemoryGuards = function installCurrentWorldMemoryGuardsLazy() {
    syncWorldMemoryHeaders();
    return originalInstallCurrentWorldMemoryGuards();
};
const originalRepairMissingColumnsBeforeCleanup = repairMissingColumnsBeforeCleanup;
repairMissingColumnsBeforeCleanup = function repairMissingColumnsBeforeCleanupLazy(options) {
    syncWorldMemoryHeaders();
    return originalRepairMissingColumnsBeforeCleanup(options);
};

export { WORLD_MEMORY_HEADERS, conformValueSheetToSchema, installCurrentWorldMemoryGuards, installWorldMemorySchemaGuard, repairMissingColumnsBeforeCleanup };
