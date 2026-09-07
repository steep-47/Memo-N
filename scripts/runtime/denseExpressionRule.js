import { EDITOR, USER } from '../../core/manager.js';
import LLMApiService from '../../services/llmApi.js';

const PATCH_MARK = '__memoNDenseExpressionRuleV1';
const OLD_STEP_MARKER = '[Memo七表独立记录v4-记录优先]';
const STEP_MARKER = '[Memo七表独立记录v5-完整但不摘抄]';
const CLEANUP_MARKER = 'Memo世界状态表格整理器';
const RULE = '长文本字段应在不损失有效细节的前提下提炼表达。保留人物辨识度、位置、程度、状态、条件和关系等有用信息，合并重复与同义内容，去掉冗长叙述和无必要修辞；优先改写为紧凑、自然、信息密度高的描述，不为缩短而过度概括，也不削弱原本的表达力度。';

function upgradeDefaultStepPrompt(value) {
    let text = String(value ?? '');
    if (!text || (!text.includes(OLD_STEP_MARKER) && !text.includes(STEP_MARKER))) return text;
    text = text.replaceAll(OLD_STEP_MARKER, STEP_MARKER);
    if (text.includes(RULE)) return text;

    const anchor = '表5字段“年龄”和“最后确认时间”必须分开：年龄是人物属性，最后确认时间是该发展锚点最后被剧情确认的世界时间；未知分别留空。';
    if (text.includes(anchor)) return text.replace(anchor, `${anchor}${RULE}`);

    const outputAnchor = '只输出一个<tableEdit><!-- 函数调用 --></tableEdit>';
    if (text.includes(outputAnchor)) return text.replace(outputAnchor, `${RULE}${outputAnchor}`);
    return text;
}

function installStepPromptRule() {
    const current = USER.tableBaseSetting?.step_by_step_user_prompt;
    const upgraded = upgradeDefaultStepPrompt(current);
    if (upgraded && upgraded !== current) {
        USER.tableBaseSetting.step_by_step_user_prompt = upgraded;
        USER.saveSettings?.();
        console.log('[Memo-N][dense-expression] 已升级手动更新默认提示：完整记录，但避免正文式摘抄');
    }

    const defaultPrompt = USER.tableBaseDefaultSettings?.step_by_step_user_prompt;
    const upgradedDefault = upgradeDefaultStepPrompt(defaultPrompt);
    if (upgradedDefault && upgradedDefault !== defaultPrompt) {
        USER.tableBaseDefaultSettings.step_by_step_user_prompt = upgradedDefault;
    }
}

function appendCleanupRule(text) {
    const source = String(text ?? '');
    if (!source || source.includes(RULE)) return source;
    return `${source.trimEnd()}\n\n[长文本字段表达]\n${RULE}`;
}

function patchEditorGenerateRaw() {
    if (typeof EDITOR.generateRaw !== 'function' || EDITOR.generateRaw[PATCH_MARK]) return;
    const original = EDITOR.generateRaw;
    const wrapped = async function (...args) {
        const request = args?.[0];
        if (request && typeof request === 'object' && String(request.systemPrompt ?? '').includes(CLEANUP_MARKER)) {
            args[0] = { ...request, prompt: appendCleanupRule(request.prompt) };
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
                args[0] = appendCleanupRule(args[0]);
            } else if (Array.isArray(args[0])) {
                const messages = args[0].map(item => ({ ...item }));
                for (let i = messages.length - 1; i >= 0; i--) {
                    if (messages[i]?.role === 'user' && typeof messages[i]?.content === 'string') {
                        messages[i].content = appendCleanupRule(messages[i].content);
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
    installStepPromptRule();
    patchEditorGenerateRaw();
    patchCustomApi();
    console.log('[Memo-N] 长文本高信息密度表达规则已加载：保留细节，不做过激压缩');
}

install();

export { RULE, STEP_MARKER, upgradeDefaultStepPrompt };
