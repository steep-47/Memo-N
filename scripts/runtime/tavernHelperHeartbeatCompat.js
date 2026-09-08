const INSTALL_FLAG = '__memoTavernHelperHeartbeatCompatInstalled';

function install() {
    if (globalThis[INSTALL_FLAG]) return true;

    const helper = globalThis.TavernHelper;
    if (!helper || typeof helper !== 'object') return false;

    if (typeof helper._eventOn === 'function') {
        globalThis[INSTALL_FLAG] = true;
        console.log('[Memo][heartbeat-compat] TavernHelper 已直接提供 _eventOn');
        return true;
    }

    if (typeof globalThis.eventOn === 'function') {
        helper._eventOn = (eventType, listener) => globalThis.eventOn(eventType, listener);
        globalThis[INSTALL_FLAG] = true;
        console.log('[Memo][heartbeat-compat] 已使用全局 eventOn 接入流式心跳');
        return true;
    }

    const boundEventOn = helper?._bind?._eventOn;
    if (typeof boundEventOn === 'function') {
        helper._eventOn = (eventType, listener) => boundEventOn.call(globalThis, eventType, listener);
        globalThis[INSTALL_FLAG] = true;
        console.log('[Memo][heartbeat-compat] 已使用 TavernHelper._bind._eventOn 接入流式心跳');
        return true;
    }

    return false;
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
            console.error('[Memo][heartbeat-compat] 未找到可用的流式事件监听接口；表格整理心跳监控不可用');
            globalThis?.toastr?.warning?.('Memo 表格整理无法接入酒馆流式事件；请更新酒馆助手后重试。');
        }
    }, 500);
}

export { install };
