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

export function normalizeProviderRoute(value) {
    const route = String(value ?? '').trim().toLowerCase();
    return route === ROUTE.RELAY || route === ROUTE.DEEPSEEK ? route : null;
}

export function resolveManualProviderRoute(explicit, stored) {
    return normalizeProviderRoute(explicit)
        ?? normalizeProviderRoute(stored)
        ?? DEFAULT_ROUTE;
}

function manualRoute(data) {
    // 只允许显式手动值或已保存的手动值；绝不读取 Provider、URL、模型名等自动识别字段。
    return resolveManualProviderRoute(
        data?.memo_n_record_provider,
        settingsStore()?.[ROUTE_KEY],
    );
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
    const route = normalizeProviderRoute(value) ?? DEFAULT_ROUTE;
    const store = settingsStore();
    if (store) store[ROUTE_KEY] = route;
    return route;
}
