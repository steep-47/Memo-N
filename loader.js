import './index.js';

const RUNTIME_VERSION = 'memon62';

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
// - recordEngine 是唯一正常请求协议入口。
//   DeepSeek直连/NATIVE走JSON信封；SillyTavern自定义(OpenAI兼容)与反代端点统一走中转纯文本哨兵。
// - Provider路由不再保留含糊的CUSTOM中间态，避免中转站被误送入JSON协议。
// - 记录提示动态读取当前真实七表，column严格0-based；执行器只校验，不猜、不自动修正越界列。
// - 不在生成前常驻自动修表层。旧结构迁移仍由既有迁移/整理工具按明确操作处理。
// - 伊依不属于世界七表；她使用独立全局长期记忆库，世界表守卫只负责隔离误写。
// - Memo-N 不改SillyTavern原始stream设置。
// - 成功提示只在严格执行与saveChat真正完成后显示，避免渲染阶段过早判断。
// - loader只启动“有运行时副作用”的入口模块；纯工具库由实际调用者import，避免重复模块实例。
const runtimes = [
    ['设置归一', './scripts/runtime/settingsBootstrap.js'],
    ['Swipe精确快照恢复', './scripts/runtime/swipeSnapshotRestore.js'],
    ['记录模式控制', './scripts/runtime/modeRuntimeControl.js'],
    ['Memo-N一次API记录引擎', './scripts/engine/recordEngine.js'],
    ['世界七表伊依隔离守卫', './scripts/runtime/worldTableGuard.js'],
    ['中转哨兵响应转换', './scripts/runtime/relaySentinelBridge.js'],
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
console.log('[Memo-N][loader] memon62 中转路由收口版加载完成');
