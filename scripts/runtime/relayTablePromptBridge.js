import { APP, BASE } from '../../core/manager.js';
import { ROUTE, getProviderRoute } from './providerRoute.js';

const RECORD_MARKER = '[Memo-N record envelope v7]';
const TABLE_PROMPT_MARKER = '# dataTable 世界状态记忆';
const OUTPUT_HEADING = '# 输出';
const RELAY_GUARD_MARKER = '[Memo-N relay verification three-point]';

function writableSheets() {
    return (BASE.getChatSheets?.() ?? [])
        .filter(sheet => sheet?.enable !== false)
        .filter(sheet => sheet?.sendToContext !== false);
}

function liveTableMap() {
    const sheets = writableSheets();
    if (!sheets.length) return '当前没有可写表格。';
    return sheets.map((sheet, tableIndex) => {
        const name = String(sheet?.name ?? `表${tableIndex}`);
        const headers = (sheet?.getHeader?.() ?? [])
            .map((value, columnIndex) => ({ columnIndex, header: String(value ?? '').trim() }))
            .filter(item => item.header);
        const state = sheet?.isEmpty?.() ? '空表' : `已有${Math.max(0, Number(sheet?.getRowCount?.() ?? 1) - 1)}行`;
        return `#${tableIndex} ${name}（${state}）：${headers.map(item => `${item.columnIndex}=${item.header}`).join('，')}`;
    }).join('\n');
}

function machineRule() {
    return `Memo-N机器记录：本轮回复第一段先输出一个完整<tableEdit>记录块，闭合后继续执行原有# 输出的全部要求。记录块只使用insertRow(tableIndex,{columnIndex:"value",...})、updateRow(tableIndex,rowIndex,{columnIndex:"value",...})、deleteRow(tableIndex,rowIndex)；无变化也输出<tableEdit><!-- NO_CHANGE --></tableEdit>。机器记录不能替代、删减或重排原有正文、状态、时间、金钱、选项及角色内容。`;
}

function reinforceTablePrompt(messages) {
    let count = 0;
    for (const message of messages) {
        const text = String(message?.content ?? '');
        if (!text.includes(TABLE_PROMPT_MARKER)) continue;
        const at = text.lastIndexOf(OUTPUT_HEADING);
        if (at >= 0) {
            const head = text.slice(0, at + OUTPUT_HEADING.length);
            const originalOutput = text.slice(at + OUTPUT_HEADING.length);
            message.content = `${head}\n- ${machineRule()}${originalOutput}`;
        } else {
            message.content = `${text.trimEnd()}\n\n# Memo-N机器记录补充\n${machineRule()}`;
        }
        count++;
    }
    return count;
}

function reinforceLastUser(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message?.role !== 'user' || typeof message.content !== 'string') continue;
        if (!message.content.includes('[Memo-N记录提醒]')) {
            message.content = `${message.content.trimEnd()}\n\n[Memo-N记录提醒：回复第一段先给完整<tableEdit>机器块，闭合后完整执行原有回复要求。]`;
        }
        return true;
    }
    return false;
}

function relayContract() {
    return `${RELAY_GUARD_MARKER}\n这是本轮Memo-N中转站记录协议的最终兜底，不取代任何原有输出要求。\n${machineRule()}\n当前真实表格映射：\n${liveTableMap()}\n空表出现属于该表职责的明确事实时用insertRow建立基线；updateRow/deleteRow只能使用真实存在的rowIndex。`;
}

function apply(data) {
    if (!data || getProviderRoute(data) !== ROUTE.RELAY || !Array.isArray(data.messages)) return;

    delete data.json_schema;
    if (data.response_format?.type === 'json_object') delete data.response_format;

    data.messages = data.messages.filter(message => {
        const text = String(message?.content ?? '');
        return !text.includes(RECORD_MARKER)
            && !text.includes('[Memo-N relay protocol v104]')
            && !text.includes('[Memo-N relay protocol v105]')
            && !text.includes('[Memo-N relay protocol v106]')
            && !text.includes('[Memo-N relay protocol v107]')
            && !text.includes(RELAY_GUARD_MARKER);
    });

    const tablePromptReinforced = reinforceTablePrompt(data.messages);
    const lastUserReinforced = reinforceLastUser(data.messages);
    data.messages.push({ role: 'system', content: relayContract() });

    globalThis.__memoNRelayTablePromptProbe = Object.freeze({
        at: Date.now(),
        route: ROUTE.RELAY,
        tablePromptReinforced,
        lastUserReinforced,
        systemFallback: true,
        originalOutputPreserved: true,
        tableCount: writableSheets().length,
    });
    console.log(`[Memo-N] relay verification｜table=${tablePromptReinforced}｜user=${lastUserReinforced}`);
}

APP.eventSource.on(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, apply);
APP.eventSource.makeLast?.(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, apply);
