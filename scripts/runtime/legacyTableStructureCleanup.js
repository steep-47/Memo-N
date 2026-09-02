import applicationFunctionManager from '../../services/appFuncManager.js';

const CLEANUP_MARKER = '_legacy_table_structure_dedup_v1';

function normalizeName(value) {
    return String(value ?? '').trim().replace(/\s+/g, ' ');
}

try {
    const root = applicationFunctionManager.power_user;
    const store = root?.memo_n_settings;

    if (store && !store[CLEANUP_MARKER] && Array.isArray(store.tableStructure)) {
        const seen = new Set();
        const before = store.tableStructure.length;

        store.tableStructure = store.tableStructure.filter((table) => {
            const name = normalizeName(table?.tableName);
            if (!name) return true;
            if (seen.has(name)) return false;
            seen.add(name);
            return true;
        });

        const removed = before - store.tableStructure.length;
        store[CLEANUP_MARKER] = true;
        applicationFunctionManager.saveSettingsDebounced?.();

        if (removed > 0) {
            console.log(`[Memo-N][cleanup] 已清理 ${removed} 个遗留重复模板项`);
            globalThis?.toastr?.success?.(`Memo-N 已清理 ${removed} 个重复模板项，请刷新设置页`);
        } else {
            console.log('[Memo-N][cleanup] 未发现遗留重复模板项');
        }
    }
} catch (error) {
    console.warn('[Memo-N][cleanup] 遗留模板去重失败:', error);
}
