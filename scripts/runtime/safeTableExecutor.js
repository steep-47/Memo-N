import { BASE, USER } from '../../core/manager.js';
import { Cell } from '../../core/table/cell.js';
import JSON5 from '../../utils/json5.min.mjs';

const STANDARD_NAMES = ['当前状态表','角色状态表','背包表','当前任务与约定表','人物主表','人物发展表','历史事件表'];
const ACTION_NAMES = new Set(['insertRow','updateRow','deleteRow']);
const IDENTITY_TABLES = new Set([2,4,5]);

function norm(value) {
    return String(value ?? '').trim();
}

function normIdentity(value) {
    return norm(value).replace(/\s+/g, ' ').toLocaleLowerCase();
}

function copyValue(value) {
    if (value === undefined) return undefined;
    try { return structuredClone(value); }
    catch (_) { return JSON.parse(JSON.stringify(value)); }
}

function copyHash(value) {
    if (!value || typeof value !== 'object') return null;
    try { return BASE.copyHashSheets(value); }
    catch (_) { return copyValue(value); }
}

function visiblePromptSheets() {
    return (BASE.getChatSheets?.() ?? [])
        .filter(sheet => sheet?.enable)
        .filter(sheet => sheet?.sendToContext !== false);
}

function tableNameForIndex(tableIndex) {
    const index = Number(tableIndex);
    if (!Number.isInteger(index) || index < 0) return null;
    if (index < STANDARD_NAMES.length) return STANDARD_NAMES[index];
    return norm(visiblePromptSheets()[index]?.name) || null;
}

function sheetForIndex(tableIndex) {
    const index = Number(tableIndex);
    if (!Number.isInteger(index) || index < 0) return null;
    if (index < STANDARD_NAMES.length) {
        const tableName = STANDARD_NAMES[index];
        return BASE.getChatSheets?.().find(sheet => sheet?.name === tableName) ?? null;
    }
    return visiblePromptSheets()[index] ?? null;
}

function strictIndex(value) {
    if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
    if (typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value)) {
        const parsed = Number(value);
        return Number.isSafeInteger(parsed) ? parsed : null;
    }
    return null;
}

function quoteNumericObjectKeys(text) {
    const source = String(text ?? '');
    let output = '';
    let quote = null;
    let escaped = false;
    for (let i = 0; i < source.length; i++) {
        const ch = source[i];
        if (quote) {
            output += ch;
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            quote = ch;
            output += ch;
            continue;
        }
        output += ch;
        if (ch !== '{' && ch !== ',') continue;
        let cursor = i + 1;
        while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
        const start = cursor;
        while (cursor < source.length && /\d/.test(source[cursor])) cursor++;
        if (cursor === start) continue;
        let colon = cursor;
        while (colon < source.length && /\s/.test(source[colon])) colon++;
        if (source[colon] !== ':') continue;
        output += source.slice(i + 1, start) + `"${source.slice(start, cursor)}"` + source.slice(cursor, colon);
        i = colon - 1;
    }
    return output;
}

