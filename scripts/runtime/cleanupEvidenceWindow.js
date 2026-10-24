import { EDITOR, USER } from '../../core/manager.js';
import LLMApiService from '../../services/llmApi.js';

const PATCH_MARK = '__memoCleanupEvidenceWindowV7';
const CLEANUP_MARKER = 'Memo世界状态表格整理器';
const REDUNDANCY_MARKER = 'Memo冗余合并专用整理器';
const EVIDENCE_RULE = '当前七表是表格整理的主体和主要事实来源；最近聊天只作为极小的校对证据窗口，用于确认表内已有记录的明显冲突、失效或错误。整理不以重新阅读剧情和补录大量信息为目标；表内没有对应问题时，不主动从最近聊天扩写新内容。';
const MAINTENANCE_SCOPE_RULE = '普通“表格整理”只做七表正确性维护：处理重复实体/物品/任务行、完成/过期/失效项、错表错位、字段混写、旧值冲突及能够明确证明的数据错误；不做长文本润色或内容压缩，也不把表6逐轮记录重组为完整事件。表6完整事件级跨行合并以及纯内容冗余压缩统一交给“冗余整理”。';
const SETTLEMENT_RULE = '删除表3中已完成、失败、取消、失效或明确到期的事项前，先结算其已确认的结束事实：若结束使表1/4/5等当前状态中的持续描述失效，先更新对应字段；若结束本身对未来推演仍有长期价值，优先更新表6已有相关事件的结果，只有没有合适历史行且确有独立长期价值时才新增历史。普通完成项不为留痕而新增表6；目标表已有该结果时不重复写。期限结束只证明原状态终止，不得据此推断新的地点、行为、身份或其他后续状态；结算完成后再删除表3。';
const REDUNDANCY_SYSTEM_RULE = `你是Memo冗余合并专用整理器。只做七表内容去冗余，不做表格正确性维护。必须按0→1→2→3→4→5→6完整扫描当前七表；每个候选独立判断，不因已经找到一组可整理内容就停止后续检查，也不得为了增加操作数量强行修改。
表0～5：只允许压缩同一现有行内部明确重复、同义堆叠、被同一行更完整表述覆盖且不承载额外事实的文字；不跨行合并实体、物品、任务或人物，不处理完成、过期、失效、错位、纠错等正确性问题。
表6：除单行内部压缩外，可把逐轮拆开的多行重组为较少记录，但只有多行共同描述同一次具体行动、会面、战斗、调查或同一任务阶段，并能形成一个共同结果时才属于同一事件。以下情况视为事件硬边界，默认不得跨越合并：前一事件已有明确结果或结束后出现新事件起点；对手、核心目标或正式阶段变化；一个任务完成后开始新任务；明确离场后重新进入新的场景或行动；不同场次、轮次或独立对局，即使属于同一大活动、同一天或同一地点。复杂事件中有独立回溯价值的子事件继续分开保留。
已经完整、紧凑且无明显冗余的行保持原样；这不是判断整张表是否“整理过”，而是逐行、逐组判断。无法确认候选确属冗余，或无法确认多行确属同一具体事件时，不操作该候选。
合并表6时先updateRow保留行，再deleteRow被吸收行；时间和地点可写范围，事件列保留关键过程、转折、线索、因果与先后顺序，结果列保留最终结果及影响，不得只剩最终结果。
只允许updateRow和deleteRow；不得insertRow、补漏、纠错、迁移字段、编造事实或修改表头。最终必须且只能输出一个<tableEdit><!-- 操作 --></tableEdit>；只有完整扫描七表后没有任何高置信冗余操作时才输出<tableEdit><!-- NO_CHANGE --></tableEdit>。所有行号、列名与对象核对名必须来自当前表格。`;
const REDUNDANCY_USER_RULE = '仅做内容冗余整理。按0→6完整扫描，每个候选独立判断，并把所有有充分把握的冗余操作放进同一个tableEdit；不要找到第一组后停止，也不要为了凑操作强行修改。表0～5只做单行内部压缩；表6只有同一具体事件才允许跨行重组，遇到明确结果后出现新事件、对手或核心目标变化、正式阶段变化、不同场次/轮次/独立对局、离场后重新开始等边界必须分开。已经紧凑的行不动。不补漏、不纠错、不迁移、不新增。';

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
    return REDUNDANCY_SYSTEM_RULE;
}

function rewriteRedundancyUserPrompt(value) {
    const text = String(value ?? '');
    const tableBlock = text.match(/<当前七表>[\s\S]*?<\/当前七表>/i)?.[0] ?? text.trim();
    return `${tableBlock}\n${REDUNDANCY_USER_RULE}`.trim();
}

function rewriteLastUserMessage(messages, rewriter) {
    const copy = messages.map(item => ({ ...item }));
    for (let i = copy.length - 1; i >= 0; i--) {
        if (copy[i]?.role === 'user' && typeof copy[i]?.content === 'string') {
            copy[i].content = rewriter(copy[i].content);
            break;
        }
    }
    return copy;
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
                    prompt: rewriteRedundancyUserPrompt(request.prompt),
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
            const rewriter = normalCleanup ? rewriteCleanupUserPrompt : rewriteRedundancyUserPrompt;
            if (typeof args[0] === 'string') {
                args[0] = rewriter(args[0]);
            } else if (Array.isArray(args[0])) {
                args[0] = rewriteLastUserMessage(args[0], rewriter);
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
console.log('[Memo-N] 整理守卫v7已加载：普通整理保持正确性职责；冗余整理按候选与事件硬边界逐组判断');

export {
    CLEANUP_MARKER,
    REDUNDANCY_MARKER,
    EVIDENCE_RULE,
    MAINTENANCE_SCOPE_RULE,
    SETTLEMENT_RULE,
    REDUNDANCY_SYSTEM_RULE,
    REDUNDANCY_USER_RULE,
    buildOneRoundEvidence,
    rewriteCleanupUserPrompt,
    rewriteCleanupSystemPrompt,
    rewriteRedundancySystemPrompt,
    rewriteRedundancyUserPrompt,
};
