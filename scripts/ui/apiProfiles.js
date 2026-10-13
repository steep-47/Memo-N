import { USER } from '../../core/manager.js';
import { processApiKey, apiIdentity } from '../settings/standaloneAPI.js';
import { generateDeviceId } from '../../utils/utility.js';

const PRIVATE = USER.IMPORTANT_USER_PRIVACY_DATA;
const LIST_KEY = 'memo_api_profiles';
const ACTIVE_KEY = 'memo_api_profile_id';
const $id = id => document.getElementById(id);
const notify = (type, message) => globalThis.toastr?.[type]?.(message);

function listProfiles() {
    const list = PRIVATE[LIST_KEY];
    return Array.isArray(list) ? list.filter(item =>
        item && typeof item.id === 'string' && typeof item.name === 'string'
    ) : [];
}

function selectedId() {
    return String(PRIVATE[ACTIVE_KEY] || '');
}

function selectedProfile() {
    return listProfiles().find(item => item.id === selectedId()) || null;
}

function refreshSelector(id = selectedId()) {
    const select = $id('memo-api-profile-select');
    if (!select) return;
    select.replaceChildren(new Option('当前配置（尚未保存方案）', ''));
    for (const item of listProfiles()) {
        select.add(new Option(item.name, item.id));
    }
    select.value = listProfiles().some(item => item.id === id) ? id : '';
    const current = selectedProfile();
    $id('memo-api-profile-name').value = current?.name || '';
    $id('memo-api-profile-delete').style.display = current ? '' : 'none';
}

function syncModelList() {
    const select = $id('model_selector');
    if (select) select.replaceChildren(new Option('可选：读取接口可用模型', ''));
}

function fillFields(profile) {
    const defaults = { url:'', model:'', key:'', modelMode:'auto', temperature:1, maxTokens:8192 };
    const value = profile || defaults;
    PRIVATE.custom_api_url = String(value.url || '');
    PRIVATE.custom_api_key = String(value.key || '');
    PRIVATE.custom_model_name = String(value.model || '');
    USER.tableBaseSetting.memo_record_model_mode = value.modelMode === 'manual' ? 'manual' : 'auto';
    const status = $id('memo-record-model-status');
    if (status) status.textContent = value.modelMode === 'manual' && value.model ? '手动指定模型：' + value.model : value.model ? '已保存的模型：' + value.model + '（连接时自动验证）' : '自动识别可用模型；你只需填写地址和 Key';
    const temperature = Number(value.temperature);
    USER.tableBaseSetting.custom_temperature = Number.isFinite(temperature) ? temperature : 1;
    const maxTokens = Number(value.maxTokens);
    USER.tableBaseSetting.custom_max_tokens = Number.isSafeInteger(maxTokens) && maxTokens >= 256 && maxTokens <= 65536 ? maxTokens : 8192;

    $id('custom_api_url').value = PRIVATE.custom_api_url;
    $id('custom_model_name').value = PRIVATE.custom_model_name;
    const key = $id('custom_api_key');
    key.value = '';
    key.placeholder = PRIVATE.custom_api_key ? '已保存 API Key，输入新 Key 可替换' : '输入服务商提供的 API Key';
    $id('custom_temperature').value = String(USER.tableBaseSetting.custom_temperature);
    $id('custom_temperature_value').textContent = String(USER.tableBaseSetting.custom_temperature);
    $id('memo-record-max-tokens').value = String(USER.tableBaseSetting.custom_max_tokens);
    syncModelList();
}

function captureFields() {
    const url = String($id('custom_api_url').value || '').trim();
    const model = String($id('custom_model_name').value || '').trim();
    const pendingKey = String($id('custom_api_key').value || '').trim();
    let key = PRIVATE.custom_api_key;
    if (pendingKey) {
        const result = processApiKey(pendingKey, generateDeviceId());
        key = result.encryptedResult?.encrypted || result.encryptedResult;
    }
    if (typeof key !== 'string') key = '';
    if (!url || !key) {
        notify('warning', '请先填写 API 地址和 API Key，再保存方案');
        return null;
    }
    if (!/^https?:\/\//i.test(url)) {
        notify('warning', 'API 地址需以 http:// 或 https:// 开头');
        return null;
    }
    const temperature = Number($id('custom_temperature')?.value);
    const maxTokens = Number($id('memo-record-max-tokens')?.value);
    return {
        url, key, model,
        modelMode: USER.tableBaseSetting.memo_record_model_mode === 'manual' ? 'manual' : 'auto',
        temperature: Number.isFinite(temperature) && temperature >= 0 && temperature <= 2 ? temperature : 1,
        maxTokens: Number.isSafeInteger(maxTokens) && maxTokens >= 256 && maxTokens <= 65536 ? maxTokens : 8192
    };
}

