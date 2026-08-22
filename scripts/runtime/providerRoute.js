import { oai_settings } from '/scripts/openai.js';

export const ROUTE = Object.freeze({
    DEEPSEEK: 'deepseek',
    CUSTOM: 'custom',
    RELAY: 'relay',
    NATIVE: 'native',
});

function sourceOf(data) {
    return String(data?.chat_completion_source ?? oai_settings?.chat_completion_source ?? '').trim().toLowerCase();
}

function customUrlOf(data) {
    return String(data?.custom_url ?? oai_settings?.custom_url ?? '').trim();
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

export function isDirectDeepSeek(data) {
    const source = sourceOf(data);
    // SillyTavern 原生 DeepSeek provider 的 source 就是 "deepseek"。
    // 一旦 source 明确为 deepseek，必须优先判定为直连 DeepSeek，忽略此前 CUSTOM/relay 遗留的 custom_url 或 reverse_proxy。
    if (source === 'deepseek') return true;
    if (source !== 'custom') return false;

    const url = customUrlOf(data).toLowerCase();
    const hostLike = url.replace(/^https?:\/\//, '');
    return /(^|\.)deepseek\.com(?:\/|$)/.test(hostLike)
        || /api\.deepseek\.com/.test(url)
        || (!url && /^deepseek-/.test(modelOf(data)));
}

export function getProviderRoute(data) {
    // Provider source takes precedence over stale connection-specific fields.
    if (isDirectDeepSeek(data)) return ROUTE.DEEPSEEK;

    const source = sourceOf(data);
    if (source === 'custom') return ROUTE.CUSTOM;

    const customUrl = customUrlOf(data);
    const reverseProxy = String(data?.reverse_proxy ?? oai_settings?.reverse_proxy ?? '').trim();
    if (customUrl || reverseProxy) return ROUTE.RELAY;

    return ROUTE.NATIVE;
}

export function providerDebug(data) {
    return {
        route: getProviderRoute(data),
        source: sourceOf(data),
        customUrl: customUrlOf(data),
        model: modelOf(data),
    };
}
