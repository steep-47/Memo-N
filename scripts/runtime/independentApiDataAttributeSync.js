import { EDITOR } from '../../core/manager.js';
import LLMApiService from '../../services/llmApi.js';
import JSON5 from '../../utils/json5.min.mjs';

const PATCH_MARK = '__memoNIndependentApiDataAttributeSyncV1';
const TABLE_EDIT_RE = /<tableEdit\b[^>]*>[\s\S]*?<\/tableEdit>/ig;
const ROW_TAG_RE = /<(insertRow|updateRow|deleteRow)(?=\s*tableIndex\s*=)([^<>]*?)(?:\/\s*>|>\s*<\/\1\s*>)/gi;
const IDENTITY_TABLES = new Set([2, 4, 5]);

function requestText(value) {
    if (Array.isArray(value)) return value.map(item => requestText(item)).join('\n');
    if (!value || typeof value !== 'object') return String(value ?? '');
    if (typeof value.content === 'string') return value.content;
    return [value.systemPrompt, value.prompt, value.system_prompt, value.ordered_prompts, value.messages]
        .map(item => requestText(item))
        .filter(Boolean)
        .join('\n');
}

function isMemoIndependentRecordRequest(value) {
    const text = requestText(value);
    if (!/<tableEdit\b/i.test(text)) return false;
    return text.includes('# Memo独立记录操作协议')
        || text.includes('Memo独立表格记录器')
        || text.includes('[Memo七表独立记录')
        || text.includes('Memo世界状态表格整理器');
}

function decodeXml(value) {
    return String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_match, entity) => {
        const key = entity.toLowerCase();
        if (key === 'amp') return '&';
        if (key === 'lt') return '<';
        if (key === 'gt') return '>';
        if (key === 'quot') return '"';
        if (key === 'apos') return "'";
        const code = key.startsWith('#x') ? Number.parseInt(key.slice(2), 16) : Number.parseInt(key.slice(1), 10);
        if (!Number.isSafeInteger(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return _match;
        return String.fromCodePoint(code);
    });
}

