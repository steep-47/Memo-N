import './index.js';

const RUNTIME_VERSION = 'memon89';
const PUBLIC_VERSION = '0.1.0-memon.89';

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
// - recordEngine 是唯一普通一次API协议与记录执行入口。
// - DeepSeek/中转站不自动识别；全部记录/整理API只由“记录接口”手动指定。
// - 普通一次API：DeepSeek走JSON reply+changes；中转站走前置tableEdit，再输出完整正文。
// - 独立API/手动立即填表：DeepSeek走记录专用JSON；中转站走唯一tableEdit。
// - 基础消息模板、独立填表模板、整理模板本身全部保持传输格式中立，最终协议只在请求末尾注入。
// - 表格整理继续保留用户的“总结模板”选择与自定义模板；模板只提供整理语义，最终机器格式仍服从手动记录接口。
// - “填表行为发生在”是唯一模式选择；旧 step_by_step 只作运行时兼容桥。
// - 每次聊天切换先清空派生Sheet实例缓存；真实表格仍只从当前聊天 chatMetadata.memo_n_sheets 重建，禁止同uid跨分档复用旧实例。
// - Swipe严格快照恢复后，旧index Swipe/编辑监听必须被安全隔离，禁止再次按旧基线重放覆盖新快照。
// - 所有记录最终进入同一个严格事务执行器；stale/过期任务只安全作废，不自动重算或重试。
// - 数据页保持统一横向画布：单指横滑同步全部表格，双指缩放整个tableContainer。
// - 七表职责/结构校验继续在请求前执行；表格整理按钮走严格增量整理器。
// - standaloneAPI保留原插件公开表格导出、模型列表与token估算能力，同时记录请求保持单次网络尝试。
// - 伊依直接角色与预设桥共享独立长期记忆库；独立记录v4/v3与整理请求必须排除伊依预设注入；中转普通回复顺序固定为前置tableEdit→正文→正文末尾yiyiMemory；记忆写回在记录持久化后串行执行。
// - memon70-72 tagged JSON仅保留旧回复兼容解析，不用于新请求。
// - Memo-N 不改SillyTavern原始stream设置；记录失败不自动重试。
const runtimes = [
    ['设置归一', './scripts/runtime/settingsBootstrap.js'],
    ['聊天分档Sheet实例隔离', './scripts/runtime/chatSheetIsolation.js'],
    ['七表职责与请求前结构校验', './scripts/runtime/memoryContentRules.js'],
    ['Swipe精确快照恢复', './scripts/runtime/swipeSnapshotRestore.js'],
    ['旧Swipe与消息编辑安全隔离', './scripts/runtime/legacyEventSafety.js'],
    ['记录模式控制', './scripts/runtime/modeRuntimeControl.js'],
    ['Memo-N一次API记录引擎', './scripts/engine/recordEngine.js'],
    ['世界七表伊依隔离守卫', './scripts/runtime/worldTableGuard.js'],
    ['一次API成功提示', './scripts/runtime/singleApiFinish.js'],
    ['记录接口设置', './scripts/ui/apiModeToggle.js'],
    ['严格表格整理按钮桥接', './scripts/runtime/cleanupButtonBridge.js'],
    ['旧人物虚拟拆分残留清理', './scripts/ui/personTableSplit.js'],
    ['填表提示颜色与时长', './scripts/ui/fillStatusColor.js'],
    ['表格统一横滑与双指缩放', './scripts/ui/pinchZoom.js'],
    ['伊依长期记忆库UI', './scripts/ui/yiyiMemoryPanel.js'],
    ['伊依预设长期记忆桥', './scripts/yiyi/yiyiPresetMemoryBridge.js'],
    ['伊依直接角色长期记忆', './scripts/yiyi/yiyiMemoryRuntime.js'],
];

for (const [label, path] of runtimes) await loadRuntime(label, path);

function syncPublicVersion() {
    try {
        if (globalThis.window?.memoN && typeof globalThis.window.memoN === 'object') globalThis.window.memoN.VERSION = PUBLIC_VERSION;
        const tag = globalThis.document?.querySelector?.('#tableUpdateTag');
        if (tag) {
            tag.style.display = '';
            tag.textContent = `v${PUBLIC_VERSION}`;
        }
    } catch (error) {
        console.warn('[Memo-N][loader] 同步公开版本号失败', error);
    }
}

function schedulePublicVersionSync() {
    syncPublicVersion();
    queueMicrotask(syncPublicVersion);
    setTimeout(syncPublicVersion, 0);
    setTimeout(syncPublicVersion, 500);
}

schedulePublicVersionSync();
if (globalThis.document?.readyState === 'loading') {
    globalThis.document.addEventListener('DOMContentLoaded', schedulePublicVersionSync, { once: true });
} else {
    setTimeout(syncPublicVersion, 0);
}

console.log('[Memo-N][loader] memon89 记录链收口与伊依独立请求隔离版加载完成');
