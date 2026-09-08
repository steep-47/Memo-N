import { oai_settings } from '/scripts/openai.js';

function sourceOf(data) {
    return String(data?.chat_completion_source ?? oai_settings?.chat_completion_source ?? '').trim().toLowerCase();
}

function customUrlOf(data) {
    return String(data?.custom_url ?? oai_settings?.custom_url ?? '').trim();
}

function reverseProxyOf(data) {
    return String(data?.reverse_proxy ?? oai_settings?.reverse_proxy ?? '').trim();
}

function hostnameOf(rawUrl) {
    const value = String(rawUrl ?? '').trim();
    if (!value) return '';
    try {
        const normalized = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
        return new URL(normalized).hostname.toLowerCase().replace(/\.$/, '');
    } catch (_) {
        return value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/, 1)[0].split(':', 1)[0].toLowerCase().replace(/\.$/, '');
    }
}

function isOfficialDeepSeekHost(rawUrl) {
    const host = hostnameOf(rawUrl);
    return host === 'deepseek.com' || host.endsWith('.deepseek.com');
}

function deepSeekPrefixBetaUrl(rawUrl) {
    const value = String(rawUrl ?? '').trim();
    if (!value) return '';
    try {
        const normalized = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
        const url = new URL(normalized);
        if (!isOfficialDeepSeekHost(url.hostname)) return '';

        const path = url.pathname.replace(/\/+$/, '');
        // SillyTavern CUSTOM这里配置的是API基址。只接管官方常见基址，
        // 不改写用户自行配置的其他DeepSeek路径，避免误伤代理或特殊网关。
        if (path && path !== '/v1' && path !== '/beta') return '';

        url.pathname = '/beta';
        url.search = '';
        url.hash = '';
        return url.toString().replace(/\/$/, '');
    } catch (_) {
        return '';
    }
}

export function isDirectDeepSeek(data) {
    const source = sourceOf(data);
    if (reverseProxyOf(data)) return false;
    if (source === 'deepseek') return true;
    return source === 'custom' && isOfficialDeepSeekHost(customUrlOf(data));
}

export function isNativeDeepSeek(data) {
    const source = sourceOf(data);
    if (reverseProxyOf(data)) return false;
    if (source === 'deepseek') return true;
    if (source !== 'custom') return false;

    // recordEngine把这个判断用于DeepSeek助手前缀传输。
    // 官方DeepSeek若通过CUSTOM直连，则只把“当前这一份请求数据”的基址
    // 临时切到官方 /beta；仍使用原CUSTOM密钥、原模型与同一次正文API。
    const betaUrl = deepSeekPrefixBetaUrl(customUrlOf(data));
    if (!betaUrl) return false;
    if (data && typeof data === 'object') data.custom_url = betaUrl;
    return true;
}
