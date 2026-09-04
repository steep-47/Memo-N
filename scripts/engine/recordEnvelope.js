const OP_TYPES = new Set(['insert', 'update', 'delete']);
// Root-level HTML comments can be removed by the mobile render pipeline before
// GENERATION_ENDED. Plain sentinels survive in chat.mes and are stripped here.
const RELAY_TAG_START = 'MEMO_N_CHANGES_V1';
const RELAY_TAG_END = 'MEMO_N_CHANGES_END';

function isIndex(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

function normalizeCellValue(value, label) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value === null) return '';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
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
    if (keys.every(key => ['column', 'value'].includes(key)) && keys.includes('column') && keys.includes('value')) return [value];
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
        if (escaped) { result += char; escaped = false; continue; }
        if (char === '\\') { result += char; escaped = true; continue; }
        if (char === '"') { result += char; inString = false; continue; }
        const code = char.charCodeAt(0);
        if (code < 0x20) {
            const shortEscape = { 8: '\\b', 9: '\\t', 10: '\\n', 12: '\\f', 13: '\\r' }[code];
            result += shortEscape || `\\u${code.toString(16).padStart(4, '0')}`;
        } else result += char;
    }
    return result;
}

function findJsonKey(text, key) {
    const needle = `"${key}"`;
    const hits = [];
    let from = 0;
    while (true) {
        const at = text.indexOf(needle, from);
        if (at < 0) break;
        let cursor = at + needle.length;
        while (cursor < text.length && /\s/.test(text[cursor])) cursor++;
        if (text[cursor] === ':') hits.push({ keyStart: at, valueStart: cursor + 1 });
        from = at + needle.length;
    }
    return hits;
}

function scanBalanced(text, start, open, close) {
    if (text[start] !== open) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === open) depth++;
        else if (ch === close) {
            depth--;
            if (depth === 0) return { start, end: i + 1, raw: text.slice(start, i + 1) };
            if (depth < 0) return null;
        }
    }
    return null;
}

function scanJsonString(text, start) {
    if (text[start] !== '"') return null;
    let escaped = false;
    for (let i = start + 1; i < text.length; i++) {
        const ch = text[i];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') return { start, end: i + 1, raw: text.slice(start, i + 1) };
        if (ch.charCodeAt(0) < 0x20) return null;
    }
    return null;
}

function recoverCompleteEnvelopeFields(input) {
    const text = String(input ?? '').trim();
    const changeHits = findJsonKey(text, 'changes');
    const replyHits = findJsonKey(text, 'reply');
    if (changeHits.length !== 1 || replyHits.length !== 1) return null;

    let c = changeHits[0].valueStart;
    while (c < text.length && /\s/.test(text[c])) c++;
    const changeToken = scanBalanced(text, c, '[', ']');
    if (!changeToken) return null;

    let r = replyHits[0].valueStart;
    while (r < text.length && /\s/.test(text[r])) r++;
    const replyToken = scanJsonString(text, r);
    if (!replyToken) return null;

    let changes;
    let reply;
    try {
        changes = JSON.parse(escapeControlCharsInsideJsonStrings(changeToken.raw));
        reply = JSON.parse(replyToken.raw);
    } catch (_) { return null; }
    if (!Array.isArray(changes) || typeof reply !== 'string' || !reply.trim()) return null;

    const spans = [[changeHits[0].keyStart, changeToken.end], [replyHits[0].keyStart, replyToken.end]].sort((a, b) => b[0] - a[0]);
    let residue = text;
    for (const [start, end] of spans) residue = `${residue.slice(0, start)}${residue.slice(end)}`;
    residue = residue.replace(/[\s{},:]+/g, '');
    if (residue) return null;

    return { changes, reply };
}

function isEnvelopeShape(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const keys = Object.keys(value);
    return keys.length === 2 && keys.includes('reply') && keys.includes('changes')
        && typeof value.reply === 'string' && Array.isArray(value.changes);
}

