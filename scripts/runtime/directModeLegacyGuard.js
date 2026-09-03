import { APP, USER } from '../../core/manager.js';

const PREF_KEY = 'independent_record_api_enabled';

function directOneCallActive() {
    const independent = USER?.getSettings?.()?.memo_n_settings?.[PREF_KEY] === true;
    return globalThis.__memoNRecordEngineActive === true
        && independent !== true
        && USER?.tableBaseSetting?.step_by_step !== true;
}

function markMachineBlockHandled(chatId) {
    if (!directOneCallActive()) return;
    const id = Number(chatId);
    if (!Number.isInteger(id) || id < 0) return;
    const chat = USER?.getContext?.()?.chat?.[id];
    if (!chat || chat.is_user === true) return;

    // DeepSeek一次API在持久化前会把JSON信封拆成纯正文，机器变更已由recordEngine事务执行。
    // 旧index.js的MESSAGE_EDITED / MESSAGE_SWIPED处理器仍会尝试寻找<tableEdit>；
    // 预先标记为空可让旧解析器判定“机器块未变化”并直接返回，避免它再次恢复上一条消息的表格快照。
    chat.tableEditMatches = [];
}

for (const event of [APP.event_types.MESSAGE_EDITED, APP.event_types.MESSAGE_SWIPED]) {
    if (!event) continue;
    APP.eventSource.on(event, markMachineBlockHandled);
    APP.eventSource.makeFirst?.(event, markMachineBlockHandled);
}

console.log('[Memo-N] DeepSeek一次API旧解析器隔离守卫已加载');
