import { BASE, DERIVED, USER } from '../../core/manager.js';

function getChoiceUid(removeButton) {
    const choice = removeButton?.closest?.('.select2-selection__choice');
    if (!choice) return null;

    try {
        const data = globalThis.$?.(choice)?.data?.('data');
        if (data?.id) return String(data.id);
    } catch (_) {}

    const title = String(choice.getAttribute?.('title') || '').trim();
    if (!title) return null;
    const metadata = USER.getContext()?.chatMetadata;
    const sheets = Array.isArray(metadata?.memo_n_sheets) ? metadata.memo_n_sheets : [];
    return sheets.find(sheet => String(sheet?.name || '').trim() === title)?.uid || null;
}

function removeUidFromHashMap(target, uid) {
    if (!target || typeof target !== 'object') return false;
    if (!Object.prototype.hasOwnProperty.call(target, uid)) return false;
    delete target[uid];
    return true;
}

function purgeSheetSnapshots(uid) {
    const context = USER.getContext?.();
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    let changed = false;

    for (const piece of chat) {
        changed = removeUidFromHashMap(piece?.memo_n_hash_sheets, uid) || changed;
        changed = removeUidFromHashMap(piece?.extra?.memo_n_swipe_hash_sheets, uid) || changed;

        if (Array.isArray(piece?.swipe_info)) {
            for (const swipe of piece.swipe_info) {
                changed = removeUidFromHashMap(swipe?.memo_n_hash_sheets, uid) || changed;
                changed = removeUidFromHashMap(swipe?.extra?.memo_n_swipe_hash_sheets, uid) || changed;
            }
        }
    }

    return changed;
}

async function deleteCurrentChatSheet(uid) {
    const context = USER.getContext?.();
    const metadata = context?.chatMetadata;
    if (!metadata || !Array.isArray(metadata.memo_n_sheets)) return false;

    const target = metadata.memo_n_sheets.find(sheet => sheet?.uid === uid);
    if (!target) return false;

    metadata.memo_n_sheets = metadata.memo_n_sheets.filter(sheet => sheet?.uid !== uid);
    if (Array.isArray(metadata.memo_n_selected_sheets)) {
        metadata.memo_n_selected_sheets = metadata.memo_n_selected_sheets.filter(item => item !== uid);
    }

    purgeSheetSnapshots(uid);

    try {
        if (DERIVED?.any?.chatSheetMap) delete DERIVED.any.chatSheetMap[uid];
    } catch (_) {}

    const select = document.querySelector('#table_template');
    if (select) {
        const option = Array.from(select.options || []).find(item => item.value === uid);
        option?.remove?.();
        const selected = Array.from(select.selectedOptions || []).map(item => item.value).filter(item => item !== uid);
        try { globalThis.$?.(select)?.val?.(selected)?.trigger?.('change', [true]); } catch (_) {}
    }

    const saving = USER.saveChat?.();
    if (saving?.then) await saving;

    try { BASE.refreshTempView?.(true); } catch (_) {}
    try { BASE.refreshContextView?.(); } catch (_) {}

    globalThis?.toastr?.success?.(`已删除表格：${target?.name || uid}`);
    return true;
}

function onRemovePointer(event) {
    const removeButton = event.target?.closest?.('.select2-selection__choice__remove');
    if (!removeButton) return;

    const select = document.querySelector('#table_template');
    if (!select) return;

    const uid = getChoiceUid(removeButton);
    if (!uid) return;

    const metadata = USER.getContext?.()?.chatMetadata;
    const isCurrentChatSheet = Array.isArray(metadata?.memo_n_sheets)
        && metadata.memo_n_sheets.some(sheet => sheet?.uid === uid);

    // 只接管“当前聊天”中的标签 ×。模板作用域继续走原插件行为。
    if (!isCurrentChatSheet) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();

    deleteCurrentChatSheet(uid).catch(error => {
        console.error('[Memo-N][sheet-delete] 删除当前聊天表格失败:', error);
        globalThis?.toastr?.error?.(`删除表格失败：${error?.message || error}`);
    });
}

// Select2 的标签 × 使用 mousedown/touchstart 触发取消选择；捕获阶段先接管，避免它退化成“仅取消勾选”。
document.addEventListener('mousedown', onRemovePointer, true);
document.addEventListener('touchstart', onRemovePointer, true);

console.log('[Memo-N][sheet-delete] 已恢复当前聊天标签 × 的真实删除行为');
