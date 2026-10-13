// standaloneAPI.js
import {BASE, DERIVED, EDITOR, SYSTEM, USER} from '../../core/manager.js';
import LLMApiService from "../../services/llmApi.js";
import {PopupConfirm} from "../../components/popupConfirm.js";
import { discoverChatModels } from "./recordApiModels.js";

let loadingToast = null;
let currentApiKeyIndex = 0;// 用于记录当前使用的API Key的索引


/**
 * 加密
 * @param {*} rawKey - 原始密钥
 * @param {*} deviceId - 设备ID
 * @returns {string} 加密后的字符串
 */
export function encryptXor(rawKey, deviceId) {
    // 处理多个逗号分隔的API Key
    const keys = rawKey.split(',').map(k => k.trim()).filter(k => k.trim().length > 0);
    const uniqueKeys = [...new Set(keys)];
    const uniqueKeyString = uniqueKeys.join(',');

    // 如果有重复Key，返回去重数量和加密后的Key
    if (keys.length !== uniqueKeys.length) {
        return {
            encrypted: Array.from(uniqueKeyString).map((c, i) =>
                c.charCodeAt(0) ^ deviceId.charCodeAt(i % deviceId.length)
            ).map(c => c.toString(16).padStart(2, '0')).join(''),
            duplicatesRemoved: keys.length - uniqueKeys.length
        };
    }

    // 没有重复Key时直接返回加密结果
    return Array.from(uniqueKeyString).map((c, i) =>
        c.charCodeAt(0) ^ deviceId.charCodeAt(i % deviceId.length)
    ).map(c => c.toString(16).padStart(2, '0')).join('');
}

export function processApiKey(rawKey, deviceId) {
    try {
        const keys = rawKey.split(',').map(k => k.trim()).filter(k => k.trim().length > 0);
        const invalidKeysCount = rawKey.split(',').length - keys.length; // 计算无效Key的数量
        const encryptedResult = encryptXor(rawKey, deviceId);
        const totalKeys = rawKey.split(',').length;
        const remainingKeys = totalKeys - (encryptedResult.duplicatesRemoved || 0); // 剩余去掉无效和重复之后Key的数量

        let message = `已更新API Key，共${remainingKeys}个Key`;
        if(totalKeys - remainingKeys > 0 || invalidKeysCount > 0){
            const removedParts = [];
            if (totalKeys - remainingKeys > 0) removedParts.push(`${totalKeys - remainingKeys}个重复Key`);
            if (invalidKeysCount > 0) removedParts.push(`${invalidKeysCount}个空值`);
            message += `（已去除${removedParts.join('，')}）`;
        }
        return {
            encryptedResult,
            encrypted: encryptedResult.encrypted,
            duplicatesRemoved: encryptedResult.duplicatesRemoved,
            invalidKeysCount: invalidKeysCount,
            remainingKeys: remainingKeys,
            totalKeys: totalKeys,
            message: message,
        }
    } catch (error) {
        console.error('API Key 处理失败:', error);
        throw error;
    }
}


/**
 * API KEY解密
 * @returns {Promise<string|null>} 解密后的API密钥
 */
export async function getDecryptedApiKey() { // Export this function
    try {
        const encrypted = USER.IMPORTANT_USER_PRIVACY_DATA.custom_api_key;
        const deviceId = localStorage.getItem('st_device_id');
        if (!encrypted || !deviceId) return null;

        return await decryptXor(encrypted, deviceId);
    } catch (error) {
        console.error('API Key 解密失败:', error);
        return null;
    }
}

/**
 * 解密
 * @param {string} encrypted - 加密字符串
 * @param {string} deviceId - 设备ID
 * @returns {string|null} 解密后的字符串，如果解密失败则返回null
 */
async function decryptXor(encrypted, deviceId) {
    try {
        const bytes = encrypted.match(/.{1,2}/g).map(b =>
            parseInt(b, 16)
        );
        return String.fromCharCode(...bytes.map((b, i) =>
            b ^ deviceId.charCodeAt(i % deviceId.length)
        ));
    } catch(e) {
        console.error('解密失败:', e);
        return null;
    }
}

