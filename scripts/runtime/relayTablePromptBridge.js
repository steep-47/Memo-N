import { APP, BASE } from '../../core/manager.js';
import { ROUTE, getProviderRoute } from './providerRoute.js';

const RECORD_MARKER = '[Memo-N record envelope v7]';
const TABLE_PROMPT_MARKER = '# dataTable 世界状态记忆';
const OUTPUT_HEADING = '# 输出';
const RELAY_GUARD_MARKER = '[Memo-N relay protocol v104]';

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

function stripMemoOutputProtocol(text) {
    const content = String(text ?? '');
    if (!content.includes(TABLE_PROMPT_MARKER)) return content;
    const at = content.lastIndexOf(OUTPUT_HEADING);
    if (at < 0) return content;
    return content.slice(0, at).trimEnd();
}

function relayContract() {
    return `${RELAY_GUARD_MARKER}
这是Memo-N在本请求中的唯一表格机器协议。它只负责记录，不改变本请求原有正文、状态栏、时间、金钱、选项、角色内容或它们的格式与顺序。

先按本请求原有指令完整生成正常回复。正常回复完成后，在回复末尾追加且只追加一个完整<tableEdit>记录块；追加记录块是完成本轮回复的一部分，不得省略。
记录块内部只允许：
insertRow(tableIndex,{columnIndex:"value",...})
updateRow(tableIndex,rowIndex,{columnIndex:"value",...})
deleteRow(tableIndex,rowIndex)
没有需要写入的内容时仍必须追加<tableEdit><!-- NO_CHANGE --></tableEdit>。
不要把insertRow、updateRow、deleteRow写成XML/HTML标签或属性形式，不输出JSON、SQL、Markdown代码围栏或第二套机器协议。

记录判断以“本轮最终正文已经明确成立的事实”和“当前表格已经保存的事实”比较：当前表缺失的明确事实用insert补齐；已有对象出现持续信息变化用update；明确失效按规则delete；只有应保存事实已完整存在且没有变化时才NO_CHANGE。空表首次出现属于该表职责的明确事实时必须insert建立基线。
updateRow/deleteRow的rowIndex只能使用对应表第一列真实存在的行号；空表只能insertRow。tableIndex和columnIndex严格使用下面当前真实映射：
${liveTableMap()}

<tableEdit>闭合后本轮Memo-N记录任务结束。`;
}

function apply(data) {
    if (!data || getProviderRoute(data) !== ROUTE.RELAY || !Array.isArray(data.messages)) return;

    delete data.json_schema;
    if (data.response_format?.type === 'json_object') delete data.response_format;

    let tablePromptCleaned = 0;
    const kept = [];
    for (const message of data.messages) {
        const text = String(message?.content ?? '');
        if (text.includes(RECORD_MARKER) || text.includes(RELAY_GUARD_MARKER)) continue;
        if (text.includes(TABLE_PROMPT_MARKER)) {
            const cleaned = stripMemoOutputProtocol(text);
            kept.push({ ...message, content: cleaned });
            tablePromptCleaned++;
        } else {
            kept.push(message);
        }
    }
    kept.push({ role: 'system', content: relayContract() });
    data.messages = kept;

    globalThis.__memoNRelayTablePromptProbe = Object.freeze({
        at: Date.now(),
        route: ROUTE.RELAY,
        tablePromptCleaned,
        tableCount: writableSheets().length,
        uniqueRelayProtocol: true,
        finalRole: 'system',
    });
    console.log(`[Memo-N] 中转站唯一记录协议已重建｜tables=${writableSheets().length}｜prompt=${tablePromptCleaned}`);
}

APP.eventSource.on(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, apply);
APP.eventSource.makeLast?.(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, apply);
