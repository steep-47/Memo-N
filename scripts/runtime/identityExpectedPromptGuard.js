import { APP, USER } from '../../core/manager.js';

const MARK = '[Memo-N对象核对输出硬约束v1]';
const RECORD_MARK = '[Memo-N native tableEdit one-call v1]';

function independentEnabled() {
    return USER?.getSettings?.()?.memo_n_settings?.independent_record_api_enabled === true;
}

function active() {
    const setting = USER?.tableBaseSetting;
    return !independentEnabled()
        && setting?.isExtensionAble !== false
        && setting?.isAiReadTable !== false
        && setting?.isAiWriteTable !== false
        && setting?.injection_mode !== 'injection_off'
        && setting?.step_by_step !== true;
}

function patchRecordContract(content) {
    let text = String(content ?? '');
    if (!text.includes(RECORD_MARK)) return text;

    const oldFormat = `机器记录块格式：\n<tableEdit><!--\ninsertRow(tableIndex,{columnIndex:"value"})\nupdateRow(tableIndex,rowIndex,{columnIndex:"value"})\ndeleteRow(tableIndex,rowIndex)\n--></tableEdit>`;
    const newFormat = `机器记录块调用格式：\ninsertRow(tableIndex,{columnIndex:"value"})\n表0/1/3/6的update：updateRow(tableIndex,rowIndex,{columnIndex:"value"})\n表0/1/3/6的delete：deleteRow(tableIndex,rowIndex)\n表2/4/5的update：updateRow(tableIndex,rowIndex,{columnIndex:"value"},"当前行第一列原值")\n表2/4/5的delete：deleteRow(tableIndex,rowIndex,"当前行第一列原值")`;

    if (text.includes(oldFormat)) text = text.replace(oldFormat, newFormat);
    return text;
}

function strengthenReminder(content) {
    const text = String(content ?? '');
    if (!text.includes('[Memo-N本轮输出顺序：')) return text;
    if (text.includes('三参数updateRow只允许表0/1/3/6')) return text;
    return `${text}\n\n[Memo-N对象核对硬约束：三参数updateRow和二参数deleteRow只允许表0/1/3/6。表2/4/5的updateRow必须有第4参数对象核对名，deleteRow必须有第3参数对象核对名；对象核对名必须原样抄当前目标row第一列。输出<tableEdit>前逐条检查，缺少参数先补齐，禁止输出不完整调用。]`;
}

function inject(data) {
    if (!active() || !data || typeof data !== 'object' || !Array.isArray(data.messages)) return;

    data.messages = data.messages
        .filter(message => !String(message?.content ?? '').includes(MARK))
        .map(message => {
            if (typeof message?.content !== 'string') return message;
            let content = patchRecordContract(message.content);
            content = strengthenReminder(content);
            return content === message.content ? message : { ...message, content };
        });

    data.messages.push({
        role: 'system',
        content: `${MARK}\n表2/4/5的update/delete必须使用完整对象核对格式：\nupdateRow(tableIndex,rowIndex,{columnIndex:"value"},"当前行第一列原值")\ndeleteRow(tableIndex,rowIndex,"当前行第一列原值")\n三参数updateRow、二参数deleteRow仅允许表0/1/3/6；用于表2/4/5一律视为未完成，禁止输出。生成<tableEdit>前必须逐条检查全部表2/4/5操作；发现缺少对象核对名，先从当前表目标row第一列原样抄写补齐，再输出。不得猜测、不得省略。`,
    });
}

const settingsReady = APP.event_types.CHAT_COMPLETION_SETTINGS_READY;
APP.eventSource.on(settingsReady, inject);
APP.eventSource.makeLast?.(settingsReady, inject);

console.log('[Memo-N] 对象核对输出硬约束v1已加载：修正表2/4/5不完整update/delete提示');
