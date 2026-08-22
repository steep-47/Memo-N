import './index.js';

const RUNTIME_VERSION = 'memon19';

async function loadOptional(label, path) {
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

// 原生直连继续使用严格JSON信封。
// custom或reverse proxy中转站：完整正文优先，正文结束后追加tableEdit。
// 中转站仅协调dataTable主提示和recordEngine system协议，不再改写最后一条user消息，降低对选项/角色留言等预设输出结构的干扰。
const modules = [
    ['设置归一', './scripts/runtime/settingsBootstrap.js'],
    ['严格表格执行器', './scripts/runtime/safeTableExecutor.js'],
    ['Swipe精确快照恢复', './scripts/runtime/swipeSnapshotRestore.js'],
    ['记录模式控制', './scripts/runtime/modeRuntimeControl.js'],
    ['Memo-N一次API记录引擎', './scripts/engine/recordEngine.js'],
    ['中转站提示协调', './scripts/runtime/relayPromptCoordinator.js'],
    ['中转站调试日志', './scripts/runtime/relayDebugLogger.js'],
    ['一次API成功提示', './scripts/runtime/singleApiFinish.js'],
    ['记录API开关', './scripts/ui/apiModeToggle.js'],

    ['七表规则', './scripts/runtime/memoryContentRules.js'],
    ['稳定表格整理', './scripts/runtime/stableTableCleanup.js'],
    ['整理按钮桥接', './scripts/runtime/cleanupButtonBridge.js'],
    ['人物表展示', './scripts/ui/personTableSplit.js'],
    ['双指缩放', './scripts/ui/pinchZoom.js'],
    ['填表状态颜色', './scripts/ui/fillStatusColor.js'],
];

for (const [label, path] of modules) await loadOptional(label, path);
console.log('[Memo-N][loader] memon19 中转站不改写user消息运行时加载完成');
