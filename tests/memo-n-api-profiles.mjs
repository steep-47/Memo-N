import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const file = new URL('../scripts/ui/apiProfiles.js', import.meta.url);
const source = (await fs.readFile(file, 'utf8')).replace(/^import[^\n]*\n/gm, '');

class Element {
    constructor(id) {
        this.id = id;
        this.value = '';
        this.placeholder = '';
        this.style = {};
        this.dataset = {};
        this.handlers = {};
        this.options = [];
        this.textContent = '';
    }
    replaceChildren(...options) { this.options = options; }
    add(option) { this.options.push(option); }
    addEventListener(event, handler) { this.handlers[event] = handler; }
    click() { this.handlers.click(); }
    focus() {}
}
const ids = [
    'memo-api-profile-select', 'memo-api-profile-name',
    'memo-api-profile-save', 'memo-api-profile-new', 'memo-api-profile-delete',
    'custom_api_url', 'custom_api_key', 'custom_model_name',
    'custom_temperature', 'custom_temperature_value',
    'memo-record-max-tokens', 'model_selector',
];
const nodes = Object.fromEntries(ids.map(id => [id, new Element(id)]));
const privacy = {};
const setting = { custom_temperature: 1, custom_max_tokens: 2048 };
let saveCount = 0;
const user = {
    IMPORTANT_USER_PRIVACY_DATA: privacy,
    tableBaseSetting: setting,
    saveSettings() { saveCount++; },
};
const notices = [];
const context = {
    USER: user,
    processApiKey(key) { return { encryptedResult: 'ENC:' + key }; },
    generateDeviceId() { return 'device-test'; },
    apiIdentity() { return 'verified-profile-test'; },
    document: {
        getElementById(id) { return nodes[id] || null; },
        documentElement: {},
    },
    window: { confirm() { return true; } },
    Option: class { constructor(text, value) { this.text = text; this.value = value; } },
    MutationObserver: class { observe() {} disconnect() {} },
    console: { log() {} },
    toastr: {
        success(message) { notices.push(message); },
        warning(message) { notices.push(message); },
    },
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context);

function setConfig(label, url, model, key) {
    nodes['memo-api-profile-name'].value = label;
    nodes.custom_api_url.value = url;
    nodes.custom_model_name.value = model;
    nodes.custom_api_key.value = key;
}

setConfig('模型A', 'https://a.example/v1', 'provider-model-a', 'key-a');
nodes['memo-api-profile-save'].click();
assert.equal(privacy.memo_api_profiles.length, 1);
const first = privacy.memo_api_profile_id;
assert.equal(privacy.memo_api_profiles[0].key, 'ENC:key-a');
assert.equal(nodes.custom_api_key.value, '', 'saved key must never remain in input');

nodes['memo-api-profile-new'].click();
setConfig('模型B', 'https://b.example/v1', 'provider-model-b', 'key-b');
nodes['memo-api-profile-save'].click();
assert.equal(privacy.memo_api_profiles.length, 2);
const second = privacy.memo_api_profile_id;
assert.notEqual(first, second);

nodes['memo-api-profile-select'].value = first;
nodes['memo-api-profile-select'].handlers.change();
assert.equal(nodes.custom_api_url.value, 'https://a.example/v1');
assert.equal(nodes.custom_model_name.value, 'provider-model-a');
assert.equal(privacy.custom_api_key, 'ENC:key-a');
assert.equal(nodes.custom_api_key.value, '');
assert.equal(privacy.memo_api_profile_id, first);

nodes['memo-api-profile-name'].value = '模型A-重命名';
nodes['memo-api-profile-save'].click();
assert.equal(privacy.memo_api_profiles.length, 2);
assert.equal(privacy.memo_api_profiles.find(p => p.id === first).name, '模型A-重命名');

nodes['memo-api-profile-select'].value = second;
nodes['memo-api-profile-select'].handlers.change();
assert.equal(privacy.custom_api_key, 'ENC:key-b');
nodes['memo-api-profile-delete'].click();
assert.equal(privacy.memo_api_profiles.length, 1);
assert.equal(privacy.memo_api_profile_id, '');
assert.equal(privacy.custom_api_key, '');
// Display names are arbitrary; a profile must be savable before any provider model ID is known.
nodes['memo-api-profile-new'].click();
setConfig('大锅饭', 'https://c.example/v1', '', 'key-c');
nodes['memo-api-profile-save'].click();
assert.equal(privacy.memo_api_profiles.length, 2);
const named = privacy.memo_api_profiles.find(p => p.name === '大锅饭');
assert.ok(named);
assert.equal(named.model, '');
assert.equal(named.modelMode, 'auto');
assert.equal(privacy.custom_model_name, '');
assert.equal(privacy.custom_api_key, 'ENC:key-c');
privacy.memo_record_verified_identity = 'verified-profile-test';
privacy.memo_record_verified_model = 'checked-model';
nodes['custom_model_name'].value = 'checked-model';
nodes['memo-api-profile-save'].click();
assert.equal(privacy.memo_api_profiles.find(p => p.name === '大锅饭').verified, true);


assert.ok(saveCount === 0, 'privacy proxy handles setting persistence in production');
console.log('memo-n-api-profiles PASS: create, save, switch, rename, delete, profile nickname without model ID, encrypted key only');