// The nickname of a saved API profile is not the provider's model ID.
let discoveryCache = null;
function apiIdentity() {
    const data = USER.IMPORTANT_USER_PRIVACY_DATA;
    const text = JSON.stringify([String(data.custom_api_url || '').trim(), String(data.custom_api_key || '')]);
    // Do not persist another copy of the stored credential, even its obfuscated form.
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return 'v1:' + (hash >>> 0).toString(16);
}
function showModelStatus(message) {
    const output = document.getElementById('memo-record-model-status');
    if (output) output.textContent = message;
}
function saveResolvedModel(model, verified = false, expectedIdentity = apiIdentity()) {
    if (apiIdentity() !== expectedIdentity) return false;
    const data = USER.IMPORTANT_USER_PRIVACY_DATA;
    if (data.custom_model_name !== model) data.custom_model_name = model;
    const field = document.getElementById('custom_model_name');
    if (field) field.value = model;
    if (verified) {
        if (data.memo_record_verified_identity !== expectedIdentity) data.memo_record_verified_identity = expectedIdentity;
        if (data.memo_record_verified_model !== model) data.memo_record_verified_model = model;
        // Keep the selected named profile in sync with the model that actually passed.
        const profiles = data.memo_api_profiles;
        const selected = data.memo_api_profile_id;
        if (Array.isArray(profiles) && selected) {
            const pos = profiles.findIndex(x => x?.id === selected);
            const profile = profiles[pos];
            const selectedMode = USER.tableBaseSetting.memo_record_model_mode === 'manual' ? 'manual' : 'auto';
            if (pos >= 0 && profile.url === String(data.custom_api_url || '').trim()
                && profile.key === data.custom_api_key
                && (profile.model !== model || profile.modelMode !== selectedMode)) {
                const updated = profiles.slice();
                updated[pos] = { ...profile, model, modelMode: selectedMode };
                data.memo_api_profiles = updated;
            }
        }
    }
    showModelStatus('当前记录模型：' + model);
    return true;
}
export async function resolveRecordApiModel({ refresh = false } = {}) {
    const data = USER.IMPORTANT_USER_PRIVACY_DATA;
    const url = String(data.custom_api_url || '').trim();
    if (!url || !data.custom_api_key) throw new Error('请先填写 API 地址和 API Key');
    const saved = String(data.custom_model_name || '').trim();
    if (USER.tableBaseSetting.memo_record_model_mode === 'manual' && saved) {
        showModelStatus('手动指定模型：' + saved);
        return { model: saved, candidates: [saved], manual: true };
    }
    const identity = apiIdentity();
    if (!refresh && data.memo_record_verified_identity === identity && data.memo_record_verified_model) {
        const model = String(data.memo_record_verified_model);
        saveResolvedModel(model);
        return { model, candidates: [model], manual: false };
    }
    if (!refresh && discoveryCache?.identity === identity && Date.now() - discoveryCache.timestamp < 5 * 60_000) {
        const candidates = discoveryCache.models;
        saveResolvedModel(candidates[0]);
        return { model: candidates[0], candidates, manual: false };
    }
    showModelStatus('正在自动获取可用模型…');
    const keys = await getDecryptedApiKey();
    if (apiIdentity() !== identity) throw new Error('API 配置已更改，请重新测试');
    if (!keys?.trim()) throw new Error('API Key 不可用，请重新填写');
    try {
        const models = await discoverChatModels(url, keys.split(',').map(x => x.trim()).find(Boolean));
        if (apiIdentity() !== identity) throw new Error('API 配置已更改，请重新测试');
        discoveryCache = { identity, models, timestamp: Date.now() };
        saveResolvedModel(models[0], false, identity);
        return { model: models[0], candidates: models, manual: false };
    } catch (error) {
        if (apiIdentity() !== identity) throw new Error('API 配置已更改，请重新测试');
        showModelStatus('无法自动获取模型；请在高级设置填写服务商提供的模型 ID');
        throw new Error('无法自动识别模型：' + (error?.message || error) + '。可在高级设置手动填写模型 ID');
    }
}

async function createLoadingToast(isUseMainAPI = true, isSilent = false) {
    if (isSilent) {
        // 在静默模式下，不显示弹窗，直接模拟“后台继续”
        // 返回 false，因为 PopupConfirm 中“后台继续”按钮（cancelBtn）返回 false
        return Promise.resolve(false);
    }
    loadingToast?.close()
    loadingToast = new PopupConfirm();
    return await loadingToast.show(
        isUseMainAPI
            ? '正在使用【主API】重新生成完整表格...'
            : '正在使用【自定义API】重新生成完整表格...',
        '后台继续',
        '中止执行',
    )
}

