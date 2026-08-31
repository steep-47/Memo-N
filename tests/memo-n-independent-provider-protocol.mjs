import fs from 'node:fs';
import assert from 'node:assert/strict';
import { parseRecordEnvelope, changesToStrictCalls } from '../scripts/engine/recordEnvelope.js';

const source = fs.readFileSync(new URL('../scripts/runtime/separateTableUpdate.js', import.meta.url), 'utf8');
const provider = fs.readFileSync(new URL('../scripts/runtime/providerRoute.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../scripts/ui/apiModeToggle.js', import.meta.url), 'utf8');
const template = fs.readFileSync(new URL('../assets/templates/index.html', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../scripts/runtime/settingsBootstrap.js', import.meta.url), 'utf8');
const loader = fs.readFileSync(new URL('../loader.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

// 独立/手动记录必须直接读取统一手动 route，而不是依赖 UI 副作用或 Provider 自动识别。
assert.match(source, /getManualProviderRoute\(\)/u);
assert.match(source, /const useMain = route === ROUTE\.DEEPSEEK/u);
assert.doesNotMatch(source, /const useMain\s*=\s*USER\.tableBaseSetting\.step_by_step_use_main_api/u);
assert.doesNotMatch(ui, /step_by_step_use_main_api\s*=/u);
assert.doesNotMatch(template, /id="step_by_step_use_main_api"/u);
for (const forbidden of ['chat_completion_source', 'custom_url', 'reverse_proxy', 'modelOf', 'sourceOf', 'isDirectDeepSeek']) {
    assert.doesNotMatch(provider, new RegExp(forbidden, 'u'));
}

// DeepSeek 独立/手动协议：记录专用 JSON，固定 reply + changes。
assert.match(source, /DEEPSEEK_RECORD_CONTRACT/u);
assert.match(source, /"reply":"RECORD_ONLY"/u);
assert.match(source, /parseRecordEnvelope\(rawContent\)/u);
assert.match(source, /changesToStrictCalls\(envelope\.changes\)/u);
assert.match(source, /reply 必须固定为 "RECORD_ONLY"/u);
assert.match(source, /不得返回 tableEdit/u);

const deepseek = parseRecordEnvelope(JSON.stringify({
    reply: 'RECORD_ONLY',
    changes: [
        { op: 'update', table: 0, row: 0, cells: [{ column: 1, value: '09:10' }] },
        { op: 'insert', table: 2, row: null, cells: [{ column: 0, value: '钥匙' }] },
    ],
}));
assert.equal(deepseek.ok, true);
assert.deepEqual(changesToStrictCalls(deepseek.changes), [
    'updateRow(0,0,{"1":"09:10"})',
    'insertRow(2,{"0":"钥匙"})',
]);
const deepseekNoChange = parseRecordEnvelope(JSON.stringify({ reply: 'RECORD_ONLY', changes: [] }));
assert.equal(deepseekNoChange.ok, true);
assert.deepEqual(changesToStrictCalls(deepseekNoChange.changes), ['NO_CHANGE']);

// 中转站独立/手动协议：唯一 tableEdit，并直接交同一个严格执行器。
assert.match(source, /RELAY_RECORD_CONTRACT/u);
assert.match(source, /getTableEditTag\(rawContent\)/u);
assert.match(source, /中转站模型必须且只能返回1个<tableEdit>/u);
assert.match(source, /executeMemoTableEdit\(parsed\.executionInput, referencePiece\)/u);
assert.match(source, /handleCustomAPIRequest\(messages, null, true, isSilentMode\)/u);
assert.match(source, /handleMainAPIRequest\(messages, null, isSilentMode\)/u);

// 两种协议都要把经过验证的记录绑定回当前 message/swipe，保持原插件历史/恢复语义。
assert.match(source, /attachMachineRecord\(referencePiece, parsed\.machineBlock\)/u);
assert.match(source, /return 'detached'/u);
assert.match(source, /return 'stale'/u);
assert.match(source, /prepareAutoBaseline/u);
assert.match(source, /restorePieceState/u);

// 模式入口只保留“填表行为发生在”，并迁移旧 step_by_step 一次。
assert.match(ui, /bindFillTime/u);
assert.match(ui, /independent_record_api_enabled/u);
assert.doesNotMatch(template, /id="memory-independent-record-api"/u);
assert.match(bootstrap, /hasOwnProperty\.call\(store, 'independent_record_api_enabled'\)/u);
assert.match(bootstrap, /store\.independent_record_api_enabled = store\.step_by_step === true/u);
assert.match(bootstrap, /store\.step_by_step = false/u);

assert.match(loader, /RUNTIME_VERSION = 'memon76'/u);
assert.equal(manifest.version, '0.1.0-memon.76');
console.log('memo-n-independent-provider-protocol: all assertions passed');
