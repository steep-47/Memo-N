import { APP } from '../../core/manager.js';

const INSTALL_FLAG = '__memoTavernHelperHeartbeatCompatInstalled';

function install() {
    if (globalThis[INSTALL_FLAG]) return true;

    const helper = globalThis.TavernHelper;
    const source = APP?.eventSource;
    if (!helper || typeof helper !== 'object') return false;
    if (!source || typeof source.on !== 'function' || typeof source.removeListener !== 'function') return false;

    // Memo-N 是主页面扩展，不是 iframe 脚本。
    // 酒馆助手的全局 eventOn / _bind._eventOn 会尝试解析 iframe id，
    // 在主页面环境会出现 frameElement is null。这里直接使用 Memo 已经从 /script.js
    // 导入的主页面 eventSource，监听的是同一条 SillyTavern 事件总线。
    helper._eventOn = (eventType, listener) => {
        source.on(eventType, listener);
        return {
            stop: () => source.removeListener(eventType, listener),
        };
    };

    globalThis[INSTALL_FLAG] = true;
    console.log('[Memo][heartbeat-compat] 已使用主页面 APP.eventSource 接入流式心跳');
    return true;
}

if (!install()) {
    let attempts = 0;
    const retryTimer = setInterval(() => {
        attempts += 1;
        if (install()) {
            clearInterval(retryTimer);
            return;
        }
        if (attempts >= 20) {
            clearInterval(retryTimer);
            console.error('[Memo][heartbeat-compat] 主页面 eventSource 或 TavernHelper 不可用；表格整理心跳监控不可用');
            globalThis?.toastr?.warning?.('Memo 表格整理无法接入酒馆流式事件；请刷新酒馆后重试。');
        }
    }, 500);
}

export { install };
