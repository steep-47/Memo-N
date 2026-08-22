import './index.js';

const RUNTIME_VERSION = 'memon26';

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

// CUSTOM OpenAI兼容中转站使用原生json_schema，并把changes放在reply之前优先生成。
// 如果CUSTOM响应在reply尾部被截断，但changes已经完整，生成结束时重建信封，优先完成记录链。
// 非CUSTOM reverse proxy继续使用纯文本哨兵兜底；不增加API次数，不改user消息，不改stream_openai。
const modules = [
    ['设置归一', './scripts/runtime/settingsBootstrap.js'],
    ['严格表格执行器', './scripts/runtime/safeTableExecutor.js'],
    ['Swipe精确快照恢复', './scripts/runtime/swipeSnapshotRestore.js'],
    ['记录模式控制', './scripts/runtime/modeRuntimeControl.js'],
    ['Memo-N一次API记录引擎', './scripts/engine/recordEngine.js'],
    ['流式状态保护', './scripts/runtime/streamStateGuard.js'],
    ['中转站提示协调', './scripts/runtime/relayPromptCoordinator.js'],
    ['非CUSTOM中转哨兵桥', './scripts/runtime/relaySentinelBridge.js'],
    ['CUSTOM原生结构化输出', './scripts/runtime/customStructuredOutputBridge.js'],
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
console.log('[Memo-N][loader] memon26 记录链优先版运行时加载完成');
