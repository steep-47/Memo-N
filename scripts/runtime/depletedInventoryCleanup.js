// Only unequivocal stale inventory is eligible. Execution still uses the strict
// executor's original row indexes, identity checks and descending deletion order.
export function completeDepletedInventoryCleanup(parsed, sheets) {
    const inventory = sheets.filter(sheet => sheet?.name === '背包表');
    if (inventory.length !== 1) return { ok: true, block: null };
    const sheet = inventory[0];
    const headers = sheet.getCellsByRowIndex?.(0)?.slice(1).map(cell => String(cell?.data?.value ?? '').trim()) ?? [];
    const quantity = headers.indexOf('数量');
    const status = headers.indexOf('状态/品质');
    if (headers[0] !== '物品名' || quantity < 0 || status < 0
        || headers.lastIndexOf('数量') !== quantity || headers.lastIndexOf('状态/品质') !== status) {
        return { ok: true, block: null };
    }
    const actions = [...parsed.actions];
    let added = false;
    for (let rowIndex = 0; rowIndex < (sheet.hashSheet?.length ?? 1) - 1; rowIndex++) {
        const cells = sheet.getCellsByRowIndex(rowIndex + 1).slice(1);
        const name = String(cells[0]?.data?.value ?? '');
        const amount = cells[quantity]?.data?.value;
        const state = String(cells[status]?.data?.value ?? '').trim();
        const zero = amount === 0 || (typeof amount === 'string' && /^0(?:\.0+)?$/.test(amount.trim()));
        if (!name.trim() || !zero || !['已售出', '已耗尽'].includes(state)) continue;
        const existing = actions.find(action => action.tableIndex === 2 && action.rowIndex === rowIndex);
        if (existing?.type === 'delete') continue;
        if (existing) return { ok: false, error: `背包“${name}”已明确归零且${state}，整理结果却继续修改该失效库存，请重试` };
        actions.push({ type: 'delete', tableIndex: 2, rowIndex, expected: name });
        added = true;
    }
    if (!added) return { ok: true, block: null };
    const json = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
    const calls = actions.map(action => {
        if (action.type === 'insert') return `insertRow(${action.tableIndex},${json(action.data)})`;
        if (action.type === 'delete') return `deleteRow(${action.tableIndex},${action.rowIndex},${json(action.expected ?? '')})`;
        return `updateRow(${action.tableIndex},${action.rowIndex},${json(action.data)},${json(action.expected ?? '')})`;
    });
    return { ok: true, block: `<tableEdit><!--\n${calls.join('\n')}\n--></tableEdit>` };
}
