import applicationFunctionManager from '../../services/appFuncManager.js';

function normalizeName(value) {
    return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function uniqueMappedUids(values, remap, validUids) {
    if (!Array.isArray(values)) return values;
    const seen = new Set();
    const result = [];
    for (const rawUid of values) {
        const uid = remap.get(rawUid) ?? rawUid;
        if (!uid || !validUids.has(uid) || seen.has(uid)) continue;
        seen.add(uid);
        result.push(uid);
    }
    return result;
}

function dedupeNamedSheets(list) {
    if (!Array.isArray(list)) return { list, removed: 0, remap: new Map() };

    const kept = [];
    const firstUidByName = new Map();
    const remap = new Map();

    for (const item of list) {
        const name = normalizeName(item?.name);
        const uid = item?.uid;

        if (!name || !uid) {
            kept.push(item);
            continue;
        }

        const firstUid = firstUidByName.get(name);
        if (!firstUid) {
            firstUidByName.set(name, uid);
            kept.push(item);
            continue;
        }

        remap.set(uid, firstUid);
    }

    return { list: kept, removed: list.length - kept.length, remap };
}

try {
    const root = applicationFunctionManager.power_user;
    const context = applicationFunctionManager.getContext?.();
    let settingsChanged = false;
    let chatChanged = false;
    let removedTemplates = 0;
    let removedChatSheets = 0;

    // 1. 清理全局模板库。截图中的下拉标签在“模板”作用域时来自这里。
    if (root && Array.isArray(root.memo_n_table_database_templates)) {
        const result = dedupeNamedSheets(root.memo_n_table_database_templates);
        if (result.removed > 0) {
            root.memo_n_table_database_templates = result.list;
            removedTemplates = result.removed;
            settingsChanged = true;
        }

        const validUids = new Set((root.memo_n_table_database_templates || []).map(item => item?.uid).filter(Boolean));
        const oldSelected = root.memo_n_table_selected_sheets;
        if (Array.isArray(oldSelected)) {
            const nextSelected = uniqueMappedUids(oldSelected, result.remap, validUids);
            if (JSON.stringify(nextSelected) !== JSON.stringify(oldSelected)) {
                root.memo_n_table_selected_sheets = nextSelected;
                settingsChanged = true;
            }
        }
    }

    // 2. 清理当前聊天已经落盘的重复 Sheet。截图中的下拉标签在“聊天”作用域时来自这里。
    const metadata = context?.chatMetadata;
    if (metadata && Array.isArray(metadata.memo_n_sheets)) {
        const result = dedupeNamedSheets(metadata.memo_n_sheets);
        if (result.removed > 0) {
            metadata.memo_n_sheets = result.list;
            removedChatSheets = result.removed;
            chatChanged = true;
        }

        const validUids = new Set((metadata.memo_n_sheets || []).map(item => item?.uid).filter(Boolean));
        const oldSelected = metadata.memo_n_selected_sheets;
        if (Array.isArray(oldSelected)) {
            const nextSelected = uniqueMappedUids(oldSelected, result.remap, validUids);
            if (JSON.stringify(nextSelected) !== JSON.stringify(oldSelected)) {
                metadata.memo_n_selected_sheets = nextSelected;
                chatChanged = true;
            }
        }
    }

    if (settingsChanged) {
        const saving = applicationFunctionManager.saveSettings?.() ?? applicationFunctionManager.saveSettingsDebounced?.();
        saving?.catch?.(error => console.warn('[Memo-N][cleanup] 保存模板去重结果失败:', error));
    }

    if (chatChanged) {
        const saving = applicationFunctionManager.saveChat?.();
        saving?.catch?.(error => console.warn('[Memo-N][cleanup] 保存聊天表格去重结果失败:', error));
    }

    const total = removedTemplates + removedChatSheets;
    if (total > 0) {
        console.log(`[Memo-N][cleanup] 已删除遗留重复项 ${total} 个（模板 ${removedTemplates}，当前聊天 ${removedChatSheets}）`);
        globalThis?.toastr?.success?.(`Memo-N 已删除 ${total} 个遗留重复表格项`);
    } else {
        console.log('[Memo-N][cleanup] 模板库和当前聊天均未发现同名重复表格');
    }
} catch (error) {
    console.warn('[Memo-N][cleanup] 遗留表格数据清理失败:', error);
}