function extractCalls(text) {
    const source = String(text ?? '');
    const calls = [];
    const spans = [];
    let i = 0;
    while (i < source.length) {
        const match = /(insertRow|updateRow|deleteRow)\s*\(/g;
        match.lastIndex = i;
        const found = match.exec(source);
        if (!found) break;
        const name = found[1];
        let cursor = match.lastIndex;
        let depth = 1;
        let quote = null;
        let escaped = false;
        for (; cursor < source.length; cursor++) {
            const ch = source[cursor];
            if (quote) {
                if (escaped) escaped = false;
                else if (ch === '\\') escaped = true;
                else if (ch === quote) quote = null;
                continue;
            }
            if (ch === '"' || ch === "'" || ch === '`') {
                quote = ch;
                continue;
            }
            if (ch === '(') depth++;
            else if (ch === ')') {
                depth--;
                if (depth === 0) break;
            }
        }
        if (depth !== 0) return { ok:false, error:`${name} 缺少右括号`, calls:[], residue:'' };
        const argsText = source.slice(match.lastIndex, cursor);
        let args;
        try {
            args = JSON5.parse(`[${quoteNumericObjectKeys(argsText)}]`);
        } catch (error) {
            return { ok:false, error:`${name} 参数无法解析：${error?.message || error}`, calls:[], residue:'' };
        }
        calls.push({ name, args });
        spans.push([found.index, cursor + 1]);
        i = cursor + 1;
    }
    let residue = source;
    for (let index = spans.length - 1; index >= 0; index--) {
        const [start, end] = spans[index];
        residue = `${residue.slice(0, start)}${residue.slice(end)}`;
    }
    return { ok:true, calls, residue };
}

function decodeXmlAttribute(value) {
    return String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_match, entity) => {
        const key = entity.toLowerCase();
        if (key === 'amp') return '&';
        if (key === 'lt') return '<';
        if (key === 'gt') return '>';
        if (key === 'quot') return '"';
        if (key === 'apos') return "'";
        const code = key.startsWith('#x') ? Number.parseInt(key.slice(2), 16) : Number.parseInt(key.slice(1), 10);
        if (!Number.isSafeInteger(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
            throw new Error(`无效XML字符实体 &${entity};`);
        }
        return String.fromCodePoint(code);
    });
}

function parseXmlAttributes(source, label) {
    const attrs = {};
    let cursor = 0;
    while (cursor < source.length) {
        while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
        if (cursor >= source.length) break;
        const match = /^[A-Za-z_][A-Za-z0-9_.:-]*/.exec(source.slice(cursor));
        if (!match) return { ok:false, error:`${label} 属性名无法解析` };
        const name = match[0];
        cursor += name.length;
        while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
        if (source[cursor] !== '=') return { ok:false, error:`${label} 属性${name}缺少=` };
        cursor++;
        while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
        const quote = source[cursor];
        if (quote !== '"' && quote !== "'") return { ok:false, error:`${label} 属性${name}必须使用引号` };
        cursor++;
        const start = cursor;
        while (cursor < source.length && source[cursor] !== quote) cursor++;
        if (cursor >= source.length) return { ok:false, error:`${label} 属性${name}缺少结束引号` };
        if (Object.prototype.hasOwnProperty.call(attrs, name)) return { ok:false, error:`${label} 属性${name}重复` };
        try { attrs[name] = decodeXmlAttribute(source.slice(start, cursor)); }
        catch (error) { return { ok:false, error:`${label} 属性${name}无法解析：${error?.message || error}` }; }
        cursor++;
    }
    return { ok:true, error:'', attrs };
}

function readXmlTag(source, start) {
    if (source[start] !== '<') return { ok:false, error:'XML标签缺少<' };
    let cursor = start + 1;
    let quote = null;
    for (; cursor < source.length; cursor++) {
        const ch = source[cursor];
        if (quote) {
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === '>') break;
    }
    if (cursor >= source.length) return { ok:false, error:'XML标签缺少>' };
    let body = source.slice(start + 1, cursor).trim();
    const closing = body.startsWith('/');
    if (closing) body = body.slice(1).trim();
    const selfClosing = !closing && body.endsWith('/');
    if (selfClosing) body = body.slice(0, -1).trim();
    const nameMatch = /^[A-Za-z_][A-Za-z0-9_.:-]*/.exec(body);
    if (!nameMatch) return { ok:false, error:'XML标签名无法解析' };
    const name = nameMatch[0];
    const parsed = parseXmlAttributes(body.slice(name.length), `<${closing ? '/' : ''}${name}>`);
    if (!parsed.ok) return parsed;
    return { ok:true, error:'', name, closing, selfClosing, attrs:parsed.attrs, start, end:cursor + 1 };
}

function skipXmlSeparators(source, start) {
    let cursor = start;
    while (cursor < source.length && /[\s;,]/.test(source[cursor])) cursor++;
    return cursor;
}

