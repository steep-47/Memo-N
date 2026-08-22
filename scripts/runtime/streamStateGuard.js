import { APP, USER } from '../../core/manager.js';

let originalStream = null;
let armed = false;

function captureStreamState(_type, _options, dryRun) {
    if (dryRun === true) return;
    const settings = USER?.getContext?.()?.chatCompletionSettings;
    if (!settings || typeof settings.stream_openai !== 'boolean') {
        originalStream = null;
        armed = false;
        return;
    }
    originalStream = settings.stream_openai;
    armed = true;
}

function restoreStreamState() {
    if (!armed || originalStream === null) return;
    const settings = USER?.getContext?.()?.chatCompletionSettings;
    if (!settings) return;
    if (settings.stream_openai !== originalStream) {
        console.warn(`[Memo-N] 检测到生成期间stream_openai被改写：${settings.stream_openai} -> ${originalStream}，已立即恢复`);
        settings.stream_openai = originalStream;
    }
}

function releaseStreamState() {
    restoreStreamState();
    armed = false;
    originalStream = null;
}

const started = APP.event_types.GENERATION_STARTED;
APP.eventSource.on(started, captureStreamState);
APP.eventSource.makeFirst?.(started, captureStreamState);

// recordEngine曾在CHAT_COMPLETION_PROMPT_READY里临时关闭stream_openai。
// 本保护器在所有prompt处理器之后立刻恢复用户原设置，避免污染SillyTavern生成生命周期。
const promptReady = APP.event_types.CHAT_COMPLETION_PROMPT_READY;
APP.eventSource.on(promptReady, restoreStreamState);
APP.eventSource.makeLast?.(promptReady, restoreStreamState);

// 再在最终请求设置完成时兜底一次，确保真正发出的请求使用用户原本的stream状态。
const settingsReady = APP.event_types.CHAT_COMPLETION_SETTINGS_READY;
APP.eventSource.on(settingsReady, restoreStreamState);
APP.eventSource.makeLast?.(settingsReady, restoreStreamState);

const rendered = APP.event_types.CHARACTER_MESSAGE_RENDERED;
APP.eventSource.on(rendered, releaseStreamState);

console.log('[Memo-N] 流式状态保护器已加载：Memo-N不得改写SillyTavern原始stream_openai状态');
