import fs from 'node:fs';
import assert from 'node:assert/strict';

const ui = fs.readFileSync(new URL('../scripts/ui/apiModeToggle.js', import.meta.url), 'utf8');
const template = fs.readFileSync(new URL('../assets/templates/index.html', import.meta.url), 'utf8');
const loader = fs.readFileSync(new URL('../loader.js', import.meta.url), 'utf8');
const modeRuntime = fs.readFileSync(new URL('../scripts/runtime/modeRuntimeControl.js', import.meta.url), 'utf8');
const structureRepair = fs.readFileSync(new URL('../scripts/runtime/tableStructureRepair.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

assert.match(template, /id="memo-record-provider-route"/u);
assert.match(template, /<option value="deepseek">DeepSeek<\/option>/u);
assert.match(template, /<option value="relay">中转站<\/option>/u);
assert.match(template, /id="fill_table_time"/u);
assert.doesNotMatch(template, /id="memory-independent-record-api"/u);
assert.doesNotMatch(template, /id="step_by_step_use_main_api"/u);
assert.match(template, /自定义独立API（中转站）/u);

assert.match(ui, /new MutationObserver\(scheduleMount\)/u);
assert.doesNotMatch(ui, /observer\.disconnect/u);
assert.match(ui, /function bindFillTime\(fillTime\)/u);
assert.match(ui, /fillTime\.value === 'after'/u);
assert.match(ui, /USER\.tableBaseSetting\.step_by_step = false/u);
assert.doesNotMatch(ui, /syncIndependentApiRoute/u);
assert.doesNotMatch(ui, /step_by_step_use_main_api\s*=/u);

const mountBody = ui.match(/function mount\(\) \{([\s\S]*?)\n\}\n\nlet mountQueued/u)?.[1] ?? '';
assert.ok(mountBody);
assert.doesNotMatch(mountBody, /tableBaseSetting\.step_by_step\s*=/u);
assert.match(mountBody, /getManualProviderRoute\(\)/u);
assert.match(mountBody, /syncModeSections\(fillTime\)/u);

assert.match(modeRuntime, /function bridgePromptMode\(\)/u);
assert.match(modeRuntime, /captureGeneration[\s\S]*bridgePromptMode\(\)/u);
assert.match(modeRuntime, /CHAT_COMPLETION_SETTINGS_READY/u);
assert.match(modeRuntime, /settingsReadyEvent[^\n]*forceNormalMode/u);
assert.doesNotMatch(modeRuntime, /makeFirst\(promptEvent/u);
assert.doesNotMatch(modeRuntime, /makeLast\(promptEvent/u);
assert.doesNotMatch(modeRuntime, /enqueueCurrentVersion/u, 'stale结果不得自动排队重算');
assert.match(modeRuntime, /result==='stale'[\s\S]*不会自动重试/u, 'stale必须明确安全作废且不重试');
assert.match(modeRuntime, /liveToken!==job\.token[\s\S]*不自动重算/u, '过期排队任务不得自动重算');
assert.doesNotMatch(modeRuntime, /\?v=memon\d+/u);
assert.doesNotMatch(structureRepair, /\?v=memon\d+/u);

assert.match(loader, /RUNTIME_VERSION = 'memon80'/u);
assert.match(loader, /PUBLIC_VERSION = '0\.1\.0-memon\.80'/u);
assert.match(loader, /window\.memoN\.VERSION = PUBLIC_VERSION/u);
assert.equal(manifest.version, '0.1.0-memon.80');
console.log('memo-n-provider-ui: all assertions passed');
