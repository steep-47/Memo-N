import { defaultSettings } from '../../data/pluginSetting.js';
import applicationFunctionManager from '../../services/appFuncManager.js';

defaultSettings.table_cell_width_mode ??= 'wide1_2_cell';

const STEP_PROMPT_MARKER = '[Memo七表独立记录v4]';
const STEP_BY_STEP_PROMPT = `[
  { role: 'system', content: '${STEP_PROMPT_MARKER} 你是世界状态记忆维护器。只维护表格，不输出剧情正文。只依据已确认事实，不猜测未知。表4人物主表负责NPC身份识别；表5人物发展表负责最新发展锚点；表6历史事件表只保存重大既成节点。这里只规定记录语义，不规定最终机器传输格式；最终格式只服从本轮请求末尾由Memo-N按“记录接口”注入的唯一协议。' },
  { role: 'user', content: '<已有七表>\\n$0\\n</已有七表>\\n<最近上下文>\\n$1\\n</最近上下文>\\n<本轮内容>\\n$2\\n</本轮内容>\\n<操作规则>\\n$3\\n</操作规则>\\n<世界书参考>\\n$4\\n</世界书参考>\\n逐表检查0→1→2→3→4→5→6。已有对象优先update，新对象才insert，明确失效按规则delete。表5字段“年龄”和“最后确认时间”必须分开：年龄是人物属性，最后确认时间是该发展锚点最后被剧情确认的世界时间；未知分别留空。不要自行指定JSON、tableEdit、函数文本或其他输出协议；最终机器格式只服从本轮最后的Memo-N记录接口协议。' }
]`;
defaultSettings.step_by_step_user_prompt = STEP_BY_STEP_PROMPT;

if (Array.isArray(defaultSettings.tableStructure)) {
    const dev = defaultSettings.tableStructure.find(item => item?.tableName === '人物发展表');
    if (dev) {
        dev.columns = ['姓名','修为','主要能力','当前地点','年龄','最后确认时间','当前状态','主要目标/重要事项'];
        dev.note = 'NPC专属最新发展锚点表；年龄与最后确认时间分列；同一NPC一行；只保存最后有效状态，不记录离线流水账';
        dev.updateNode = '新确认的修为/能力/地点/年龄/最后确认时间/重要状态/目标只更新对应字段；年龄与最后确认时间不得混写';
    }
    for (const table of defaultSettings.tableStructure) if (table.tochat === undefined && table.toChat !== undefined) table.tochat = table.toChat;
}

const TRANSPORT_NEUTRAL_OPERATIONS = `# 记录动作语义
- insert：当前表中没有该对象/事实且本轮首次明确确认时新增。
- update：只更新当前表中真实存在的rowIndex；不得把不存在的row当成新增。
- delete：只删除当前表中真实存在且已明确失效/消失的rowIndex。
- 这里只定义记录语义，不定义本轮传输语法；最终JSON或tableEdit格式只服从请求末尾由Memo-N记录引擎注入的唯一协议。`;
const TRANSPORT_NEUTRAL_OUTPUT = `# 输出
- 本段只规定“应记录哪些事实”，不规定最终机器传输格式。
- 最终传输格式只服从本轮请求末尾由Memo-N记录引擎注入的唯一记录协议；不得自行混用JSON、tableEdit或其他格式。
- 日期、时间、地点、当前场景人物任一发生变化（包括“日影移动”“日头升高”“片刻后”“随后”等明确时间推进）时必须维护表0；七表均无变化时按最终协议表示“无变化”。`;

