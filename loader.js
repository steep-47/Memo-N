import './index.js';

const RUNTIME_VERSION = 'memon89-sixfix4';
const PUBLIC_VERSION = '0.1.0-memon.89';

async function loadRuntime(label, path) {
    try {
        await import(`${path}?v=${RUNTIME_VERSION}`);
        console.log(`[Memo][loader] ${label} loaded`);
        return true;
    } catch (error) {
        console.error(`[Memo][loader] ${label} load failed`, error);
        const toast = globalThis?.toastr;
        if (toast?.error) toast.error(`Memo模块加载失败：${label}｜${error?.message || error}`);
        return false;
    }
}

const runtimes = [
    ['设置归一', './scripts/runtime/settingsBootstrap.js'],
    ['聊天分档Sheet实例隔离', './scripts/runtime/chatSheetIsolation.js'],
    ['Swipe精确快照恢复', './scripts/runtime/swipeSnapshotRestore.js'],
    ['旧Swipe与消息编辑安全隔离', './scripts/runtime/legacyEventSafety.js'],
    ['记录模式控制', './scripts/runtime/modeRuntimeControl.js'],
    // 必须先注册 GENERATION_ENDED 预解析，再加载 recordEngine。
    ['DeepSeek记录块预解析桥', './scripts/runtime/deepSeekPreParser.js'],
    ['Memo-N一次API记录引擎', './scripts/engine/recordEngine.js'],
    // SETTINGS_READY 最终守卫在 recordEngine 后覆盖旧硬编码协议，并按当前真实表格生成映射。
    ['当前表格双路由记录守卫', './scripts/runtime/deepSeekJsonGuard.js'],
    ['伊依世界表隔离守卫', './scripts/runtime/worldTableGuard.js'],
    ['一次API成功提示', './scripts/runtime/singleApiFinish.js'],
    ['记录接口设置', './scripts/ui/apiModeToggle.js'],
    ['严格表格整理按钮桥接', './scripts/runtime/cleanupButtonBridge.js'],
    ['旧人物虚拟拆分残留清理', './scripts/ui/personTableSplit.js'],
    ['填表提示颜色与时长', './scripts/ui/fillStatusColor.js'],
    ['表格统一横滑与双指缩放', './scripts/ui/pinchZoom.js'],
    ['伊依长期记忆库UI', './scripts/ui/yiyiMemoryPanel.js'],
    ['伊依预设长期记忆桥', './scripts/yiyi/yiyiPresetMemoryBridge.js'],
    ['伊依直接角色长期记忆', './scripts/yiyi/yiyiMemoryRuntime.js'],
    ['伊依当前记录协议覆盖', './scripts/yiyi/yiyiProtocolOverride.js'],
];

for (const [label, path] of runtimes) await loadRuntime(label, path);

function syncPublicVersion() {
    try {
        if (globalThis.window?.memoN && typeof globalThis.window.memoN === 'object') globalThis.window.memoN.VERSION = PUBLIC_VERSION;
        const tag = globalThis.document?.querySelector?.('#tableUpdateTag');
        if (tag) {
            tag.style.display = '';
            tag.textContent = `v${PUBLIC_VERSION}`;
        }
    } catch (error) {
        console.warn('[Memo-N][loader] 同步公开版本号失败', error);
    }
}

function schedulePublicVersionSync() {
    syncPublicVersion();
    queueMicrotask(syncPublicVersion);
    setTimeout(syncPublicVersion, 0);
    setTimeout(syncPublicVersion, 500);
}

schedulePublicVersionSync();
if (globalThis.document?.readyState === 'loading') {
    globalThis.document.addEventListener('DOMContentLoaded', schedulePublicVersionSync, { once: true });
} else {
    setTimeout(syncPublicVersion, 0);
}

console.log('[Memo-N][loader] memon89 六表运行时兼容版加载完成');
