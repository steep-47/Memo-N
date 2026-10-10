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
本轮记录块必须遵守主记录引擎的XML协议，不得输出insertRow()/updateRow()/deleteRow()函数调用文本。
updateRow必须写成：<updateRow tableIndex="4" rowIndex="0" expected="老叔公"><data columnIndex="5" value="练气士"/></updateRow>。
deleteRow必须写成：<deleteRow tableIndex="2" rowIndex="0" expected="肉饼"/>。
表2/4/5：expected原样抄本轮对象核对映射中同一tableIndex、rowIndex的修改前名称；其他表expected填写空字符串。不能把占位词expected写入结果。
每个data必须同时填写columnIndex与value；value中的英文双引号、&、<、>分别转义为&quot;、&amp;、&lt;、&gt;。
生成正式记录前检查每条update/delete的expected属性；表2/4/5名称缺失或无法确认时，不得猜测，不得输出该操作。保持本轮memo-round标识、tableEdit外壳及原预设正文结构。`,
    });
}
const settingsReady = APP.event_types.CHAT_COMPLETION_SETTINGS_READY;
APP.eventSource.on(settingsReady, inject);
APP.eventSource.makeLast?.(settingsReady, inject);
console.log('[Memo-N] 对象核对输出硬约束v2已加载');