function normalizeBaseTablePrompt(template) {
    let source = String(template || '').replace(/年龄或最后确认时间/g, '年龄、最后确认时间').replace(/年龄\/最后确认时间/g, '年龄、最后确认时间');
    if (!source.includes('# dataTable 世界状态记忆')) return source;
    if (source.includes('# 操作') && source.includes('# 总原则')) source = source.replace(/# 操作[\s\S]*?(?=# 总原则)/, `${TRANSPORT_NEUTRAL_OPERATIONS}\n`);
    else if (!source.includes('# 记录动作语义') && source.includes('# 总原则')) source = source.replace('# 总原则', `${TRANSPORT_NEUTRAL_OPERATIONS}\n# 总原则`);
    if (source.includes('# 输出')) source = `${source.split('# 输出')[0].trimEnd()}\n${TRANSPORT_NEUTRAL_OUTPUT}`.trim();
    else source = `${source.trimEnd()}\n${TRANSPORT_NEUTRAL_OUTPUT}`.trim();
    return source;
}
defaultSettings.message_template = normalizeBaseTablePrompt(defaultSettings.message_template);

const REBUILD_MARKER = '[Memo七表整理v3]';
const REBUILD_SYSTEM_PROMPT = `${REBUILD_MARKER}\n你是Memo世界状态表格整理器。只整理现有七张表，不写剧情，不猜测未知，不模拟NPC离线生活。表头结构由代码维护，不得创建、删除、改名或重排标准列。人物主表负责NPC身份识别，人物发展表保存NPC最后有效发展锚点，历史表只保存影响未来推演的重要既成节点。这里只规定整理语义，不规定最终机器传输格式；最终JSON或tableEdit协议只服从Memo-N当前“记录接口”在请求末尾注入的唯一协议。`;
const REBUILD_USER_PROMPT = `<当前表格>\n$0\n</当前表格>\n<聊天记录>\n$1\n</聊天记录>\n<固定表头>\n$2\n</固定表头>\n<附加要求>\n$3\n</附加要求>\n按0当前状态→1角色状态→2背包→3任务约定→4人物主表→5人物发展表→6历史事件逐表检查重复、过期、错位和应合并的数据。已有对象优先update，真正新增才insert，明确失效才delete。#0最多一行；#1只保存玩家本人；#2只保存当前实际持有库存；#3只保存未结束事项；#4/#5同一NPC各一行并通过姓名关联；#5年龄与最后确认时间分别维护；#6只保存影响未来推演的重要节点。不要自行指定JSON、tableEdit、函数文本、<新的表格>或完整重建格式；最终机器格式只服从Memo-N当前记录接口协议。`;
defaultSettings.rebuild_default_system_message_template = REBUILD_SYSTEM_PROMPT;
defaultSettings.rebuild_default_message_template = REBUILD_USER_PROMPT;

const REFRESH_SYSTEM_PROMPT = `你是世界状态表格整理助手。只根据已确认事实维护现有七张表。优先更新已有行，不写流水账，不猜测未知。人物主表保存NPC识别信息以及已确认的种族/血脉、修炼体系/路径；人物发展表保存最新发展锚点，其中“修为”必须保留角色自身体系的原生境界文本，禁止换算成人族境界；年龄与最后确认时间分开维护；历史表只保存影响未来推演的重要节点。这里只规定整理语义，不指定机器传输格式；最终格式服从Memo-N当前“记录接口”的唯一协议。`;
const REFRESH_USER_PROMPT = `<聊天记录>\n$1\n</聊天记录>\n<当前表格>\n$0\n</当前表格>\n<表头信息>\n$2\n</表头信息>\n按0当前状态→1角色状态→2背包→3任务约定→4人物主表→5人物发展表→6历史事件检查。同一对象已有行优先update；人物主表保存NPC种族/血脉与修炼体系/路径等稳定事实；人物发展表“修为”只记录其原生体系境界，不把战力对应换算成人族境界；重要节点才写历史；不猜测未知。不要自行指定JSON、tableEdit或函数文本；最终机器格式只服从Memo-N当前记录接口协议。`;
defaultSettings.refresh_system_message_template = REFRESH_SYSTEM_PROMPT;
defaultSettings.refresh_user_message_template = REFRESH_USER_PROMPT;
delete defaultSettings.step_by_step_use_main_api;
delete defaultSettings.use_main_api;

function clone(value) {
    if (value === null || typeof value !== 'object') return value;
    try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value)); }
}

