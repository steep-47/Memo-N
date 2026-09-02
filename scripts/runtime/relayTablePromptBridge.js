import { APP, BASE } from '../../core/manager.js';
import { ROUTE, getProviderRoute } from './providerRoute.js';

const RECORD_MARKER = '[Memo-N record envelope v7]';
const TABLE_PROMPT_MARKER = '# dataTable 世界状态记忆';
const OUTPUT_HEADING = '# 输出';
const RELAY_GUARD_MARKER = '[Memo-N relay protocol v107]';

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
这是Memo-N在本请求中的唯一表格机器协议。它只负责记录，不改变本请求原有正文格式与内容要求。

先完整执行本请求原有回复要求。原有回复完成后，在末尾追加且只追加一个完整<tableEdit>记录块。
记录块内部只允许：
insertRow(tableIndex,{columnIndex:"value",...})
updateRow(tableIndex,rowIndex,{columnIndex:"value",...})
deleteRow(tableIndex,rowIndex)
没有需要写入的内容时追加<tableEdit><!-- NO_CHANGE --></tableEdit>。

记录判断以本轮最终正文已经明确成立的事实与当前表格已保存事实比较：缺失事实insert，已有对象的新持续信息update，明确失效按规则delete，只有已经完整存在且无变化时NO_CHANGE。
updateRow/deleteRow只能使用对应表第一列真实存在的rowIndex；空表只能insertRow。tableIndex和columnIndex严格使用下面当前真实映射：
${liveTableMap()}`;
}

function apply(data) {
    if (!data || getProviderRoute(data) !== ROUTE.RELAY || !Array.isArray(data.messages)) return;

    delete data.json_schema;
    if (data.response_format?.type === 'json_object') delete data.response_format;

    const kept = [];
    for (const message of data.messages) {
        const text = String(message?.content ?? '');
        if (text.includes(RECORD_MARKER) || text.includes('[Memo-N relay protocol v104]') || text.includes('[Memo-N relay protocol v105]') || text.includes('[Memo-N relay protocol v106]') || text.includes(RELAY_GUARD_MARKER)) continue;
        kept.push(message);
    }
    kept.push({ role: 'system', content: relayContract() });
    data.messages = kept;

    globalThis.__memoNRelayTablePromptProbe = Object.freeze({
        at: Date.now(),
        route: ROUTE.RELAY,
        tablePromptUntouched: true,
        tableCount: writableSheets().length,
        uniqueRelayProtocol: true,
        placement: 'separate-system-after-original-preset',
    });
    console.log(`[Memo-N] 中转站回退为非侵入记录协议｜tables=${writableSheets().length}`);
}

APP.eventSource.on(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, apply);
APP.eventSource.makeLast?.(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, apply);
