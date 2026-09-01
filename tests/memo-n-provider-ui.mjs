import fs from 'node:fs';
import assert from 'node:assert/strict';

const ui = fs.readFileSync(new URL('../scripts/ui/apiModeToggle.js', import.meta.url), 'utf8');
const pinch = fs.readFileSync(new URL('../scripts/ui/pinchZoom.js', import.meta.url), 'utf8');
const simpleCss = fs.readFileSync(new URL('../assets/styles/simple-ui.css', import.meta.url), 'utf8');
const managerTemplate = fs.readFileSync(new URL('../assets/templates/manager.html', import.meta.url), 'utf8');
const template = fs.readFileSync(new URL('../assets/templates/index.html', import.meta.url), 'utf8');
const loader = fs.readFileSync(new URL('../loader.js', import.meta.url), 'utf8');
const modeRuntime = fs.readFileSync(new URL('../scripts/runtime/modeRuntimeControl.js', import.meta.url), 'utf8');
const chatIsolation = fs.readFileSync(new URL('../scripts/runtime/chatSheetIsolation.js', import.meta.url), 'utf8');
const structureRepair = fs.readFileSync(new URL('../scripts/runtime/tableStructureRepair.js', import.meta.url), 'utf8');
const swipeRestore = fs.readFileSync(new URL('../scripts/runtime/swipeSnapshotRestore.js', import.meta.url), 'utf8');
const memoryRules = fs.readFileSync(new URL('../scripts/runtime/memoryContentRules.js', import.meta.url), 'utf8');
const presetBridge = fs.readFileSync(new URL('../scripts/yiyi/yiyiPresetMemoryBridge.js', import.meta.url), 'utf8');
const yiyiRuntime = fs.readFileSync(new URL('../scripts/yiyi/yiyiMemoryRuntime.js', import.meta.url), 'utf8');
const standalone = fs.readFileSync(new URL('../scripts/settings/standaloneAPI.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../scripts/runtime/settingsBootstrap.js', import.meta.url), 'utf8');
const defaults = fs.readFileSync(new URL('../data/pluginSetting.js', import.meta.url), 'utf8');
const cleanup = fs.readFileSync(new URL('../scripts/runtime/stableTableCleanup.js', import.meta.url), 'utf8');
const cleanupBridge = fs.readFileSync(new URL('../scripts/runtime/cleanupButtonBridge.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

assert.match(template, /id="memo-record-provider-route"/u);
assert.match(template, /<option value="deepseek">DeepSeek<\/option>/u);
assert.match(template, /<option value="relay">中转站<\/option>/u);
assert.match(template, /id="fill_table_time"/u);
assert.doesNotMatch(template, /id="memory-independent-record-api"|id="step_by_step_use_main_api"|id="use_main_api"/u);
assert.match(template, /整理请求同样服从上方“记录接口”/u);
assert.match(template, /自定义独立API（中转站）/u);

assert.match(ui, /new MutationObserver\(scheduleMount\)/u);
assert.doesNotMatch(ui, /observer\.disconnect/u);
assert.match(ui, /function bindFillTime\(fillTime\)/u);
assert.match(ui, /fillTime\.value === 'after'/u);
assert.match(ui, /USER\.tableBaseSetting\.step_by_step = false/u);
assert.doesNotMatch(ui, /syncIndependentApiRoute|step_by_step_use_main_api\s*=/u);

const mountBody = ui.match(/function mount\(\) \{([\s\S]*?)\n\}\n\nlet mountQueued/u)?.[1] ?? '';
assert.ok(mountBody);
assert.doesNotMatch(mountBody, /tableBaseSetting\.step_by_step\s*=/u);
assert.match(mountBody, /getManualProviderRoute\(\)/u);
assert.match(mountBody, /syncModeSections\(fillTime\)/u);

assert.match(modeRuntime, /function bridgePromptMode\(\)/u);
assert.match(modeRuntime, /captureGeneration[\s\S]*bridgePromptMode\(\)/u);
assert.match(modeRuntime, /CHAT_COMPLETION_SETTINGS_READY/u);
assert.match(modeRuntime, /settingsReadyEvent[^\n]*forceNormalMode/u);
assert.doesNotMatch(modeRuntime, /makeFirst\(promptEvent|makeLast\(promptEvent|enqueueCurrentVersion|\?v=memon\d+/u);
assert.match(modeRuntime, /result==='stale'[\s\S]*不会自动重试/u);
assert.match(modeRuntime, /liveToken!==job\.token[\s\S]*不自动重算/u);
assert.doesNotMatch(structureRepair, /\?v=memon\d+/u);
assert.doesNotMatch(swipeRestore, /\?v=memon\d+/u, 'Swipe恢复不得绑定旧执行器缓存身份');
assert.doesNotMatch(memoryRules, /preserveSingleApiProtocol/u, '不得继续保留旧固定收尾协议');
assert.match(memoryRules, /stripLegacyFixedProtocol/u);

assert.match(loader, /RUNTIME_VERSION = 'memon89'/u);
assert.match(loader, /PUBLIC_VERSION = '0\.1\.0-memon\.89'/u);
for (const modulePath of [
    './scripts/runtime/chatSheetIsolation.js',
    './scripts/runtime/memoryContentRules.js',
    './scripts/runtime/swipeSnapshotRestore.js',
    './scripts/runtime/legacyEventSafety.js',
    './scripts/runtime/cleanupButtonBridge.js',
    './scripts/ui/personTableSplit.js',
    './scripts/ui/fillStatusColor.js',
    './scripts/ui/pinchZoom.js',
    './scripts/ui/yiyiMemoryPanel.js',
    './scripts/yiyi/yiyiPresetMemoryBridge.js',
    './scripts/yiyi/yiyiMemoryRuntime.js',
]) assert.ok(loader.includes(modulePath), `loader遗漏运行时：${modulePath}`);
assert.match(chatIsolation, /CHAT_CHANGED/u);
assert.match(chatIsolation, /DERIVED\.any\.chatSheetMap = \{\}/u);
assert.match(chatIsolation, /waitingTableIdMap = null/u);
assert.match(loader, /window\.memoN\.VERSION = PUBLIC_VERSION/u);
assert.equal(manifest.version, '0.1.0-memon.89');

for (const name of ['ext_getAllTables','ext_exportAllTablesAsJson','estimateTokenCount','updateModelList']) assert.match(standalone, new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b`));
assert.match(defaults, /\[Memo七表独立记录v4\]/u);
assert.doesNotMatch(defaults, /step_by_step_use_main_api\s*:|use_main_api\s*:/u);
const defaultStep = defaults.match(/step_by_step_user_prompt:[\s\S]*?bool_silent_refresh:/u)?.[0] ?? '';
assert.ok(defaultStep);
assert.doesNotMatch(defaultStep, /最终只输出.*<tableEdit>|"reply"\s*:|"changes"\s*:/u);
assert.match(bootstrap, /STEP_PROMPT_MARKER = '\[Memo七表独立记录v4\]'/u);
assert.match(bootstrap, /REBUILD_MARKER = '\[Memo七表整理v3\]'/u);
assert.match(bootstrap, /delete store\.step_by_step_use_main_api/u);
assert.match(bootstrap, /delete store\.use_main_api/u);
assert.match(cleanup, /getManualProviderRoute\(\)/u);
assert.match(cleanup, /selectedTemplate\(\)/u);
assert.match(cleanup, /rebuild_message_template_list/u);
assert.match(cleanup, /DEEPSEEK_CONTRACT/u);
assert.match(cleanup, /RELAY_CONTRACT/u);
assert.doesNotMatch(cleanup, /tableBaseSetting\.use_main_api|\?v=memon\d+/u);
assert.doesNotMatch(cleanupBridge, /\?v=memon\d+/u);

assert.doesNotMatch(presetBridge, /MEMO_N_EDIT_BEGIN|纯文本哨兵/u);
assert.match(presetBridge, /前置<tableEdit>/u);
assert.match(presetBridge, /reply字符串末尾/u);
assert.match(presetBridge, /let processing = false/u);
assert.match(presetBridge, /\[Memo七表独立记录v4\]/u);
assert.match(presetBridge, /\[Memo七表独立记录v3\]/u);
assert.match(yiyiRuntime, /waitRecordPersistence\(chat\)/u);
assert.doesNotMatch(yiyiRuntime, /CHARACTER_MESSAGE_RENDERED,\s*onMessage/u);
assert.match(yiyiRuntime, /ledger\(chat\)\[ledgerKey\(chat\)\]/u);
assert.match(yiyiRuntime, /applyForward\(target\)/u);

assert.match(managerTemplate, /id="contentContainer" class="memory-table-pinch-area"/u);
assert.match(simpleCss, /#contentContainer\.memory-table-pinch-area\s*\{[\s\S]*?overflow-x:\s*auto/u);
assert.match(pinch, /function syncWholeCanvasWidth\(area\)/u);
assert.match(pinch, /tableContainer\.style\.width\s*=\s*`\$\{canvasWidth\}px`/u);
assert.match(pinch, /tableContainer\.style\.zoom\s*=\s*String\(currentScale\)/u);
assert.match(pinch, /touchmove[\s\S]*onTouchMove/u);

console.log('memo-n-provider-ui: all assertions passed');
