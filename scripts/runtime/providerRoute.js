import { oai_settings } from '/scripts/openai.js';

export const ROUTE = Object.freeze({
    DEEPSEEK: 'deepseek',
    RELAY: 'relay',
    NATIVE: 'native',
});

function sourceOf(data) {
    return String(data?.chat_completion_source ?? oai_settings?.chat_completion_source ?? '').trim().toLowerCase();
}

function customUrlOf(data) {
    return String(data?.custom_url ?? oai_settings?.custom_url ?? '').trim();
}

function reverseProxyOf(data) {
    return String(data?.reverse_proxy ?? oai_settings?.reverse_proxy ?? '').trim();
}

function modelOf(data) {
    return String(
        data?.model
        ?? oai_settings?.deepseek_model
        ?? oai_settings?.custom_model
        ?? oai_settings?.openai_model
        ?? ''
    ).trim().toLowerCase();
}

function hostnameOf(rawUrl) {
    const value = String(rawUrl ?? '').trim();
    if (!value) return '';
    try {
        const normalized = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
        return new URL(normalized).hostname.toLowerCase().replace(/\.$/, '');
    } catch (_) {
        return value
            .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
            .split(/[/?#]/, 1)[0]
            .split(':', 1)[0]
            .toLowerCase()
            .replace(/\.$/, '');
    }
}

function isOfficialDeepSeekHost(rawUrl) {
    const host = hostnameOf(rawUrl);
    return host === 'deepseek.com' || host.endsWith('.deepseek.com');
}

export function isDirectDeepSeek(data) {
    const source = sourceOf(data);
    const reverseProxy = reverseProxyOf(data);

    // 只要当前请求明确经过反代，就不能再按DeepSeek官方直连处理。
    if (reverseProxy) return false;

    // SillyTavern原生DeepSeek且未启用反代，才是真正直连。
    if (source === 'deepseek') return true;

    // 自定义(OpenAI兼容)只有当实际目标主机就是DeepSeek官方域名时，才视为直连。
    if (source !== 'custom') return false;
    return isOfficialDeepSeekHost(customUrlOf(data));
}

export function getProviderRoute(data) {
    const source = sourceOf(data);
    const customUrl = customUrlOf(data);
    const reverseProxy = reverseProxyOf(data);

    // 1) 原生DeepSeek/官方DeepSeek自定义地址，且没有反代。
    if (isDirectDeepSeek(data)) return ROUTE.DEEPSEEK;

    // 2) 任何明确反代都属于中转路线。优先级必须高于provider名称和模型名称。
    if (reverseProxy) return ROUTE.RELAY;

    // 3) SillyTavern的自定义(OpenAI兼容)只要不是DeepSeek官方域名，就是中转/兼容端点。
    if (source === 'custom') return ROUTE.RELAY;

    // 4) 非custom请求如果请求体本轮显式给出了自定义地址，也按中转处理；
    //    不使用oai_settings里可能残留的custom_url误伤当前原生provider。
    if (Object.prototype.hasOwnProperty.call(data ?? {}, 'custom_url') && customUrl) return ROUTE.RELAY;

    // 5) 其余官方/原生provider走结构化JSON信封。
    return ROUTE.NATIVE;
}

export function providerDebug(data) {
    const source = sourceOf(data);
    const customUrl = customUrlOf(data);
    const reverseProxy = reverseProxyOf(data);
    const route = getProviderRoute(data);
    return {
        route,
        source,
        customUrl,
        customHost: hostnameOf(customUrl),
        reverseProxy,
        reverseProxyHost: hostnameOf(reverseProxy),
        model: modelOf(data),
        directDeepSeek: isDirectDeepSeek(data),
    };
}
