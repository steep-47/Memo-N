import { EDITOR, USER } from '../../core/manager.js';
import { getManualProviderRoute, ROUTE, setManualProviderRoute } from '../runtime/providerRoute.js';

const ROUTE_ID = 'memo-record-provider-route';
const PREF_KEY = 'independent_record_api_enabled';

function getStore() {
    const root = USER?.getSettings?.();
    if (!root) return null;
    if (!root.memo_n_settings || typeof root.memo_n_settings !== 'object') root.memo_n_settings = {};
    return root.memo_n_settings;
}

function sanitizeDeprecatedRouteFields() {
    const store = getStore();
    if (!store) return false;
    let changed = false;
    for (const key of ['use_main_api', 'step_by_step_use_main_api']) {
        if (!Object.prototype.hasOwnProperty.call(store, key)) continue;
        delete store[key];
        changed = true;
    }
    return changed;
}

function readIndependentEnabled() {
    return getStore()?.[PREF_KEY] === true;
}

function syncModeSections(fillTime) {
    const independent = readIndependentEnabled();
    if (fillTime) fillTime.value = independent ? 'after' : 'chat';
    const replyOptions = document.querySelector('#reply_options');
    const stepOptions = document.querySelector('#step_by_step_options');
    if (replyOptions) replyOptions.style.display = independent ? 'none' : '';
    if (stepOptions) stepOptions.style.display = independent ? '' : 'none';
}

function applyIndependentMode(enabled, save = true) {
    const store = getStore();
    if (!store) return;
    store[PREF_KEY] = enabled === true;
    sanitizeDeprecatedRouteFields();
    // step_by_step 只允许 modeRuntimeControl 在主聊天 prompt 生命周期内临时使用；用户设置切换后必须归零。
    if (USER?.tableBaseSetting) USER.tableBaseSetting.step_by_step = false;
    syncModeSections(document.querySelector('#fill_table_time'));
    if (save) USER.saveSettings?.();
    console.log(`[Memo] 填表模式：${enabled ? '收到消息后独立记录' : '聊天同时填表'}`);
}

function applyProviderRoute(value, save = true) {
    const route = setManualProviderRoute(value);
    sanitizeDeprecatedRouteFields();
    const select = document.querySelector(`#${ROUTE_ID} select`);
    if (select) select.value = route;
    if (save) USER.saveSettings?.();
    EDITOR?.success?.(route === ROUTE.RELAY ? '记录接口：中转站' : '记录接口：DeepSeek');
    console.log(`[Memo] 记录接口已手动设为：${route}；全部API记录入口将直接读取此设置决定Provider与协议`);
}

function createRouteSelector() {
    const wrapper = document.createElement('label');
    wrapper.id = ROUTE_ID;
    wrapper.className = 'range-block flex-container flexGap5';
    wrapper.style.margin = '8px 0';

    const text = document.createElement('span');
    text.textContent = '记录接口';

    const select = document.createElement('select');
    select.style.maxWidth = '180px';
    select.innerHTML = `
        <option value="${ROUTE.DEEPSEEK}">DeepSeek</option>
        <option value="${ROUTE.RELAY}">中转站</option>
    `;

    const hint = document.createElement('small');
    hint.className = 'toggle-description justifyLeft';
    hint.textContent = '手动指定全部记录API的接口，不再自动识别';

    wrapper.append(text, select, hint);
    return wrapper;
}

function bindRouteSelector(select) {
    if (!select || select.dataset.memoRouteBound === '1') return;
    select.dataset.memoRouteBound = '1';
    select.addEventListener('change', () => applyProviderRoute(select.value, true));
}

function bindFillTime(fillTime) {
    if (!fillTime || fillTime.dataset.memoIndependentBound === '1') return;
    fillTime.dataset.memoIndependentBound = '1';
    // 原插件旧 userExtensionSetting 仍注册了 bubble change handler，会把 step_by_step 当持久模式写回。
    // 在目标捕获阶段由 Memo-N 唯一处理并停止后续旧监听，彻底隔离旧持久字段；不影响生成期的临时 bridge。
    fillTime.addEventListener('change', event => {
        event.stopImmediatePropagation();
        applyIndependentMode(fillTime.value === 'after', true);
    }, true);
}

function mount() {
    const legacyChanged = sanitizeDeprecatedRouteFields();
    if (legacyChanged) USER.saveSettings?.();
    const fillTime = document.querySelector('#fill_table_time');
    if (!fillTime) return false;
    const host = fillTime.parentElement;
    if (!host) return false;

    let routeWrapper = document.getElementById(ROUTE_ID);
    if (!routeWrapper) {
        routeWrapper = createRouteSelector();
        host.insertBefore(routeWrapper, fillTime.previousElementSibling || fillTime);
    }

    const select = routeWrapper.querySelector('select');
    bindRouteSelector(select);
    bindFillTime(fillTime);

    // 重挂载只同步 UI；Provider 与模式值都从 Memo-N 独立设置读取，不改生成期临时 step_by_step。
    const route = getManualProviderRoute();
    if (select) select.value = route;
    syncModeSections(fillTime);
    return true;
}

let mountQueued = false;
function scheduleMount() {
    if (mountQueued) return;
    mountQueued = true;
    queueMicrotask(() => {
        mountQueued = false;
        mount();
    });
}

// 设置面板在移动端可能很晚才被插入或被重新渲染。
// 页面整个生命周期内允许重新挂载，但重挂载必须无生成业务副作用。
mount();
const observer = new MutationObserver(scheduleMount);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('focus', scheduleMount);
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleMount();
});
// 导入旧设置文件后再次清理废弃路由字段；文件选择 input 是动态创建的，因此在 document 捕获 change。
document.addEventListener('change', event => {
    if (!event.target?.matches?.('input[type="file"]')) return;
    setTimeout(scheduleMount, 0);
    setTimeout(scheduleMount, 250);
}, true);

console.log('[Memo] 记录接口与填表模式控制已加载：单一路由选择 + 旧step/use_main_api监听隔离');
