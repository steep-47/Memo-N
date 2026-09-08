import { BASE } from '../../core/manager.js';

const PATCH_MARK = '__memoNTableViewStabilityGuardV2';
const DRAWER_SELECTOR = '[id="table_database_settings_drawer"]';
const TITLE_SELECTOR = '.table-directory-sheet-title[data-table-directory-sheet-title]';

let refreshQueue = Promise.resolve();
let cleanupQueued = false;
let observer = null;

function getDrawerScore(drawer) {
    if (!drawer) return -1;
    let score = 0;
    if (drawer.querySelector('#database-content')) score += 8;
    if (drawer.querySelector('#tableContainer')) score += 8;
    if (drawer.querySelector('#setting-content')) score += 4;
    if (drawer.querySelector('#app_header_table_container')?.children?.length) score += 2;
    return score;
}

function dedupeDrawerRoots() {
    const drawers = Array.from(document.querySelectorAll(DRAWER_SELECTOR));
    if (drawers.length <= 1) return 0;

    let keep = drawers[0];
    let best = getDrawerScore(keep);
    for (const drawer of drawers.slice(1)) {
        const score = getDrawerScore(drawer);
        if (score > best) {
            keep = drawer;
            best = score;
        }
    }

    let removed = 0;
    for (const drawer of drawers) {
        if (drawer === keep) continue;
        drawer.remove();
        removed++;
    }
    if (removed) console.warn(`[Memo-N][view-stability] 已移除 ${removed} 个重复表格抽屉入口`);
    return removed;
}

function getTableContainer() {
    const drawers = Array.from(document.querySelectorAll(DRAWER_SELECTOR));
    const initialized = drawers
        .sort((a, b) => getDrawerScore(b) - getDrawerScore(a))
        .find(drawer => drawer.querySelector('#tableContainer'));
    return initialized?.querySelector('#tableContainer') || document.querySelector('#tableContainer');
}

function directTitles(container) {
    if (!container) return [];
    return Array.from(container.children).filter(node => node.matches?.(TITLE_SELECTOR));
}

function titleKey(title) {
    return String(title?.dataset?.tableDirectorySheetTitle || title?.textContent || '').trim();
}

function removeTitleGroup(title) {
    if (!title?.parentNode) return 0;
    let removed = 0;
    let node = title;
    while (node) {
        const next = node.nextSibling;
        node.remove();
        removed++;
        if (next?.nodeType === 1 && next.matches?.(TITLE_SELECTOR)) break;
        node = next;
    }
    return removed;
}

function dedupeTableGroups(container = getTableContainer()) {
    if (!container) return 0;
    const titles = directTitles(container);
    if (titles.length < 2) return 0;

    const groups = new Map();
    for (const title of titles) {
        const key = titleKey(title);
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(title);
    }

    let duplicateGroups = 0;
    for (const list of groups.values()) {
        if (list.length <= 1) continue;
        // 并发渲染时较新的完整视图总是后追加；保留最后一组。
        for (const title of list.slice(0, -1)) {
            removeTitleGroup(title);
            duplicateGroups++;
        }
    }

    if (duplicateGroups) {
        console.warn(`[Memo-N][view-stability] 已清理 ${duplicateGroups} 组并发重复表格视图`);
    }
    return duplicateGroups;
}

function enabledSheetCount() {
    try {
        return (BASE.getChatSheets?.() || []).filter(sheet => sheet?.enable).length;
    } catch (_) {
        return 0;
    }
}

function uniqueRenderedCount(container = getTableContainer()) {
    return new Set(directTitles(container).map(titleKey).filter(Boolean)).size;
}

async function waitForStableView(maxWait = 1800, quietMs = 90) {
    const container = getTableContainer();
    if (!container) return;

    const expected = enabledSheetCount();
    let lastMutation = Date.now();
    const localObserver = new MutationObserver(() => { lastMutation = Date.now(); });
    localObserver.observe(container, { childList: true, subtree: true });
    const started = Date.now();

    try {
        while (Date.now() - started < maxWait) {
            dedupeTableGroups(container);
            const rendered = uniqueRenderedCount(container);
            const complete = expected === 0 || rendered >= expected;
            if (complete && Date.now() - lastMutation >= quietMs) break;
            await new Promise(resolve => setTimeout(resolve, 25));
        }
    } finally {
        localObserver.disconnect();
        dedupeTableGroups(container);
    }
}

function patchContextRefresh() {
    const original = BASE.refreshContextView;
    if (typeof original !== 'function' || original[PATCH_MARK]) return;

    const wrapped = function (...args) {
        const run = async () => {
            const container = getTableContainer();
            const expected = enabledSheetCount();
            const rendered = uniqueRenderedCount(container);
            // 包括“还没追加第一张表”的启动窗口：只要上一轮视图尚未完整，就先等它完成。
            if (container && expected > 0 && rendered < expected) {
                await waitForStableView();
            }
            const result = await original.apply(this, args);
            // 原实现的 renderSheetsDOM 没有等待逐表 renderSheet 完成；这里补足真正的完成边界。
            await waitForStableView();
            return result;
        };

        const next = refreshQueue.then(run, run);
        refreshQueue = next.catch(() => undefined);
        return next;
    };
    Object.defineProperty(wrapped, PATCH_MARK, { value: true });
    BASE.refreshContextView = wrapped;
}

function queueCleanup() {
    if (cleanupQueued) return;
    cleanupQueued = true;
    setTimeout(() => {
        cleanupQueued = false;
        dedupeDrawerRoots();
        dedupeTableGroups();
    }, 70);
}

function mutationTouchesMemoView(mutation) {
    const target = mutation?.target;
    if (target?.nodeType === 1 && (target.matches?.(DRAWER_SELECTOR) || target.closest?.(DRAWER_SELECTOR))) return true;
    for (const node of [...(mutation?.addedNodes || []), ...(mutation?.removedNodes || [])]) {
        if (node?.nodeType !== 1) continue;
        if (node.matches?.(DRAWER_SELECTOR) || node.matches?.(TITLE_SELECTOR)) return true;
        if (node.querySelector?.(DRAWER_SELECTOR) || node.querySelector?.(TITLE_SELECTOR)) return true;
    }
    return false;
}

function installObserver() {
    if (observer) return;
    observer = new MutationObserver(mutations => {
        if (mutations.some(mutationTouchesMemoView)) queueCleanup();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
}

function install() {
    dedupeDrawerRoots();
    dedupeTableGroups();
    patchContextRefresh();
    installObserver();
    queueCleanup();
    setTimeout(queueCleanup, 250);
    setTimeout(queueCleanup, 800);
    console.log('[Memo-N] 表格视图稳定守卫已加载：单抽屉、串行刷新、并发重复视图清理');
}

install();

export { dedupeDrawerRoots, dedupeTableGroups, waitForStableView };
