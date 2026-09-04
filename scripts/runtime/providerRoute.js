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

export function isDirectDeepSeek(data) {
    const source = sourceOf(data);
    if (reverseProxyOf(data)) return false;
    if (source === 'deepseek') return true;
    return source === 'custom' && isOfficialDeepSeekHost(customUrlOf(data));
}

export function isNativeDeepSeek(data) {
    return sourceOf(data) === 'deepseek' && !reverseProxyOf(data);
}
