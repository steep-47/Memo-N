const RUNTIME_VERSION = '0.21-table-view-stability';
const DISPLAY_VERSION = '0.21';

// 热更新时旧的 Memo-N 抽屉与事件可能仍在当前页面。
// 已存在完整 Memo-N 入口时复用旧主入口，只加载本版本运行时，避免 index.js 再次插入同 ID 抽屉和重复事件。
const existingMemoIndex = !!globalThis.memoN
    && !!document.querySelector('[id="table_database_settings_drawer"]');
if (existingMemoIndex) {
    console.log('[Memo-N][loader] 检测到当前页面已有 Memo-N 主入口，跳过 index.js 重复启动');
} else {
    await import(`./index.js?v=${RUNTIME_VERSION}`);
}

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
    ['表格视图单例与渲染稳定', './scripts/runtime/tableViewStabilityGuard.js'],
    ['设置归一', './scripts/runtime/settingsBootstrap.js'],
    ['玩家身份与称号字段结构', './scripts/runtime/playerProfileSchema.js'],
    ['表格表达与能力字段规则', './scripts/runtime/denseExpressionRule.js'],
    ['独立操作七表结构前置修复', './scripts/runtime/worldTableStructurePreflight.js'],
    ['手动更新按对话轮读取上下文', './scripts/runtime/manualRoundContextBridge.js'],
    ['推理区机器记录显示隐藏', './scripts/runtime/reasoningRecordDisplayShield.js'],
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

console.log('[Memo-N][loader] v0.21 table view stability runtime loaded');
