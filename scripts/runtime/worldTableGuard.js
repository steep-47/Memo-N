import { APP, BASE, USER } from '../../core/manager.js';
import { Cell } from '../../core/table/cell.js';
import { saveMemoSnapshot } from './safeTableExecutor.js?v=memon56';

const YIYI = '伊依';
const TABLES = Object.freeze({
    scene: '当前状态表',
    tasks: '当前任务与约定表',
    people: '人物主表',
    development: '人物发展表',
    history: '历史事件表',
});

let running = false;
let timer = null;

function sheet(name) {
    return (BASE.getChatSheets?.() ?? []).find(item => item?.name === name) ?? null;
}

function dataRowCount(target) {
    return Math.max(0, (Number(target?.getRowCount?.()) || 0) - 1);
}

function valueAt(target, row, column) {
    return String(target?.findCellByPosition?.(row + 1, column + 1)?.data?.value ?? '').trim();
}

function editAt(target, row, column, value) {
    const cell = target?.findCellByPosition?.(row + 1, column + 1);
    if (!cell) return false;
    cell.newAction(Cell.CellAction.editCell, { value }, false);
    return true;
}

function deleteRow(target, row) {
    const cell = target?.findCellByPosition?.(row + 1, 0);
    if (!cell) return false;
    cell.newAction(Cell.CellAction.deleteSelfRow, {}, false);
    return true;
}

function withoutYiyi(value) {
    const raw = String(value ?? '').trim();
    if (!raw || !raw.includes(YIYI)) return raw;
    const parts = raw.split(/[、,，;；/|\s]+/).map(part => part.trim()).filter(Boolean).filter(part => part !== YIYI);
    return parts.join('、');
}

function cleanPersonList(target, column) {
    if (!target) return false;
    let changed = false;
    for (let row = 0; row < dataRowCount(target); row++) {
        const before = valueAt(target, row, column);
        const after = withoutYiyi(before);
        if (before !== after) changed = editAt(target, row, column, after) || changed;
    }
    return changed;
}

function deleteYiyiRows(target) {
    if (!target) return false;
    let changed = false;
    for (let row = dataRowCount(target) - 1; row >= 0; row--) {
        if (valueAt(target, row, 0) === YIYI) changed = deleteRow(target, row) || changed;
    }
    return changed;
}

async function cleanWorldTables() {
    if (running) return;
    running = true;
    try {
        let changed = false;
        // #0 当前场景人物
        changed = cleanPersonList(sheet(TABLES.scene), 3) || changed;
        // #3 相关人物
        changed = cleanPersonList(sheet(TABLES.tasks), 1) || changed;
        // #4/#5 伊依整行禁止存在
        changed = deleteYiyiRows(sheet(TABLES.people)) || changed;
        changed = deleteYiyiRows(sheet(TABLES.development)) || changed;
        // #6 涉及人物
        changed = cleanPersonList(sheet(TABLES.history), 2) || changed;

        if (!changed) return;
        const chat = USER?.getChatPiece?.()?.piece ?? USER?.getContext?.()?.chat?.at?.(-1);
        if (chat) saveMemoSnapshot(chat);
        await USER?.saveChat?.();
        globalThis.__memoNWorldTableGuard = { at: Date.now(), cleaned: true };
        console.warn('[Memo-N] 世界表守卫已清理误写的伊依世界记录');
    } catch (error) {
        console.error('[Memo-N] 世界表守卫清理失败', error);
    } finally {
        running = false;
    }
}

function schedule() {
    clearTimeout(timer);
    timer = setTimeout(cleanWorldTables, 350);
}

for (const event of [APP.event_types.GENERATION_ENDED, APP.event_types.MESSAGE_RECEIVED]) {
    if (!event) continue;
    APP.eventSource.on(event, schedule);
    APP.eventSource.makeLast?.(event, schedule);
}

setTimeout(cleanWorldTables, 800);
console.log('[Memo-N] 世界七表伊依硬隔离守卫已加载');
