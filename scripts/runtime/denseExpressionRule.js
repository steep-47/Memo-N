import { EDITOR, USER } from '../../core/manager.js';
import LLMApiService from '../../services/llmApi.js';

const PATCH_MARK = '__memoNDenseExpressionRuleV2';
const OLD_STEP_MARKERS = [
    '[Memo七表独立记录v4-记录优先]',
    '[Memo七表独立记录v5-完整但不摘抄]',
];
const STEP_MARKER = '[Memo七表独立记录v6-能力字段分层]';
const CLEANUP_MARKER = 'Memo世界状态表格整理器';
const RULE = '长文本字段应在不损失有效细节的前提下提炼表达。保留人物辨识度、位置、程度、状态、条件和关系等有用信息，合并重复与同义内容，去掉冗长叙述和无必要修辞；优先改写为紧凑、自然、信息密度高的描述，不为缩短而过度概括，也不削弱原本的表达力度。';
const ABILITY_RULE = '角色状态表中，“技能/术法”记录已经掌握、可具体调用或施展的本领、技艺、功法或术法；“擅长”记录长期稳定的能力方向、熟练领域与优势倾向。两者可以同时存在：前者写具体表现，后者写能力方向；只有完全同义且没有层级区别时才避免机械重复。';

function upgradeDefaultStepPrompt(value) {
    let text = String(value ?? '');
    if (!text) return text;
    const recognized = OLD_STEP_MARKERS.some(marker => text.includes(marker)) || text.includes(STEP_MARKER);
    if (!recognized) return text;
    for (const marker of OLD_STEP_MARKERS) text = text.replaceAll(marker, STEP_MARKER);

    const anchor = '表5字段“年龄”和“最后确认时间”必须分开：年龄是人物属性，最后确认时间是该发展锚点最后被剧情确认的世界时间；未知分别留空。';
    const outputAnchor = '只输出一个<tableEdit><!-- 函数调用 --></tableEdit>';
    const additions = [];
    if (!text.includes(RULE)) additions.push(RULE);
    if (!text.includes(ABILITY_RULE)) additions.push(ABILITY_RULE);
    if (!additions.length) return text;
    const extra = additions.join('');

    if (text.includes(anchor)) return text.replace(anchor, `${anchor}${extra}`);
    if (text.includes(outputAnchor)) return text.replace(outputAnchor, `${extra}${outputAnchor}`);
    return text;
}

function upgradeBaseMessagePrompt(value) {
    const text = String(value ?? '');
    if (!text || !text.includes('# dataTable 世界状态记忆') || text.includes(ABILITY_RULE)) return text;
    const section = `# 玩家能力字段\n- ${ABILITY_RULE}\n`;
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
        console.log('[Memo-N][field-semantics] 已升级手动更新默认提示：完整记录并区分技能与擅长');
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
        console.log('[Memo-N][field-semantics] 已给正常记录补充技能/术法与擅长的字段边界');
    }

    const defaultBase = USER.tableBaseDefaultSettings?.message_template;
    const upgradedDefaultBase = upgradeBaseMessagePrompt(defaultBase);
    if (upgradedDefaultBase && upgradedDefaultBase !== defaultBase) {
        USER.tableBaseDefaultSettings.message_template = upgradedDefaultBase;
    }

    if (changed) USER.saveSettings?.();
}

function appendCleanupRules(text) {
    let source = String(text ?? '');
    if (!source) return source;
    const additions = [];
    if (!source.includes(RULE)) additions.push(`[长文本字段表达]\n${RULE}`);
    if (!source.includes(ABILITY_RULE)) additions.push(`[角色能力字段]\n${ABILITY_RULE}`);
    if (!additions.length) return source;
    return `${source.trimEnd()}\n\n${additions.join('\n\n')}`;
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
    console.log('[Memo-N] 表格表达与能力字段规则已加载：保留细节，并区分具体技能与能力方向');
}

install();

export { RULE, ABILITY_RULE, STEP_MARKER, upgradeDefaultStepPrompt, upgradeBaseMessagePrompt };
