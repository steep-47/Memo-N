import { EDITOR, USER } from '../../core/manager.js';
import LLMApiService from '../../services/llmApi.js';

const PATCH_MARK = '__memoNDenseExpressionRuleV6';
const OLD_STEP_MARKERS = [
    '[Memo七表独立记录v4-记录优先]',
    '[Memo七表独立记录v5-完整但不摘抄]',
    '[Memo七表独立记录v6-能力字段分层]',
    '[Memo七表独立记录v7-技能与擅长语义分层]',
    '[Memo七表独立记录v8-七表字段语义边界]',
    '[Memo七表独立记录v9-玩家资料字段完善]',
];
const STEP_MARKER = '[Memo七表独立记录v10-外貌视觉档案]';
const CLEANUP_MARKER = 'Memo世界状态表格整理器';
const RULE = '长文本字段应在不损失有效细节的前提下提炼表达。保留人物辨识度、位置、程度、状态、条件和关系等有用信息，合并重复与同义内容，去掉冗长叙述和无必要修辞；优先改写为紧凑、自然、信息密度高的描述，不为缩短而过度概括，也不削弱原本的表达力度。';
const APPEARANCE_RULE = '表1与表4的“外貌特征”应作为当前视觉档案维护：只记录已明确确认、稳定或具有持续辨识度的外观事实，如身量体态、肤色、五官、发色发型，以及疤痕、痣、纹身、残缺等显著特征和持久变化；保留必要的位置、程度与显现条件。描述优先直接写“现在看起来是什么样”，不把形成原因、受伤经过、童年故事、亲缘比较、行为习惯造成的解释、当下表情或气质评价写进外貌；普通临时穿着也不作为稳定外貌，除非已明确是长期标志性装束。低辨识度或近乎中性的修饰应省略，同一特征只保留信息最完整且最紧凑的一种表达。';
const OLD_ABILITY_RULES = [
    '角色状态表中，“技能/术法”记录已经掌握、可具体调用或施展的本领、技艺、功法或术法；“擅长”记录长期稳定的能力方向、熟练领域与优势倾向。两者可以同时存在：前者写具体表现，后者写能力方向；只有完全同义且没有层级区别时才避免机械重复。',
];
const ABILITY_RULE = '角色状态表中，“技能/术法”记录已经明确学习并掌握、具有相对独立技法形态、可作为具体招式、功法、术法、技艺或技能被施展或调用的能力，回答“具体掌握了什么技法”；“擅长”记录人物长期稳定的能力领域、熟练事项与优势，回答“在哪些事情上有能力或更熟练”。判断依据是信息层级而不是措辞：仅说明会做某类事情、具备某类生活、职业、生产、知识或身体能力，尚未明确到具体技法或独立技能形态时，归入“擅长”；明确到某项可单独掌握、训练、施展或调用的具体技法时，归入“技能/术法”。同一领域可以同时存在擅长方向和其中的具体技能，按层级分别记录，不机械互斥。维护时若发现既有内容放错栏，应按此边界迁移、合并并去重。';
const OLD_TABLE_RULES = [
    '七表遵循“每条事实先确定唯一主位置”的原则：表0只保存玩家下次输入前的最终场景快照；表1只保存玩家本人当前状态与稳定能力；表2只保存玩家当前实际持有物；表3只保存尚未结束的任务、承诺、交易或约定；表4只保存NPC稳定身份、关系、外貌、性格及长期识别信息；表5只保存NPC最新发展锚点，其中“主要能力”只写人物实际能力，“当前状态”只写当前处境或状态，“主要目标/重要事项”只写当前目标或需持续追踪的事项，不把身份、关系、产业、职责、性格、履历或单纯名望塞入这些字段；表6只追加已发生且会影响未来的重要历史节点，时间写实际时间或时期，结果写该事件造成的明确后果，不用当前评价或人物简介代替。若同一事实已有专门字段或专门表作为主位置，其他位置只保留必要关联，不整句重复搬运；整理时发现错栏或跨表重复，应迁回主位置并合并去重，同时保留有效信息。表格记录事实而不是文风：比喻、氛围、主观观感和一时表情动作，不自动升级为持久事实；只有表0需要按最终场景保留当下落点。',
];
const TABLE_RULE = '七表遵循“每条事实先确定唯一主位置”的原则：表0只保存玩家下次输入前的最终场景快照；表1保存玩家本人当前状态、稳定能力与持续可识别资料，其中“身份/所属”记录已确认的当前稳定身份、组织或势力归属，“别名/称号”记录已确认的别名、化名、道号、称号等可识别称谓，外貌记录稳定外观与持久变化；表2只保存玩家当前实际持有物；表3只保存尚未结束的任务、承诺、交易或约定；表4只保存NPC稳定身份、关系、外貌、性格及长期识别信息；表5只保存NPC最新发展锚点，其中“主要能力”只写人物实际能力，“当前状态”只写当前处境或状态，“主要目标/重要事项”只写当前目标或需持续追踪的事项，不把身份、关系、产业、职责、性格、履历或单纯名望塞入这些字段；表6只追加已发生且会影响未来的重要历史节点，时间写实际时间或时期，结果写该事件造成的明确后果，不用当前评价或人物简介代替。若同一事实已有专门字段或专门表作为主位置，其他位置只保留必要关联，不整句重复搬运；整理时发现错栏或跨表重复，应迁回主位置并合并去重，同时保留有效信息。表格记录事实而不是文风：比喻、氛围、主观观感和一时表情动作，不自动升级为持久事实；只有表0需要按最终场景保留当下落点。';
const UPDATE_RULE = '更新方式按数据性质判断，而不是给每个字段死记一种操作：当前值发生变化时覆盖为最新值；持续能力、身份/所属、别名/称号、外貌等稳定资料以合并维护为主，同一事实被更准确地细化、替代或纠正时更新原内容；独立对象按新增、变化、失效分别insert/update/delete；历史事件以追加为主，只在重复或明确错误时合并、纠正或删除。';

