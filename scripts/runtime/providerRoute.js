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
    if (reverseProxy) return false;
    if (source === 'deepseek') return true;
    if (source !== 'custom') return false;
    return isOfficialDeepSeekHost(customUrlOf(data));
}

export function getProviderRoute(data) {
    return isDirectDeepSeek(data) ? ROUTE.DEEPSEEK : ROUTE.RELAY;
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
        directDeepSeek: route === ROUTE.DEEPSEEK,
    };
}
