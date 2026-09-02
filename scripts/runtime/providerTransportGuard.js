import { APP } from '../../core/manager.js';
import { ROUTE, getProviderRoute, providerDebug } from './providerRoute.js';

let lastFingerprint = '';

function fingerprint(info) {
    return [
        info?.route ?? '',
        info?.source ?? '',
        info?.customHost ?? '',
        info?.reverseProxyHost ?? '',
        info?.model ?? '',
    ].join('|');
}

function guardProviderTransport(data) {
    if (!data || typeof data !== 'object') return;

    const route = getProviderRoute(data);
    const info = providerDebug(data);

    // Provider识别只决定Memo使用哪套“内容协议”，不再决定底层接口必须支持哪种结构化输出能力。
    // 很多OpenAI兼容中转虽然模型/来源显示为DeepSeek，却不完整支持 response_format/json_schema。
    // 因此DeepSeek JSON信封依靠Memo的system contract约束，避免向底层强塞 response_format。
    if (route === ROUTE.DEEPSEEK) {
        delete data.json_schema;
        if (data.response_format?.type === 'json_object') delete data.response_format;
    }

    // 中转路线保持纯文本tableEdit协议，确保任何残留结构化输出设置都不会污染请求。
    if (route === ROUTE.RELAY) {
        delete data.json_schema;
        if (data.response_format?.type === 'json_object' || data.response_format?.type === 'json_schema') {
            delete data.response_format;
        }
    }

    const nextFingerprint = fingerprint(info);
    if (nextFingerprint !== lastFingerprint) {
        lastFingerprint = nextFingerprint;
        console.log('[Memo-N][provider]', {
            route: info.route,
            source: info.source,
            customHost: info.customHost,
            reverseProxyHost: info.reverseProxyHost,
            model: info.model,
            directDeepSeek: info.directDeepSeek,
            responseFormat: data.response_format?.type ?? '',
            hasJsonSchema: !!data.json_schema,
        });
    }
}

const event = APP?.event_types?.CHAT_COMPLETION_SETTINGS_READY;
if (event) {
    APP.eventSource.on(event, guardProviderTransport);
    APP.eventSource.makeLast?.(event, guardProviderTransport);
}

console.log('[Memo-N] provider transport guard loaded: route只选内容协议，不再强绑接口结构化输出能力');
