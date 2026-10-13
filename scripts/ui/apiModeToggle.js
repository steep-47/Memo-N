import { USER } from '../../core/manager.js';

const PREF_KEY = 'independent_record_api_enabled';
const SWITCH_ID = 'memo-independent-api-switch';
const SELECT_ID = 'memo-record-provider-select';

function readEnabled() {
    return USER?.getSettings?.()?.memo_n_settings?.[PREF_KEY] === true;
}

function keepOriginalSettingsVisible() {
    for (const id of ['reply_options', 'step_by_step_options']) {
        const node = document.getElementById(id);
        if (node) node.style.display = '';
    }
}

function syncNativeApiPanel() {
    const select = document.getElementById(SELECT_ID);
    const provider = document.getElementById('memo-record-provider-choice');
    const nativeUrl = document.getElementById('custom_api_url');
    const drawer = nativeUrl?.closest('.inline-drawer');
    if (!select || !provider || !drawer) return false;

    // Reuse the original Memo-N drawer and all its existing URL/Key/model
    // bindings rather than creating duplicate form controls.
    if (drawer.previousElementSibling !== provider) {
        provider.insertAdjacentElement('afterend', drawer);
    }
    drawer.id = 'memo-record-custom-panel';
    const custom = select.value === 'custom';
    drawer.style.display = custom ? '' : 'none';
    if (custom) {
        const content = drawer.querySelector(':scope > .inline-drawer-content');
        if (content) content.style.display = 'block';
        const arrow = drawer.querySelector(':scope > .inline-drawer-toggle > .inline-drawer-icon');
        if (arrow) {
            arrow.classList.remove('down', 'fa-circle-chevron-down');
            arrow.classList.add('up', 'fa-circle-chevron-up');
        }
    }
    return true;
}

function mount() {
    const input = document.getElementById(SWITCH_ID);
    const select = document.getElementById(SELECT_ID);
    if (!input || !select || !document.getElementById('custom_api_url')) return false;

    input.checked = readEnabled();
    select.value = USER.tableBaseSetting.step_by_step_use_main_api === false ? 'custom' : 'main';

    const outputLimit = document.getElementById('memo-record-max-tokens');
    if (outputLimit) {
        outputLimit.value = String(USER.tableBaseSetting.custom_max_tokens ?? 8192);
        if (!outputLimit.dataset.memoBound) {
            outputLimit.dataset.memoBound = '1';
            outputLimit.addEventListener('change', () => {
                const value = Number(outputLimit.value);
                if (!Number.isSafeInteger(value) || value < 256 || value > 65536) {
                    globalThis.toastr?.warning?.('最大输出 Token 范围为 256～65536');
                    outputLimit.value = String(USER.tableBaseSetting.custom_max_tokens ?? 8192);
                    return;
                }
                USER.tableBaseSetting.custom_max_tokens = value;
                USER.saveSettings?.();
            });
        }
    }

    if (!input.dataset.memoBound) {
        input.dataset.memoBound = '1';
        input.addEventListener('change', () => {
            const settings = USER.getSettings?.();
            if (!settings) return;
            if (!settings.memo_n_settings || typeof settings.memo_n_settings !== 'object') {
                settings.memo_n_settings = {};
            }
            settings.memo_n_settings[PREF_KEY] = input.checked;
            USER.tableBaseSetting.step_by_step = false;
            USER.saveSettings?.();
        });
    }
    if (!select.dataset.memoBound) {
        select.dataset.memoBound = '1';
        select.addEventListener('change', () => {
            USER.tableBaseSetting.step_by_step_use_main_api = select.value !== 'custom';
            USER.saveSettings?.();
            syncNativeApiPanel();
        });
    }

    USER.tableBaseSetting.step_by_step = false;
    syncNativeApiPanel();
    keepOriginalSettingsVisible();
    requestAnimationFrame(keepOriginalSettingsVisible);
    return true;
}

if (!mount()) {
    const observer = new MutationObserver(() => {
        if (mount()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
}

console.log('[Memo-N] 独立记录 API 复用原有设置界面已加载');
