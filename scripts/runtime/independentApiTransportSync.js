import { EDITOR } from '../../core/manager.js';
import LLMApiService from '../../services/llmApi.js';

const PATCH_MARK = '__memoNIndependentApiTransportSyncV1';
const TABLE_EDIT_RE = /<tableEdit\b[^>]*>[\s\S]*?<\/tableEdit>/ig;

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

function encodeXmlAttribute(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function strictDecimal(value) {
    const text = String(value ?? '').trim();
    if (!/^(?:0|[1-9]\d*)$/.test(text)) return null;
    const parsed = Number(text);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseXmlAttributes(source) {
    const attrs = {};
    let cursor = 0;
    while (cursor < source.length) {
        while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
        if (cursor >= source.length) break;
        const nameMatch = /^[A-Za-z_][A-Za-z0-9_.:-]*/.exec(source.slice(cursor));
        if (!nameMatch) return null;
        const name = nameMatch[0];
        cursor += name.length;
        while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
        if (source[cursor] !== '=') return null;
        cursor++;
        while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
        const quote = source[cursor];
        if (quote !== '"' && quote !== "'") return null;
        cursor++;
        const start = cursor;
        while (cursor < source.length && source[cursor] !== quote) cursor++;
        if (cursor >= source.length || Object.prototype.hasOwnProperty.call(attrs, name)) return null;
        attrs[name] = decodeXml(source.slice(start, cursor));
        cursor++;
    }
    return attrs;
}

function allowedType(value) {
    if (value === undefined) return true;
    return ['string', 'number', 'text'].includes(String(value).trim().toLowerCase());
}

function canonicalData(column, value) {
    const index = strictDecimal(column);
    if (index === null) return null;
    return `<data columnIndex="${index}" value="${encodeXmlAttribute(value)}"/>`;
}

function normalizeDataNode(attrsSource, body, selfClosing) {
    const attrs = parseXmlAttributes(attrsSource);
    if (!attrs) return null;
    const keys = Object.keys(attrs);
    const allowed = new Set(['columnIndex', 'colIndex', 'value', 'type']);
    if (keys.some(key => !allowed.has(key))) return null;
    if (!allowedType(attrs.type)) return null;

    const columnKeys = ['columnIndex', 'colIndex'].filter(key => Object.prototype.hasOwnProperty.call(attrs, key));
    if (columnKeys.length > 1) return null;

    if (columnKeys.length === 1) {
        const column = attrs[columnKeys[0]];
        if (Object.prototype.hasOwnProperty.call(attrs, 'value')) {
            if (!selfClosing && String(body ?? '').trim()) return null;
            return canonicalData(column, attrs.value);
        }
        if (selfClosing) return null;
        const text = String(body ?? '').trim();
        if (!text || /[<>]/.test(text)) return null;
        return canonicalData(column, decodeXml(text));
    }

    if (keys.length) return null;
    if (selfClosing) return null;
    const text = String(body ?? '').trim();
    const child = /^<(columnIndex|colIndex)>\s*((?:0|[1-9]\d*))\s*<\/\1>\s*<value>([\s\S]*?)<\/value>$/i.exec(text);
    if (!child) return null;
    if (/[<>]/.test(child[3])) return null;
    return canonicalData(child[2], decodeXml(child[3].trim()));
}

function normalizeDataNodes(block) {
    let changed = false;
    let text = String(block ?? '');

    text = text.replace(/<data\b((?:"[^"]*"|'[^']*'|[^'">])*)\/\s*>/gi, (match, attrsSource) => {
        const normalized = normalizeDataNode(attrsSource, '', true);
        if (!normalized || normalized === match) return match;
        changed = true;
        return normalized;
    });

    text = text.replace(/<data\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/data\s*>/gi, (match, attrsSource, body) => {
        const normalized = normalizeDataNode(attrsSource, body, false);
        if (!normalized || normalized === match) return match;
        changed = true;
        return normalized;
    });

    return { text, changed };
}

function normalizeIndependentApiResponse(raw, channel = 'unknown') {
    if (typeof raw !== 'string' || !raw.trim()) return raw;
    const matches = [...raw.matchAll(TABLE_EDIT_RE)];
    if (matches.length !== 1) return raw;
    const match = matches[0];
    const normalized = normalizeDataNodes(match[0]);
    if (!normalized.changed) return raw;
    console.log(`[Memo-N][independent-api-sync] ${channel} 已同步规范化独立API的<data>变体，继续交给严格执行器复核`);
    return `${raw.slice(0, match.index)}${normalized.text}${raw.slice(match.index + match[0].length)}`;
}

function installMethodGuard(target, key, requestInspector, channel) {
    if (!target || typeof target[key] !== 'function') return false;
    const current = target[key];
    if (current[PATCH_MARK]) return true;
    const wrapped = async function (...args) {
        let guarded = false;
        try { guarded = isMemoIndependentRecordRequest(requestInspector.call(this, args)); }
        catch (error) { console.warn(`[Memo-N][independent-api-sync] ${channel} 请求识别失败，保持原行为`, error); }
        const result = await current.apply(this, args);
        return guarded ? normalizeIndependentApiResponse(result, channel) : result;
    };
    Object.defineProperty(wrapped, PATCH_MARK, { value: true });
    try {
        target[key] = wrapped;
        return target[key] === wrapped || target[key]?.[PATCH_MARK] === true;
    } catch (error) {
        console.warn(`[Memo-N][independent-api-sync] ${channel} 无法安装同步守卫`, error);
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
    console.log(`[Memo-N] 独立API传输同步守卫已加载：EDITOR=${editor} TavernHelper=${tavern} CustomAPI=${custom}`);
}

install();

export {
    isMemoIndependentRecordRequest,
    normalizeDataNodes,
    normalizeIndependentApiResponse,
};
