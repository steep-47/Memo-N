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

function manualRoute(data) {
    const explicit = String(data?.memo_n_record_provider ?? '').trim().toLowerCase();
    const stored = String(settingsStore()?.[ROUTE_KEY] ?? '').trim().toLowerCase();
    return explicit === ROUTE.RELAY || stored === ROUTE.RELAY ? ROUTE.RELAY : DEFAULT_ROUTE;
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
    const route = String(value ?? '').trim().toLowerCase() === ROUTE.RELAY ? ROUTE.RELAY : ROUTE.DEEPSEEK;
    const store = settingsStore();
    if (store) store[ROUTE_KEY] = route;
    return route;
}
