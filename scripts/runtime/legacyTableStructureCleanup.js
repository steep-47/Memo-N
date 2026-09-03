import applicationFunctionManager from '../../services/appFuncManager.js';

const OBSOLETE_SHEET_NAMES = new Set([
    '时空表格',
    '角色特征表格',
    '角色与社交表格',
    '任务、命令或者约定表格',
    '重要事件历史表格',
    '重要物品表格',
]);

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

function cleanNamedSheets(list) {
    if (!Array.isArray(list)) return { list, removed: 0, remap: new Map() };

    const kept = [];
    const firstUidByName = new Map();
    const remap = new Map();
    let removed = 0;

    for (const item of list) {
        const name = normalizeName(item?.name);
        const uid = item?.uid;

        // 固定七表之外的旧默认表属于历史遗留，直接删除。
        if (OBSOLETE_SHEET_NAMES.has(name)) {
            removed++;
            continue;
        }

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
        removed++;
    }

    return { list: kept, removed, remap };
}

try {
    const root = applicationFunctionManager.power_user;
    const context = applicationFunctionManager.getContext?.();
    let settingsChanged = false;
    let chatChanged = false;
    let removedTemplates = 0;
    let removedChatSheets = 0;

    // 1. 清理全局模板库，防止旧表以后再次被新聊天或模板选择带回来。
    if (root && Array.isArray(root.memo_n_table_database_templates)) {
        const result = cleanNamedSheets(root.memo_n_table_database_templates);
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

    // 2. 清理当前聊天已经落盘的旧表和同名重复表。
    const metadata = context?.chatMetadata;
    if (metadata && Array.isArray(metadata.memo_n_sheets)) {
        const result = cleanNamedSheets(metadata.memo_n_sheets);
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
        saving?.catch?.(error => console.warn('[Memo-N][cleanup] 保存模板清理结果失败:', error));
    }

    if (chatChanged) {
        const saving = applicationFunctionManager.saveChat?.();
        saving?.catch?.(error => console.warn('[Memo-N][cleanup] 保存聊天表格清理结果失败:', error));
    }

    const total = removedTemplates + removedChatSheets;
    if (total > 0) {
        console.log(`[Memo-N][cleanup] 已删除遗留表格 ${total} 个（模板 ${removedTemplates}，当前聊天 ${removedChatSheets}）`);
        globalThis?.toastr?.success?.(`Memo-N 已删除 ${total} 个遗留表格`);
    } else {
        console.log('[Memo-N][cleanup] 未发现遗留旧表或同名重复表');
    }
} catch (error) {
    console.warn('[Memo-N][cleanup] 遗留表格数据清理失败:', error);
}
