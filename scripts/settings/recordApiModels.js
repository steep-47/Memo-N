// OpenAI-compatible model discovery for the independent record API.
// This module does not read or store API keys; callers supply the key explicitly.
export function modelsEndpoint(apiUrl) {
    const url = new URL(String(apiUrl ?? '').trim());
    if (!/^https?:$/.test(url.protocol)) throw new Error('API 地址必须以 http:// 或 https:// 开头');
    url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/(?:chat\/completions|models)$/i, '') + '/models';
    url.search = '';
    url.hash = '';
    return url.href;
}

const EXCLUDE = /(?:embedding|embed-|rerank|re-rank|whisper|transcription|speech|tts|dall-e|image|moderation|bge-|clip-|sora|video|audio|asr|ocr)/i;
const FAVOR = /(?:mini|flash|lite|small|nano|cheap|economy|haiku|turbo)/i;

export function availableChatModelIds(payload) {
    const records = Array.isArray(payload?.data) ? payload.data
        : Array.isArray(payload?.models) ? payload.models
        : Array.isArray(payload) ? payload : [];
    const ids = records.map(item => typeof item === 'string' ? item : item?.id)
        .filter(value => typeof value === 'string' && value.trim())
        .map(value => value.trim()).filter(id => !EXCLUDE.test(id));
    return [...new Set(ids)].sort((a, b) => Number(FAVOR.test(b)) - Number(FAVOR.test(a)));
}

export async function discoverChatModels(apiUrl, apiKey, fetcher = fetch) {
    const endpoint = modelsEndpoint(apiUrl);
    const key = String(apiKey ?? '').trim();
    if (!key) throw new Error('请先填写 API Key');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
        const response = await fetcher(endpoint, {
            method: 'GET',
            headers: { Authorization: 'Bearer ' + key },
            signal: controller.signal,
        });
        if (!response.ok) {
            const code = response.status;
            if (code === 401 || code === 403) throw new Error('读取模型列表失败（' + code + '）：Key 无效或无权查看模型');
            throw new Error('模型列表接口不可用（HTTP ' + code + '）');
        }
        const payload = await response.json();
        const ids = availableChatModelIds(payload);
        if (!ids.length) throw new Error('接口未返回可识别的对话模型 ID');
        return ids;
    } finally {
        clearTimeout(timeout);
    }
}
