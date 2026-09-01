import { APP, BASE, USER } from '../../core/manager.js';
import { executeMemoTableEdit, restoreMemoSnapshot, saveMemoSnapshot } from './safeTableExecutor.js';

const YIYI = '伊依';
const TABLES = Object.freeze({
    scene: { name: '当前状态表', index: 0, column: 3 },
    tasks: { name: '当前任务与约定表', index: 3, column: 1 },
    people: { name: '人物主表', index: 4 },
    development: { name: '人物发展表', index: 5 },
    history: { name: '历史事件表', index: 6, column: 2 },
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
function withoutYiyi(value) {
    const raw = String(value ?? '').trim();
    if (!raw || !raw.includes(YIYI)) return raw;
    return raw
        .split(/[、,，;；/|\s]+/)
        .map(part => part.trim())
        .filter(Boolean)
        .filter(part => part !== YIYI)
        .join('、');
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
    for (const spec of [TABLES.scene, TABLES.tasks, TABLES.history]) {
        const target = sheet(spec.name);
        if (!target) continue;
        for (let row = 0; row < dataRowCount(target); row++) {
            const before = valueAt(target, row, spec.column);
            const after = withoutYiyi(before);
            if (before !== after) calls.push(`updateRow(${spec.index},${row},${JSON.stringify({ [spec.column]: after })})`);
        }
    }
    for (const spec of [TABLES.people, TABLES.development]) {
        const target = sheet(spec.name);
        if (!target) continue;
        for (let row = dataRowCount(target) - 1; row >= 0; row--) {
            if (valueAt(target, row, 0) === YIYI) calls.push(`deleteRow(${spec.index},${row})`);
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
        if (!baseline) {
            console.warn('[Memo-N] 世界表守卫缺少可靠回滚基线，本次清理跳过');
            return;
        }
        const execution = executeMemoTableEdit(calls, piece);
        if (!execution.ok) {
            console.error('[Memo-N] 世界表守卫严格清理失败，原表未部分写入', execution.error);
            return;
        }
        try {
            await USER?.saveChat?.();
        } catch (error) {
            const restored = restoreMemoSnapshot(copyHash(baseline));
            try { if (restored.ok) saveMemoSnapshot(piece); } catch (snapshotError) { console.error('[Memo-N] 世界表守卫回滚快照保存失败', snapshotError); }
            console.error('[Memo-N] 世界表守卫聊天保存失败，已尝试回滚', error, restored);
            return;
        }
        globalThis.__memoNWorldTableGuard = { at: Date.now(), cleaned: true, count: execution.count };
        console.warn(`[Memo-N] 世界表守卫已严格清理误写的伊依世界记录：${execution.count}项`);
    } catch (error) {
        console.error('[Memo-N] 世界表守卫清理失败', error);
    } finally {
        running = false;
    }
}

function schedule(delay = 250) {
    clearTimeout(timer);
    timer = setTimeout(() => void cleanWorldTables(), delay);
}
function scheduleAfterGeneration() { schedule(); }

schedule(500);
const ended = APP.event_types.GENERATION_ENDED;
if (ended) {
    APP.eventSource.on(ended, scheduleAfterGeneration);
    APP.eventSource.makeLast?.(ended, scheduleAfterGeneration);
}

console.log('[Memo-N] 世界七表伊依隔离守卫已加载：等待严格记录持久化后再事务清理');