function isKnownOldMemoRebuildPrompt(systemPrompt, userPrompt) {
    const system = String(systemPrompt || '');
    const user = String(userPrompt || '');
    if (!system.trim()) return true;
    if (system.includes(REBUILD_MARKER)) return false;
    return system.includes('[Memo六表整理')
        || system.includes('[Memo七表整理v1]')
        || system.includes('[Memo七表整理v2]')
        || system.includes('返回七张表整理后的最终状态')
        || system.includes('完整七表最终JSON数组')
        || system.includes('memo-six-table-final-state')
        || system.includes('返回六张表整理完成后的最终状态')
        || system.includes("role: 'system'")
        || (system.trim().startsWith('[') && system.includes('$0') && system.includes('$2'))
        || (!user.trim() && system.includes('六张表'));
}

function needsStepPromptUpgrade(value) {
    const text = String(value || '').trim();
    if (!text) return true;
    if (text.includes(STEP_PROMPT_MARKER)) return false;
    if (text.includes('[Memo七表独立记录v3]')) return true;
    if (!text.startsWith('[') || !text.includes('role') || !text.includes('content')) return true;
    if (!text.includes('$0') || !text.includes('$2') || !text.includes('$3') || !text.includes('$4')) return true;
    if (/<tableEdit>|MEMO_N_EDIT_BEGIN|"reply"\s*:|"changes"\s*:/.test(text)) return true;
    return text.includes('逐表检查0到5') || text.includes('六张表');
}
function needsRefreshPromptUpgrade(systemPrompt, userPrompt) {
    const text = `${String(systemPrompt || '')}\n${String(userPrompt || '')}`;
    return /<tableEdit>|MEMO_N_EDIT_BEGIN|只输出JSON|只能输出JSON|函数放在/.test(text);
}

try {
    const root = applicationFunctionManager.power_user;
    if (root) {
        if (!root.memo_n_settings || typeof root.memo_n_settings !== 'object') root.memo_n_settings = {};
        const store = root.memo_n_settings;
        for (const [key, value] of Object.entries(defaultSettings)) if (!(key in store)) store[key] = clone(value);

        if (!Object.prototype.hasOwnProperty.call(store, 'independent_record_api_enabled')) {
            store.independent_record_api_enabled = store.step_by_step === true;
            console.log(`[Memo-N][settings] 已迁移旧填表时机：${store.independent_record_api_enabled ? '收到消息后独立记录' : '聊天同时填表'}`);
        }
        const normalizedMessageTemplate = normalizeBaseTablePrompt(store.message_template);
        if (normalizedMessageTemplate !== store.message_template) {
            store.message_template = normalizedMessageTemplate;
            console.log('[Memo-N][settings] 已把基础七表提示归一为传输格式中立；最终格式只由记录引擎决定');
        }
        if (needsStepPromptUpgrade(store.step_by_step_user_prompt)) {
            store.step_by_step_user_prompt = STEP_BY_STEP_PROMPT;
            console.log('[Memo-N][settings] 已升级独立记录模板为传输格式中立v4');
        }
        if (needsRefreshPromptUpgrade(store.refresh_system_message_template, store.refresh_user_message_template)) {
            store.refresh_system_message_template = REFRESH_SYSTEM_PROMPT;
            store.refresh_user_message_template = REFRESH_USER_PROMPT;
            console.log('[Memo-N][settings] 已清理旧整理模板中的固定协议残留');
        }
        if (isKnownOldMemoRebuildPrompt(store.rebuild_default_system_message_template, store.rebuild_default_message_template)) {
            store.rebuild_default_system_message_template = REBUILD_SYSTEM_PROMPT;
            store.rebuild_default_message_template = REBUILD_USER_PROMPT;
            if (store.lastSelectedTemplate === 'rebuild_base') console.log('[Memo-N][settings] 已升级默认总结模板为严格增量整理v3');
        }

        delete store.step_by_step_use_main_api;
        delete store.use_main_api;
        store.step_by_step = false;
        applicationFunctionManager.saveSettingsDebounced?.();
        console.log('[Memo-N][settings] 七表默认设置、模式迁移与记录模板已归一化');
    }
} catch (error) {
    console.warn('[Memo-N][settings] bootstrap normalization failed:', error);
}

export { REBUILD_SYSTEM_PROMPT, REBUILD_USER_PROMPT, STEP_BY_STEP_PROMPT, REFRESH_SYSTEM_PROMPT, REFRESH_USER_PROMPT };