/**主API调用
 * @param {string|Array<object>} systemPrompt - 系统提示或消息数组
 * @param {string} [userPrompt] - 用户提示 (如果第一个参数是消息数组，则此参数被忽略)
 * @param {boolean} [isSilent=false] - 是否以静默模式运行，不显示加载提示
 * @returns {Promise<string>} 生成的响应内容
 */
export async function handleMainAPIRequest(systemPrompt, userPrompt, isSilent = false) {
    let finalSystemPrompt = '';
    let finalUserPrompt = '';
    let suspended = false; // Define suspended outside the blocks

    if (Array.isArray(systemPrompt)) {
        // --- Start: Processing for array input ---
        const messages = systemPrompt; // messages is defined here now

        // Loading toast logic
        createLoadingToast(true, isSilent).then((r) => {
            if (loadingToast) loadingToast.close();
            suspended = r; // Assign to the outer suspended variable
        });

        let startTime = Date.now();
        if (loadingToast) {
            loadingToast.frameUpdate(() => {
                if (loadingToast) {
                    loadingToast.text = `正在使用【主API】(多消息)重新生成完整表格: ${((Date.now() - startTime) / 1000).toFixed(1)}秒`;
                }
            });
        }

        console.log('主API请求的多消息数组:', messages); // Log the actual array
        // Use TavernHelper.generateRaw with the array, enabling streaming

        if(!TavernHelper) throw new Error("酒馆助手未安装，总结功能依赖于酒馆助手插件，请安装后刷新");

        const response = await TavernHelper.generateRaw({
            ordered_prompts: messages, // Pass the array directly
            should_stream: true,      // Re-enable streaming
        });
        loadingToast?.close();
        loadingToast = null;
        return suspended ? 'suspended' : response;
        // --- End: Processing for array input ---

    } else { // Correctly placed ELSE block
        // --- Start: Original logic for non-array input ---
        finalSystemPrompt = systemPrompt;
        finalUserPrompt = userPrompt;

        createLoadingToast(true, isSilent).then((r) => {
            if (loadingToast) loadingToast.close();
            suspended = r; // Assign to the outer suspended variable
        });

        let startTime = Date.now();
        if (loadingToast) {
            loadingToast.frameUpdate(() => {
                if (loadingToast) {
                    loadingToast.text = `正在使用【主API】重新生成完整表格: ${((Date.now() - startTime) / 1000).toFixed(1)}秒`;
                }
            });
        }

        // Use EDITOR.generateRaw for non-array input
        const response = await EDITOR.generateRaw({
            prompt: finalUserPrompt,
            systemPrompt: finalSystemPrompt,
            trimNames: false,
        });
        loadingToast?.close();
        loadingToast = null;
        return suspended ? 'suspended' : response;
        // --- End: Original logic ---
    }
} // Correct closing brace for the function

/**
 * 处理 API 测试请求，包括获取输入、解密密钥、调用测试函数和返回结果。
 * @param {string} apiUrl - API URL.
 * @param {string} encryptedApiKeys - 加密的 API 密钥字符串.
 * @param {string} modelName - 模型名称.
 * @returns {Promise<Array<{keyIndex: number, success: boolean, error?: string}>>} 测试结果数组.
 */