function extractXmlCalls(text) {
    const source = String(text ?? '');
    let cursor = skipXmlSeparators(source, 0);
    if (source[cursor] !== '<') return { recognized:false, ok:true, calls:[], residue:source };
    const first = readXmlTag(source, cursor);
    const actionMap = { insertrow:'insertRow', updaterow:'updateRow', deleterow:'deleteRow' };
    if (!first.ok || first.closing || !actionMap[first.name.toLowerCase()]) {
        return { recognized:false, ok:true, calls:[], residue:source };
    }

    const calls = [];
    while (cursor < source.length) {
        cursor = skipXmlSeparators(source, cursor);
        if (cursor >= source.length) break;
        const open = readXmlTag(source, cursor);
        if (!open.ok) return { recognized:true, ok:false, error:open.error, calls:[], residue:'' };
        const name = actionMap[open.name.toLowerCase()];
        if (!name || open.closing) return { recognized:true, ok:false, error:`不允许的XML操作标签 <${open.closing ? '/' : ''}${open.name}>`, calls:[], residue:'' };

        const allowedAttrs = name === 'insertRow'
            ? new Set(['tableIndex'])
            : new Set(['tableIndex','rowIndex','expected']);
        for (const key of Object.keys(open.attrs || {})) {
            if (!allowedAttrs.has(key)) return { recognized:true, ok:false, error:`<${open.name}> 包含不允许的属性：${key}`, calls:[], residue:'' };
        }
        if (!Object.prototype.hasOwnProperty.call(open.attrs, 'tableIndex')) {
            return { recognized:true, ok:false, error:`<${open.name}> 缺少属性：tableIndex`, calls:[], residue:'' };
        }
        if (name !== 'insertRow' && !Object.prototype.hasOwnProperty.call(open.attrs, 'rowIndex')) {
            return { recognized:true, ok:false, error:`<${open.name}> 缺少属性：rowIndex`, calls:[], residue:'' };
        }

        cursor = open.end;
        if (name === 'deleteRow') {
            if (!open.selfClosing) {
                cursor = skipXmlSeparators(source, cursor);
                const close = readXmlTag(source, cursor);
                if (!close.ok || !close.closing || close.name.toLowerCase() !== 'deleterow' || Object.keys(close.attrs || {}).length) {
                    return { recognized:true, ok:false, error:'<deleteRow> 只能为空标签', calls:[], residue:'' };
                }
                cursor = close.end;
            }
            calls.push({ name, args:[open.attrs.tableIndex, open.attrs.rowIndex, open.attrs.expected].filter(v => v !== undefined) });
            continue;
        }

        if (open.selfClosing) return { recognized:true, ok:false, error:`<${open.name}> 缺少<data>`, calls:[], residue:'' };
        const data = {};
        let closed = false;
        while (cursor < source.length) {
            cursor = skipXmlSeparators(source, cursor);
            const child = readXmlTag(source, cursor);
            if (!child.ok) return { recognized:true, ok:false, error:child.error, calls:[], residue:'' };
            if (child.closing && child.name.toLowerCase() === open.name.toLowerCase()) {
                if (Object.keys(child.attrs || {}).length) return { recognized:true, ok:false, error:`</${child.name}> 不允许携带属性`, calls:[], residue:'' };
                cursor = child.end;
                closed = true;
                break;
            }
            if (child.closing || child.name.toLowerCase() !== 'data') {
                return { recognized:true, ok:false, error:`<${open.name}> 内只允许<data>`, calls:[], residue:'' };
            }
            const keys = Object.keys(child.attrs || {});
            if (keys.some(key => !['columnIndex','value'].includes(key)) || !keys.includes('columnIndex') || !keys.includes('value')) {
                return { recognized:true, ok:false, error:'<data> 只允许并必须包含columnIndex、value', calls:[], residue:'' };
            }
            const column = child.attrs.columnIndex;
            if (Object.prototype.hasOwnProperty.call(data, column)) {
                return { recognized:true, ok:false, error:`<data> 重复更新第${column}列`, calls:[], residue:'' };
            }
            data[column] = child.attrs.value;
            cursor = child.end;
            if (!child.selfClosing) {
                cursor = skipXmlSeparators(source, cursor);
                const dataClose = readXmlTag(source, cursor);
                if (!dataClose.ok || !dataClose.closing || dataClose.name.toLowerCase() !== 'data' || Object.keys(dataClose.attrs || {}).length) {
                    return { recognized:true, ok:false, error:'<data> 必须自闭合或使用空的</data>', calls:[], residue:'' };
                }
                cursor = dataClose.end;
            }
        }
        if (!closed) return { recognized:true, ok:false, error:`<${open.name}> 缺少结束标签`, calls:[], residue:'' };
        const expected = open.attrs.expected;
        calls.push({
            name,
            args: name === 'insertRow'
                ? [open.attrs.tableIndex, data]
                : [open.attrs.tableIndex, open.attrs.rowIndex, data, expected].filter(v => v !== undefined),
        });
    }
    return { recognized:true, ok:true, calls, residue:'' };
}

