import { EDITOR, USER } from '../../core/manager.js';
import LLMApiService from '../../services/llmApi.js';

const PATCH_MARK = '__memoNDenseExpressionRuleV10';
const OLD_STEP_MARKERS = [
    '[Memo七表独立记录v4-记录优先]',
    '[Memo七表独立记录v5-完整但不摘抄]',
    '[Memo七表独立记录v6-能力字段分层]',
    '[Memo七表独立记录v7-技能与擅长语义分层]',
    '[Memo七表独立记录v8-七表字段语义边界]',
    '[Memo七表独立记录v9-玩家资料字段完善]',
    '[Memo七表独立记录v10-外貌视觉档案]',
];
const STEP_MARKER = '[Memo七表独立记录v11-字段判断方法]';
const CLEANUP_MARKER = 'Memo世界状态表格整理器';
const RULE = '长文本字段应在不损失有效细节的前提下提炼表达。保留人物辨识度、位置、程度、状态、条件和关系等有用信息，合并重复与同义内容，去掉冗长叙述和无必要修辞；优先改写为紧凑、自然、信息密度高的描述，不为缩短而过度概括，也不削弱原本的表达力度。';
const OLD_APPEARANCE_RULES = [
    '外貌字段按“可观察性→持续性→辨识度→信息压缩”判断：先从叙述中抽取人物当前能够直接观察到的视觉事实，再判断该特征是否稳定、持久或足以持续识别人物；只保留有辨识价值的事实，并保留理解该特征所必需的位置、程度和显现条件。不能直接构成人物当前视觉状态的信息，不因与外貌出现在同一句话中就写入外貌；若它本身具有其他长期价值，应按事实性质归入对应字段或表。已有外貌更新时，以更晚、更明确、更准确的事实细化、替代或合并同一特征，不把叙事原句逐次堆叠。最终目标是形成紧凑、可用于重新识别人形象的当前视觉档案，而不是保存描写过程。',
    '外貌特征只维护已确认、稳定且具有辨识度的可观察外形事实；优先记录整体体态、主要面部特征及持久细节，合并重复与普通修辞。外貌形成原因、过往经历、性格评价、临时神态与动作不写入此栏。表达按整体轮廓→主要特征→辨识细节组织，在不损失位置、程度和状态等有效信息的前提下保持紧凑。',
    '外貌特征只保留已确认、稳定且能明显帮助识别人物的外形信息；先提取最有辨识度的整体特征和关键细节，普通、常见、相近的信息合并或省略。当现有信息已足以形成清晰人物印象时停止继续补充。表达保持紧凑，在不丢失关键位置、程度和状态的前提下优先减少低辨识度细节。',
];
const APPEARANCE_RULE = '外貌特征只维护已确认、稳定且具有辨识度的可观察外形事实；保留能够形成完整人物印象的整体体态、主要外貌特征和持久细节，合并重复、同义及冗余修饰。外貌形成原因、过往经历、性格评价、临时神态与动作不混入此栏。表达按整体轮廓→主要特征→辨识细节组织，在保留有效信息和人物辨识度的前提下适度提炼，使描述紧凑、自然、便于快速阅读。';
const OLD_ABILITY_RULES = [
    '角色状态表中，“技能/术法”记录已经掌握、可具体调用或施展的本领、技艺、功法或术法；“擅长”记录长期稳定的能力方向、熟练领域与优势倾向。两者可以同时存在：前者写具体表现，后者写能力方向；只有完全同义且没有层级区别时才避免机械重复。',
];
const ABILITY_RULE = '角色状态表中，“技能/术法”记录已经明确学习并掌握、具有相对独立技法形态、可作为具体招式、功法、术法、技艺或技能被施展或调用的能力，回答“具体掌握了什么技法”；“擅长”记录人物长期稳定的能力领域、熟练事项与优势，回答“在哪些事情上有能力或更熟练”。判断依据是信息层级而不是措辞：仅说明会做某类事情、具备某类生活、职业、生产、知识或身体能力，尚未明确到具体技法或独立技能形态时，归入“擅长”；明确到某项可单独掌握、训练、施展或调用的具体技法时，归入“技能/术法”。同一领域可以同时存在擅长方向和其中的具体技能，按层级分别记录，不机械互斥。维护时若发现既有内容放错栏，应按此边界迁移、合并并去重。';
const OLD_TABLE_RULES = [
    '七表遵循“每条事实先确定唯一主位置”的原则：表0只保存玩家下次输入前的最终场景快照；表1只保存玩家本人当前状态与稳定能力；表2只保存玩家当前实际持有物；表3只保存尚未结束的任务、承诺、交易或约定；表4只保存NPC稳定身份、关系、外貌、性格及长期识别信息；表5只保存NPC最新发展锚点，其中“主要能力”只写人物实际能力，“当前状态”只写当前处境或状态，“主要目标/重要事项”只写当前目标或需持续追踪的事项，不把身份、关系、产业、职责、性格、履历或单纯名望塞入这些字段；表6只追加已发生且会影响未来的重要历史节点，时间写实际时间或时期，结果写该事件造成的明确后果，不用当前评价或人物简介代替。若同一事实已有专门字段或专门表作为主位置，其他位置只保留必要关联，不整句重复搬运；整理时发现错栏或跨表重复，应迁回主位置并合并去重，同时保留有效信息。表格记录事实而不是文风：比喻、氛围、主观观感和一时表情动作，不自动升级为持久事实；只有表0需要按最终场景保留当下落点。',
];
const TABLE_RULE = '七表遵循“每条事实先确定唯一主位置”的原则：先判断事实属于场景快照、玩家资料/状态、当前持有物、未结束事项、NPC稳定识别信息、NPC最新发展锚点还是重要既成历史，再写入对应主位置；同一事实已有专门字段或专门表时，其他位置只保留必要关联，不整句重复搬运。表0保存玩家下次输入前的最终场景快照；表1保存玩家本人当前状态、稳定能力与持续可识别资料；表2保存玩家当前实际持有物；表3保存尚未结束的任务、承诺、交易或约定；表4保存NPC稳定身份、关系、外貌、性格及长期识别信息；表5保存NPC最新发展锚点，其中“主要能力”写实际能力，“当前状态”写当前处境或状态，“主要目标/重要事项”写当前目标或需持续追踪事项；表6保存已发生且会影响未来的重要历史节点。维护时按事实性质判断主位置，发现错栏或跨表重复就迁回主位置并合并去重，同时保留有效信息。表格记录可确认事实而不是叙事文风；一段话中同时包含多类信息时应拆分判断，而不是整句搬入某个字段。';
const UPDATE_RULE = '更新方式按数据性质判断，而不是给每个字段死记一种操作：当前值发生变化时覆盖为最新值；持续能力、身份/所属、别名/称号、外貌等稳定资料以合并维护为主，同一事实被更准确地细化、替代或纠正时更新原内容；独立对象按新增、变化、失效分别insert/update/delete；历史事件以追加为主，只在重复或明确错误时合并、纠正或删除。';

function replaceOldRules(value) {
    let text = String(value ?? '');
    for (const oldRule of OLD_APPEARANCE_RULES) {
        if (text.includes(oldRule)) text = text.replaceAll(oldRule, APPEARANCE_RULE);
    }
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
        console.log('[Memo-N][field-semantics] 已升级手动更新默认提示：按字段判断方法归类事实');
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
        console.log('[Memo-N][field-semantics] 已给正常记录补充通用字段判断方法');
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
        ['外貌判断方法', APPEARANCE_RULE],
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
    console.log('[Memo-N] 七表字段语义规则已加载：按事实性质判断主位置，外貌保留完整人物印象并适度提炼表达');
}

install();

export { RULE, APPEARANCE_RULE, ABILITY_RULE, TABLE_RULE, UPDATE_RULE, STEP_MARKER, upgradeDefaultStepPrompt, upgradeBaseMessagePrompt };