function strictDecimal(value) {
    const text = String(value ?? '').trim();
    if (!/^(?:0|[1-9]\d*)$/.test(text)) return null;
    const parsed = Number(text);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

function readQuoted(source, start) {
    let cursor = start;
    while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
    const quote = source[cursor];
    if (quote !== '"' && quote !== "'") return null;
    cursor++;
    let output = '';
    let escaped = false;
    for (; cursor < source.length; cursor++) {
        const ch = source[cursor];
        if (escaped) {
            output += ch;
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            output += ch;
            escaped = true;
            continue;
        }
        if (ch === quote) return { value: decodeXml(output), end: cursor + 1 };
        output += ch;
    }
    return null;
}

function parseAttributeSequence(source) {
    const attrs = {};
    let anonymousExpected;
    let cursor = 0;
    while (cursor < source.length) {
        while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
        if (cursor >= source.length) break;

        if ((source[cursor] === '"' || source[cursor] === "'") && anonymousExpected === undefined) {
            const token = readQuoted(source, cursor);
            if (!token || !String(token.value).trim()) return null;
            anonymousExpected = token.value;
            cursor = token.end;
            while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
            if (cursor !== source.length) return null;
            break;
        }

        const nameMatch = /^[A-Za-z_][A-Za-z0-9_.:-]*/.exec(source.slice(cursor));
        if (!nameMatch) return null;
        const name = nameMatch[0];
        if (!['tableIndex', 'rowIndex', 'data', 'expected'].includes(name)) return null;
        if (Object.prototype.hasOwnProperty.call(attrs, name)) return null;
        cursor += name.length;
        while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
        if (source[cursor] !== '=') return null;
        const token = readQuoted(source, cursor + 1);
        if (!token) return null;
        attrs[name] = token.value;
        cursor = token.end;
    }
    if (attrs.expected !== undefined && anonymousExpected !== undefined) return null;
    return { attrs, expected: attrs.expected ?? anonymousExpected };
}

function parseDataObject(value) {
    let parsed;
    try { parsed = JSON5.parse(String(value ?? '').trim()); }
    catch (_) { return null; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed);
    if (!entries.length) return null;
    const normalized = {};
    for (const [key, cellValue] of entries) {
        const column = strictDecimal(key);
        if (column === null) return null;
        if (typeof cellValue !== 'string' && (typeof cellValue !== 'number' || !Number.isFinite(cellValue))) return null;
        normalized[column] = cellValue;
    }
    return normalized;
}

function canonicalizeRowTag(name, attrsSource) {
    const parsed = parseAttributeSequence(attrsSource);
    if (!parsed) return null;
    const { attrs, expected } = parsed;
    const tableIndex = strictDecimal(attrs.tableIndex);
    if (tableIndex === null) return null;

    if (name === 'insertRow') {
        if (attrs.rowIndex !== undefined || expected !== undefined || attrs.data === undefined) return null;
        const data = parseDataObject(attrs.data);
        if (!data) return null;
        return `insertRow(${tableIndex},${JSON.stringify(data)})`;
    }

    const rowIndex = strictDecimal(attrs.rowIndex);
    if (rowIndex === null) return null;
    if (IDENTITY_TABLES.has(tableIndex) && (expected === undefined || !String(expected).trim())) return null;

    if (name === 'deleteRow') {
        if (attrs.data !== undefined) return null;
        return expected === undefined
            ? `deleteRow(${tableIndex},${rowIndex})`
            : `deleteRow(${tableIndex},${rowIndex},${JSON.stringify(String(expected))})`;
    }

    if (attrs.data === undefined) return null;
    const data = parseDataObject(attrs.data);
    if (!data) return null;
    return expected === undefined
        ? `updateRow(${tableIndex},${rowIndex},${JSON.stringify(data)})`
        : `updateRow(${tableIndex},${rowIndex},${JSON.stringify(data)},${JSON.stringify(String(expected))})`;
}

function normalizeRowDataAttributes(block) {
    let changed = false;
    const text = String(block ?? '').replace(ROW_TAG_RE, (match, name, attrsSource) => {
        const normalized = canonicalizeRowTag(name, attrsSource);
        if (!normalized) return match;
        changed = true;
        return normalized;
    });
    return { text, changed };
}

function normalizeIndependentApiDataAttributeResponse(raw, channel = 'unknown') {
    if (typeof raw !== 'string' || !raw.trim()) return raw;
    const matches = [...raw.matchAll(TABLE_EDIT_RE)];
    if (matches.length !== 1) return raw;
    const match = matches[0];
    const normalized = normalizeRowDataAttributes(match[0]);
    if (!normalized.changed) return raw;
    console.log(`[Memo-N][independent-api-data-attr] ${channel} 已把row标签data属性规范化为标准函数调用，继续交给严格执行器复核`);
    return `${raw.slice(0, match.index)}${normalized.text}${raw.slice(match.index + match[0].length)}`;
}

function installMethodGuard(target, key, requestInspector, channel) {
    if (!target || typeof target[key] !== 'function') return false;
    const current = target[key];
    if (current[PATCH_MARK]) return true;
    const wrapped = async function (...args) {
        let guarded = false;
        try { guarded = isMemoIndependentRecordRequest(requestInspector.call(this, args)); }
        catch (error) { console.warn(`[Memo-N][independent-api-data-attr] ${channel} 请求识别失败，保持原行为`, error); }
        const result = await current.apply(this, args);
        return guarded ? normalizeIndependentApiDataAttributeResponse(result, channel) : result;
    };
    Object.defineProperty(wrapped, PATCH_MARK, { value: true });
    try {
        target[key] = wrapped;
        return target[key] === wrapped || target[key]?.[PATCH_MARK] === true;
    } catch (error) {
        console.warn(`[Memo-N][independent-api-data-attr] ${channel} 无法安装同步守卫`, error);
        return false;
    }
}

function patchEditor() {
    return installMethodGuard(EDITOR, 'generateRaw', args => args?.[0], 'EDITOR.generateRaw');
}

function patchTavernHelper() {
    return installMethodGuard(globalThis.TavernHelper, 'generateRaw', args => args?.[0], 'TavernHelper.generateRaw');
}

function patchCustomApi() {
    return installMethodGuard(
        LLMApiService?.prototype,
        'callLLM',
        function (args) { return [this?.config?.system_prompt ?? '', args?.[0]]; },
        'LLMApiService.callLLM',
    );
}

function install() {
    const editor = patchEditor();
    const custom = patchCustomApi();
    const tavern = patchTavernHelper();
    if (!tavern) {
        let tries = 0;
        const retry = setInterval(() => {
            tries++;
            if (patchTavernHelper() || tries >= 20) clearInterval(retry);
        }, 500);
    }
    console.log(`[Memo-N] 独立API row-data 属性同步守卫已加载：EDITOR=${editor} TavernHelper=${tavern} CustomAPI=${custom}`);
}

install();

export {
    canonicalizeRowTag,
    isMemoIndependentRecordRequest,
    normalizeIndependentApiDataAttributeResponse,
    normalizeRowDataAttributes,
};