function normalizeBlocks(raw) {
    const list = Array.isArray(raw) ? raw : [raw];
    return list
        .map(value => String(value ?? '')
            .replace(/^\s*<tableEdit\b[^>]*>\s*/i, '')
            .replace(/\s*<\/tableEdit>\s*$/i, '')
            .replace(/^\s*<!--\s*/, '')
            .replace(/\s*-->\s*$/, '')
            .trim())
        .filter(Boolean);
}

function validateData(data, headers, label) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok:false, error:`${label} data必须是对象` };
    const keys = Object.keys(data);
    if (!keys.length) return { ok:false, error:`${label} data不能为空对象` };

    const normalizedHeaders = (headers || []).map(norm);
    const mapped = {};
    for (const key of keys) {
        let col = strictIndex(key);
        if (col === null) {
            const wanted = norm(key);
            const matches = [];
            normalizedHeaders.forEach((header, index) => {
                if (header === wanted) matches.push(index);
            });
            if (matches.length !== 1) return { ok:false, error:`${label} 列${key}${matches.length ? '存在重复表头，无法唯一对应' : '无效或不存在'}` };
            col = matches[0];
        }
        if (col >= normalizedHeaders.length) return { ok:false, error:`${label} 列${key}无效或越界` };
        const numericKey = String(col);
        if (Object.prototype.hasOwnProperty.call(mapped, numericKey)) return { ok:false, error:`${label} 列${key}与另一键重复指向第${col}列` };
        const value = data[key];
        if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) {
            return { ok:false, error:`${label} 列${key}的值必须是字符串或有限数字` };
        }
        mapped[numericKey] = value;
    }
    return { ok:true, error:'', data:mapped };
}

function rowIdentity(sheet, rowIndex) {
    const cell = sheet?.findCellByPosition?.(rowIndex + 1, 1);
    return norm(cell?.data?.value);
}

function validateIdentity(action, expected) {
    if (!IDENTITY_TABLES.has(action.tableIndex)) return { ok:true, error:'' };
    const wanted = norm(expected);
    if (!wanted) {
        return {
            ok:false,
            error:`#${action.tableIndex} ${tableNameForIndex(action.tableIndex)} row=${action.rowIndex} 缺少对象核对名；表2/4/5的update/delete必须携带当前行第一列原值`,
        };
    }
    const actual = rowIdentity(action.sheet, action.rowIndex);
    if (!actual) {
        return {
            ok:false,
            error:`#${action.tableIndex} ${tableNameForIndex(action.tableIndex)} row=${action.rowIndex} 当前行对象名为空，拒绝${action.type}`,
        };
    }
    if (normIdentity(actual) !== normIdentity(wanted)) {
        return {
            ok:false,
            error:`#${action.tableIndex} ${tableNameForIndex(action.tableIndex)} row=${action.rowIndex} 对象不匹配：期望“${wanted}”，实际“${actual}”`,
        };
    }
    action.expected = actual;
    return { ok:true, error:'' };
}

