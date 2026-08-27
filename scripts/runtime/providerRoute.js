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
    if (source === 'deepseek') return true;
    if (source !== 'custom') return false;

    const url = customUrlOf(data).toLowerCase();
    const hostLike = url.replace(/^https?:\/\//, '');
    return /(^|\.)deepseek\.com(?:\/|$)/.test(hostLike)
        || /api\.deepseek\.com/.test(url)
        || (!url && /^deepseek-/.test(modelOf(data)));
}

export function getProviderRoute(data) {
    // 1) 原生DeepSeek，或custom直连DeepSeek官方地址。
    if (isDirectDeepSeek(data)) return ROUTE.DEEPSEEK;

    const source = sourceOf(data);
    const customUrl = customUrlOf(data);
    const reverseProxy = String(data?.reverse_proxy ?? oai_settings?.reverse_proxy ?? '').trim();

    // 2) SillyTavern的“自定义(OpenAI兼容)”就是中转/兼容端点路线。
    //    不能先返回一个抽象CUSTOM，否则真正中转站永远到不了RELAY协议。
    if (source === 'custom') return ROUTE.RELAY;

    // 3) 原生provider通过反代时，同样按中转路线处理。
    if (customUrl || reverseProxy) return ROUTE.RELAY;

    // 4) 其余官方/原生provider走结构化JSON信封。
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