export async function handleApiTestRequest(apiUrl, encryptedApiKeys, modelName) {
    if (!String(apiUrl ?? '').trim() || !encryptedApiKeys) {
        EDITOR.warning('请先填写 API 地址和 API Key');
        return [];
    }
    const testIdentity = apiIdentity();
    const rawKeys = await getDecryptedApiKey();
    if (apiIdentity() !== testIdentity) return [];
    const key = rawKeys?.split(',').map(x => x.trim()).find(Boolean);
    if (!key) {
        EDITOR.warning('API Key 不可用，请重新填写');
        return [];
    }
    const confirmed = await EDITOR.callGenericPopup(
        '测试连接会发送少量文本，可能产生少量费用。是否继续？',
        EDITOR.POPUP_TYPE.CONFIRM, '测试独立记录 API',
        { okButton: '测试', cancelButton: '取消' }
    );
    if (!confirmed || apiIdentity() !== testIdentity) return [];

    let resolved;
    try {
        resolved = await resolveRecordApiModel({ refresh: true });
    } catch (error) {
        EDITOR.warning(String(error?.message || error));
        return [];
    }
    if (apiIdentity() !== testIdentity) return [];
    // Automatic choice probes at most 3 chat models; manual mode tests only the chosen ID.
    const candidates = resolved.manual ? [resolved.model] : resolved.candidates.slice(0, 3);
    let last = null;
    for (const model of candidates) {
        if (apiIdentity() !== testIdentity) return [];
        const result = (await testApiConnection(String(apiUrl).trim(), [key], model))[0];
        if (apiIdentity() !== testIdentity) return [];
        if (result?.success) {
            saveResolvedModel(model, true, testIdentity);
            EDITOR.success('连接成功，记录模型：' + model);
            return [{ ...result, model }];
        }
        last = result;
        if (/401|403|unauthorized|鉴权|invalid.{0,15}(api.?key|token)/i.test(String(result?.error || ''))) break;
    }
    const errorText = String(last?.error || '未知错误');
    if (/401|403|unauthorized|鉴权/i.test(errorText)) {
        EDITOR.error('连接失败：API Key 无效或没有访问权限');
    } else if (/404|model|模型/i.test(errorText)) {
        EDITOR.error('连接失败：当前服务不支持测试的模型。请在高级设置手动填写服务商提供的准确模型 ID。');
    } else {
        EDITOR.error('连接失败：' + errorText.slice(0, 180));
    }
    return last ? [last] : [];
}

/**
 * 测试API连接
 * @param {string} apiUrl - API URL
 * @param {string[]} apiKeys - API密钥数组
 * @param {string} modelName - 模型名称
 * @returns {Promise<Array<{keyIndex: number, success: boolean, error?: string}>>} 测试结果数组
 */
export async function testApiConnection(apiUrl, apiKeys, modelName) {
    const results = [];
    const testPrompt = "Say 'test'"; // 测试用例

    for (let i = 0; i < apiKeys.length; i++) {
        const apiKey = apiKeys[i];
        console.log(`Testing API Key index: ${i}`);
        try {
            const llmService = new LLMApiService({
                api_url: apiUrl,
                api_key: apiKey,
                model_name: modelName, // 必须使用用户实际指定的模型，不静默回退默认模型
                system_prompt: 'You are a test assistant.',
                temperature: 0.1,
                max_tokens: 32 // 连接测试只需极少输出，避免默认大上限被模型拒绝
            });

            // 调用API
            const response = await llmService.callLLM(testPrompt);

            if (response && typeof response === 'string') {
                console.log(`API Key index ${i} test successful. Response: ${response}`);
                results.push({ keyIndex: i, success: true });
            } else {
                throw new Error('Invalid or empty response received.');
            }
        } catch (error) {
            console.error(`API Key index ${i} test failed (raw error object):`, error); // Log the raw error object
            let errorMessage = 'Unknown error';
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'string') {
                errorMessage = error;
            } else if (error && typeof error.toString === 'function') {
                errorMessage = error.toString();
            }
            results.push({ keyIndex: i, success: false, error: errorMessage });
        }
    }
    return results;
}

/**自定义API调用
 * @param {string|Array<object>} systemPrompt - 系统提示或消息数组
 * @param {string} [userPrompt] - 用户提示 (如果第一个参数是消息数组，则此参数被忽略)
 * @param {boolean} [isStepByStepSummary=false] - 是否为分步总结模式，用于控制流式传输
 * @param {boolean} [isSilent=false] - 是否以静默模式运行，不显示加载提示
 * @returns {Promise<string>} 生成的响应内容
 */
