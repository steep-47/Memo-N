import './index.js';

const RUNTIME_VERSION = 'memon72';

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
// - DeepSeek/中转站不再自动识别；记录协议由 Memo-N 设置中的“记录接口”手动指定。
// - 普通一次API：DeepSeek走JSON记录信封；中转站先输出纯文本哨兵JSON变更块，再输出完整正文，避免长回复把记录块截断。
// - 中转站协议同时强化七表提示、最终system和最后user消息；仍由同一个recordEngine统一注入、解析、执行。
// - 独立API/手动立即填表保留原插件的纯tableEdit记录请求，并继续走严格执行器。
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
    ['记录接口设置', './scripts/ui/apiModeToggle.js'],
    ['伊依长期记忆', './scripts/yiyi/yiyiMemoryRuntime.js'],
];

for (const [label, path] of runtimes) await loadRuntime(label, path);

console.log('[Memo-N][loader] memon72 中转站前置记录块与请求强化版加载完成');