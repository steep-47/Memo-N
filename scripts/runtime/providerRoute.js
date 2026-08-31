import { USER } from '../../core/manager.js';

export const ROUTE = Object.freeze({
    DEEPSEEK: 'deepseek',
    RELAY: 'relay',
});

const ROUTE_KEY = 'record_provider_route';
const DEFAULT_ROUTE = ROUTE.DEEPSEEK;

function settingsStore() {
    const root = USER?.getSettings?.();
    if (!root) return null;
    if (!root.memo_n_settings || typeof root.memo_n_settings !== 'object') root.memo_n_settings = {};
    return root.memo_n_settings;
}

function normalizeRoute(value) {
    const route = String(value ?? '').trim().toLowerCase();
    return route === ROUTE.RELAY || route === ROUTE.DEEPSEEK ? route : null;
}

function manualRoute(data) {
    // 明确传入的手动值优先；没有明确值才读取已保存的全局选择。
    // 不读取 Provider、URL、模型名或任何 SillyTavern 自动识别字段。
    const explicit = normalizeRoute(data?.memo_n_record_provider);
    if (explicit) return explicit;

    const stored = normalizeRoute(settingsStore()?.[ROUTE_KEY]);
    return stored ?? DEFAULT_ROUTE;
}

export function getProviderRoute(data) {
    return manualRoute(data);
}

export function providerDebug(data) {
    return {
        route: manualRoute(data),
        automaticDetection: false,
    };
}

export function getManualProviderRoute() {
    return manualRoute({});
}

export function setManualProviderRoute(value) {
    const route = normalizeRoute(value) ?? DEFAULT_ROUTE;
    const store = settingsStore();
    if (store) store[ROUTE_KEY] = route;
    return route;
}