export async function handleCustomAPIRequest(systemPrompt, userPrompt, isStepByStepSummary = false, isSilent = false) {
    const USER_API_URL = String(USER.IMPORTANT_USER_PRIVACY_DATA.custom_api_url || '').trim();
    const decryptedApiKeysString = await getDecryptedApiKey(); // 获取逗号分隔的密钥字符串
    let resolvedModel;
    try {
        resolvedModel = await resolveRecordApiModel();
    } catch (error) {
        EDITOR.error(String(error?.message || error));
        return;
    }
    const USER_API_MODEL = resolvedModel.model;
    const requestIdentity = apiIdentity();
    // const MAX_RETRIES = USER.tableBaseSetting.custom_api_retries ?? 0; // 从设置中获取重试次数，默认为 0
    const MAX_RETRIES = 0; // 从设置中获取重试次数，默认为 0

    if (!USER_API_URL || !USER_API_MODEL) {
        EDITOR.error('请填写完整的自定义API配置 (URL 和模型)');
        return;
    }

    if (!decryptedApiKeysString) {
        EDITOR.error('API key解密失败或未设置，请检查API key设置！');
        return;
    }

    const apiKeys = decryptedApiKeysString.split(',').map(k => k.trim()).filter(k => k.length > 0);

    if (apiKeys.length === 0) {
        EDITOR.error('未找到有效的API Key，请检查输入。');
        return;
    }

    let suspended = false;
    createLoadingToast(false, isSilent).then((r) => {
        if (loadingToast) loadingToast.close();
        suspended = r;
    })

    const totalKeys = apiKeys.length;
    const attempts = MAX_RETRIES === 0 ? totalKeys : Math.min(MAX_RETRIES, totalKeys);
    let lastError = null;

    for (let i = 0; i < attempts; i++) {
        if (suspended) break; // 检查用户是否中止了操作

        const keyIndexToTry = currentApiKeyIndex % totalKeys;
        const currentApiKey = apiKeys[keyIndexToTry];
        currentApiKeyIndex++; // 移动到下一个密钥，用于下一次整体请求

        console.log(`尝试使用API密钥索引进行API调用: ${keyIndexToTry}`);
        if (loadingToast) {
            loadingToast.text = `尝试使用第 ${keyIndexToTry + 1}/${totalKeys} 个自定义API Key...`;
        }

        try { // Outer try for the whole attempt with the current key
            const promptData = Array.isArray(systemPrompt) ? systemPrompt : userPrompt;
            let response; // Declare response variable

            // --- ALWAYS Use llmService ---
            console.log(`自定义API: 使用 llmService.callLLM (输入类型: ${Array.isArray(promptData) ? '多消息数组' : '单条消息'})`);
            if (loadingToast) {
                loadingToast.text = `正在使用第 ${keyIndexToTry + 1}/${totalKeys} 个自定义API Key (llmService)...`;
            }

            const llmService = new LLMApiService({
                api_url: USER_API_URL,
                api_key: currentApiKey,
                model_name: USER_API_MODEL,
                // Pass empty system_prompt if promptData is array, otherwise pass the original systemPrompt string
                system_prompt: Array.isArray(promptData) ? "" : systemPrompt,
                temperature: USER.tableBaseSetting.custom_temperature,
                max_tokens: USER.tableBaseSetting.custom_max_tokens ?? 8192,
                table_proxy_address: USER.IMPORTANT_USER_PRIVACY_DATA.table_proxy_address,
                table_proxy_key: USER.IMPORTANT_USER_PRIVACY_DATA.table_proxy_key
            });

            const streamCallback = (chunk) => {
                if (loadingToast) {
                    const modeText = isStepByStepSummary ? "(分步)" : ""; // isStepByStepSummary might be useful here still
                    loadingToast.text = `正在使用第 ${keyIndexToTry + 1} 个Key生成${modeText}: ${chunk}`;
                }
            };

            try {
                // Pass promptData (which could be string or array) to callLLM
                // 独立填表与连接测试走同一非流式 Chat Completions 路径，避免测试通过但流式调用失败。
                response = await llmService.callLLM(promptData, isStepByStepSummary ? null : streamCallback);
                console.log(`请求成功 (llmService, 密钥索引: ${keyIndexToTry}):`, response);
                loadingToast?.close();
                if (!suspended && typeof response === 'string' && response.trim()) saveResolvedModel(USER_API_MODEL, true, requestIdentity);
                return suspended ? 'suspended' : response; // Success, return immediately
            } catch (llmServiceError) {
                // llmService failed, log error and continue loop
                console.error(`API调用失败 (llmService)，密钥索引 ${keyIndexToTry}:`, llmServiceError);
                lastError = llmServiceError;
                EDITOR.error(`使用第 ${keyIndexToTry + 1} 个 Key 调用 (llmService) 失败: ${llmServiceError.message || '未知错误'}`);
                // Let the loop continue to the next key
            }
            // If code reaches here, the llmService call failed for this key

        } catch (error) { // This catch should ideally not be reached due to inner try/catch
            console.error(`处理密钥索引 ${keyIndexToTry} 时发生意外错误:`, error);
            lastError = error;
            EDITOR.error(`处理第 ${keyIndexToTry + 1} 个 Key 时发生意外错误`, error.message || '未知错误', error);
        }
    }

    // 所有尝试均失败
    loadingToast?.close();
    if (suspended) {
        EDITOR.warning('操作已被用户中止。');
        return 'suspended';
    }

    const errorMessage = `所有 ${attempts} 次尝试均失败。最后错误: ${lastError?.message || '未知错误'}`;
    EDITOR.error(errorMessage, "", lastError);
    console.error('所有API调用尝试均失败。', lastError);
    return `错误: ${errorMessage}`; // 返回一个明确的错误字符串

    // // 公共请求配置 (Commented out original code remains unchanged)
    // const requestConfig = {
    //     method: 'POST',
    //     headers: {
    //         'Content-Type': 'application/json',
    //         'Authorization': `Bearer ${USER_API_KEY}`
    //     },
    //     body: JSON.stringify({
    //         model: USER_API_MODEL,
    //         messages: [
    //             { role: "system", content: systemPrompt },
    //             { role: "user", content: userPrompt }
    //         ],
    //         temperature: USER.tableBaseSetting.custom_temperature
    //     })
    // };
    //
    // // 通用请求函数
    // const makeRequest = async (url) => {
    //     const response = await fetch(url, requestConfig);
    //     if (!response.ok) {
    //         const errorBody = await response.text();
    //         throw { status: response.status, message: errorBody };
    //     }
    //     return response.json();
    // };
    // let firstError;
    // try {
    //     // 第一次尝试补全/chat/completions
    //     const modifiedUrl = new URL(USER_API_URL);
    //     modifiedUrl.pathname = modifiedUrl.pathname.replace(/\/$/, '') + '/chat/completions';
    //     const result = await makeRequest(modifiedUrl.href);
    //     if (result?.choices?.[0]?.message?.content) {
    //         console.log('请求成功:', result.choices[0].message.content)
    //         return result.choices[0].message.content;
    //     }
    // } catch (error) {
    //     firstError = error;
    // }
    //
    // try {
    //     // 第二次尝试原始URL
    //     const result = await makeRequest(USER_API_URL);
    //     return result.choices[0].message.content;
    // } catch (secondError) {
    //     const combinedError = new Error('API请求失败');
    //     combinedError.details = {
    //         firstAttempt: firstError?.message || '第一次请求无错误信息',
    //         secondAttempt: secondError.message
    //     };
    //     throw combinedError;
    // }
}