function findDuplicateIdentity(sheet, wanted) {
    const normalized = normIdentity(wanted);
    if (!normalized) return null;
    const rowCount = Math.max(0, Number(sheet?.getRowCount?.()) - 1 || 0);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
        const actual = rowIdentity(sheet, rowIndex);
        if (actual && normIdentity(actual) === normalized) return { rowIndex, actual };
    }
    return null;
}

function validateAction(call) {
    if (!ACTION_NAMES.has(call?.name)) return { ok:false, error:'未知操作' };
    const args = call.args || [];
    const tableIndex = strictIndex(args[0]);
    if (tableIndex === null) return { ok:false, error:`${call.name} tableIndex必须是非负安全整数` };

    const sheet = sheetForIndex(tableIndex);
    if (!sheet) return { ok:false, error:`#${tableIndex} ${tableNameForIndex(tableIndex) || '未知/不可见表'} 不存在` };

    const headers = sheet.getHeader?.() || [];
    const rowCount = Math.max(0, Number(sheet.getRowCount?.()) - 1 || 0);

    if (call.name === 'insertRow') {
        if (args.length !== 2) return { ok:false, error:`insertRow参数数量必须为2，实际为${args.length}` };
        const checked = validateData(args[1], headers, `insertRow(${tableIndex})`);
        if (!checked.ok) return checked;
        const action = { type:'insert', tableIndex, sheet, data:checked.data };
        if (IDENTITY_TABLES.has(tableIndex)) {
            const identity = norm(checked.data['0']);
            if (!identity) return { ok:false, error:`insertRow(${tableIndex}) 必须写入第一列对象名，才能执行重复保护` };
            const duplicate = findDuplicateIdentity(sheet, identity);
            if (duplicate) {
                return {
                    ok:false,
                    error:`#${tableIndex} ${tableNameForIndex(tableIndex)} 已存在同名对象“${duplicate.actual}”于row=${duplicate.rowIndex}，禁止重复insert；请update现有行`,
                };
            }
            action.identity = identity;
        }
        return { ok:true, action };
    }

    if (call.name === 'deleteRow') {
        if (args.length !== 2 && args.length !== 3) {
            return { ok:false, error:`deleteRow参数数量必须为2或3，实际为${args.length}` };
        }
        const rowIndex = strictIndex(args[1]);
        if (rowIndex === null) return { ok:false, error:`deleteRow(${tableIndex}) rowIndex=${args[1]}不是非负安全整数` };
        if (rowIndex >= rowCount) {
            if (rowCount === 0) return { ok:true, action:null };
            return { ok:false, error:`deleteRow(${tableIndex}) rowIndex=${rowIndex}无效或越界；当前数据行数=${rowCount}` };
        }
        const action = { type:'delete', tableIndex, sheet, rowIndex };
        const identity = validateIdentity(action, args[2]);
        if (!identity.ok) return identity;
        return { ok:true, action };
    }

    const shorthand = args.length === 2;
    if (shorthand) {
        if (IDENTITY_TABLES.has(tableIndex)) {
            return { ok:false, error:`updateRow(${tableIndex}) 表2/4/5禁止省略rowIndex和对象核对名` };
        }
        if (rowCount !== 1) {
            return { ok:false, error:`updateRow(${tableIndex}) 省略rowIndex仅适用于恰好一条数据的表；当前数据行数=${rowCount}` };
        }
        const checked = validateData(args[1], headers, `updateRow(${tableIndex},0)`);
        if (!checked.ok) return checked;
        return { ok:true, action:{ type:'update', tableIndex, sheet, rowIndex:0, data:checked.data } };
    }

    if (args.length !== 3 && args.length !== 4) {
        return { ok:false, error:`updateRow参数数量必须为3或4，实际为${args.length}` };
    }
    const rowIndex = strictIndex(args[1]);
    if (rowIndex === null) return { ok:false, error:`updateRow(${tableIndex}) rowIndex=${args[1]}不是非负安全整数` };
    if (rowIndex >= rowCount) return { ok:false, error:`updateRow(${tableIndex}) rowIndex=${rowIndex}无效或越界；当前数据行数=${rowCount}` };
    const checked = validateData(args[2], headers, `updateRow(${tableIndex},${rowIndex})`);
    if (!checked.ok) return checked;

    const action = { type:'update', tableIndex, sheet, rowIndex, data:checked.data };
    const identity = validateIdentity(action, args[3]);
    if (!identity.ok) return identity;
    return { ok:true, action };
}

