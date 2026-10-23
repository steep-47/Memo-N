import { EDITOR, USER } from '../../core/manager.js';
import LLMApiService from '../../services/llmApi.js';

const PATCH_MARK = '__memoCleanupEvidenceWindowV7';
const CLEANUP_MARKER = 'Memo世界状态表格整理器';
const REDUNDANCY_MARKER = 'Memo冗余合并专用整理器';
const EVIDENCE_RULE = '当前七表是表格整理的主体和主要事实来源；最近聊天只作为极小的校对证据窗口，用于确认表内已有记录的明显冲突、失效或错误。整理不以重新阅读剧情和补录大量信息为目标；表内没有对应问题时，不主动从最近聊天扩写新内容。';
const MAINTENANCE_SCOPE_RULE = '普通“表格整理”只做七表正确性维护：处理重复实体/物品/任务行、完成/过期/失效项、错表错位、字段混写、旧值冲突及能够明确证明的数据错误；不做长文本润色或内容压缩，也不把表6逐轮记录重组为完整事件。表6完整事件级跨行合并以及纯内容冗余压缩统一交给“冗余整理”。';
const SETTLEMENT_RULE = '删除表3中已完成、失败、取消、失效或明确到期的事项前，先结算其已确认的结束事实：若结束使表1/4/5等当前状态中的持续描述失效，先更新对应字段；若结束本身对未来推演仍有长期价值，优先更新表6已有相关事件的结果，只有没有合适历史行且确有独立长期价值时才新增历史。普通完成项不为留痕而新增表6；目标表已有该结果时不重复写。期限结束只证明原状态终止，不得据此推断新的地点、行为、身份或其他后续状态；结算完成后再删除表3。';
const REDUNDANCY_IDEMPOTENCE_RULE = '冗余整理应近似幂等：表6中已经能够独立表达一个完整事件、且内部没有逐轮重复或同义堆叠的行，视为稳定历史单元，不得仅为了更短再次改写。明确终局（目标达成或失败、冲突解决、正式结案、明确离场等）视为事件边界；终局之后即使人物、地点或主题相同，也默认是新的完整事件，不得跨终局合并。只有原事件明确尚未闭合，且后续记录直接延续同一目标、冲突或行动链时，才允许在后续冗余整理中继续合并。重复执行只保护已经稳定完整的行，不保护整张表；若仍存在明确可合并的逐轮事件链，应继续整理，只有确认全表已无可合并内容时才输出NO_CHANGE。';

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
    if (!result.includes(MAINTENANCE_SCOPE_RULE)) {
        result += `\n\n[普通表格整理职责]\n${MAINTENANCE_SCOPE_RULE}`;
    }
    return result;
}

function appendSettlementRule(text) {
    let result = String(text ?? '').trimEnd();
    if (!result.includes(SETTLEMENT_RULE)) {
        result += `\n\n[结束事项结算]\n${SETTLEMENT_RULE}`;
    }
    return result;
}

function appendRedundancyIdempotenceRule(text) {
    let result = String(text ?? '').trimEnd();
    if (!result.includes(REDUNDANCY_IDEMPOTENCE_RULE)) {
        result += `\n\n[重复执行稳定性]\n${REDUNDANCY_IDEMPOTENCE_RULE}`;
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
    text = text.replaceAll(
        '历史表既整理重大节点，也保留0～5无法承接但后续需要的连续性事实，同一连续事件优先合并/更新。',
        '历史表只做正确性维护：纠正明确错误、重复或与已确认事实冲突的记录；完整事件级跨行合并交给冗余整理。',
    );

    return appendSettlementRule(appendCleanupRules(text));
}

function rewriteCleanupSystemPrompt(value) {
    let text = String(value ?? '');
    if (!text.includes(CLEANUP_MARKER)) return text;

    text = text.replaceAll(
        '当前表中存在明确漏项，而最近聊天能够直接证明时允许补回；证据不足保持原状，不为了“完整”制造事实。',
        '最近聊天只用于辅助判断当前表内已有记录的明显冲突、失效或错误；整理不主动把聊天内容重新补录进表，证据不足保持原状。',
    );
    text = text.replaceAll(
        '纯氛围、无后续意义的琐碎动作可删除；同一连续事件优先压缩维护同一条记录，不机械按每轮拆行。',
        '历史表仅纠正明确错误、重复或与已确认事实冲突的行；普通表格整理不做完整事件级跨行压缩。',
    );
    return appendSettlementRule(appendCleanupRules(text));
}

function rewriteRedundancySystemPrompt(value) {
    const text = String(value ?? '');
    if (!text.includes(REDUNDANCY_MARKER)) return text;
    return appendRedundancyIdempotenceRule(text);
}

function patchEditorGenerateRaw() {
    if (typeof EDITOR.generateRaw !== 'function' || EDITOR.generateRaw[PATCH_MARK]) return;
    const original = EDITOR.generateRaw;
    const wrapped = async function (...args) {
        const request = args?.[0];
        if (request && typeof request === 'object') {
            const systemPrompt = String(request.systemPrompt ?? '');
            if (systemPrompt.includes(CLEANUP_MARKER)) {
                args[0] = {
                    ...request,
                    systemPrompt: rewriteCleanupSystemPrompt(request.systemPrompt),
                    prompt: rewriteCleanupUserPrompt(request.prompt),
                };
            } else if (systemPrompt.includes(REDUNDANCY_MARKER)) {
                args[0] = {
                    ...request,
                    systemPrompt: rewriteRedundancySystemPrompt(request.systemPrompt),
                };
            }
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
        const config = this?.config;
        const currentSystem = String(config?.system_prompt ?? '');
        const normalCleanup = currentSystem.includes(CLEANUP_MARKER);
        const redundancyCleanup = currentSystem.includes(REDUNDANCY_MARKER);
        if (!normalCleanup && !redundancyCleanup) return original.apply(this, args);

        const originalSystem = config?.system_prompt;
        if (config && typeof config === 'object') {
            config.system_prompt = normalCleanup
                ? rewriteCleanupSystemPrompt(originalSystem)
                : rewriteRedundancySystemPrompt(originalSystem);
        }
        try {
            if (normalCleanup) {
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
            return await original.apply(this, args);
        } finally {
            if (config && typeof config === 'object') config.system_prompt = originalSystem;
        }
    };
    Object.defineProperty(wrapped, PATCH_MARK, { value: true });
    proto.callLLM = wrapped;
}

function install() {
    patchEditorGenerateRaw();
    patchCustomApi();
}

install();
console.log('[Memo-N] 整理守卫v7已加载：普通整理只做正确性维护；冗余整理幂等保护仅锁定已稳定事件行');

export {
    CLEANUP_MARKER,
    REDUNDANCY_MARKER,
    EVIDENCE_RULE,
    MAINTENANCE_SCOPE_RULE,
    SETTLEMENT_RULE,
    REDUNDANCY_IDEMPOTENCE_RULE,
    buildOneRoundEvidence,
    rewriteCleanupUserPrompt,
    rewriteCleanupSystemPrompt,
    rewriteRedundancySystemPrompt,
};
