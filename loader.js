import './index.js';

const RUNTIME_VERSION = 'memon60';

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

// Memo-N 当前稳定结构：
// 1) recordEngine 是唯一正常请求协议入口。
//    - DeepSeek / CUSTOM / NATIVE：JSON信封。
//    - 真正中转站：纯文本哨兵，响应阶段再转换成内部tableEdit。
// 2) 所有记录协议都从当前真实七表动态读取0-based列号映射；执行器只校验，不猜列号、不静默纠错。
// 3) 七表结构只由现有表格/既有迁移工具负责，不在生成前额外常驻“自动修表”层。
// 4) 伊依不属于世界七表；世界表守卫只负责隔离误写，伊依长期记忆使用独立全局库。
// 5) Memo-N 不改写SillyTavern原始stream设置，不再保留历史stream补丁。
// 6) 正文格式、行动选项、伊依人格与表达由预设负责，插件只负责记忆和记录工程。
const modules = [
    ['设置归一', './scripts/runtime/settingsBootstrap.js'],
    ['严格表格执行器', './scripts/runtime/safeTableExecutor.js'],
    ['Swipe精确快照恢复', './scripts/runtime/swipeSnapshotRestore.js'],
    ['记录模式控制', './scripts/runtime/modeRuntimeControl.js'],
    ['Provider路由', './scripts/runtime/providerRoute.js'],
    ['Memo-N一次API记录引擎', './scripts/engine/recordEngine.js'],
    ['世界七表伊依隔离守卫', './scripts/runtime/worldTableGuard.js'],
    ['中转哨兵响应转换', './scripts/runtime/relaySentinelBridge.js'],
    ['CUSTOM截断恢复', './scripts/runtime/customStructuredOutputBridge.js'],
    ['一次API成功提示', './scripts/runtime/singleApiFinish.js'],
    ['记录API开关', './scripts/ui/apiModeToggle.js'],
    ['伊依独立长期记忆库', './scripts/yiyi/yiyiMemoryStore.js'],
    ['伊依独立召回引擎', './scripts/yiyi/yiyiRecallEngine.js'],
    ['伊依记忆维护引擎', './scripts/yiyi/yiyiMemoryMaintenance.js'],
    ['伊依自动记忆运行时', './scripts/yiyi/yiyiMemoryRuntime.js'],
    ['伊依预设角色记忆桥', './scripts/yiyi/yiyiPresetMemoryBridge.js'],
    ['伊依长期记忆库UI', './scripts/ui/yiyiMemoryPanel.js'],
    ['伊依启动自检', './scripts/yiyi/yiyiDiagnostics.js'],
    ['七表规则', './scripts/runtime/memoryContentRules.js'],
    ['稳定表格整理', './scripts/runtime/stableTableCleanup.js'],
    ['整理按钮桥接', './scripts/runtime/cleanupButtonBridge.js'],
    ['人物表展示', './scripts/ui/personTableSplit.js'],
    ['双指缩放', './scripts/ui/pinchZoom.js'],
    ['填表状态颜色', './scripts/ui/fillStatusColor.js'],
];

for (const [label, path] of modules) await loadOptional(label, path);
console.log('[Memo-N][loader] memon60 统一记录链清理版加载完成');