function validateBatch(actions) {
    const deleted = new Set();
    const updated = new Set();
    const updatedColumns = new Map();
    const insertedIdentities = new Set();

    for (const action of actions) {
        if (action.type === 'insert' && IDENTITY_TABLES.has(action.tableIndex)) {
            const key = `${action.tableIndex}:${normIdentity(action.identity)}`;
            if (insertedIdentities.has(key)) {
                return { ok:false, error:`同一批操作重复插入 #${action.tableIndex} 对象“${action.identity}”` };
            }
            insertedIdentities.add(key);
            continue;
        }
        if (action.type !== 'delete' && action.type !== 'update') continue;
        const key = `${action.tableIndex}:${action.rowIndex}`;
        if (action.type === 'delete') {
            if (deleted.has(key)) return { ok:false, error:`同一批操作重复删除 #${action.tableIndex} row=${action.rowIndex}` };
            deleted.add(key);
            continue;
        }
        updated.add(key);
        let columns = updatedColumns.get(key);
        if (!columns) {
            columns = new Set();
            updatedColumns.set(key, columns);
        }
        for (const column of Object.keys(action.data)) {
            if (columns.has(column)) return { ok:false, error:`同一批操作重复更新 #${action.tableIndex} row=${action.rowIndex} col=${column}` };
            columns.add(column);
        }
    }

    for (const key of deleted) {
        if (updated.has(key)) {
            const [tableIndex, rowIndex] = key.split(':');
            return { ok:false, error:`同一批操作不能同时更新并删除 #${tableIndex} row=${rowIndex}` };
        }
    }
    return { ok:true, error:'' };
}

function ordered(actions) {
    const priority = { update:0, insert:1, delete:2 };
    return [...actions].sort((a, b) => {
        if (a.type === 'delete' && b.type === 'delete' && a.tableIndex === b.tableIndex) {
            return b.rowIndex - a.rowIndex;
        }
        return priority[a.type] - priority[b.type];
    });
}

function applyAction(action) {
    const sheet = action.sheet;
    if (action.type === 'update') {
        for (const [key, value] of Object.entries(action.data)) {
            const cell = sheet.findCellByPosition(action.rowIndex + 1, Number(key) + 1);
            if (!cell) throw new Error(`updateRow #${action.tableIndex} 找不到单元格 row=${action.rowIndex} col=${key}`);
            cell.newAction(Cell.CellAction.editCell, { value }, false);
        }
        return;
    }
    if (action.type === 'insert') {
        const anchor = sheet.findCellByPosition(sheet.getRowCount() - 1, 0);
        if (!anchor) throw new Error(`insertRow #${action.tableIndex} 找不到插入锚点`);
        anchor.newAction(Cell.CellAction.insertDownRow, {}, false);
        const row = sheet.getCellsByRowIndex(sheet.getRowCount() - 1);
        if (!row) throw new Error(`insertRow #${action.tableIndex} 插入后无法读取新行`);
        for (const [key, value] of Object.entries(action.data)) {
            const cell = row[Number(key) + 1];
            if (!cell) throw new Error(`insertRow #${action.tableIndex} 找不到列${key}`);
            cell.data.value = value;
        }
        return;
    }
    const cell = sheet.findCellByPosition(action.rowIndex + 1, 0);
    if (!cell) throw new Error(`deleteRow #${action.tableIndex} 找不到row=${action.rowIndex}`);
    cell.newAction(Cell.CellAction.deleteSelfRow, {}, false);
}

function ensureExtra(target) {
    if (!target.extra || typeof target.extra !== 'object') target.extra = {};
    return target.extra;
}