function extractWrappedEnvelope(input) {
    const text = String(input ?? '');
    const matches = [];
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch !== '{') continue;
        const token = scanBalanced(text, i, '{', '}');
        if (!token) continue;
        let candidate;
        try { candidate = JSON.parse(escapeControlCharsInsideJsonStrings(token.raw)); }
        catch (_) { i = token.end - 1; continue; }
        if (isEnvelopeShape(candidate)) matches.push(candidate);
        i = token.end - 1;
    }
    return matches.length === 1 ? matches[0] : null;
}

export function parseRecordEnvelope(raw) {
    let value = raw;
    let recovered = false;
    if (typeof value === 'string') {
        const text = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
        try {
            value = JSON.parse(text);
        } catch (error) {
            const normalized = escapeControlCharsInsideJsonStrings(text);
            try {
                value = JSON.parse(normalized);
            } catch (_) {
                const wrapped = extractWrappedEnvelope(normalized);
                if (wrapped) {
                    value = wrapped;
                    recovered = true;
                } else {
                    const rescue = recoverCompleteEnvelopeFields(normalized);
                    if (!rescue) return { ok: false, error: `响应不是合法JSON：${error.message}` };
                    value = { changes: rescue.changes, reply: rescue.reply };
                    recovered = true;
                }
            }
        }
    }
    try {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('响应根节点必须是对象');
        const allowed = new Set(['reply', 'changes']);
        for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`响应包含未知字段${key}`);
        if (typeof value.reply !== 'string' || !value.reply.trim()) throw new Error('reply必须是非空字符串');
        if (!Array.isArray(value.changes)) throw new Error('changes必须是数组');
        const changes = value.changes.map(normalizeChange);
        return { ok: true, reply: value.reply.trim(), changes, noChange: changes.length === 0, error: '', recovered };
    } catch (error) {
        const reply = value && typeof value === 'object' && !Array.isArray(value) && typeof value.reply === 'string' && value.reply.trim() ? value.reply.trim() : '';
        return { ok: false, error: error?.message || String(error), reply };
    }
}

/**
 * Parse the one-call relay format used by thinking models:
 * visible reply first, then one hidden JSON array containing only table changes.
 * A fallback reply is supplied when the machine block was routed to reasoning.
 */
export function parseRelayTaggedEnvelope(raw, fallbackReply = '') {
    const text = String(raw ?? '');
    const fallback = String(fallbackReply ?? '').trim();
    const start = text.indexOf(RELAY_TAG_START);
    if (start < 0) {
        return { ok: false, error: '未找到Memo-N记录块', reply: fallback || text.trim() };
    }

    const wrappedStart = text.slice(Math.max(0, start - 4), start) === '<!--' ? start - 4 : start;
    const secondStart = text.indexOf(RELAY_TAG_START, start + RELAY_TAG_START.length);
    if (secondStart >= 0) {
        const reply = fallback || text.slice(0, wrappedStart).trim();
        return { ok: false, error: 'Memo-N记录块重复', reply };
    }

    const end = text.indexOf(RELAY_TAG_END, start + RELAY_TAG_START.length);
    if (end < 0) {
        const reply = fallback || text.slice(0, wrappedStart).trim();
        return { ok: false, error: 'Memo-N记录块尚未闭合', reply };
    }

    const markerEnd = end + RELAY_TAG_END.length;
    const wrappedEnd = text.slice(markerEnd, markerEnd + 3) === '-->' ? markerEnd + 3 : markerEnd;
    const visible = [text.slice(0, wrappedStart).trim(), text.slice(wrappedEnd).trim()].filter(Boolean).join('\n\n').trim();
    const reply = fallback || visible;

    const payload = text.slice(start + RELAY_TAG_START.length, end).trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '');
    let changes;
    try {
        changes = JSON.parse(escapeControlCharsInsideJsonStrings(payload));
    } catch (error) {
        return { ok: false, error: `Memo-N记录块不是合法JSON数组：${error.message}`, reply };
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

export { OP_TYPES, RELAY_TAG_START, RELAY_TAG_END, escapeControlCharsInsideJsonStrings, normalizeCellValue, recoverCompleteEnvelopeFields, extractWrappedEnvelope };