/**请求模型列表
 * @returns {Promise<void>}
 */
/**
 * 格式化API Key用于错误提示
 * @param {string} key - API Key
 * @returns {string} 格式化后的Key字符串
 */
function maskApiKey(key) {
    const len = key.length;
    if (len === 0) return "[空密钥]";
    if (len <= 8) {
        const visibleCount = Math.ceil(len / 2);
        return key.substring(0, visibleCount) + '...';
    } else {
        return key.substring(0, 4) + '...' + key.substring(len - 4);
    }
}

/**请求模型列表
 * @returns {Promise<void>}
 */
export async function updateModelList() {
    const url = String(USER.IMPORTANT_USER_PRIVACY_DATA.custom_api_url || '').trim();
    const identity = apiIdentity();
    const keys = await getDecryptedApiKey();
    if (apiIdentity() !== identity) return [];
    const key = keys?.split(',').map(x => x.trim()).find(Boolean);
    if (!url || !key) {
        EDITOR.warning('请先填写 API 地址和 API Key');
        return [];
    }
    try {
        const models = await discoverChatModels(url, key);
        if (apiIdentity() !== identity) return [];
        const select = $('#model_selector');
        select.empty();
        select.append($('<option>', { value:'', text:'请选择一个模型' }));
        for (const model of models) {
            select.append($('<option>', { value:model, text:model }));
        }
        const manual = USER.tableBaseSetting.memo_record_model_mode === 'manual';
        const selected = String(USER.IMPORTANT_USER_PRIVACY_DATA.custom_model_name || '').trim();
        if (manual && models.includes(selected)) select.val(selected);
        else if (!manual) saveResolvedModel(models[0]);
        EDITOR.success('已获取 ' + models.length + ' 个可选模型，可直接测试连接或手动选择');
        return models;
    } catch (error) {
        if (apiIdentity() !== identity) return [];
        EDITOR.warning('无法读取模型列表：' + String(error?.message || error).slice(0, 120) + '。若服务商不开放 /models，请在高级设置填写真实模型 ID。');
        return [];
    }
}

