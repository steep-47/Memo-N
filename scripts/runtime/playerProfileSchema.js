import { BASE, USER } from '../../core/manager.js';
import { defaultSettings } from '../../data/pluginSetting.js';
import { repairMissingColumnsBeforeCleanup } from './tableStructureRepair.js?v=memon20';

// 物理列保持既有索引稳定，只在末尾增加新字段；手机展示层由 pinchZoom.js 按信息密度重排。
const PLAYER_COLUMNS = [
    '姓名','性别','种族','年龄','修为','灵根/体质','灵力','神识','身体状态',
    '灵石','钱财','技能/术法','擅长','其他状态','外貌特征','身份/所属','别名/称号',
];

const PLAYER_NOTE = '<user>/玩家本人专属实时状态表，只允许一行；钱财/灵石保存货币余额，灵力/神识/身体状态/其他状态保存持续资源与生效状态；技能/术法与擅长按能力层级区分；身份/所属保存已确认的当前稳定身份、组织或势力归属；别名/称号保存已确认的别名、化名、道号、称号等持续可识别称谓；外貌特征保存已确认的稳定外观和持久变化；数字0也是有效值；“修为”保留玩家原生体系表达';
const PLAYER_INIT = '首次得到玩家明确状态时插入；已有玩家行存在空字段且当前上下文能确认现值时补齐；钱财、状态、能力、身份/所属、别名/称号和外貌等已确认信息都应按字段职责核对';
const PLAYER_UPDATE = '仅更新<user>/玩家本人；当前余额、持续资源与生效状态按最新值维护；技能/术法、擅长、身份/所属、别名/称号和外貌等持续信息按事实合并、细化或纠正；空字段按已确认现值补齐；普通物品不写入本表';

function clone(value) {
    if (value === null || typeof value !== 'object') return value;
    try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value)); }
}

function patchRoleStructure(settings) {
    const list = settings?.tableStructure;
    if (!Array.isArray(list)) return false;
    const role = list.find(item => item?.tableName === '角色状态表' || Number(item?.tableIndex) === 1);
    if (!role) return false;
    let changed = false;
    if (JSON.stringify(role.columns || []) !== JSON.stringify(PLAYER_COLUMNS)) {
        role.columns = [...PLAYER_COLUMNS];
        changed = true;
    }
    for (const [key, value] of Object.entries({ note: PLAYER_NOTE, initNode: PLAYER_INIT, updateNode: PLAYER_UPDATE })) {
        if (role[key] !== value) {
            role[key] = value;
            changed = true;
        }
    }
    return changed;
}

function patchAllSettings() {
    let changed = false;
    changed = patchRoleStructure(defaultSettings) || changed;
    changed = patchRoleStructure(USER.tableBaseDefaultSettings) || changed;
    changed = patchRoleStructure(USER.tableBaseSetting) || changed;
    if (changed) USER.saveSettings?.();
    return changed;
}

function roleNeedsRepair() {
    const sheet = (BASE.getChatSheets?.() || []).find(item => item?.name === '角色状态表');
    if (!sheet) return false;
    const headers = (sheet.getHeader?.() || []).map(value => String(value ?? '').trim());
    return !PLAYER_COLUMNS.every(header => headers.includes(header));
}

let running = false;
function ensureCurrentPlayerSchema() {
    if (running) return false;
    const piece = USER.getChatPiece?.()?.piece;
    if (!piece) return false;
    const settingsChanged = patchAllSettings();
    if (!settingsChanged && !roleNeedsRepair()) return false;
    running = true;
    try {
        const repaired = repairMissingColumnsBeforeCleanup({ notify: false, piece, syncSnapshot: true }) || [];
        if (repaired.some(item => item?.tableName === '角色状态表')) {
            console.log('[Memo-N][player-profile] 已补齐玩家身份/所属、别名/称号字段并保留原数据');
        }
        return repaired.length > 0;
    } catch (error) {
        console.warn('[Memo-N][player-profile] 玩家角色状态表结构升级失败', error);
        return false;
    } finally {
        running = false;
    }
}

let queued = false;
function queueEnsure() {
    if (queued) return;
    queued = true;
    setTimeout(() => {
        queued = false;
        ensureCurrentPlayerSchema();
    }, 80);
}

patchAllSettings();
ensureCurrentPlayerSchema();
queueMicrotask(queueEnsure);
setTimeout(queueEnsure, 300);

// SillyTavern 切换聊天时 #chat 的直接子节点会整体变化；此处只做缺列检查，已升级后为零写入。
const chat = document.querySelector('#chat');
if (chat) new MutationObserver(queueEnsure).observe(chat, { childList: true });

document.addEventListener('click', event => {
    if (event.target?.closest?.('#trigger_step_by_step_button, #table_clear_up')) ensureCurrentPlayerSchema();
}, true);

console.log('[Memo-N] 玩家资料结构已加载：新增身份/所属与别名/称号，旧列索引保持稳定');

export { PLAYER_COLUMNS, PLAYER_NOTE, ensureCurrentPlayerSchema, patchRoleStructure };
