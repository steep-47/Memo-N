import { USER } from '../../core/manager.js';
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

function applyMode(enabled, save = true) {
    const value = enabled === true;
    const store = getStore();
    if (!store) return;
    store[PREF_KEY] = value;
    USER.tableBaseSetting.step_by_step = false;
    const checkbox = document.querySelector(`#${TOGGLE_ID} input[type="checkbox"]`);
    if (checkbox) checkbox.checked = value;
    keepConfigSectionsVisible();
    if (save) USER.saveSettings?.();
    console.log(`[Memo] 独立记录 API：${value ? '开启（正文后额外1次API记录）' : '关闭（正文与填表共用1次API）'}`);
}

function applyProviderRoute(value, save = true) {
    const route = setManualProviderRoute(value);
    const select = document.querySelector(`#${ROUTE_ID}`);
    if (select) select.value = route;
    if (save) USER.saveSettings?.();
    EDITOR?.success?.(route === ROUTE.RELAY ? '记录接口：中转站' : '记录接口：DeepSeek');
    console.log(`[Memo] 记录接口已手动设为：${route}`);
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
    select.value = getManualProviderRoute();
    select.addEventListener('change', () => applyProviderRoute(select.value, true));

    const hint = document.createElement('small');
    hint.className = 'toggle-description justifyLeft';
    hint.textContent = '手动指定记录协议，不再自动识别';

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
    input.checked = readEnabled();

    const text = document.createElement('span');
    text.textContent = '独立记录 API';

    const hint = document.createElement('small');
    hint.className = 'toggle-description justifyLeft';
    hint.textContent = '（关闭：正文与填表共用1次API；开启：正文后额外调用1次API记录）';

    input.addEventListener('change', () => applyMode(input.checked, true));
    label.append(input, text, hint);
    return label;
}

function mount() {
    const fillTime = document.querySelector('#fill_table_time');
    if (!fillTime) return false;
    const host = fillTime.parentElement;
    if (!host) return false;

    if (!document.getElementById(ROUTE_ID)) host.insertBefore(createRouteSelector(), fillTime);
    if (!document.getElementById(TOGGLE_ID)) host.insertBefore(createToggle(), fillTime.nextSibling);

    applyMode(readEnabled(), false);
    const select = document.querySelector(`#${ROUTE_ID}`);
    if (select) select.value = getManualProviderRoute();
    keepConfigSectionsVisible();
    requestAnimationFrame(keepConfigSectionsVisible);
    setTimeout(keepConfigSectionsVisible, 100);
    setTimeout(keepConfigSectionsVisible, 500);
    return true;
}

if (!mount()) {
    const observer = new MutationObserver(() => {
        if (mount()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 10000);
}

console.log('[Memo] 记录接口手动选择已加载：DeepSeek / 中转站；自动识别已关闭');
