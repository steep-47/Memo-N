import './index.js';

const RUNTIME_VERSION = 'memon56';

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

// 世界七表稳定主链冻结。
// 所有NPC统一按已确认事实维护，不区分世界书来源或剧情自动生成来源。
// 修炼记录保存角色自身种族/血脉、修炼体系/路径与原生修为文本，不换算成人族境界。
// 伊依属于独立后台陪伴者，永远不进入世界七表；若模型误写，由世界表守卫清理。
// DeepSeek直连使用独立JSON Output适配器；中转站继续使用既有tableEdit稳定协议，互不串线。
// JSON记录解析只容错响应外层包装、控制字符和无歧义外层标点；reply/changes结构仍严格校验，不猜业务内容。
// 伊依插件层只负责记忆工程：长期存储、召回排序、纠错/去重、写回与分支事务；人格/文风/表达方式留给预设。
// Memo-N不检查、不补写预设规定的正文结构；行动选项等输出契约由预设负责。
const modules = [
    ['设置归一', './scripts/runtime/settingsBootstrap.js'],
    ['严格表格执行器', './scripts/runtime/safeTableExecutor.js'],
    ['Swipe精确快照恢复', './scripts/runtime/swipeSnapshotRestore.js'],
    ['记录模式控制', './scripts/runtime/modeRuntimeControl.js'],
    ['Provider路由', './scripts/runtime/providerRoute.js'],
    ['Memo-N一次API记录引擎', './scripts/engine/recordEngine.js'],
    ['DeepSeek独立记录适配器', './scripts/runtime/deepseekRecordAdapter.js'],
    ['世界七表伊依隔离守卫', './scripts/runtime/worldTableGuard.js'],
    ['流式状态保护', './scripts/runtime/streamStateGuard.js'],
    ['非CUSTOM中转提示协调', './scripts/runtime/relayPromptCoordinator.js'],
    ['非CUSTOM中转哨兵桥', './scripts/runtime/relaySentinelBridge.js'],
    ['CUSTOM中转结构化输出', './scripts/runtime/customStructuredOutputBridge.js'],
    ['一次API成功提示', './scripts/runtime/singleApiFinish.js'],
    ['记录API开关', './scripts/ui/apiModeToggle.js'],
    ['伊依独立长期记忆库', './scripts/yiyi/yiyiMemoryStore.js'],
    ['伊依独立召回引擎', './scripts/yiyi/yiyiRecallEngine.js'],
    ['伊依记忆维护引擎', './scripts/yiyi/yiyiMemoryMaintenance.js'],
    ['伊依自动记忆运行时', './scripts/yiyi/yiyiMemoryRuntime.js'],
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
console.log('[Memo-N][loader] memon56 DeepSeek独立记录 + 伊依世界表硬隔离版加载完成');
