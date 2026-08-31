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
    // 原插件自己的 #fill_table_time change handler 仍会把旧 step_by_step 写成持久状态。
    // Memo-N 模式的唯一持久真值是 independent_record_api_enabled，因此用户切换后立即把旧字段归零；
    // 真正构建主聊天 prompt 时由 modeRuntimeControl 只在事件分发期间临时桥接。
    if (USER?.tableBaseSetting) USER.tableBaseSetting.step_by_step = false;
    syncModeSections(document.querySelector('#fill_table_time'));
    if (save) USER.saveSettings?.();
    console.log(`[Memo] 填表模式：${enabled ? '收到消息后独立记录' : '聊天同时填表'}`);
}

function applyProviderRoute(value, save = true) {
    const route = setManualProviderRoute(value);
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
    fillTime.addEventListener('change', () => applyIndependentMode(fillTime.value === 'after', true));
}

function mount() {
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

    // 重挂载只同步 UI；Provider 与模式值都从 Memo-N 独立设置读取，不改旧 step_by_step 主/自定义路由字段。
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
// 页面整个生命周期内允许重新挂载，但重挂载必须无业务副作用。
mount();
const observer = new MutationObserver(scheduleMount);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('focus', scheduleMount);
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleMount();
});

console.log('[Memo] 记录接口与填表模式控制已加载：单一路由选择 + 原生填表时机选择器');
