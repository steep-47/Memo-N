import { APP, USER } from '../../core/manager.js';

const MARK = '[Memo-N对象核对输出硬约束v2]';
function active() {
    const setting = USER?.tableBaseSetting;
    return USER?.getSettings?.()?.memo_n_settings?.independent_record_api_enabled !== true
        && setting?.isExtensionAble !== false
        && setting?.isAiReadTable !== false
        && setting?.isAiWriteTable !== false
        && setting?.injection_mode !== 'injection_off'
        && setting?.step_by_step !== true;
}
function inject(data) {
    if (!active() || !Array.isArray(data?.messages)) return;
    data.messages = data.messages.filter(message => !/^\[Memo-N对象核对输出硬约束v[12]\]/.test(String(message?.content ?? '')));
    data.messages.push({
        role: 'system',
        content: `${MARK}
本轮updateRow统一4参数：updateRow(tableIndex,rowIndex,{columnIndex:"value"},"expected")。
本轮deleteRow统一3参数：deleteRow(tableIndex,rowIndex,"expected")。
表2/4/5：expected原样抄本轮对象核对映射中同一tableIndex、rowIndex的修改前名称；其他表填空字符串""。不能把占位词expected写入结果。
生成正式记录前检查每条update/delete的最后参数；表2/4/5名称缺失或无法确认时，不得猜测，也不得输出缺参调用。保持本轮memo-round标识及原预设正文结构。`,
    });
}
const settingsReady = APP.event_types.CHAT_COMPLETION_SETTINGS_READY;
APP.eventSource.on(settingsReady, inject);
APP.eventSource.makeLast?.(settingsReady, inject);
console.log('[Memo-N] 对象核对输出硬约束v2已加载');

