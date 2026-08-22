import './index.js';

const RUNTIME_VERSION = 'memon35';

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

// 世界七表稳定主链冻结；伊依长期记忆使用独立全局库 + 当前聊天事务账本。
// 伊依关系不是好感度：由真实共同经历形成预期、信任依据、相处方式、主动程度与舒适/谨慎边界。
const modules = [
    ['设置归一', './scripts/runtime/settingsBootstrap.js'],
    ['严格表格执行器', './scripts/runtime/safeTableExecutor.js'],
    ['Swipe精确快照恢复', './scripts/runtime/swipeSnapshotRestore.js'],
    ['记录模式控制', './scripts/runtime/modeRuntimeControl.js'],
    ['Provider路由', './scripts/runtime/providerRoute.js'],
    ['Memo-N一次API记录引擎', './scripts/engine/recordEngine.js'],
    ['流式状态保护', './scripts/runtime/streamStateGuard.js'],
    ['非CUSTOM中转提示协调', './scripts/runtime/relayPromptCoordinator.js'],
    ['非CUSTOM中转哨兵桥', './scripts/runtime/relaySentinelBridge.js'],
    ['CUSTOM中转结构化输出', './scripts/runtime/customStructuredOutputBridge.js'],
    ['中转站调试日志', './scripts/runtime/relayDebugLogger.js'],
    ['一次API成功提示', './scripts/runtime/singleApiFinish.js'],
    ['记录API开关', './scripts/ui/apiModeToggle.js'],
    ['伊依独立长期记忆库', './scripts/yiyi/yiyiMemoryStore.js'],
    ['伊依自动记忆运行时', './scripts/yiyi/yiyiMemoryRuntime.js'],
    ['伊依长期记忆库UI', './scripts/ui/yiyiMemoryPanel.js'],
    ['七表规则', './scripts/runtime/memoryContentRules.js'],
    ['稳定表格整理', './scripts/runtime/stableTableCleanup.js'],
    ['整理按钮桥接', './scripts/runtime/cleanupButtonBridge.js'],
    ['人物表展示', './scripts/ui/personTableSplit.js'],
    ['双指缩放', './scripts/ui/pinchZoom.js'],
    ['填表状态颜色', './scripts/ui/fillStatusColor.js'],
];

for (const [label, path] of modules) await loadOptional(label, path);
console.log('[Memo-N][loader] memon35 伊依关系连续性版加载完成；世界记录主链未改动');
