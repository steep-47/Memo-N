const RUNTIME_VERSION = '0.50-root-path-classification';
const DISPLAY_VERSION = '0.50';

// index.js 必须保持唯一的标准模块URL。
// core/manager.js 会循环引用 ../index.js；若这里给 index.js 加 ?v= 查询参数，浏览器会把两者当成两个模块，
// 导致主入口、顶部抽屉与事件监听各初始化两次。缓存版本号只用于非循环的运行时模块。
const existingMemoIndex = !!globalThis.memoN
    && !!document.querySelector('[id="table_database_settings_drawer"]');
if (existingMemoIndex) {
    console.log('[Memo-N][loader] 检测到当前页面已有 Memo-N 主入口，跳过 index.js 重复启动');
} else {
    await import('./index.js');
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
    ['上下文轮数最小值保护', './scripts/runtime/contextRoundInputGuard.js'],
    ['推理区机器记录显示隐藏', './scripts/runtime/reasoningRecordDisplayShield.js'],
    // 两层都是generateRaw包装器：先安装返回兼容层，再安装请求格式锁。
    // 实际调用顺序因此是：格式锁注入 -> API -> 兼容规范化 -> 严格执行器。
    ['独立tableEdit传输守卫', './scripts/runtime/recordOnlyTransportGuard.js'],
    ['记录专用唯一输出格式', './scripts/runtime/recordOnlyOutputProtocolGuard.js'],
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
    // 放在旧七表规则之后，并在请求事件中保持最后执行：只纠正记录判断，不替换单API链。
    ['逐表连续性审计与对象安全', './scripts/runtime/continuityAuditRules.js'],
    ['稳定表格整理', './scripts/runtime/stableTableCleanup.js'],
    ['整理最近证据与表达规则', './scripts/runtime/cleanupEvidenceWindow.js'],
    ['整理按钮桥接', './scripts/runtime/cleanupButtonBridge.js'],
    ['人物表展示', './scripts/ui/personTableSplit.js'],
    ['双指缩放', './scripts/ui/pinchZoom.js'],
    ['角色状态表点击桥', './scripts/ui/roleStatusClickBridge.js'],
    ['单元格编辑输入框尺寸', './scripts/ui/cellEditorSize.js'],
    ['填表状态颜色', './scripts/ui/fillStatusColor.js'],
];

for (const [label, path] of runtimes) await loadRuntime(label, path);

jQuery(() => {
    if (window.memoN && typeof window.memoN === 'object') window.memoN.VERSION = DISPLAY_VERSION;
    $('#tableUpdateTag').show().text(`v${DISPLAY_VERSION}`);
});

console.log('[Memo-N][loader] v0.50 loaded: martial artist requires no spirit root; body cultivator requires spirit root and body specialization');
