import { APP, BASE, USER } from '../../core/manager.js';
import { executeMemoTableEdit, restoreMemoSnapshot, saveMemoSnapshot } from './safeTableExecutor.js';

const YIYI = '伊依';
let running = false;
let timer = null;

function sheets() {
    return (BASE.getChatSheets?.() ?? []).filter(sheet => sheet?.enable !== false).filter(sheet => sheet?.sendToContext !== false);
}
function sheetIndex(target) { return sheets().indexOf(target); }
function headerIndex(target, names) {
    const headers = (target?.getHeader?.() ?? []).map(value => String(value ?? '').trim());
    for (const name of names) {
        const index = headers.indexOf(name);
        if (index >= 0) return index;
    }
    return -1;
}
function rowCount(target) { return Math.max(0, (Number(target?.getRowCount?.()) || 0) - 1); }
function valueAt(target, row, column) {
    return String(target?.findCellByPosition?.(row + 1, column + 1)?.data?.value ?? '').trim();
}
function withoutYiyi(value) {
    const raw = String(value ?? '').trim();
    if (!raw || !raw.includes(YIYI)) return raw;
    return raw.split(/[、,，;；/|\s]+/).map(part => part.trim()).filter(Boolean).filter(part => part !== YIYI).join('、');
}
function copyHash(value) {
    if (!value || typeof value !== 'object') return null;
    try { return BASE.copyHashSheets(value); }
    catch (_) { try { return structuredClone(value); } catch (_) { return null; } }
}
function latestAssistant() {
    const chat = USER?.getContext?.()?.chat;
    if (!Array.isArray(chat)) return null;
    for (let index = chat.length - 1; index >= 0; index--) if (chat[index]?.is_user === false) return chat[index];
    return null;
}
async function waitStrictPersistence(piece) {
    const persistence = piece?.__memoStrictPersistence;
    if (persistence && typeof persistence.then === 'function') {
        try { await persistence; } catch (_) {}
    }
}
function buildCleanupCalls() {
    const calls = [];
    for (const target of sheets()) {
        const table = sheetIndex(target);
        if (table < 0) continue;
        const name = String(target?.name ?? '');
        if (name === '时空表格') {
            const column = headerIndex(target, ['此地角色']);
            if (column < 0) continue;
            for (let row = 0; row < rowCount(target); row++) {
                const before = valueAt(target, row, column);
                const after = withoutYiyi(before);
                if (before !== after) calls.push(`updateRow(${table},${row},{${column}:${JSON.stringify(after)}})`);
            }
            continue;
        }
        if (name === '角色特征表格' || name === '角色与社交表格') {
            const column = headerIndex(target, ['角色名']);
            if (column < 0) continue;
            for (let row = rowCount(target) - 1; row >= 0; row--) {
                if (valueAt(target, row, column) === YIYI) calls.push(`deleteRow(${table},${row})`);
            }
            continue;
        }
        if (name === '任务、命令或者约定表格' || name === '重要事件历史表格') {
            const column = headerIndex(target, ['角色']);
            if (column < 0) continue;
            for (let row = 0; row < rowCount(target); row++) {
                const before = valueAt(target, row, column);
                const after = withoutYiyi(before);
                if (before !== after) calls.push(`updateRow(${table},${row},{${column}:${JSON.stringify(after)}})`);
            }
            continue;
        }
        if (name === '重要物品表格') {
            const owner = headerIndex(target, ['拥有人','拥有者']);
            if (owner < 0) continue;
            for (let row = rowCount(target) - 1; row >= 0; row--) {
                if (valueAt(target, row, owner) === YIYI) calls.push(`deleteRow(${table},${row})`);
            }
        }
    }
    return calls;
}
async function cleanWorldTables() {
    if (running) return;
    running = true;
    const session = USER?.getContext?.()?.chat;
    try {
        const latest = latestAssistant();
        await waitStrictPersistence(latest);
        if (session !== USER?.getContext?.()?.chat) return;
        const piece = USER?.getChatPiece?.()?.piece ?? latest;
        if (!piece?.memo_n_hash_sheets) return;
        const calls = buildCleanupCalls();
        if (!calls.length) return;
        const baseline = copyHash(piece.memo_n_hash_sheets);
        if (!baseline) return;
        const execution = executeMemoTableEdit(calls, piece);
        if (!execution.ok) {
            console.error('[Memo-N] 伊依世界表隔离清理失败，原表未部分写入', execution.error);
            return;
        }
        try { await USER?.saveChat?.(); }
        catch (error) {
            const restored = restoreMemoSnapshot(copyHash(baseline));
            try { if (restored.ok) saveMemoSnapshot(piece); } catch (_) {}
            console.error('[Memo-N] 伊依世界表隔离保存失败，已尝试回滚', error);
            return;
        }
        globalThis.__memoNWorldTableGuard = { at:Date.now(), cleaned:true, count:execution.count };
    } catch (error) {
        console.error('[Memo-N] 伊依世界表隔离异常', error);
    } finally { running = false; }
}
function schedule(delay = 250) {
    clearTimeout(timer);
    timer = setTimeout(() => void cleanWorldTables(), delay);
}
schedule(500);
const ended = APP.event_types.GENERATION_ENDED;
if (ended) {
    APP.eventSource.on(ended, () => schedule());
    APP.eventSource.makeLast?.(ended, () => schedule());
}
console.log('[Memo-N] 伊依世界表隔离守卫已加载：按当前六表真实结构清理');