function storeSwipeSnapshot(piece) {
    if (!piece?.memo_n_hash_sheets) return;
    const snapshot = copyHash(piece.memo_n_hash_sheets);
    ensureExtra(piece).memo_n_swipe_hash_sheets = snapshot;
    const id = Number(piece?.swipe_id);
    if (!Number.isInteger(id) || id < 0) return;
    if (!Array.isArray(piece.swipe_info)) piece.swipe_info = [];
    if (!piece.swipe_info[id] || typeof piece.swipe_info[id] !== 'object') piece.swipe_info[id] = {};
    if (!piece.swipe_info[id].extra || typeof piece.swipe_info[id].extra !== 'object') piece.swipe_info[id].extra = {};
    piece.swipe_info[id].extra.memo_n_swipe_hash_sheets = copyHash(snapshot);
    delete piece.swipe_info[id].memo_n_swipe_hash_sheets;
}

export function saveMemoSnapshot(piece, sheets = BASE.getChatSheets?.() ?? []) {
    if (!piece) throw new Error('无法获取当前聊天片段，未保存');
    for (const sheet of sheets) {
        if (!sheet || typeof sheet.save !== 'function') continue;
        const saved = sheet.save(piece, true);
        if (saved === false) throw new Error(`保存表格 ${sheet.name || sheet.uid || '未知表'} 失败`);
    }
    storeSwipeSnapshot(piece);
    return true;
}

function snapshotSheets(sheets) {
    const snapshots = new Map();
    for (const sheet of sheets) {
        try {
            const data = sheet?.filterSavingData?.();
            if (!data || typeof data !== 'object') throw new Error('表格不支持完整序列化');
            snapshots.set(sheet, copyValue(data));
        } catch (error) {
            console.error('[Memo][safe-executor] 无法建立完整表格回滚快照', sheet?.name, error);
            throw error;
        }
    }
    return snapshots;
}

function rollbackSnapshots(snapshots) {
    const failures = [];
    for (const [sheet, data] of snapshots.entries()) {
        try { sheet.loadJson(copyValue(data)); }
        catch (error) {
            failures.push(`${sheet?.name || '未知表'}: ${error?.message || error}`);
            console.error('[Memo][safe-executor] 完整回滚表格失败', sheet?.name, error);
        }
    }
    return failures;
}

export function restoreMemoSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return { ok:false, error:'表格快照为空或格式无效' };
    let liveSnapshots;
    try {
        liveSnapshots = snapshotSheets(new Set(BASE.getChatSheets?.() ?? []));
        const restored = BASE.hashSheetsToSheets(copyHash(snapshot));
        if (!Array.isArray(restored) || restored.length === 0) throw new Error('快照恢复未返回任何表格');
        return { ok:true, error:'' };
    } catch (error) {
        const rollbackFailures = liveSnapshots ? rollbackSnapshots(liveSnapshots) : [];
        const suffix = rollbackFailures.length ? `；回滚异常：${rollbackFailures.join('；')}` : '';
        return { ok:false, error:`${error?.message || error}${suffix}` };
    }
}

function snapshotPieceState(piece) {
    const id = Number(piece?.swipe_id);
    const info = Array.isArray(piece?.swipe_info) && Number.isInteger(id) && id >= 0 ? piece.swipe_info[id] : undefined;
    return {
        hadHash:Object.prototype.hasOwnProperty.call(piece ?? {}, 'memo_n_hash_sheets'),
        hash:copyHash(piece?.memo_n_hash_sheets),
        extra:copyValue(piece?.extra),
        swipeId:id,
        hadSwipeInfo:Array.isArray(piece?.swipe_info) && Number.isInteger(id) && id >= 0 && id < piece.swipe_info.length,
        swipeInfo:copyValue(info),
        contextSheets:copyValue(BASE.sheetsData?.context),
    };
}

function restorePieceState(piece, state) {
    if (!piece || !state) return;
    if (state.hadHash) piece.memo_n_hash_sheets = copyHash(state.hash);
    else delete piece.memo_n_hash_sheets;
    piece.extra = copyValue(state.extra) ?? {};
    if (BASE.sheetsData) BASE.sheetsData.context = copyValue(state.contextSheets) ?? [];
    const id = state.swipeId;
    if (Number.isInteger(id) && id >= 0) {
        if (!Array.isArray(piece.swipe_info)) piece.swipe_info = [];
        if (state.hadSwipeInfo) piece.swipe_info[id] = copyValue(state.swipeInfo);
        else if (id < piece.swipe_info.length) piece.swipe_info[id] = undefined;
    }
}

