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
    message_template: '# Memo-N\n# 输出\nMemo-N会在最终请求阶段提供唯一JSON变更信封',
    step_by_step_user_prompt: "[{role:'system',content:'$0 $2 $3 $4 [Memo七表独立记录v3]'}]",
    rebuild_default_system_message_template: '',
    rebuild_default_message_template: '',
    lastSelectedTemplate: 'rebuild_base',
    step_by_step: false,
    preset_character_policy: 'changes_only',
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
if (!root.memo_n_settings || root.memo_n_settings.preset_character_policy !== 'changes_only') throw new Error('Memo-N未建立独立默认设置');
if (root.memo_n_settings.message_template === root.muyoo_dataTable.message_template) throw new Error('Memo-N错误复用了原Memo提示词');
if (saves !== 1) throw new Error('Memo-N首次启动设置保存次数异常');

// Fresh-load ESM linking guard: index/settings/cleanup all depend on these named exports.
const standalone = await fs.readFile(new URL('../scripts/settings/standaloneAPI.js', import.meta.url), 'utf8');
for (const name of ['ext_getAllTables', 'ext_exportAllTablesAsJson', 'estimateTokenCount', 'updateModelList', 'handleApiTestRequest', 'processApiKey', 'handleCustomAPIRequest', 'handleMainAPIRequest']) {
    if (!new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b`).test(standalone)) throw new Error(`standaloneAPI缺少新鲜加载所需导出：${name}`);
}
const indexText = await fs.readFile(new URL('../index.js', import.meta.url), 'utf8');
if (!indexText.includes('ext_getAllTables, ext_exportAllTablesAsJson')) throw new Error('index公开表格API依赖断言失效');
const settingsText = await fs.readFile(new URL('../scripts/settings/userExtensionSetting.js', import.meta.url), 'utf8');
if (!settingsText.includes('updateModelList, handleApiTestRequest, processApiKey')) throw new Error('设置页standaloneAPI依赖断言失效');
const cleanupText = await fs.readFile(new URL('../scripts/runtime/stableTableCleanup.js', import.meta.url), 'utf8');
if (!cleanupText.includes('estimateTokenCount')) throw new Error('整理器token估算依赖断言失效');

console.log('memo-n-fresh-install PASS: old-settings-preserved=1, old-templates-preserved=1, old-secrets-preserved=1, independent-defaults=1, esm-exports=1');
