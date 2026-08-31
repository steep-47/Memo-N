import { oai_settings } from '/scripts/openai.js';

export const ROUTE = Object.freeze({
    DEEPSEEK: 'deepseek',
    RELAY: 'relay',
});

const ROUTE_KEY = 'record_provider_route';
const DEFAULT_ROUTE = ROUTE.DEEPSEEK;

function settingsStore() {
    const root = globalThis?.SillyTavern?.getContext?.()?.extensionSettings
        ?? globalThis?.extensionSettings
        ?? null;
    if (!root) return null;
    if (!root.memo_n_settings || typeof root.memo_n_settings !== 'object') root.memo_n_settings = {};
    return root.memo_n_settings;
}

function manualRoute(data) {
    const explicit = String(data?.memo_n_record_provider ?? '').trim().toLowerCase();
    const stored = String(settingsStore()?.[ROUTE_KEY] ?? '').trim().toLowerCase();
    const value = explicit || stored || DEFAULT_ROUTE;
    return value === ROUTE.RELAY ? ROUTE.RELAY : ROUTE.DEEPSEEK;
}

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

export function getProviderRoute(data) {
    return manualRoute(data);
}

export function providerDebug(data) {
    return {
        route: manualRoute(data),
        source: sourceOf(data),
        customUrl: customUrlOf(data),
        model: modelOf(data),
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
