// standaloneAPI.js
import {EDITOR, USER} from '../../core/manager.js';
import LLMApiService from "../../services/llmApi.js";
import {PopupConfirm} from "../../components/popupConfirm.js";

let loadingToast = null;
let currentApiKeyIndex = 0;

export function encryptXor(rawKey, deviceId) {
    const keys = rawKey.split(',').map(k => k.trim()).filter(k => k.length > 0);
    const uniqueKeys = [...new Set(keys)];
    const uniqueKeyString = uniqueKeys.join(',');
    const encrypted = Array.from(uniqueKeyString).map((c, i) => c.charCodeAt(0) ^ deviceId.charCodeAt(i % deviceId.length)).map(c => c.toString(16).padStart(2, '0')).join('');
    return keys.length !== uniqueKeys.length ? { encrypted, duplicatesRemoved: keys.length - uniqueKeys.length } : encrypted;
}

export function processApiKey(rawKey, deviceId) {
    try {
        const keys = rawKey.split(',').map(k => k.trim()).filter(k => k.length > 0);
        const invalidKeysCount = rawKey.split(',').length - keys.length;
        const encryptedResult = encryptXor(rawKey, deviceId);
        const encrypted = typeof encryptedResult === 'string' ? encryptedResult : encryptedResult.encrypted;
        const duplicatesRemoved = typeof encryptedResult === 'string' ? 0 : (encryptedResult.duplicatesRemoved || 0);
        const totalKeys = rawKey.split(',').length;
        const remainingKeys = totalKeys - duplicatesRemoved;
        const removedParts = [];
        if (duplicatesRemoved > 0) removedParts.push(`${duplicatesRemoved}个重复Key`);
        if (invalidKeysCount > 0) removedParts.push(`${invalidKeysCount}个空值`);
        return { encryptedResult, encrypted, duplicatesRemoved, invalidKeysCount, remainingKeys, totalKeys, message: `已更新API Key，共${remainingKeys}个Key${removedParts.length ? `（已去除${removedParts.join('，')}）` : ''}` };
    } catch (error) {
        console.error('API Key 处理失败:', error);
        throw error;
    }
}

export async function getDecryptedApiKey() {
    try {
        const encrypted = USER.IMPORTANT_USER_PRIVACY_DATA.custom_api_key;
        const deviceId = localStorage.getItem('st_device_id');
        if (!encrypted || !deviceId) return null;
        const bytes = encrypted.match(/.{1,2}/g)?.map(b => parseInt(b, 16));
        if (!bytes) return null;
        return String.fromCharCode(...bytes.map((b, i) => b ^ deviceId.charCodeAt(i % deviceId.length)));
    } catch (error) {
        console.error('API Key 解密失败:', error);
        return null;
    }
}

async function createLoadingToast(isUseMainAPI = true, isSilent = false) {
    if (isSilent) return false;
    loadingToast?.close();
    loadingToast = new PopupConfirm();
    return await loadingToast.show(isUseMainAPI ? '正在使用【主API】重新生成完整表格...' : '正在使用【自定义API】重新生成完整表格...', '后台继续', '中止执行');
}

export async function handleMainAPIRequest(systemPrompt, userPrompt, isSilent = false) {
    let suspended = false;
    createLoadingToast(true, isSilent).then(r => { suspended = r; });
    try {
        if (Array.isArray(systemPrompt)) {
            if (!globalThis.TavernHelper) throw new Error('酒馆助手未安装，总结功能依赖于酒馆助手插件，请安装后刷新');
            const response = await globalThis.TavernHelper.generateRaw({ ordered_prompts: systemPrompt, should_stream: true });
            return suspended ? 'suspended' : response;
        }
        const response = await EDITOR.generateRaw({ prompt: userPrompt, systemPrompt, trimNames: false });
        return suspended ? 'suspended' : response;
    } finally {
        loadingToast?.close(); loadingToast = null;
    }
}

export async function handleApiTestRequest(apiUrl, encryptedApiKeys, modelName) {
    if (!apiUrl || !encryptedApiKeys) { EDITOR.error('请先填写 API URL 和 API Key。'); return []; }
    const raw = await getDecryptedApiKey();
    const keys = raw?.split(',').map(k => k.trim()).filter(Boolean) || [];
    if (!keys.length) { EDITOR.error('API Key 解密失败或未设置！'); return []; }
    const confirmed = await EDITOR.callGenericPopup(`检测到 ${keys.length} 个 API Key。\n测试只发送一次很短的请求。`, EDITOR.POPUP_TYPE.CONFIRM, '', { okButton: '测试第一个key', cancelButton: '取消' });
    if (!confirmed) return [];
    return await testApiConnection(apiUrl, [keys[0]], modelName);
}

export async function testApiConnection(apiUrl, apiKeys, modelName) {
    const results = [];
    for (let i = 0; i < apiKeys.length; i++) {
        try {
            const service = new LLMApiService({ api_url: apiUrl, api_key: apiKeys[i], model_name: modelName || 'gpt-3.5-turbo', system_prompt: 'You are a test assistant.', temperature: 0.1 });
            const response = await service.callLLM("Say 'test'");
            if (!response) throw new Error('Invalid or empty response received.');
            results.push({ keyIndex: i, success: true });
        } catch (error) { results.push({ keyIndex: i, success: false, error: error?.message || String(error) }); }
    }
    return results;
}

/**
 * 自定义API业务调用严格只发送一次网络请求。
 * 多Key只在不同业务调用之间轮换；当前Key失败不会自动换Key重试，避免重复扣费或重复记录。
 */
export async function handleCustomAPIRequest(systemPrompt, userPrompt, _isStepByStepSummary = false, isSilent = false) {
    const apiUrl = USER.IMPORTANT_USER_PRIVACY_DATA.custom_api_url;
    const model = USER.IMPORTANT_USER_PRIVACY_DATA.custom_model_name;
    const rawKeys = await getDecryptedApiKey();
    if (!apiUrl || !model) { EDITOR.error('请填写完整的自定义API配置 (URL 和模型)'); return; }
    const keys = rawKeys?.split(',').map(k => k.trim()).filter(Boolean) || [];
    if (!keys.length) { EDITOR.error('API key解密失败或未设置，请检查API key设置！'); return; }

    let suspended = false;
    createLoadingToast(false, isSilent).then(r => { suspended = r; });
    const keyIndex = currentApiKeyIndex % keys.length;
    currentApiKeyIndex = (currentApiKeyIndex + 1) % keys.length;
    if (loadingToast) loadingToast.text = `正在使用第 ${keyIndex + 1}/${keys.length} 个自定义API Key...`;

    try {
        const promptData = Array.isArray(systemPrompt) ? systemPrompt : userPrompt;
        const service = new LLMApiService({
            api_url: apiUrl,
            api_key: keys[keyIndex],
            model_name: model,
            system_prompt: Array.isArray(promptData) ? '' : systemPrompt,
            temperature: USER.tableBaseSetting.custom_temperature,
        });
        // 独立记录只需要最终机器块；非流式避免流解析遗漏隐藏字段，同时不改变正常聊天的流式设置。
        const response = await service.callLLM(promptData);
        return suspended ? 'suspended' : response;
    } catch (error) {
        console.error(`[Memo] 自定义API单次调用失败，Key索引 ${keyIndex}；不会自动换Key重试`, error);
        EDITOR.error(`自定义API调用失败：${error?.message || error}。不会自动重试。`);
        return `错误: ${error?.message || error}`;
    } finally {
        loadingToast?.close(); loadingToast = null;
    }
}
