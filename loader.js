import './index.js';

const RUNTIME_VERSION = 'memon64';

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

// Memo-N 稳定运行边界：
// - recordEngine 是唯一正常请求协议与记录执行入口。
//   DeepSeek直连/NATIVE走JSON信封；中转端点走tableEdit。
// - 中转tableEdit约束由recordEngine在同一次注入中同步写入七表基础提示与最终收尾契约，恢复稳定约束但不引入第二个协调模块。
// - 中转分支只解析tableEdit，不再保留旧tagged/JSON fallback；DeepSeek分支只解析JSON，避免协议串线。
// - 记录提示动态读取当前真实七表，column严格0-based；执行器只校验，不猜、不自动修正越界列。
// - 不在生成前常驻自动修表层。旧结构迁移仍由既有迁移/整理工具按明确操作处理。
// - 伊依不属于世界七表；她使用独立全局长期记忆库，世界表守卫只负责隔离误写。
// - Memo-N 不改SillyTavern原始stream设置。
// - 成功提示只在严格执行与saveChat真正完成后显示。
// - loader只启动有运行时副作用的入口模块；纯工具库由实际调用者import。
const runtimes = [
    ['设置归一', './scripts/runtime/settingsBootstrap.js'],
    ['Swipe精确快照恢复', './scripts/runtime/swipeSnapshotRestore.js'],
    ['记录模式控制', './scripts/runtime/modeRuntimeControl.js'],
    ['Memo-N一次API记录引擎', './scripts/engine/recordEngine.js'],
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
    ['填表状态颜色', './scripts/ui/fillStatusColor.js'],
];

for (const [label, path] of runtimes) await loadRuntime(label, path);
console.log('[Memo-N][loader] memon64 中转tableEdit稳定约束恢复版加载完成');