/**
 * 估算 Token 数量
 * @param {string} text - 要估算 token 数量的文本
 * @returns {number} 估算的 token 数量
 */
export function estimateTokenCount(text) {
    // 统计中文字符数量
    let chineseCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;

    // 统计英文单词数量
    let englishWords = text.match(/\b\w+\b/g) || [];
    let englishCount = englishWords.length;

    // 估算 token 数量
    let estimatedTokenCount = chineseCount + Math.floor(englishCount * 1.2);
    return estimatedTokenCount;
}
/**
 * @description
 * - **功能**: 导出所有表格数据，方便其他插件调用。
 * - **使用场景**: 当其他插件需要访问或处理当前插件管理的表格数据时，可以通过此函数获取。
 * - **返回值**: 返回一个包含所有表格数据的数组，每个表格对象包含：
 *   - `name`: 表格的名称。
 *   - `data`: 一个二维数组，表示表格的完整数据（包括表头和所有行）。
 *
 * @returns {Array<Object<{name: string, data: Array<Array<string>>}>>}
 */
export function ext_getAllTables() {
    // 核心重构：与 ext_exportAllTablesAsJson 保持一致，确保数据源是最新的持久化状态。
    
    // 1. 获取最新的 piece
    const { piece } = BASE.getLastSheetsPiece();
    if (!piece || !piece.memo_n_hash_sheets) {
        console.warn("[Memory Enhancement] ext_getAllTables: 未找到任何有效的表格数据。");
        return [];
    }

    // 2. 基于最新的 memo_n_hash_sheets 创建/更新 Sheet 实例
    const tables = BASE.hashSheetsToSheets(piece.memo_n_hash_sheets);
    if (!tables || tables.length === 0) {
        return [];
    }
    
    // 3. 遍历最新的实例构建数据
    const allData = tables.map(table => {
        if (!table.enable) return null; // 跳过禁用的表格
        const header = table.getHeader();
        const body = table.getBody();
        const fullData = [header, ...body];

        return {
            name: table.name,
            data: fullData,
        };
    }).filter(Boolean); // 过滤掉 null (禁用的表格)

    return allData;
}

/**
 * @description
 * - **功能**: 导出所有表格为一个 JSON 对象，格式与 '范例表格.json' 类似。
 * - **使用场景**: 用于将当前所有表格的状态和数据导出为一个单一的 JSON 文件。
 * - **返回值**: 返回一个 JSON 对象，键是表格的 UID，值是表格的完整配置和数据。
 *
 * @returns {Object}
 */
export function ext_exportAllTablesAsJson() {
    // 最终、最稳妥的方案：确保输入给 JSON.stringify 的数据是纯净的。

    const { piece } = BASE.getLastSheetsPiece();
    if (!piece || !piece.memo_n_hash_sheets) {
        console.warn("[Memory Enhancement] ext_exportAllTablesAsJson: 未找到任何有效的表格数据。");
        return {};
    }

    const tables = BASE.hashSheetsToSheets(piece.memo_n_hash_sheets);
    if (!tables || tables.length === 0) {
        return {};
    }

    const exportData = {};
    tables.forEach(table => {
        if (!table.enable) return; // 跳过禁用的表格

        try {
            const rawContent = table.getContent(true) || [];

            // 深度清洗，确保所有单元格都是字符串类型。
            // 这是防止因 undefined、null 或其他非字符串类型导致 JSON.stringify 行为异常的关键。
            const sanitizedContent = rawContent.map(row =>
                Array.isArray(row) ? row.map(cell =>
                    String(cell ?? '') // 将 null 和 undefined 转换为空字符串，其他类型强制转换为字符串
                ) : []
            );

            exportData[table.uid] = {
                uid: table.uid,
                name: table.name,
                content: sanitizedContent
            };
        } catch (error) {
            console.error(`[Memory Enhancement] 导出表格 ${table.name} (UID: ${table.uid}) 时出错:`, error);
        }
    });

    // 直接序列化整个清洗过的对象。
    // 如果这里依然出错，说明问题比预想的更复杂，但理论上这已经是JS中最标准的做法。
    try {
        // 为了避免外层宏解析失败，我们直接返回字符串，让宏自己去解析。
        return exportData;
    } catch (e) {
        console.error("[Memory Enhancement] 最终JSON序列化失败:", e);
        return {}; // 发生意外时返回空对象
    }
}