function replaceOldRules(value) {
    let text = String(value ?? '');
    for (const oldRule of OLD_ABILITY_RULES) {
        if (text.includes(oldRule)) text = text.replaceAll(oldRule, ABILITY_RULE);
    }
    for (const oldRule of OLD_TABLE_RULES) {
        if (text.includes(oldRule)) text = text.replaceAll(oldRule, TABLE_RULE);
    }
    return text;
}

function collectMissing(text, rules) {
    return rules.filter(rule => rule && !text.includes(rule));
}

function upgradeDefaultStepPrompt(value) {
    let text = replaceOldRules(value);
    if (!text) return text;
    const recognized = OLD_STEP_MARKERS.some(marker => text.includes(marker)) || text.includes(STEP_MARKER);
    if (!recognized) return text;
    for (const marker of OLD_STEP_MARKERS) text = text.replaceAll(marker, STEP_MARKER);

    const anchor = '表5字段“年龄”和“最后确认时间”必须分开：年龄是人物属性，最后确认时间是该发展锚点最后被剧情确认的世界时间；未知分别留空。';
    const outputAnchor = '只输出一个<tableEdit><!-- 函数调用 --></tableEdit>';
    const additions = collectMissing(text, [RULE, APPEARANCE_RULE, ABILITY_RULE, TABLE_RULE, UPDATE_RULE]);
    if (!additions.length) return text;
    const extra = additions.join('');

    if (text.includes(anchor)) return text.replace(anchor, `${anchor}${extra}`);
    if (text.includes(outputAnchor)) return text.replace(outputAnchor, `${extra}${outputAnchor}`);
    return `${text}${extra}`;
}

