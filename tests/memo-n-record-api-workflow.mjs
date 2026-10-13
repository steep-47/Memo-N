import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const file = new URL('../scripts/settings/standaloneAPI.js', import.meta.url);
const source = (await fs.readFile(file, 'utf8'))
    .replace(/^import[^\n]*\n/gm, '')
    .replace(/\bexport (?=(?:async )?function|class|const)/g, '');

const privateData = { custom_api_url:'https://provider.example/v1', custom_model_name:'大锅饭' };
const settings = { memo_record_model_mode:'auto', custom_temperature:0.2, custom_max_tokens:8192 };
const notifications = [];
const requestedModels = [];
let modelsAvailable = true;
const status = { textContent:'' }, modelField = { value:'' };

class MockLLM {
    constructor(config) { this.config = config; }
    async callLLM(message) {
        requestedModels.push(this.config.model_name);
        if (this.config.model_name === 'unavailable-model') throw new Error('API请求失败: 404 未知模型');
        if (this.config.model_name === 'actual-mini' || this.config.model_name === 'manual-id') {
            return typeof message === 'string' ? 'test' : '<tableEdit><!-- NO_CHANGE --></tableEdit>';
        }
        throw new Error('unexpected model');
    }
}
const context = {
    USER: { IMPORTANT_USER_PRIVACY_DATA: privateData, tableBaseSetting:settings, saveSettings() {} },
    EDITOR: {
        POPUP_TYPE: { CONFIRM:1 },
        callGenericPopup: async () => true,
        clear() {},
        info() {},
        warning(value) { notifications.push(['warning', value]); },
        error(value) { notifications.push(['error', value]); },
        success(value) { notifications.push(['success', value]); },
    },
    BASE:{}, DERIVED:{}, SYSTEM:{},
    PopupConfirm:class {},
    document: { getElementById: id =>
        id === 'memo-record-model-status' ? status
        : id === 'custom_model_name' ? modelField : null },
    localStorage: { getItem: () => 'device' },
    LLMApiService: MockLLM,
    discoverChatModels: async () => {
        if (!modelsAvailable) throw new Error('HTTP 404 /models');
        return ['unavailable-model', 'actual-mini'];
    },
    $: () => ({}),
    console: { log() {}, error() {} },
    TavernHelper:{},
    setTimeout, clearTimeout,
};
vm.createContext(context);
vm.runInContext(source + '\nglobalThis.testExports = { processApiKey, handleApiTestRequest, handleCustomAPIRequest };', context);
const api = context.testExports;

privateData.custom_api_key = api.processApiKey('key', 'device').encryptedResult;
privateData.memo_api_profile_id = 'nickname';
privateData.memo_api_profiles = [{
    id:'nickname', name:'大锅饭', url:privateData.custom_api_url,
    key:privateData.custom_api_key, model:'', modelMode:'auto',
}];

const first = await api.handleApiTestRequest(privateData.custom_api_url, privateData.custom_api_key, '大锅饭');
assert.equal(first[0]?.success, true);
assert.equal(first[0]?.model, 'actual-mini');
assert.deepEqual(requestedModels, ['unavailable-model', 'actual-mini']);
assert.equal(privateData.memo_api_profiles[0].name, '大锅饭');
assert.equal(privateData.memo_api_profiles[0].model, 'actual-mini');
assert.equal(privateData.memo_record_verified_model, 'actual-mini');
assert.equal(privateData.custom_model_name, 'actual-mini');

const response = await api.handleCustomAPIRequest([{ role:'user', content:'记录' }], null, true, true);
assert.equal(response, '<tableEdit><!-- NO_CHANGE --></tableEdit>');
assert.equal(requestedModels.at(-1), 'actual-mini');

modelsAvailable = false;
privateData.custom_api_url = 'https://other.example/v1';
settings.memo_record_model_mode = 'auto';
const absent = await api.handleApiTestRequest(privateData.custom_api_url, privateData.custom_api_key, '');
assert.equal(absent.length, 0, 'No model must be invented when /models is unavailable');

privateData.memo_api_profile_id = 'manual-profile';
privateData.memo_api_profiles.push({
    id:'manual-profile', name:'手动服务', url:privateData.custom_api_url,
    key:privateData.custom_api_key, model:'', modelMode:'auto',
});
settings.memo_record_model_mode = 'manual';
privateData.custom_model_name = 'manual-id';
const manual = await api.handleApiTestRequest(privateData.custom_api_url, privateData.custom_api_key, 'manual-id');
assert.equal(manual[0]?.success, true);
assert.equal(manual[0]?.model, 'manual-id');
assert.equal(privateData.memo_api_profiles[1].model, 'manual-id');
assert.equal(privateData.memo_api_profiles[1].modelMode, 'manual');

console.log('memo-n-record-api-workflow PASS: nickname ignored, failover, tested model reused, /models fallback');
