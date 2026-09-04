import fs from 'node:fs/promises';

let source = await fs.readFile(new URL('../scripts/runtime/settingsBootstrap.js', import.meta.url), 'utf8');
source = source
    .replace("import { defaultSettings } from '../../data/pluginSetting.js';", 'const { defaultSettings } = globalThis.__memoNBootstrapMocks;')
    .replace("import applicationFunctionManager from '../../services/appFuncManager.js';", 'const { applicationFunctionManager } = globalThis.__memoNBootstrapMocks;');

const oldMemo = {
    message_template: '原Memo提示词',
    pinned_character_names: ['原人物'],
    sentinel: { keep: true },
};
const root = {
    muyoo_dataTable: structuredClone(oldMemo),
    table_database_templates: [{ uid: 'old-template' }],
    table_selected_sheets: ['old-template'],
    IMPORTANT_USER_PRIVACY_DATA: { custom_api_key: 'old-secret' },
};
const before = structuredClone(root);
const defaultSettings = {
    message_template: '# Memo-N\n# 输出\nMemo-N会在最终请求阶段提供唯一的一次API记录协议',
    independent_record_api_enabled: false,
    step_by_step_user_prompt: "[{role:'system',content:'$0 $2 $3 $4 [Memo七表独立记录v3]'}]",
    rebuild_default_system_message_template: '',
    rebuild_default_message_template: '',
    lastSelectedTemplate: 'rebuild_base',
    step_by_step: false,
};
let saves = 0;
globalThis.__memoNBootstrapMocks = {
    defaultSettings,
    applicationFunctionManager: { power_user: root, saveSettingsDebounced: () => { saves += 1; } },
};

await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#memo-n-fresh-install`);

for (const key of ['muyoo_dataTable', 'table_database_templates', 'table_selected_sheets', 'IMPORTANT_USER_PRIVACY_DATA']) {
    if (JSON.stringify(root[key]) !== JSON.stringify(before[key])) throw new Error(`Memo-N首次启动修改了原插件数据：${key}`);
}
if (!root.memo_n_settings || root.memo_n_settings.message_template !== defaultSettings.message_template) throw new Error('Memo-N未建立独立默认设置');
if (root.memo_n_settings.message_template === root.muyoo_dataTable.message_template) throw new Error('Memo-N错误复用了原Memo提示词');
if (root.memo_n_settings.independent_record_api_enabled !== false || root.memo_n_settings.record_mode_single_api_v71 !== true) throw new Error('Memo-N新安装未默认启用单次API记录');
if (saves !== 1) throw new Error('Memo-N首次启动设置保存次数异常');

const existingRoot = { memo_n_settings: { message_template: '用户现有设置', independent_record_api_enabled: true, record_mode_independent_v70: true } };
globalThis.__memoNBootstrapMocks = {
    defaultSettings,
    applicationFunctionManager: { power_user: existingRoot, saveSettingsDebounced() {} },
};
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#memo-n-v71-migration`);
if (existingRoot.memo_n_settings.independent_record_api_enabled !== false || existingRoot.memo_n_settings.record_mode_single_api_v71 !== true) {
    throw new Error('Memo-N未把v70独立记录设置迁移回单次API');
}

const optedInRoot = { memo_n_settings: { message_template: '用户现有设置', independent_record_api_enabled: true, record_mode_single_api_v71: true } };
globalThis.__memoNBootstrapMocks = {
    defaultSettings,
    applicationFunctionManager: { power_user: optedInRoot, saveSettingsDebounced() {} },
};
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#memo-n-v71-opt-in`);
if (optedInRoot.memo_n_settings.independent_record_api_enabled !== true) throw new Error('Memo-N重复迁移覆盖了用户后续手动选择');

console.log('memo-n-fresh-install PASS: old-settings-preserved=1, old-templates-preserved=1, old-secrets-preserved=1, one-call-default=1, v70-migration=1, later-opt-in-preserved=1');
