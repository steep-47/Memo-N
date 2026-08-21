function cleanName(value) {
    return String(value ?? '').trim().replace(/[\u200B-\u200D\uFEFF]/g, '').toLowerCase();
}

export function normalizePinnedCharacters(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const result = [];
    for (const item of value) {
        const display = String(item ?? '').trim();
        const key = cleanName(display);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push(display);
    }
    return result;
}

export function pinRank(name, pinnedCharacters) {
    const key = cleanName(name);
    const index = normalizePinnedCharacters(pinnedCharacters).findIndex(item => cleanName(item) === key);
    return index < 0 ? Number.POSITIVE_INFINITY : index;
}

export function toggleCharacterPin(name, pinnedCharacters) {
    const display = String(name ?? '').trim();
    if (!display) return normalizePinnedCharacters(pinnedCharacters);
    const list = normalizePinnedCharacters(pinnedCharacters);
    const key = cleanName(display);
    const index = list.findIndex(item => cleanName(item) === key);
    if (index >= 0) list.splice(index, 1);
    else list.push(display);
    return list;
}

export function stablePinnedSort(items, getName, pinnedCharacters) {
    return items.map((item, index) => ({ item, index, rank: pinRank(getName(item), pinnedCharacters) }))
        .sort((a, b) => a.rank - b.rank || a.index - b.index)
        .map(entry => entry.item);
}

export { cleanName };