function upgradeBaseMessagePrompt(value) {
    let text = replaceOldRules(value);
    if (!text || !text.includes('# dataTable 世界状态记忆')) return text;
    const additions = collectMissing(text, [APPEARANCE_RULE, ABILITY_RULE, TABLE_RULE, UPDATE_RULE]);
    if (!additions.length) return text;
    const section = `# 字段归属与更新判断\n${additions.map(rule => `- ${rule}`).join('\n')}\n`;
    if (text.includes('# NPC长期发展锚点')) return text.replace('# NPC长期发展锚点', `${section}# NPC长期发展锚点`);
    if (text.includes('# 输出')) return text.replace('# 输出', `${section}# 输出`);
    return `${text.trimEnd()}\n${section}`;
}

function installPromptRules() {
    let changed = false;

    const currentStep = USER.tableBaseSetting?.step_by_step_user_prompt;
    const upgradedStep = upgradeDefaultStepPrompt(currentStep);
    if (upgradedStep && upgradedStep !== currentStep) {
        USER.tableBaseSetting.step_by_step_user_prompt = upgradedStep;
        changed = true;
        console.log('[Memo-N][field-semantics] 已升级手动更新默认提示：外貌按视觉档案高密度维护');
    }

    const defaultStep = USER.tableBaseDefaultSettings?.step_by_step_user_prompt;
    const upgradedDefaultStep = upgradeDefaultStepPrompt(defaultStep);
    if (upgradedDefaultStep && upgradedDefaultStep !== defaultStep) {
        USER.tableBaseDefaultSettings.step_by_step_user_prompt = upgradedDefaultStep;
    }

    const currentBase = USER.tableBaseSetting?.message_template;
    const upgradedBase = upgradeBaseMessagePrompt(currentBase);
    if (upgradedBase && upgradedBase !== currentBase) {
        USER.tableBaseSetting.message_template = upgradedBase;
        changed = true;
        console.log('[Memo-N][field-semantics] 已给正常记录补充外貌视觉档案规则');
    }

    const defaultBase = USER.tableBaseDefaultSettings?.message_template;
    const upgradedDefaultBase = upgradeBaseMessagePrompt(defaultBase);
    if (upgradedDefaultBase && upgradedDefaultBase !== defaultBase) {
        USER.tableBaseDefaultSettings.message_template = upgradedDefaultBase;
    }

    if (changed) USER.saveSettings?.();
}

function appendCleanupRules(text) {
    let source = replaceOldRules(text);
    if (!source) return source;
    const sections = [
        ['长文本字段表达', RULE],
        ['外貌视觉档案', APPEARANCE_RULE],
        ['角色能力字段', ABILITY_RULE],
        ['七表字段归属', TABLE_RULE],
        ['更新方式判断', UPDATE_RULE],
    ].filter(([, rule]) => !source.includes(rule));
    if (!sections.length) return source;
    return `${source.trimEnd()}\n\n${sections.map(([title, rule]) => `[${title}]\n${rule}`).join('\n\n')}`;
}

function patchEditorGenerateRaw() {
    if (typeof EDITOR.generateRaw !== 'function' || EDITOR.generateRaw[PATCH_MARK]) return;
    const original = EDITOR.generateRaw;
    const wrapped = async function (...args) {
        const request = args?.[0];
        if (request && typeof request === 'object' && String(request.systemPrompt ?? '').includes(CLEANUP_MARKER)) {
            args[0] = { ...request, prompt: appendCleanupRules(request.prompt) };
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
                args[0] = appendCleanupRules(args[0]);
            } else if (Array.isArray(args[0])) {
                const messages = args[0].map(item => ({ ...item }));
                for (let i = messages.length - 1; i >= 0; i--) {
                    if (messages[i]?.role === 'user' && typeof messages[i]?.content === 'string') {
                        messages[i].content = appendCleanupRules(messages[i].content);
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
    installPromptRules();
    patchEditorGenerateRaw();
    patchCustomApi();
    console.log('[Memo-N] 七表字段语义规则已加载：外貌按视觉档案高密度维护，能力与字段按主位置归类');
}

install();

export { RULE, APPEARANCE_RULE, ABILITY_RULE, TABLE_RULE, UPDATE_RULE, STEP_MARKER, upgradeDefaultStepPrompt, upgradeBaseMessagePrompt };
