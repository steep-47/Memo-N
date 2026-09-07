const RUNTIME_VERSION = '0.17-manual-visible-channel-isolation';
const DISPLAY_VERSION = '0.17';

// index.js 也使用版本化URL加载，避免插件更新后主入口仍命中旧浏览器缓存。
await import(`./index.js?v=${RUNTIME_VERSION}`);

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
    ['表格表达与能力字段规则', './scripts/runtime/denseExpressionRule.js'],
    ['独立操作七表结构前置修复', './scripts/runtime/worldTableStructurePreflight.js'],
    ['手动更新按对话轮读取上下文', './scripts/runtime/manualRoundContextBridge.js'],
    ['独立tableEdit传输守卫', './scripts/runtime/recordOnlyTransportGuard.js'],
    ['遗留重复模板清理', './scripts/runtime/legacyTableStructureCleanup.js'],
    ['标签×删除当前聊天表格', './scripts/runtime/chatSheetChoiceDelete.js'],
    ['Swipe精确快照恢复', './scripts/runtime/swipeSnapshotRestore.js'],
    ['DeepSeek旧解析器隔离', './scripts/runtime/directModeLegacyGuard.js'],
    ['记录模式控制', './scripts/runtime/modeRuntimeControl.js'],
    ['单次API记录引擎', './scripts/engine/recordEngine.js'],
    ['世界七表伊依隔离守卫', './scripts/runtime/worldTableGuard.js'],
    ['一次API成功提示', './scripts/runtime/singleApiFinish.js'],
    ['记录API开关', './scripts/ui/apiModeToggle.js'],
    ['伊依自动记忆运行时', './scripts/yiyi/yiyiMemoryRuntime.js'],
    ['伊依预设角色记忆桥', './scripts/yiyi/yiyiPresetMemoryBridge.js'],
    ['伊依长期记忆库UI', './scripts/ui/yiyiMemoryPanel.js'],
    ['伊依启动自检', './scripts/yiyi/yiyiDiagnostics.js'],
    ['七表规则', './scripts/runtime/memoryContentRules.js'],
    ['稳定表格整理', './scripts/runtime/stableTableCleanup.js'],
    ['整理按钮桥接', './scripts/runtime/cleanupButtonBridge.js'],
    ['人物表展示', './scripts/ui/personTableSplit.js'],
    ['双指缩放', './scripts/ui/pinchZoom.js'],
    ['角色状态表点击桥', './scripts/ui/roleStatusClickBridge.js'],
    ['填表状态颜色', './scripts/ui/fillStatusColor.js'],
];

for (const [label, path] of runtimes) await loadRuntime(label, path);

jQuery(() => {
    if (window.memoN && typeof window.memoN === 'object') window.memoN.VERSION = DISPLAY_VERSION;
    $('#tableUpdateTag').show().text(`v${DISPLAY_VERSION}`);
});

console.log('[Memo-N][loader] v0.17 manual visible-channel isolation runtime loaded');
