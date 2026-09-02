import { APP, BASE } from '../../core/manager.js';
import { ROUTE, getProviderRoute } from './providerRoute.js';

const RECORD_MARKER = '[Memo-N record envelope v7]';
const TABLE_PROMPT_MARKER = '# dataTable 世界状态记忆';
const RELAY_GUARD_MARKER = '[Memo-N relay protocol v106]';

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

function relayAppendix() {
    return `${RELAY_GUARD_MARKER}

## Memo-N机器记录附录
上方原有# 输出规则全部照常执行，正文、状态、时间、金钱、选项、角色内容及顺序均保持原要求。
完成上方全部可见输出后，回复最后必须再追加且只追加一个完整<tableEdit>记录块；这是本轮回复的固定末尾，不得省略。

记录块只使用：
insertRow(tableIndex,{columnIndex:"value",...})
updateRow(tableIndex,rowIndex,{columnIndex:"value",...})
deleteRow(tableIndex,rowIndex)

没有需要写表的事实也必须以<tableEdit><!-- NO_CHANGE --></tableEdit>结束。
不要把函数写成XML/HTML标签、JSON、SQL或Markdown代码块。

记录依据是“本轮最终正文已经明确成立的事实”与“当前表格已保存事实”的差异：表里缺失的已确认事实要insert；已有对象的新持续信息要update；明确失效按规则delete；空表出现属于该表职责的明确事实时必须insert建立基线。
updateRow/deleteRow只能使用对应表第一列真实存在的rowIndex；空表只能insertRow。tableIndex和columnIndex严格使用下面真实映射：
${liveTableMap()}

最终回复的最后一个闭合标签必须是</tableEdit>。`;
}

function apply(data) {
    if (!data || getProviderRoute(data) !== ROUTE.RELAY || !Array.isArray(data.messages)) return;

    delete data.json_schema;
    if (data.response_format?.type === 'json_object') delete data.response_format;

    let tablePromptPatched = 0;
    const kept = [];
    for (const message of data.messages) {
        const text = String(message?.content ?? '');

        // recordEngine的额外relay system协议只用于建立pending/解析模式；最终请求里移除，避免双协议。
        if (text.includes(RECORD_MARKER) || text.includes('[Memo-N relay protocol v104]') || text.includes('[Memo-N relay protocol v105]') || text.includes(RELAY_GUARD_MARKER)) continue;

        if (text.includes(TABLE_PROMPT_MARKER)) {
            // 关键：不再删除、替换、前插原# 输出。保持原消息逐字存在，只在同一条必达table prompt末尾追加机器附录。
            kept.push({ ...message, content: `${text.trimEnd()}\n\n${relayAppendix()}` });
            tablePromptPatched++;
        } else {
            kept.push(message);
        }
    }

    // 极端情况下没有dataTable prompt时才回退为system附录；正常主链不走这里。
    if (!tablePromptPatched) kept.push({ role: 'system', content: relayAppendix() });
    data.messages = kept;

    globalThis.__memoNRelayTablePromptProbe = Object.freeze({
        at: Date.now(),
        route: ROUTE.RELAY,
        tablePromptPatched,
        tableCount: writableSheets().length,
        uniqueRelayProtocol: true,
        placement: tablePromptPatched ? 'inside-surviving-table-prompt-end' : 'fallback-system-end',
    });
    console.log(`[Memo-N] 中转站记录协议绑定原dataTable prompt末尾｜tables=${writableSheets().length}｜patched=${tablePromptPatched}`);
}

APP.eventSource.on(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, apply);
APP.eventSource.makeLast?.(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, apply);
