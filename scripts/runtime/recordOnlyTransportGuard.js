import { EDITOR } from '../../core/manager.js';
import LLMApiService from '../../services/llmApi.js';
import JSON5 from '../../utils/json5.min.mjs';

const PATCH_MARK = '__memoNRecordOnlyTransportGuardV1';
const TABLE_EDIT_RE = /<tableEdit\b[^>]*>[\s\S]*?<\/tableEdit>/ig;
const OPEN_TABLE_EDIT_RE = /<tableEdit\b/i;
const THINK_RE = /<(think|thinking)>[\s\S]*?<\/\1>/gi;
const XML_DATA_SELF_CLOSING_RE = /<(insertRow|updateRow)\b((?:"[^"]*"|'[^']*'|[^'">])*)\/\s*>/gi;
const XML_DATA_EMPTY_PAIR_RE = /<(insertRow|updateRow)\b((?:"[^"]*"|'[^']*'|[^'">])*)>\s*<\/\1\s*>/gi;

function requestText(value) {
    if (Array.isArray(value)) return value.map(item => requestText(item)).join('\n');
    if (!value || typeof value !== 'object') return String(value ?? '');
    if (typeof value.content === 'string') return value.content;
    return [value.systemPrompt, value.prompt, value.system_prompt, value.ordered_prompts, value.messages]
        .map(item => requestText(item))
        .filter(Boolean)
        .join('\n');
}

function isMemoRecordOnlyRequest(value) {
    const text = requestText(value);
    if (!/<tableEdit\b/i.test(text)) return false;
    return text.includes('Memo独立表格记录器')
        || text.includes('[Memo七表独立记录v3]')
        || text.includes('# Memo独立记录操作协议')
        || text.includes('Memo世界状态表格整理器');
}

