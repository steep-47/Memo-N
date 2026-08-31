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

// 保留纯函数给迁移/测试使用；真实运行时不接受请求对象上的临时覆盖值。
export function resolveManualProviderRoute(explicit, stored) {
    return normalizeProviderRoute(explicit)
        ?? normalizeProviderRoute(stored)
        ?? DEFAULT_ROUTE;
}

function manualRoute() {
    // “记录接口”持久设置是唯一运行时权威来源。
    // 不读取请求对象、Provider、URL、模型名、custom/reverse_proxy等字段，也不接受隐藏的单次请求覆盖。
    return normalizeProviderRoute(settingsStore()?.[ROUTE_KEY]) ?? DEFAULT_ROUTE;
}

export function getProviderRoute(_data) {
    return manualRoute();
}

export function providerDebug(_data) {
    return {
        route: manualRoute(),
        automaticDetection: false,
        source: ROUTE_KEY,
    };
}

export function getManualProviderRoute() {
    return manualRoute();
}

export function setManualProviderRoute(value) {
    const route = normalizeProviderRoute(value) ?? DEFAULT_ROUTE;
    const store = settingsStore();
    if (store) store[ROUTE_KEY] = route;
    return route;
}
