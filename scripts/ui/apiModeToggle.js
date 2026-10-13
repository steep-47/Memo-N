import { USER } from '../../core/manager.js';
import { processApiKey, handleApiTestRequest } from '../settings/standaloneAPI.js';
import { generateDeviceId } from '../../utils/utility.js';

const TOGGLE_ID = 'memory-independent-record-api';
const PREF_KEY = 'independent_record_api_enabled';

function getStore() {
    const root = USER?.getSettings?.();
    if (!root) return null;
    if (!root.memo_n_settings || typeof root.memo_n_settings !== 'object') {
        root.memo_n_settings = {};
    }
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

    // 独立记录 API 使用自己的持久化开关；旧 step_by_step 不再作为模式状态保存。
    // 它只会由 modeRuntimeControl 在受控时机短暂借用，常态必须为 false。
    store[PREF_KEY] = value;
    USER.tableBaseSetting.step_by_step = false;

    const checkbox = document.querySelector(`#${TOGGLE_ID} input[type="checkbox"]`);
    if (checkbox) checkbox.checked = value;

    // 独立 API 模式与设置面板显隐彻底解耦：两组配置始终可见。
    keepConfigSectionsVisible();

    if (save) USER.saveSettings?.();
    console.log(`[Memo] 独立记录 API：${value ? '开启（正文正常生成，随后额外1次API记录）' : '关闭（正文与填表共用1次API）'}`);
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
    hint.textContent = '（默认关闭：正文与填表共用1次API；开启后会额外调用1次记录API）';

    input.addEventListener('change', () => applyMode(input.checked, true));
    label.append(input, text, hint);
    return label;
}

function createProviderChoice() {
    const wrap = document.createElement('label');
    wrap.id = 'memo-record-provider-choice';
    wrap.style.display = 'block';
    wrap.style.margin = '6px 0 10px';
    wrap.textContent = '独立填表使用：';
    const select = document.createElement('select');
    select.style.marginLeft = '8px';
    for (const [value, label] of [['main', '主聊天 API'], ['custom', '自定义 API（使用下方 URL / Key / 模型）']]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
    }
    select.value = USER.tableBaseSetting.step_by_step_use_main_api === false ? 'custom' : 'main';
    select.addEventListener('change', () => {
        USER.tableBaseSetting.step_by_step_use_main_api = select.value !== 'custom';
        USER.saveSettings?.();
        syncCustomPanel();
    });
    wrap.appendChild(select);
    return wrap;
}

function syncCustomPanel() {
    const panel = document.getElementById('memo-record-custom-panel');
    const select = document.querySelector('#memo-record-provider-choice select');
    if (panel && select) panel.style.display = select.value === 'custom' ? 'grid' : 'none';
}

function createCustomPanel() {
    const panel = document.createElement('div');
    panel.id = 'memo-record-custom-panel';
    panel.style.cssText = 'margin:4px 0 12px;padding:8px 0 0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 10px;';
    const field = (label, type, placeholder, value, change) => {
        const row = document.createElement('label');
        row.style.cssText = 'display:block;margin:0;min-width:0;';
        const heading = document.createElement('span');
        heading.textContent = label;
        heading.style.cssText = 'display:block;margin-bottom:3px;font-size:0.9em;';
        const input = document.createElement('input');
        input.type = type;
        input.placeholder = placeholder;
        input.value = value ?? '';
        input.className = 'text_pole';
        input.style.cssText = 'width:100%;box-sizing:border-box;min-width:0;';
        input.addEventListener('change', () => change(input.value));
        row.append(heading, input);
        panel.appendChild(row);
        return input;
    };
    const privacy = USER.IMPORTANT_USER_PRIVACY_DATA;
    const urlInput = field('API URL', 'url', 'https://example.com/v1', privacy.custom_api_url, value => {
        privacy.custom_api_url = value.trim();
        USER.saveSettings?.();
    });
    urlInput.parentElement.style.gridColumn = '1 / -1';
    const key = field('API Key', 'password', privacy.custom_api_key ? '已保存密钥；留空不修改' : '填写 API Key', '', value => {
        if (!value.trim()) return;
        const result = processApiKey(value, generateDeviceId());
        privacy.custom_api_key = result.encryptedResult.encrypted || result.encryptedResult;
        key.value = '';
        key.placeholder = '已保存密钥；留空不修改';
        USER.saveSettings?.();
    });
    key.parentElement.style.gridColumn = '1 / -1';
    field('模型 ID', 'text', '例如 gpt-4.1-mini', privacy.custom_model_name, value => {
        privacy.custom_model_name = value.trim();
        USER.saveSettings?.();
    });
    const temp = field('Temperature', 'number', '0.3', USER.tableBaseSetting.custom_temperature ?? 0.3, value => {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0 || n > 2) return;
        USER.tableBaseSetting.custom_temperature = n;
        USER.saveSettings?.();
    });
    temp.min = '0'; temp.max = '2'; temp.step = '0.1';
    const test = document.createElement('button');
    test.type = 'button';
    test.className = 'menu_button';
    test.textContent = '测试 API 连接';
    test.addEventListener('click', async () => {
        test.disabled = true;
        try {
            await handleApiTestRequest(privacy.custom_api_url, privacy.custom_api_key, privacy.custom_model_name);
        } finally { test.disabled = false; }
    });
    test.style.cssText = 'grid-column:1 / -1;justify-self:start;margin-top:4px;';
    panel.appendChild(test);
    return panel;
}

function mount() {
    const fillTime = document.querySelector('#fill_table_time');
    if (!fillTime) return false;

    if (!document.getElementById(TOGGLE_ID)) {
        const host = fillTime.parentElement;
        if (!host) return false;
        host.insertBefore(createToggle(), fillTime.nextSibling);
    }

    if (!document.getElementById('memo-record-provider-choice')) {
        document.getElementById(TOGGLE_ID)?.insertAdjacentElement('afterend', createProviderChoice());
    }

    if (!document.getElementById('memo-record-custom-panel')) {
        document.getElementById('memo-record-provider-choice')?.insertAdjacentElement('afterend', createCustomPanel());
    }
    syncCustomPanel();

    // 加载时只恢复我们自己的开关；旧 step_by_step 仍保持关闭。
    applyMode(readEnabled(), false);
    keepConfigSectionsVisible();

    // 原作者其他代码若随后再次改显隐，下一帧再恢复一次。
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

console.log('[Memo] 独立记录 API 开关已加载（与旧 step_by_step 完全解耦）');
