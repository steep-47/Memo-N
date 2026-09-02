import { defaultSettings } from '../../data/pluginSetting.js';
import applicationFunctionManager from '../../services/appFuncManager.js';

defaultSettings.table_cell_width_mode ??= 'wide1_2_cell';

const STANDARD_NAMES = ['时空表格','角色特征表格','角色与社交表格','任务、命令或者约定表格','重要事件历史表格','重要物品表格'];
const LEGACY_SEVEN_NAMES = new Set(['当前状态表','角色状态表','背包表','当前任务与约定表','人物主表','人物发展表','历史事件表','人物表']);
const STEP_MARKER = '[Memo当前表格独立记录v6]';
const CURRENT_OLD_MARKERS = [
    '[Memo当前表格独立记录v5]',
    '六张表维护对后续仍有用的事实状态与重要记忆，不是关键词出现日志',
    '只记录本轮最终正文已经明确发生或确认的变化；已有对象优先update，禁止重复insert',
];

function clone(value) {
    if (value === null || typeof value !== 'object') return value;
    try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value)); }
}

function isKnownGeneratedPrompt(text) {
    const value = String(text || '');
    return value.includes('## 表格：0当前状态 / 1角色状态 / 2背包 / 3当前任务与约定 / 4人物主表 / 5人物发展表 / 6历史事件')
        || value.includes('[Memo七表独立记录v4]')
        || value.includes('[Memo七表独立记录v3]')
        || value.includes('[Memo七表整理v3]')
        || value.includes('[Memo七表整理v2]')
        || value.includes('只根据已确认事实维护现有七张表')
        || value.includes('按0当前状态→1角色状态→2背包→3任务约定→4人物主表→5人物发展表→6历史事件')
        || CURRENT_OLD_MARKERS.some(marker => value.includes(marker));
}

function normalizeTableStructure(store) {
    const current = Array.isArray(store.tableStructure) ? store.tableStructure : [];
    const defaults = defaultSettings.tableStructure.map(item => clone(item));
    const byName = new Map();
    for (const item of current) {
        const name = String(item?.tableName || '').trim();
        if (!name || byName.has(name)) continue;
        byName.set(name, item);
    }

    const standard = defaults.map((definition, index) => {
        const existing = byName.get(definition.tableName);
        const preserved = existing ? clone(existing) : {};
        delete preserved.tableName;
        delete preserved.tableIndex;
        delete preserved.columns;
        delete preserved.note;
        delete preserved.initNode;
        delete preserved.insertNode;
        delete preserved.updateNode;
        delete preserved.deleteNode;
        return {
            ...clone(definition),
            ...preserved,
            tableName: definition.tableName,
            tableIndex: index,
            columns: clone(definition.columns),
            note: definition.note,
            initNode: definition.initNode,
            insertNode: definition.insertNode,
            updateNode: definition.updateNode,
            deleteNode: definition.deleteNode,
        };
    });

    const custom = [];
    const seen = new Set(STANDARD_NAMES);
    for (const item of current) {
        const name = String(item?.tableName || '').trim();
        if (!name || seen.has(name) || LEGACY_SEVEN_NAMES.has(name)) continue;
        seen.add(name);
        custom.push({ ...clone(item), tableIndex: STANDARD_NAMES.length + custom.length });
    }

    const next = [...standard, ...custom];
    if (JSON.stringify(next) === JSON.stringify(current)) return false;
    store.tableStructure = next;
    return true;
}

function migrateKnownGeneratedPrompts(store) {
    let changed = false;
    for (const key of [
        'message_template',
        'step_by_step_user_prompt',
        'refresh_system_message_template',
        'refresh_user_message_template',
        'rebuild_default_system_message_template',
        'rebuild_default_message_template',
    ]) {
        if (!String(store[key] || '').trim() || isKnownGeneratedPrompt(store[key])) {
            if (store[key] !== defaultSettings[key]) {
                store[key] = clone(defaultSettings[key]);
                changed = true;
            }
        }
    }
    return changed;
}

try {
    const root = applicationFunctionManager.power_user;
    if (root) {
        if (!root.memo_n_settings || typeof root.memo_n_settings !== 'object') root.memo_n_settings = {};
        const store = root.memo_n_settings;
        let changed = false;

        for (const [key, value] of Object.entries(defaultSettings)) {
            if (!(key in store)) {
                store[key] = clone(value);
                changed = true;
            }
        }

        if (!Object.prototype.hasOwnProperty.call(store, 'independent_record_api_enabled')) {
            store.independent_record_api_enabled = store.step_by_step === true;
            changed = true;
        }

        changed = normalizeTableStructure(store) || changed;
        changed = migrateKnownGeneratedPrompts(store) || changed;

        if (store.step_by_step !== false) {
            store.step_by_step = false;
            changed = true;
        }
        if ('step_by_step_use_main_api' in store) { delete store.step_by_step_use_main_api; changed = true; }
        if ('use_main_api' in store) { delete store.use_main_api; changed = true; }

        if (changed) applicationFunctionManager.saveSettingsDebounced?.();
        console.log(`[Memo-N][settings] 当前表格设置已归一：标准表=${STANDARD_NAMES.length}｜独立协议=${STEP_MARKER}`);
    }
} catch (error) {
    console.warn('[Memo-N][settings] 当前六表设置归一失败，保留原设置继续加载', error);
}

export const STEP_BY_STEP_PROMPT = defaultSettings.step_by_step_user_prompt;
export const REBUILD_SYSTEM_PROMPT = defaultSettings.rebuild_default_system_message_template;
export const REBUILD_USER_PROMPT = defaultSettings.rebuild_default_message_template;
export const REFRESH_SYSTEM_PROMPT = defaultSettings.refresh_system_message_template;
export const REFRESH_USER_PROMPT = defaultSettings.refresh_user_message_template;
