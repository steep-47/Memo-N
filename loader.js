import './index.js';

const RUNTIME_VERSION = 'memon75';
const PUBLIC_VERSION = '0.1.0-memon.75';

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
// - DeepSeek/中转站不再自动识别；所有API记录协议都由 Memo-N 设置中的“记录接口”手动指定。
// - 普通一次API：DeepSeek走JSON reply+changes；中转站统一走前置tableEdit，再输出完整正文，避免长回复把机器块截断。
// - 独立API/手动立即填表：DeepSeek走记录专用JSON reply="RECORD_ONLY"+changes；中转站走唯一tableEdit。
// - “填表行为发生在”是唯一模式选择：聊天同时填表 / 收到消息后独立记录；不再额外显示重复独立开关或旧主/自定义API路由开关。
// - 所有模式最终进入同一个严格事务执行器；独立/手动链继续保留聊天切换、stale、基线、保存失败和Swipe保护。
// - 中转tableEdit协议在普通一次API同时强化七表提示、最终system和最后user消息。
// - memon70-72 tagged JSON仅保留旧回复兼容解析，不再用于新请求。
// - 记录提示动态读取当前真实七表，column严格0-based；执行器只校验，不猜、不自动修正越界列。
// - 伊依不属于世界七表；她使用独立全局长期记忆库。
// - Memo-N 不改SillyTavern原始stream设置；记录失败不自动重试。
const runtimes = [
    ['设置归一', './scripts/runtime/settingsBootstrap.js'],
    ['Swipe精确快照恢复', './scripts/runtime/swipeSnapshotRestore.js'],
    ['记录模式控制', './scripts/runtime/modeRuntimeControl.js'],
    ['Memo-N一次API记录引擎', './scripts/engine/recordEngine.js'],
    ['世界七表伊依隔离守卫', './scripts/runtime/worldTableGuard.js'],
    ['一次API成功提示', './scripts/runtime/singleApiFinish.js'],
    ['记录接口设置', './scripts/ui/apiModeToggle.js'],
    ['伊依长期记忆', './scripts/yiyi/yiyiMemoryRuntime.js'],
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

console.log('[Memo-N][loader] memon75 模式UI收口与全记录入口手动协议版加载完成');