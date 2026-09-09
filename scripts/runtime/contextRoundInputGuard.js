import { USER } from '../../core/manager.js';

const DEFAULT_ROUNDS = 1;
const SELECTOR = '#separateReadContextLayers';
let lastValid = DEFAULT_ROUNDS;

function normalized(value, fallback = DEFAULT_ROUNDS) {
    if (value === undefined || value === null || String(value).trim() === '') return fallback;
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 0 ? numeric : fallback;
}

function applyUiHints(input = document.querySelector(SELECTOR)) {
    if (!input) return;
    input.setAttribute('min', '0');
    input.setAttribute('step', '1');
    input.setAttribute('required', 'required');
    input.title = '0轮：不读取额外聊天上下文，只使用上一轮表格基线 + 当前待处理回复；1轮及以上：额外读取对应轮数的前文。';
    const label = document.querySelector('label[for="separateReadContextLayers"]');
    if (label) label.title = input.title;
}

function install() {
    lastValid = normalized(USER?.tableBaseSetting?.separateReadContextLayers, DEFAULT_ROUNDS);
    if (USER?.tableBaseSetting) USER.tableBaseSetting.separateReadContextLayers = lastValid;

    applyUiHints();
    const input = document.querySelector(SELECTOR);
    if (input && String(input.value ?? '').trim() === '') input.value = String(lastValid);

    jQuery(document)
        .off('.memoNContextRounds')
        .on('focusin.memoNContextRounds', SELECTOR, function () {
            lastValid = normalized(USER?.tableBaseSetting?.separateReadContextLayers, lastValid);
            applyUiHints(this);
        })
        .on('input.memoNContextRounds', SELECTOR, function () {
            const raw = String(this.value ?? '').trim();
            if (!raw) {
                // userExtensionSetting 的旧 input 处理器会先把空字符串 Number('') 成 0；这里立即恢复上一个合法值。
                USER.tableBaseSetting.separateReadContextLayers = lastValid;
                return;
            }
            const numeric = Number(raw);
            if (Number.isInteger(numeric) && numeric >= 0) {
                lastValid = numeric;
                USER.tableBaseSetting.separateReadContextLayers = numeric;
                return;
            }
            USER.tableBaseSetting.separateReadContextLayers = lastValid;
        })
        .on('focusout.memoNContextRounds change.memoNContextRounds', SELECTOR, function () {
            const raw = String(this.value ?? '').trim();
            const numeric = Number(raw);
            if (raw && Number.isInteger(numeric) && numeric >= 0) {
                lastValid = numeric;
                USER.tableBaseSetting.separateReadContextLayers = numeric;
                this.value = String(numeric);
            } else {
                USER.tableBaseSetting.separateReadContextLayers = lastValid;
                this.value = String(lastValid);
            }
            applyUiHints(this);
        });
}

jQuery(install);

console.log('[Memo-N] 上下文轮数输入守卫已加载：0为有效值，空白不保存');
