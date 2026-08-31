import { EDITOR, USER } from '../../core/manager.js';
import { getManualProviderRoute, ROUTE, setManualProviderRoute } from '../runtime/providerRoute.js';

const TOGGLE_ID = 'memory-independent-record-api';
const ROUTE_ID = 'memo-record-provider-route';
const PREF_KEY = 'independent_record_api_enabled';

function getStore() {
    const root = USER?.getSettings?.();
    if (!root) return null;
    if (!root.memo_n_settings || typeof root.memo_n_settings !== 'object') root.memo_n_settings = {};
    return root.memo_n_settings;
}

function readEnabled() {
    return getStore()?.[PREF_KEY] === true;
}

function keepConfigSectionsVisible() {
    const replyOptions = document.querySelector('#reply_options');
    const stepOptions = document.querySelector('#step_by_step_options');
    if (replyOptions) replyOptions.style.display = '';
    if (stepOptions) stepOptions.style.display = '';
}

function syncModeUi() {
    const checkbox = document.querySelector(`#${TOGGLE_ID} input[type="checkbox"]`);
    if (checkbox) checkbox.checked = readEnabled();
}

function applyMode(enabled, save = true) {
    const value = enabled === true;
    const store = getStore();
    if (!store) return;
    store[PREF_KEY] = value;
    // 新独立记录模式与原插件 step_by_step 不能同时作为自动触发入口，
    // 仅在用户主动切换“独立记录 API”时关闭旧自动分步开关。
    USER.tableBaseSetting.step_by_step = false;
    syncModeUi();
    keepConfigSectionsVisible();
    if (save) USER.saveSettings?.();
    console.log(`[Memo] 独立记录 API：${value ? '开启（正文后额外1次API记录）' : '关闭（正文与填表共用1次API）'}`);
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

function createToggle() {
    const label = document.createElement('label');
    label.id = TOGGLE_ID;
    label.className = 'checkbox_label range-block justifyLeft';
    label.style.margin = '8px 0';

    const input = document.createElement('input');
    input.type = 'checkbox';

    const text = document.createElement('span');
    text.textContent = '独立记录 API';

    const hint = document.createElement('small');
    hint.className = 'toggle-description justifyLeft';
    hint.textContent = '（关闭：正文与填表共用1次API；开启：正文后额外调用1次API记录）';

    label.append(input, text, hint);
    return label;
}

function bindRouteSelector(select) {
    if (!select || select.dataset.memoRouteBound === '1') return;
    select.dataset.memoRouteBound = '1';
    select.addEventListener('change', () => applyProviderRoute(select.value, true));
}

function bindIndependentToggle(input) {
    if (!input || input.dataset.memoIndependentBound === '1') return;
    input.dataset.memoIndependentBound = '1';
    input.addEventListener('change', () => applyMode(input.checked, true));
}

function mount() {
    const fillTime = document.querySelector('#fill_table_time');
    if (!fillTime) return false;
    const host = fillTime.parentElement;
    if (!host) return false;

    let routeWrapper = document.getElementById(ROUTE_ID);
    if (!routeWrapper) {
        routeWrapper = createRouteSelector();
        host.insertBefore(routeWrapper, fillTime);
    }

    let toggleWrapper = document.getElementById(TOGGLE_ID);
    if (!toggleWrapper) {
        toggleWrapper = createToggle();
        host.insertBefore(toggleWrapper, fillTime.nextSibling);
    }

    const select = routeWrapper.querySelector('select');
    const toggleInput = toggleWrapper.querySelector('input[type="checkbox"]');
    bindRouteSelector(select);
    bindIndependentToggle(toggleInput);

    // 重挂载只同步 UI，不得改写 step_by_step、step_by_step_use_main_api 或独立记录配置。
    syncModeUi();
    const route = getManualProviderRoute();
    if (select) select.value = route;
    if (toggleInput) toggleInput.checked = readEnabled();
    keepConfigSectionsVisible();
    requestAnimationFrame(keepConfigSectionsVisible);
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

console.log('[Memo] 全部记录接口手动选择已加载：DeepSeek / 中转站；设置面板支持无副作用延迟/重渲染挂载');