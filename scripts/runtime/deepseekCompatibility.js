import { APP } from '../../core/manager.js';
import { oai_settings } from '/scripts/openai.js';

function sourceOf(data) {
    return String(data?.chat_completion_source ?? oai_settings?.chat_completion_source ?? '').trim().toLowerCase();
}

function customUrlOf(data) {
    return String(data?.custom_url ?? oai_settings?.custom_url ?? '').trim();
}

function modelOf(data) {
    return String(data?.model ?? oai_settings?.custom_model ?? oai_settings?.openai_model ?? '').trim().toLowerCase();
}

function isDirectDeepSeek(data) {
    if (sourceOf(data) !== 'custom') return false;
    const url = customUrlOf(data).toLowerCase();
    const model = modelOf(data);
    return /(^|\.)deepseek\.com(?:\/|$)/.test(url.replace(/^https?:\/\//, ''))
        || /api\.deepseek\.com/.test(url)
        || (!url && /^deepseek-/.test(model));
}

function appendJsonObjectMode(data) {
    const block = 'response_format:\n  type: json_object';
    const current = data.custom_include_body;

    if (typeof current === 'string') {
        const trimmed = current.trim();
        if (!trimmed) {
            data.custom_include_body = block;
            return;
        }
        if (/(^|\n)\s*response_format\s*:/i.test(trimmed)) {
            // 用户已经显式配置 response_format；避免制造重复 YAML key。
            return;
        }
        data.custom_include_body = `${trimmed}\n${block}`;
        return;
    }

    if (current && typeof current === 'object' && !Array.isArray(current)) {
        data.custom_include_body = { ...current, response_format: { type: 'json_object' } };
        return;
    }

    data.custom_include_body = block;
}

function applyDeepSeekCompatibility(data) {
    if (!data || typeof data !== 'object' || !isDirectDeepSeek(data)) return;

    // DeepSeek 官方 Chat Completions 只接受 response_format.type=text/json_object。
    // SillyTavern 对 CUSTOM 的 json_schema 会转译成 type=json_schema，DeepSeek 会直接 400。
    delete data.json_schema;
    appendJsonObjectMode(data);

    globalThis.__memoNDeepSeekCompatibility = {
        at: Date.now(),
        url: customUrlOf(data),
        model: modelOf(data),
        jsonObject: true,
    };
    console.log('[Memo-N] DeepSeek兼容层：已禁用CUSTOM json_schema，改用官方 response_format=json_object；记录顺序仍为changes→reply');
}

const event = APP.event_types.CHAT_COMPLETION_SETTINGS_READY;
APP.eventSource.on(event, applyDeepSeekCompatibility);
APP.eventSource.makeLast?.(event, applyDeepSeekCompatibility);

console.log('[Memo-N] DeepSeek兼容层已加载：仅处理直连 api.deepseek.com，不改变其他CUSTOM中转站');
