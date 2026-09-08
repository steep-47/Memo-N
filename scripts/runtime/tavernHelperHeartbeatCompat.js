const INSTALL_FLAG = '__memoTavernHelperHeartbeatCompatInstalled';

function install() {
    if (globalThis[INSTALL_FLAG]) return;
    globalThis[INSTALL_FLAG] = true;

    const helper = globalThis.TavernHelper;
    if (!helper || typeof helper !== 'object') {
        console.warn('[Memo][heartbeat-compat] TavernHelper 不可用，无法安装流式心跳兼容层');
        return;
    }

    if (typeof helper._eventOn === 'function') {
        console.log('[Memo][heartbeat-compat] TavernHelper 已直接提供 _eventOn');
        return;
    }

    if (typeof globalThis.eventOn === 'function') {
        helper._eventOn = (eventType, listener) => globalThis.eventOn(eventType, listener);
        console.log('[Memo][heartbeat-compat] 已使用全局 eventOn 接入流式心跳');
        return;
    }

    const boundEventOn = helper?._bind?._eventOn;
    if (typeof boundEventOn === 'function') {
        helper._eventOn = (eventType, listener) => boundEventOn.call(globalThis, eventType, listener);
        console.log('[Memo][heartbeat-compat] 已使用 TavernHelper._bind._eventOn 接入流式心跳');
        return;
    }

    console.error('[Memo][heartbeat-compat] 未找到可用的流式事件监听接口；表格整理心跳监控不可用');
    globalThis?.toastr?.warning?.('Memo 表格整理无法接入酒馆流式事件；请更新酒馆助手后重试。');
}

install();

export { install };
