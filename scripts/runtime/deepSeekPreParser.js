import { APP } from '../../core/manager.js';

function normalizeBeforeRecordEngine() {
    try {
        globalThis.__memoNNormalizeDeepSeekReply?.();
    } catch (error) {
        console.error('[Memo-N] DeepSeek记录块预解析失败', error);
    }
}

// 本模块必须在 recordEngine 之前加载，使 GENERATION_ENDED 时先把
// “前置JSON变化块 + 正文”转换成 recordEngine 原生严格信封，再由其执行事务写表。
APP.eventSource.on(APP.event_types.GENERATION_ENDED, normalizeBeforeRecordEngine);

console.log('[Memo-N] DeepSeek记录块预解析桥已加载');
