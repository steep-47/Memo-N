const OP_TYPES = new Set(['insert', 'update', 'delete']);
const RELAY_TAG_START = '<!--MEMO_N_CHANGES_V1';
const RELAY_TAG_END = 'MEMO_N_CHANGES_END-->';

function isIndex(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

function normalizeCellValue(value, label) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;

    // Safe scalar compatibility only changes representation, never column or meaning.
    // Explicit null is treated as an empty cell; booleans become literal text.
    if (value === null) return '';
    if (typeof value === 'boolean') return value ? 'true' : 'false';

    // Some OpenAI-compatible relays/models occasionally wrap a textual cell value in
    // an array/object despite the JSON Schema. A compact JSON string preserves the
    // supplied value losslessly without guessing which nested field was "intended".
    if (Array.isArray(value) || (value && typeof value === 'object')) {
        try {
            const serialized = JSON.stringify(value);
            if (typeof serialized === 'string') return serialized;
        } catch (_) {}
    }

    throw new Error(`${label}值必须是字符串、有限数字或可安全转成文本的JSON值`);
}

function normalizeCellsContainer(value, label, allowEmpty) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') throw new Error(`${label}.cells必须是数组`);

    const keys = Object.keys(value);
    if (!keys.length) {
        if (allowEmpty) return [];
        throw new Error(`${label}.cells不能为空`);
    }

    // Safe compatibility #1: a relay/model emitted one cell object instead of [cell].
    // No value or column is inferred; this only restores the missing array wrapper.
    if (keys.every(key => ['column', 'value'].includes(key)) && keys.includes('column') && keys.includes('value')) {
        return [value];
    }

    // Safe compatibility #2: a relay/model emitted the canonical column map
    // {"0":"x","2":7} instead of [{column:0,value:"x"},{column:2,value:7}].
    // Every key must itself be an exact non-negative integer column index. Values are
    // normalized with the same lossless scalar policy used for ordinary cell arrays.
    const mapped = [];
    for (const key of keys) {
        if (!/^(0|[1-9]\d*)$/.test(key)) throw new Error(`${label}.cells必须是数组`);
        const column = Number(key);
        if (!isIndex(column)) throw new Error(`${label}.cells列号必须是非负安全整数`);
        mapped.push({ column, value: normalizeCellValue(value[key], `${label}.cells[${key}]`) });
    }
    return mapped;
}

function normalizeCells(value, label, allowEmpty = false) {
    const cells = normalizeCellsContainer(value, label, allowEmpty);
    if (!allowEmpty && !cells.length) throw new Error(`${label}.cells不能为空`);
    const result = {};
    for (let index = 0; index < cells.length; index++) {
        const cell = cells[index];
        if (!cell || typeof cell !== 'object' || Array.isArray(cell)) throw new Error(`${label}.cells[${index}]必须是对象`);
        if (Object.keys(cell).some(key => !['column', 'value'].includes(key))) throw new Error(`${label}.cells[${index}]包含未知字段`);
        if (!isIndex(cell.column)) throw new Error(`${label}.cells[${index}].column必须是非负安全整数`);
        if (String(cell.column) in result) throw new Error(`${label}.cells重复列${cell.column}`);
        result[cell.column] = normalizeCellValue(cell.value, `${label}.cells[${index}].value`);
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
        const normalized = normalizeCellsContainer(change.cells, label, true);
        normalizeCells(normalized, label, true);
        if (normalized.length) throw new Error(`${label}删除操作cells必须为空数组`);
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

export function parseRelayTaggedEnvelope(raw, fallbackReply = '') {
    const text = String(raw ?? '');
    const start = text.indexOf(RELAY_TAG_START);
    if (start < 0) return { ok: false, error: '未找到中转站记录块', reply: String(fallbackReply || text).trim() };
    const end = text.indexOf(RELAY_TAG_END, start + RELAY_TAG_START.length);
    if (end < 0) {
        const reply = text.slice(0, start).trim() || String(fallbackReply || '').trim();
        return { ok: false, error: '中转站记录块尚未闭合', reply };
    }
    if (text.indexOf(RELAY_TAG_START, start + RELAY_TAG_START.length) >= 0) {
        const reply = text.slice(0, start).trim() || String(fallbackReply || '').trim();
        return { ok: false, error: '中转站记录块重复', reply };
    }
    const after = text.slice(end + RELAY_TAG_END.length).trim();
    const reply = text.slice(0, start).trim() || String(fallbackReply || '').trim();
    if (after) return { ok: false, error: '中转站记录块后存在额外内容', reply };
    const payload = text.slice(start + RELAY_TAG_START.length, end).trim();
    let changes;
    try {
        changes = JSON.parse(payload);
    } catch (error) {
        return { ok: false, error: `中转站记录块不是合法JSON数组：${error.message}`, reply };
    }
    return parseRecordEnvelope({ reply, changes });
}

export function changesToStrictCalls(changes) {
    if (!Array.isArray(changes) || !changes.length) return ['NO_CHANGE'];
    return changes.map(change => {
        if (change.op === 'insert') return `insertRow(${change.table},${JSON.stringify(change.data)})`;
        if (change.op === 'update') return `updateRow(${change.table},${change.row},${JSON.stringify(change.data)})`;
        return `deleteRow(${change.table},${change.row})`;
    });
}

export { OP_TYPES, RELAY_TAG_START, RELAY_TAG_END, escapeControlCharsInsideJsonStrings, normalizeCellValue };