export function parseMemoTableEdit(raw) {
    const blocks = normalizeBlocks(raw);
    if (!blocks.length) return { ok:false, noChange:false, actions:[], error:'没有tableEdit内容' };
    const joined = blocks.join('\n');
    const noChange = /\bNO_CHANGE\b/i.test(joined);
    const xml = extractXmlCalls(joined);
    const parsed = xml.recognized ? xml : extractCalls(joined);
    if (!parsed.ok) return { ok:false, noChange:false, actions:[], error:parsed.error };
    if (noChange && parsed.calls.length) return { ok:false, noChange:false, actions:[], error:'NO_CHANGE不能与实际表格操作同时出现' };
    if (noChange) {
        const residue = joined.replace(/\bNO_CHANGE\b/ig, '').replace(/[\s;,]+/g, '');
        if (residue) return { ok:false, noChange:false, actions:[], error:`NO_CHANGE之外存在无法识别的内容：${residue.slice(0,80)}` };
        return { ok:true, noChange:true, actions:[], error:'' };
    }
    const residue = String(parsed.residue ?? '').replace(/[\s;,]+/g, '');
    if (residue) return { ok:false, noChange:false, actions:[], error:`存在无法识别或不允许的tableEdit内容：${residue.slice(0,80)}` };
    if (!parsed.calls.length) return { ok:false, noChange:false, actions:[], error:'没有可执行的insertRow/updateRow/deleteRow，也不是NO_CHANGE' };

    const actions = [];
    for (const call of parsed.calls) {
        const checked = validateAction(call);
        if (!checked.ok) return { ok:false, noChange:false, actions:[], error:checked.error };
        if (checked.action) actions.push(checked.action);
    }
    const batch = validateBatch(actions);
    if (!batch.ok) return { ok:false, noChange:false, actions:[], error:batch.error };
    return { ok:true, noChange:actions.length === 0, actions:ordered(actions), error:'' };
}

export function executeMemoTableEdit(raw, piece = null) {
    const parsed = parseMemoTableEdit(raw);
    if (!parsed.ok) return { ok:false, changed:false, noChange:false, count:0, error:parsed.error };
    const targetPiece = piece || USER.getChatPiece?.()?.piece;
    if (!targetPiece) return { ok:false, changed:false, noChange:false, count:0, error:'无法获取当前聊天片段，未保存' };

    const pieceState = snapshotPieceState(targetPiece);
    if (parsed.noChange) {
        try {
            saveMemoSnapshot(targetPiece);
            return { ok:true, changed:false, noChange:true, count:0, error:'' };
        } catch (error) {
            restorePieceState(targetPiece, pieceState);
            return { ok:false, changed:false, noChange:false, count:0, error:`保存NO_CHANGE快照失败：${error?.message || error}` };
        }
    }

    const touched = new Set(parsed.actions.map(action => action.sheet));
    let snapshots;
    try {
        snapshots = snapshotSheets(touched);
    } catch (error) {
        return { ok:false, changed:false, noChange:false, count:0, error:`建立事务快照失败：${error?.message || error}` };
    }

    try {
        for (const action of parsed.actions) applyAction(action);
        saveMemoSnapshot(targetPiece);
        return { ok:true, changed:true, noChange:false, count:parsed.actions.length, error:'' };
    } catch (error) {
        const rollbackFailures = rollbackSnapshots(snapshots);
        restorePieceState(targetPiece, pieceState);
        const suffix = rollbackFailures.length ? `；回滚异常：${rollbackFailures.join('；')}` : '';
        return { ok:false, changed:false, noChange:false, count:0, error:`${error?.message || String(error)}${suffix}` };
    }
}

export { STANDARD_NAMES };
