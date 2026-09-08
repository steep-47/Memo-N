import { EDITOR, USER } from '../../core/manager.js';
import LLMApiService from '../../services/llmApi.js';

const PATCH_MARK = '__memoCleanupEvidenceWindowV1';
const CLEANUP_MARKER = 'Memo世界状态表格整理器';
const EVIDENCE_RULE = '当前七表是表格整理的主体和主要事实来源；最近聊天只作为极小的校对证据窗口，用于确认表内已有记录的明显冲突、失效或错误。整理不以重新阅读剧情和补录大量信息为目标；表内没有对应问题时，不主动从最近聊天扩写新内容。';

function cleanMessage(item) {
    return String(item?.mes ?? '')
        .replace(/<tableEdit>[\s\S]*?<\/tableEdit>/gi, '')
        .replace(/<(think|thinking)>[\s\S]*?<\/\1>/gi, '')
        .trim();
}

function formatMessage(item) {
    const text = cleanMessage(item);
    if (!text) return '';
    const name = item?.name || (item?.is_user === true ? 'user' : 'assistant');
    return `${name}: ${text}`;
}

function buildOneRoundEvidence() {
    const chat = Array.isArray(USER.getContext?.()?.chat) ? USER.getContext().chat : [];
    if (!chat.length) return '';

    let userIndex = -1;
    for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i]?.is_user === true && cleanMessage(chat[i])) {
            userIndex = i;
            break;
        }
    }

    if (userIndex >= 0) {
        const lines = [];
        const userLine = formatMessage(chat[userIndex]);
        if (userLine) lines.push(userLine);

        for (let i = userIndex + 1; i < chat.length; i++) {
            if (chat[i]?.is_user === false) {
                const assistantLine = formatMessage(chat[i]);
                if (assistantLine) {
                    lines.push(assistantLine);
                    break;
                }
            }
        }
        return lines.join('\n');
    }

    for (let i = chat.length - 1; i >= 0; i--) {
        const line = formatMessage(chat[i]);
        if (line) return line;
    }
    return '';
}

function rewriteCleanupUserPrompt(value) {
    let text = String(value ?? '');
    if (!text) return text;

    const evidence = buildOneRoundEvidence() || '（无最近证据）';
    text = text.replace(
        /<最近聊天>[\s\S]*?<\/最近聊天>/i,
        `<最近聊天>\n${evidence}\n</最近聊天>`,
    );
    text = text.replaceAll(
        '以及最近聊天能够直接证明的明确漏项',
        '以及最近聊天能够直接证明的表内明显冲突、失效或错误',
    );

    if (!text.includes(EVIDENCE_RULE)) {
        text = `${text.trimEnd()}\n\n[整理证据边界]\n${EVIDENCE_RULE}`;
    }
    return text;
}

function rewriteCleanupSystemPrompt(value) {
    let text = String(value ?? '');
    if (!text.includes(CLEANUP_MARKER)) return text;

    text = text.replaceAll(
        '当前表中存在明确漏项，而最近聊天能够直接证明时允许补回；证据不足保持原状，不为了“完整”制造事实。',
        '最近聊天只用于辅助判断当前表内已有记录的明显冲突、失效或错误；整理不主动把聊天内容重新补录进表，证据不足保持原状。',
    );
    if (!text.includes(EVIDENCE_RULE)) {
        text = `${text.trimEnd()}\n\n[整理证据边界]\n${EVIDENCE_RULE}`;
    }
    return text;
}

function patchTavernHelper() {
    const helper = globalThis.TavernHelper;
    if (!helper || typeof helper.generateRaw !== 'function') return false;
    if (helper.generateRaw[PATCH_MARK]) return true;

    const original = helper.generateRaw;
    const wrapped = async function (config = {}) {
        const prompts = Array.isArray(config?.ordered_prompts) ? config.ordered_prompts : null;
        const isCleanup = prompts?.some(item => String(item?.content ?? '').includes(CLEANUP_MARKER));
        if (!isCleanup) return original.apply(this, arguments);

        const nextPrompts = prompts.map(item => {
            if (!item || typeof item !== 'object') return item;
            if (item.role === 'system') return { ...item, content: rewriteCleanupSystemPrompt(item.content) };
            if (item.role === 'user') return { ...item, content: rewriteCleanupUserPrompt(item.content) };
            return item;
        });
        return original.call(this, { ...config, ordered_prompts: nextPrompts });
    };
    Object.defineProperty(wrapped, PATCH_MARK, { value: true });
    helper.generateRaw = wrapped;
    return true;
}

function patchEditorGenerateRaw() {
    if (typeof EDITOR.generateRaw !== 'function' || EDITOR.generateRaw[PATCH_MARK]) return;
    const original = EDITOR.generateRaw;
    const wrapped = async function (...args) {
        const request = args?.[0];
        if (request && typeof request === 'object' && String(request.systemPrompt ?? '').includes(CLEANUP_MARKER)) {
            args[0] = {
                ...request,
                systemPrompt: rewriteCleanupSystemPrompt(request.systemPrompt),
                prompt: rewriteCleanupUserPrompt(request.prompt),
            };
        }
        return original.apply(this, args);
    };
    Object.defineProperty(wrapped, PATCH_MARK, { value: true });
    EDITOR.generateRaw = wrapped;
}

function patchCustomApi() {
    const proto = LLMApiService?.prototype;
    if (!proto || typeof proto.callLLM !== 'function' || proto.callLLM[PATCH_MARK]) return;
    const original = proto.callLLM;
    const wrapped = async function (...args) {
        if (String(this?.config?.system_prompt ?? '').includes(CLEANUP_MARKER)) {
            if (typeof args[0] === 'string') {
                args[0] = rewriteCleanupUserPrompt(args[0]);
            } else if (Array.isArray(args[0])) {
                args[0] = args[0].map(item => {
                    if (item?.role === 'user' && typeof item?.content === 'string') {
                        return { ...item, content: rewriteCleanupUserPrompt(item.content) };
                    }
                    return item;
                });
            }
        }
        return original.apply(this, args);
    };
    Object.defineProperty(wrapped, PATCH_MARK, { value: true });
    proto.callLLM = wrapped;
}

function install() {
    patchEditorGenerateRaw();
    patchCustomApi();

    if (patchTavernHelper()) return;
    let attempts = 0;
    const timer = setInterval(() => {
        attempts += 1;
        if (patchTavernHelper() || attempts >= 20) clearInterval(timer);
    }, 500);
}

install();
console.log('[Memo-N] 表格整理证据窗口已加载：七表为主体，最近仅保留1轮聊天作校对证据');

export { EVIDENCE_RULE, buildOneRoundEvidence, rewriteCleanupUserPrompt, rewriteCleanupSystemPrompt };
