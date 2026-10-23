import { APP, USER } from '../../core/manager.js';
import { RECORD_SEMANTICS_RULE, normalizeLegacyRecordSemantics } from './recordSemantics.js';

const MARK = '[Memo-N对象核对输出硬约束v5]';
const OLD_MARK_RE = /^\[Memo-N对象核对输出硬约束v[12345]\]/;
const RECORD_MARK = '[Memo-N native tableEdit one-call v1]';

function active() {
    const setting = USER?.tableBaseSetting;
    return USER?.getSettings?.()?.memo_n_settings?.independent_record_api_enabled !== true
        && setting?.isExtensionAble !== false
        && setting?.isAiReadTable !== false
        && setting?.isAiWriteTable !== false
        && setting?.injection_mode !== 'injection_off'
        && setting?.step_by_step !== true;
}

function lastUserIndex(messages) {
    for (let index = messages.length - 1; index >= 0; index--) {
        if (messages[index]?.role === 'user') return index;
    }
    return -1;
}

function extractRecordContract(messages) {
    const index = messages.findIndex(message => String(message?.content ?? '').includes(RECORD_MARK));
    if (index < 0) return null;
    return messages.splice(index, 1)[0] ?? null;
}

function normalizeSystemRules(messages) {
    return messages.map(message => {
        if (String(message?.role ?? '').toLowerCase() !== 'system' || typeof message?.content !== 'string') return message;
        return { ...message, content: normalizeLegacyRecordSemantics(message.content) };
    });
}

function inject(data) {
    if (!active() || !Array.isArray(data?.messages)) return;

    data.messages = normalizeSystemRules(data.messages)
        .filter(message => !OLD_MARK_RE.test(String(message?.content ?? '')));
    const contract = extractRecordContract(data.messages);
    const guard = {
        role: 'system',
        content: `${MARK}
${RECORD_SEMANTICS_RULE}
本轮updateRow统一4参数：updateRow(tableIndex,rowIndex,{columnIndex:"value"},"expected")。
本轮deleteRow统一3参数：deleteRow(tableIndex,rowIndex,"expected")。
表2/4/5：expected原样抄本轮对象核对映射中同一tableIndex、rowIndex的修改前名称；其他表填空字符串""。不能把占位词expected写入结果。
生成正式记录前检查每条update/delete的最后参数；表2/4/5名称缺失或无法确认时，不得猜测，也不得输出缺参调用。保持本轮memo-round标识及原预设正文结构。`,
    };

    const userIndex = lastUserIndex(data.messages);
    if (userIndex < 0) {
        if (contract) data.messages.push(contract);
        data.messages.push(guard);
        return;
    }

    const memoMessages = contract ? [contract, guard] : [guard];
    data.messages.splice(userIndex, 0, ...memoMessages);
}

const settingsReady = APP.event_types.CHAT_COMPLETION_SETTINGS_READY;
APP.eventSource.on(settingsReady, inject);
APP.eventSource.makeLast?.(settingsReady, inject);
console.log('[Memo-N] 对象核对输出硬约束v5已加载：发送前移除旧冲突记录规则，统一职责紧贴最后user之前');
