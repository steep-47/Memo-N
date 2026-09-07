import { EDITOR } from '../../core/manager.js';
import LLMApiService from '../../services/llmApi.js';

const PATCH_MARK = '__memoNRecordOnlyTransportGuardV1';
const TABLE_EDIT_RE = /<tableEdit\b[^>]*>[\s\S]*?<\/tableEdit>/ig;
const OPEN_TABLE_EDIT_RE = /<tableEdit\b/i;
const THINK_RE = /<(think|thinking)>[\s\S]*?<\/\1>/gi;

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

function normalizeRecordOnlyResponse(raw, channel = 'unknown') {
    if (typeof raw !== 'string') return raw;
    const original = raw.trim();
    if (!original || original === 'suspended' || /^错误[:：]/.test(original)) return raw;

    const withoutThinking = original.replace(THINK_RE, '').trim();
    const completeBlocks = [...withoutThinking.matchAll(TABLE_EDIT_RE)];
    if (completeBlocks.length === 1) {
        const block = completeBlocks[0][0].trim();
        if (block !== original) console.log(`[Memo-N][record-only-transport] ${channel} 已提取唯一tableEdit记录块`);
        return block;
    }
    if (completeBlocks.length > 1) return raw;

    // An incomplete tableEdit may be a truncated model response. Never invent the
    // missing tail: leave it untouched so the existing strict caller rejects it.
    if (OPEN_TABLE_EDIT_RE.test(withoutThinking)) return raw;

    let payload = stripWholeFence(withoutThinking);
    const comment = /^<!--([\s\S]*?)-->$/.exec(payload);
    if (comment) payload = comment[1].trim();
    if (!payload) return raw;

    // This adapter only restores the transport envelope. It does not interpret,
    // repair or execute the body. The existing strict tableEdit parser/executor
    // remains the sole authority, so prose/JSON/invalid calls are still rejected.
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

export { isMemoRecordOnlyRequest, normalizeRecordOnlyResponse };