function saveProfile() {
    const name = String($id('memo-api-profile-name').value || '').trim();
    if (!name) return notify('warning', '请先填写方案名称');
    if (name.length > 60) return notify('warning', '方案名称不能超过60字');
    const fields = captureFields();
    if (!fields) return;
    const profiles = listProfiles();
    const current = selectedProfile();
    const id = current?.id || ('memo-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,10));
    const matchedExisting = current?.verified === true && current.url === fields.url
        && current.key === fields.key && current.model === fields.model
        && current.modelMode === fields.modelMode;
    const justTested = PRIVATE.memo_record_verified_identity === apiIdentity()
        && PRIVATE.memo_record_verified_model === fields.model && !!fields.model;
    const item = { id, name, ...fields, verified: matchedExisting || justTested, updatedAt: Date.now() };
    const index = profiles.findIndex(existing => existing.id === id);
    if (index < 0) {
        if (profiles.length >= 30) return notify('warning', '最多保存30个 API 方案');
        profiles.push(item);
    } else {
        profiles[index] = item;
    }
    PRIVATE.custom_api_url = fields.url;
    PRIVATE.custom_api_key = fields.key;
    PRIVATE.custom_model_name = fields.model;
    USER.tableBaseSetting.memo_record_model_mode = fields.modelMode;
    USER.tableBaseSetting.custom_temperature = fields.temperature;
    USER.tableBaseSetting.custom_max_tokens = fields.maxTokens;
    PRIVATE[LIST_KEY] = profiles;
    PRIVATE[ACTIVE_KEY] = id;
    $id('custom_api_key').value = '';
    $id('custom_api_key').placeholder = '已保存 API Key，输入新 Key 可替换';
    refreshSelector(id);
    notify('success', current ? 'API 方案已更新' : 'API 方案已保存');
}

function chooseProfile() {
    const id = String($id('memo-api-profile-select').value || '');
    const profile = listProfiles().find(item => item.id === id);
    if (!profile) {
        PRIVATE[ACTIVE_KEY] = '';
        refreshSelector('');
        return;
    }
    fillFields(profile);
    PRIVATE[ACTIVE_KEY] = id;
    refreshSelector(id);
    notify('success', '已切换到 API 方案：' + profile.name);
}

function newProfile() {
    PRIVATE[ACTIVE_KEY] = '';
    fillFields(null);
    refreshSelector('');
    $id('memo-api-profile-name').focus();
}

function deleteProfile() {
    const current = selectedProfile();
    if (!current) return;
    if (!window.confirm('确定删除 API 方案「' + current.name + '」吗？')) return;
    PRIVATE[LIST_KEY] = listProfiles().filter(item => item.id !== current.id);
    newProfile();
    notify('success', 'API 方案已删除');
}

function bindAction(id, handler) {
    const node = $id(id);
    if (!node || node.dataset.memoProfileBound) return;
    node.dataset.memoProfileBound = '1';
    node.addEventListener('click', handler);
    node.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handler();
        }
    });
}

function install() {
    if (!$id('memo-api-profile-select') || !$id('custom_api_url')) return false;
    const chosen = selectedProfile();
    refreshSelector(chosen?.id || '');
    if (chosen) fillFields(chosen);
    const select = $id('memo-api-profile-select');
    if (!select.dataset.memoProfileBound) {
        select.dataset.memoProfileBound = '1';
        select.addEventListener('change', chooseProfile);
    }
    bindAction('memo-api-profile-save', saveProfile);
    bindAction('memo-api-profile-new', newProfile);
    bindAction('memo-api-profile-delete', deleteProfile);
    return true;
}

if (!install()) {
    const observer = new MutationObserver(() => {
        if (install()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList:true, subtree:true });
}

console.log('[Memo-N] 自定义 API 多方案管理已加载');
