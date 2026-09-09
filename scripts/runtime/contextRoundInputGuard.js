import { USER } from '../../core/manager.js';

const DEFAULT_ROUNDS = 1;
const MIN_ROUNDS = 1;
const SELECTOR = '#separateReadContextLayers';

function normalized(value, fallback = DEFAULT_ROUNDS) {
    if (value === undefined || value === null || String(value).trim() === '') return fallback;
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= MIN_ROUNDS ? numeric : fallback;
}

let lastValid = normalized(USER?.tableBaseSetting?.separateReadContextLayers, DEFAULT_ROUNDS);
if (USER?.tableBaseSetting) USER.tableBaseSetting.separateReadContextLayers = lastValid;

function applyUiHints(input = document.querySelector(SELECTOR)) {
    if (!input) return;
    input.setAttribute('min', String(MIN_ROUNDS));
    input.setAttribute('step', '1');
    input.setAttribute('required', 'required');
    input.title = '上下文轮数最小为1；1轮会读取触发当前AI回复的上一轮用户消息，当前AI回复本身作为待记录内容单独处理。';
    const label = document.querySelector('label[for="separateReadContextLayers"]');
    if (label) label.title = input.title;
}

function install() {
    lastValid = normalized(USER?.tableBaseSetting?.separateReadContextLayers, DEFAULT_ROUNDS);
    if (USER?.tableBaseSetting) USER.tableBaseSetting.separateReadContextLayers = lastValid;

    applyUiHints();
    const input = document.querySelector(SELECTOR);
    if (input) input.value = String(lastValid);

    jQuery(document)
        .off('.memoNContextRounds')
        .on('focusin.memoNContextRounds', SELECTOR, function () {
            lastValid = normalized(USER?.tableBaseSetting?.separateReadContextLayers, lastValid);
            applyUiHints(this);
        })
        .on('input.memoNContextRounds', SELECTOR, function () {
            const raw = String(this.value ?? '').trim();
            if (!raw) {
                USER.tableBaseSetting.separateReadContextLayers = lastValid;
                return;
            }
            const numeric = Number(raw);
            if (Number.isInteger(numeric) && numeric >= MIN_ROUNDS) {
                lastValid = numeric;
                USER.tableBaseSetting.separateReadContextLayers = numeric;
                return;
            }
            USER.tableBaseSetting.separateReadContextLayers = lastValid;
        })
        .on('focusout.memoNContextRounds change.memoNContextRounds', SELECTOR, function () {
            const raw = String(this.value ?? '').trim();
            const numeric = Number(raw);
            if (raw && Number.isInteger(numeric) && numeric >= MIN_ROUNDS) {
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

console.log('[Memo-N] 上下文轮数输入守卫已加载：最小1轮，0/空白/负数不保存');
