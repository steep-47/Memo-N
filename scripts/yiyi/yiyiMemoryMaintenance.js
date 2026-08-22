import { saveYiYiVault } from './yiyiMemoryStore.js';

const IMPORTANCE = Object.freeze({ core: 3, high: 2, normal: 1 });
const REVIEW_THRESHOLD = 1000;

function clone(value) { try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value)); } }
function text(value) { return String(value ?? '').trim(); }
function canonical(value) {
    return text(value).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}
function duplicateKey(item) {
    return `${canonical(item?.time)}\u241f${canonical(item?.memory)}`;
}
function richness(item) {
    return text(item?.memory).length + text(item?.thenFeeling).length + text(item?.currentView).length;
}
function chooseKeeper(a, b) {
    const importanceDiff = (IMPORTANCE[b?.importance] || 1) - (IMPORTANCE[a?.importance] || 1);
    if (importanceDiff !== 0) return importanceDiff > 0 ? b : a;
    const richDiff = richness(b) - richness(a);
    if (richDiff !== 0) return richDiff > 0 ? b : a;
    const aCreated = Date.parse(a?.createdAt || '') || Number.MAX_SAFE_INTEGER;
    const bCreated = Date.parse(b?.createdAt || '') || Number.MAX_SAFE_INTEGER;
    return aCreated <= bCreated ? a : b;
}
function laterValue(a, b, key) {
    const aTime = Date.parse(a?.updatedAt || a?.createdAt || '') || 0;
    const bTime = Date.parse(b?.updatedAt || b?.createdAt || '') || 0;
    const first = bTime >= aTime ? b : a;
    const second = first === a ? b : a;
    return text(first?.[key]) || text(second?.[key]);
}
function mergeExact(a, b) {
    const keeper = chooseKeeper(a, b);
    const other = keeper === a ? b : a;
    const createdCandidates = [Date.parse(a?.createdAt || ''), Date.parse(b?.createdAt || '')].filter(Number.isFinite);
    const updatedCandidates = [Date.parse(a?.updatedAt || ''), Date.parse(b?.updatedAt || '')].filter(Number.isFinite);
    return {
        ...clone(keeper),
        id: keeper.id,
        time: text(keeper.time) || text(other.time),
        memory: text(keeper.memory) || text(other.memory),
        thenFeeling: laterValue(a, b, 'thenFeeling'),
        currentView: laterValue(a, b, 'currentView'),
        importance: (IMPORTANCE[a?.importance] || 1) >= (IMPORTANCE[b?.importance] || 1) ? (a.importance || 'normal') : (b.importance || 'normal'),
        createdAt: createdCandidates.length ? new Date(Math.min(...createdCandidates)).toISOString() : (keeper.createdAt || other.createdAt),
        updatedAt: updatedCandidates.length ? new Date(Math.max(...updatedCandidates)).toISOString() : (keeper.updatedAt || other.updatedAt),
    };
}

export function inspectYiYiMemoryVault(vault) {
    const memories = Array.isArray(vault?.memories) ? vault.memories : [];
    const counts = { total: memories.length, normal: 0, high: 0, core: 0, exactDuplicateRows: 0, needsReview: memories.length >= REVIEW_THRESHOLD };
    const seen = new Set();
    for (const item of memories) {
        counts[item?.importance] = Number(counts[item?.importance] || 0) + 1;
        const key = duplicateKey(item);
        if (!canonical(item?.memory)) continue;
        if (seen.has(key)) counts.exactDuplicateRows++;
        else seen.add(key);
    }
    return counts;
}

export function maintainYiYiMemoryVault(input, { persist = true } = {}) {
    const vault = clone(input || {});
    const memories = Array.isArray(vault.memories) ? vault.memories : [];
    const merged = [];
    const byKey = new Map();
    let duplicatesMerged = 0;

    for (const item of memories) {
        const key = duplicateKey(item);
        if (!canonical(item?.memory) || !byKey.has(key)) {
            byKey.set(key, merged.length);
            merged.push(clone(item));
            continue;
        }
        const index = byKey.get(key);
        merged[index] = mergeExact(merged[index], item);
        duplicatesMerged++;
    }

    vault.memories = merged;
    const changed = duplicatesMerged > 0;
    const stats = inspectYiYiMemoryVault(vault);

    // 容量原则：只限制每轮召回，不因年代久远或条目数量自动删除长期记忆。
    // 达到1000条仅给出维护信号；自动维护只做可证明安全的“同时间+同内容”精确去重。
    const result = { changed, vault, duplicatesMerged, stats };
    if (changed && persist) result.vault = saveYiYiVault(vault);
    return result;
}

export const YiYiMemoryMaintenance = Object.freeze({
    inspect: inspectYiYiMemoryVault,
    maintain: maintainYiYiMemoryVault,
    reviewThreshold: REVIEW_THRESHOLD,
});

globalThis.MemoNYiYiMaintenance = YiYiMemoryMaintenance;
console.log('[Memo-N][伊依] 记忆维护引擎已加载：精确去重；容量只限制召回，不按年龄/数量自动删记忆');