function stripWholeFence(value) {
    const text = String(value ?? '').trim();
    const match = /^```[^\n]*\n?([\s\S]*?)\n?```$/.exec(text);
    return match ? match[1].trim() : text;
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

function parseXmlAttributes(source) {
    const attrs = {};
    let cursor = 0;
    while (cursor < source.length) {
        while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
        if (cursor >= source.length) break;
        const nameMatch = /^[A-Za-z_][A-Za-z0-9_.:-]*/.exec(source.slice(cursor));
        if (!nameMatch) return null;
        const name = nameMatch[0];
        cursor += name.length;
        while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
        if (source[cursor] !== '=') return null;
        cursor += 1;
        while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
        const quote = source[cursor];
        if (quote !== '"' && quote !== "'") return null;
        cursor += 1;
        const start = cursor;
        while (cursor < source.length && source[cursor] !== quote) cursor += 1;
        if (cursor >= source.length || Object.prototype.hasOwnProperty.call(attrs, name)) return null;
        try { attrs[name] = decodeXmlAttribute(source.slice(start, cursor)); }
        catch (_) { return null; }
        cursor += 1;
    }
    return attrs;
}

function canonicalizeXmlDataAttribute(name, attrsSource) {
    const attrs = parseXmlAttributes(attrsSource);
    if (!attrs || !Object.prototype.hasOwnProperty.call(attrs, 'data')) return null;
    const isInsert = String(name).toLowerCase() === 'insertrow';
    const allowed = isInsert ? ['tableIndex', 'data'] : ['tableIndex', 'rowIndex', 'data'];
    const keys = Object.keys(attrs);
    if (keys.length !== allowed.length || keys.some(key => !allowed.includes(key)) || allowed.some(key => !Object.prototype.hasOwnProperty.call(attrs, key))) return null;
    if (!/^(?:0|[1-9]\d*)$/.test(attrs.tableIndex)) return null;
    if (!isInsert && !/^(?:0|[1-9]\d*)$/.test(attrs.rowIndex)) return null;

    let data;
    try { data = JSON5.parse(attrs.data); }
    catch (_) { return null; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const entries = Object.entries(data);
    if (!entries.length) return null;
    for (const [, value] of entries) {
        if (typeof value === 'string') continue;
        if (typeof value === 'number' && Number.isFinite(value)) continue;
        return null;
    }

    const safeData = JSON.stringify(data);
    return isInsert
        ? `insertRow(${Number(attrs.tableIndex)},${safeData})`
        : `updateRow(${Number(attrs.tableIndex)},${Number(attrs.rowIndex)},${safeData})`;
}

function normalizeXmlDataAttributes(value) {
    let changed = false;
    const replace = (match, name, attrsSource) => {
        const normalized = canonicalizeXmlDataAttribute(name, attrsSource);
        if (!normalized) return match;
        changed = true;
        return normalized;
    };
    let text = String(value ?? '').replace(XML_DATA_SELF_CLOSING_RE, replace);
    text = text.replace(XML_DATA_EMPTY_PAIR_RE, replace);
    return { text, changed };
}

function normalizeRecordOnlyResponse(raw, channel = 'unknown') {
    if (typeof raw !== 'string') return raw;
    const original = raw.trim();
    if (!original || original === 'suspended' || /^错误[:：]/.test(original)) return raw;

    const withoutThinking = original.replace(THINK_RE, '').trim();
    const completeBlocks = [...withoutThinking.matchAll(TABLE_EDIT_RE)];
    if (completeBlocks.length === 1) {
        const block = completeBlocks[0][0].trim();
        const normalized = normalizeXmlDataAttributes(block);
        if (normalized.changed) console.log(`[Memo-N][record-only-transport] ${channel} 已规范化XML data属性并交给严格执行器复核`);
        else if (block !== original) console.log(`[Memo-N][record-only-transport] ${channel} 已提取唯一tableEdit记录块`);
        return normalized.text;
    }
    if (completeBlocks.length > 1) return raw;

    // An incomplete tableEdit may be a truncated model response. Never invent the
    // missing tail: leave it untouched so the existing strict caller rejects it.
    if (OPEN_TABLE_EDIT_RE.test(withoutThinking)) return raw;

    let payload = stripWholeFence(withoutThinking);
    const comment = /^<!--([\s\S]*?)-->$/.exec(payload);
    if (comment) payload = comment[1].trim();
    if (!payload) return raw;

    const normalized = normalizeXmlDataAttributes(payload);
    payload = normalized.text;
    if (normalized.changed) console.log(`[Memo-N][record-only-transport] ${channel} 已规范化XML data属性并交给严格执行器复核`);

    // This adapter only restores the transport envelope and one known, structurally
    // safe XML transport variant. It never executes the body itself. Parsed data is
    // re-serialized before the existing strict tableEdit parser/executor validates
    // real table/row/column bounds, value types, conflicts and transactional safety.
    console.log(`[Memo-N][record-only-transport] ${channel} 返回缺少tableEdit外壳，已交给严格执行器校验`);
    return `<tableEdit><!--\n${payload}\n--></tableEdit>`;
}

function installMethodGuard(target, key, requestInspector, channel) {
    if (!target || typeof target[key] !== 'function') return false;
    const current = target[key];
    if (current[PATCH_MARK]) return true;
    const wrapped = async function (...args) {
        const guarded = (() => {
            try { return isMemoRecordOnlyRequest(requestInspector.call(this, args)); }
            catch (error) {
                console.warn(`[Memo-N][record-only-transport] ${channel} 请求识别失败，保持原行为`, error);
                return false;
            }
        })();
        const result = await current.apply(this, args);
        return guarded ? normalizeRecordOnlyResponse(result, channel) : result;
    };
    Object.defineProperty(wrapped, PATCH_MARK, { value: true });
    try {
        target[key] = wrapped;
        return target[key] === wrapped || target[key]?.[PATCH_MARK] === true;
    } catch (error) {
        console.warn(`[Memo-N][record-only-transport] ${channel} 无法安装守卫`, error);
        return false;
    }
}

function patchEditorGenerateRaw() {
    return installMethodGuard(
        EDITOR,
        'generateRaw',
        args => args?.[0],
        '主API/EDITOR.generateRaw',
    );
}

function patchTavernHelperGenerateRaw() {
    const helper = globalThis.TavernHelper;
    return installMethodGuard(
        helper,
        'generateRaw',
        args => args?.[0],
        '主API/TavernHelper.generateRaw',
    );
}

function patchCustomApi() {
    const proto = LLMApiService?.prototype;
    return installMethodGuard(
        proto,
        'callLLM',
        function (args) {
            return [this?.config?.system_prompt ?? '', args?.[0]];
        },
        '自定义API/LLMApiService.callLLM',
    );
}

function install() {
    const editor = patchEditorGenerateRaw();
    const custom = patchCustomApi();
    const tavern = patchTavernHelperGenerateRaw();
    if (!tavern) {
        let tries = 0;
        const retry = setInterval(() => {
            tries += 1;
            if (patchTavernHelperGenerateRaw() || tries >= 20) clearInterval(retry);
        }, 500);
    }
    console.log(`[Memo-N] 独立tableEdit传输守卫已加载：EDITOR=${editor} TavernHelper=${tavern} CustomAPI=${custom}`);
}

install();

export { isMemoRecordOnlyRequest, normalizeRecordOnlyResponse, normalizeXmlDataAttributes };