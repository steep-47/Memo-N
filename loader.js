const RUNTIME_VERSION = '0.75-independent-api-sync-5';
const DISPLAY_VERSION = '0.75';

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
    ['历史冻结', './scripts/runtime/fixedBlockHistory.js'],
    ['玩家身份与称号字段结构', './scripts/runtime/playerProfileSchema.js'],
    ['表格表达与能力字段规则', './scripts/runtime/denseExpressionRule.js'],
    ['独立操作七表结构前置修复', './scripts/runtime/worldTableStructurePreflight.js'],
    ['手动更新按对话轮读取上下文', './scripts/runtime/manualRoundContextBridge.js'],
    ['上下文轮数最小值保护', './scripts/runtime/contextRoundInputGuard.js'],
    ['推理区机器记录显示隐藏', './scripts/runtime/reasoningRecordDisplayShield.js'],
    // 四层都包装记录请求：安装顺序决定调用/返回链。请求侧先识别，再由格式锁改写实际发送内容；
    // 返回侧依次做窄兼容归一化，最后仍由safeTableExecutor裁决。
    // 实际数据流：格式锁注入 -> API -> 基础传输规范化 -> 独立API规范化 -> row-data规范化 -> 严格执行器。
    ['独立tableEdit传输守卫', './scripts/runtime/recordOnlyTransportGuard.js'],
    ['记录专用唯一输出格式', './scripts/runtime/recordOnlyOutputProtocolGuard.js'],
    // 补齐独立API/第三方端点仍可能返回的data XML方言；只做确定性规范化，最终仍由严格执行器裁决。
    ['独立API返回兼容同步', './scripts/runtime/independentApiTransportSync.js'],
    // 补齐row标签把JSON data放在顶层属性中的同族返回；身份表仍要求expected，未知属性继续拒绝。
    ['独立API row-data属性同步', './scripts/runtime/independentApiDataAttributeSync.js'],
    ['遗留重复模板清理', './scripts/runtime/legacyTableStructureCleanup.js'],
    ['标签×删除当前聊天表格', './scripts/runtime/chatSheetChoiceDelete.js'],
    ['Swipe精确快照恢复', './scripts/runtime/swipeSnapshotRestore.js'],
    ['DeepSeek旧解析器隔离', './scripts/runtime/directModeLegacyGuard.js'],
    ['记录模式控制', './scripts/runtime/modeRuntimeControl.js'],
    ['单次API记录引擎', './scripts/engine/recordEngine.js'],
    ['记录API开关', './scripts/ui/apiModeToggle.js'],
    ['自定义API多方案', './scripts/ui/apiProfiles.js'],
    ['七表规则', './scripts/runtime/memoryContentRules.js'],
    // 放在旧七表规则之后，并在请求事件中保持最后执行：只纠正记录判断，不替换单API链。
    ['逐表连续性审计与对象安全', './scripts/runtime/continuityAuditRules.js'],
    // 最后修正单API记录契约中的对象核对格式，并把Memo-N尾部system协议移到最后user之前，兼容要求最后消息为user的API。
    ['对象核对输出硬约束', './scripts/runtime/identityExpectedPromptGuard.js'],
    ['稳定表格整理', './scripts/runtime/stableTableCleanup.js'],
    ['整理最近证据与表达规则', './scripts/runtime/cleanupEvidenceWindow.js'],
    ['整理按钮桥接', './scripts/runtime/cleanupButtonBridge.js'],
    ['人物表展示', './scripts/ui/personTableSplit.js'],
    ['双指缩放', './scripts/ui/pinchZoom.js'],
    ['角色状态表点击桥', './scripts/ui/roleStatusClickBridge.js'],
    ['单元格编辑输入框尺寸', './scripts/ui/cellEditorSize.js'],
    ['填表状态颜色', './scripts/runtime/fillStatusColor.js'],
];

for (const [label, path] of runtimes) await loadRuntime(label, path);

jQuery(() => {
    if (window.memoN && typeof window.memoN === 'object') window.memoN.VERSION = DISPLAY_VERSION;
    $('#tableUpdateTag').show().text(`v${DISPLAY_VERSION}`);
});

console.log('[Memo-N][loader] v0.75 loaded: preset-compatible one-call record protocol');
