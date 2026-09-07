function deleteOwn(target, key) {
    if (!target || typeof target !== 'object' || !Object.prototype.hasOwnProperty.call(target, key)) return false;
    delete target[key];
    return true;
}

export function purgeMemoTableState(piece, { includeLegacy = true } = {}) {
    if (!piece || typeof piece !== 'object') return false;
    let changed = false;
    changed = deleteOwn(piece, 'memo_n_hash_sheets') || changed;
    changed = deleteOwn(piece?.extra, 'memo_n_swipe_hash_sheets') || changed;

    if (Array.isArray(piece.swipe_info)) {
        for (const swipe of piece.swipe_info) {
            changed = deleteOwn(swipe, 'memo_n_swipe_hash_sheets') || changed;
            changed = deleteOwn(swipe?.extra, 'memo_n_swipe_hash_sheets') || changed;
        }
    }

    if (includeLegacy) changed = deleteOwn(piece, 'dataTable') || changed;
    return changed;
}
