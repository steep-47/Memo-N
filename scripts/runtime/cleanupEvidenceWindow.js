import { EDITOR, USER } from '../../core/manager.js';
import LLMApiService from '../../services/llmApi.js';

const PATCH_MARK = '__memoCleanupEvidenceWindowV3';
const CLEANUP_MARKER = 'Memo世界状态表格整理器';
const EVIDENCE_RULE = '当前七表是表格整理的主体和主要事实来源；最近聊天只作为极小的校对证据窗口，用于确认表内已有记录的明显冲突、失效或错误。整理不以重新阅读剧情和补录大量信息为目标；表内没有对应问题时，不主动从最近聊天扩写新内容。';
const EXPRESSION_RULE = '表格整理同时负责维护长文本字段的可读性：当内容存在重复、同义堆叠、无效铺陈，或表达已经明显影响快速查阅时，应在不损失有效事实、位置、程度、状态、条件、关系和人物辨识度的前提下主动提炼。叙述性表达本身不是问题；若它有助于准确表达特征、关系、条件、程度或辨识度，应保留，只去掉不承载有效信息的铺陈。整理后的文字应紧凑、自然、便于快速阅读，而不是压成生硬标签。';

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

function appendCleanupRules(text) {
    let result = String(text ?? '').trimEnd();
    if (!result.includes(EVIDENCE_RULE)) {
        result += `\n\n[整理证据边界]\n${EVIDENCE_RULE}`;
    }
    if (!result.includes(EXPRESSION_RULE)) {
        result += `\n\n[长文本表达整理]\n${EXPRESSION_RULE}`;
    }
    return result;
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

    return appendCleanupRules(text);
}

function rewriteCleanupSystemPrompt(value) {
    let text = String(value ?? '');
    if (!text.includes(CLEANUP_MARKER)) return text;

    text = text.replaceAll(
        '当前表中存在明确漏项，而最近聊天能够直接证明时允许补回；证据不足保持原状，不为了“完整”制造事实。',
        '最近聊天只用于辅助判断当前表内已有记录的明显冲突、失效或错误；整理不主动把聊天内容重新补录进表，证据不足保持原状。',
    );
    return appendCleanupRules(text);
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
                const messages = args[0].map(item => ({ ...item }));
                for (let i = messages.length - 1; i >= 0; i--) {
                    if (messages[i]?.role === 'user' && typeof messages[i]?.content === 'string') {
                        messages[i].content = rewriteCleanupUserPrompt(messages[i].content);
                        break;
                    }
                }
                args[0] = messages;
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
}

install();
console.log('[Memo-N] 表格整理规则已加载：七表为主体、最近仅保留1轮校对证据，并主动维护长文本可读性');

export { EVIDENCE_RULE, EXPRESSION_RULE, buildOneRoundEvidence, rewriteCleanupUserPrompt, rewriteCleanupSystemPrompt };
