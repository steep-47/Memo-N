const OP_TYPES = new Set(['insert', 'update', 'delete']);

function isIndex(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

function normalizeCells(value, label, allowEmpty = false) {
    if (!Array.isArray(value)) throw new Error(`${label}.cells必须是数组`);
    if (!allowEmpty && !value.length) throw new Error(`${label}.cells不能为空`);
    const result = {};
    for (let index = 0; index < value.length; index++) {
        const cell = value[index];
        if (!cell || typeof cell !== 'object' || Array.isArray(cell)) throw new Error(`${label}.cells[${index}]必须是对象`);
        if (Object.keys(cell).some(key => !['column', 'value'].includes(key))) throw new Error(`${label}.cells[${index}]包含未知字段`);
        if (!isIndex(cell.column)) throw new Error(`${label}.cells[${index}].column必须是非负安全整数`);
        if (String(cell.column) in result) throw new Error(`${label}.cells重复列${cell.column}`);
        if (typeof cell.value !== 'string' && (typeof cell.value !== 'number' || !Number.isFinite(cell.value))) {
            throw new Error(`${label}.cells[${index}].value必须是字符串或有限数字`);
        }
        result[cell.column] = cell.value;
    }
    return result;
}

function normalizeChange(change, index) {
    const label = `changes[${index}]`;
    if (!change || typeof change !== 'object' || Array.isArray(change)) throw new Error(`${label}必须是对象`);
    const allowed = new Set(['op', 'table', 'row', 'cells']);
    for (const key of Object.keys(change)) if (!allowed.has(key)) throw new Error(`${label}包含未知字段${key}`);
    if (!OP_TYPES.has(change.op)) throw new Error(`${label}.op必须是insert/update/delete`);
    if (!isIndex(change.table)) throw new Error(`${label}.table必须是非负安全整数`);
    if (change.op === 'insert') {
        if (change.row !== null) throw new Error(`${label}插入操作row必须为null`);
        return { op: 'insert', table: change.table, data: normalizeCells(change.cells, label) };
    }
    if (!isIndex(change.row)) throw new Error(`${label}.row必须是真实存在的非负安全整数`);
    if (change.op === 'delete') {
        normalizeCells(change.cells, label, true);
        if (change.cells.length) throw new Error(`${label}删除操作cells必须为空数组`);
        return { op: 'delete', table: change.table, row: change.row };
    }
    return { op: 'update', table: change.table, row: change.row, data: normalizeCells(change.cells, label) };
}

// Some OpenAI-compatible relays leave literal control characters inside JSON
// strings. JSON has exactly one lossless representation for them: escapes.
// This changes encoding only; it never repairs structure or table operations.
function escapeControlCharsInsideJsonStrings(text) {
    let result = '';
    let inString = false;
    let escaped = false;
    for (const char of String(text ?? '')) {
        if (!inString) {
            result += char;
            if (char === '"') inString = true;
            continue;
        }
        if (escaped) {
            result += char;
            escaped = false;
            continue;
        }
        if (char === '\\') {
            result += char;
            escaped = true;
            continue;
        }
        if (char === '"') {
            result += char;
            inString = false;
            continue;
        }
        const code = char.charCodeAt(0);
        if (code < 0x20) {
            const shortEscape = { 8: '\\b', 9: '\\t', 10: '\\n', 12: '\\f', 13: '\\r' }[code];
            result += shortEscape || `\\u${code.toString(16).padStart(4, '0')}`;
        } else {
            result += char;
        }
    }
    return result;
}

export function parseRecordEnvelope(raw) {
    let value = raw;
    if (typeof value === 'string') {
        const text = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
        try {
            value = JSON.parse(text);
        } catch (error) {
            const normalized = escapeControlCharsInsideJsonStrings(text);
            if (normalized === text) return { ok: false, error: `响应不是合法JSON：${error.message}` };
            try { value = JSON.parse(normalized); } catch { return { ok: false, error: `响应不是合法JSON：${error.message}` }; }
        }
    }
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('响应根节点必须是对象');
        const allowed = new Set(['reply', 'changes']);
        for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`响应包含未知字段${key}`);
        if (typeof value.reply !== 'string' || !value.reply.trim()) throw new Error('reply必须是非空字符串');
        if (!Array.isArray(value.changes)) throw new Error('changes必须是数组');
        const changes = value.changes.map(normalizeChange);
        return { ok: true, reply: value.reply.trim(), changes, noChange: changes.length === 0, error: '' };
    } catch (error) {
        const reply = value && typeof value === 'object' && !Array.isArray(value) && typeof value.reply === 'string' && value.reply.trim()
            ? value.reply.trim()
            : '';
        return { ok: false, error: error?.message || String(error), reply };
    }
}

export function changesToStrictCalls(changes) {
    if (!Array.isArray(changes) || !changes.length) return ['NO_CHANGE'];
    return changes.map(change => {
        if (change.op === 'insert') return `insertRow(${change.table},${JSON.stringify(change.data)})`;
        if (change.op === 'update') return `updateRow(${change.table},${change.row},${JSON.stringify(change.data)})`;
        return `deleteRow(${change.table},${change.row})`;
    });
}

export { OP_TYPES, escapeControlCharsInsideJsonStrings };
