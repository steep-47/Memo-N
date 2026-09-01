import { APP, BASE } from '../../core/manager.js';
import { ROUTE, getProviderRoute } from './providerRoute.js';

const RECORD_MARKER = '[Memo-N record envelope v1]';
const TABLE_PROMPT_MARKER = '# dataTable 世界状态记忆';
const OUTPUT_HEADING = '# 输出';
const GUARD_MARKER = '[Memo-N 当前表格中转协议 v1]';

function writableSheets() {
    return (BASE.getChatSheets?.() ?? [])
        .filter(sheet => sheet?.enable !== false)
        .filter(sheet => sheet?.sendToContext !== false);
}

function tableMapText() {
    const sheets = writableSheets();
    if (!sheets.length) return '当前没有可写入表格。';
    return sheets.map((sheet, table) => {
        const headers = (sheet?.getHeader?.() ?? []).map(value => String(value ?? '').trim()).filter(Boolean);
        return `#${table} ${String(sheet?.name ?? `表${table}`)}：${headers.map((header, column) => `${column}=${header}`).join('，')}`;
    }).join('\n');
}

function relayOutputRules() {
    return `# 输出
- 本轮记录接口为中转站，使用“前置<tableEdit>机器块 + 正常正文”。
- 第一段先输出且只输出一个完整<tableEdit>...</tableEdit>，闭合后立刻继续原本要求的完整正文、状态栏、行动选项和伊依内容。
- 只允许insertRow(tableIndex,{columnIndex:value,...})、updateRow(tableIndex,rowIndex,{columnIndex:value,...})、deleteRow(tableIndex,rowIndex)。
- tableIndex与columnIndex只使用本轮当前真实表格映射；updateRow/deleteRow的rowIndex只能使用对应表第一列真实存在的行号；空表首次记录只能insertRow。
- 当前实际表格均无明确变化时输出<tableEdit><!-- NO_CHANGE --></tableEdit>。
- 不输出JSON记录信封、SQL、Markdown代码围栏或解释。

[当前实际表格映射]
${tableMapText()}`;
}

function relayContract() {
    return `${GUARD_MARKER}
本轮只使用中转站记录协议：先输出一个完整<tableEdit>机器块，再输出完整正常正文。
<tableEdit><!--
updateRow(0,0,{1:"示例值"})
--></tableEdit>
机器块中的tableIndex、columnIndex、rowIndex必须严格依据下面当前真实表格；没有变化使用NO_CHANGE。机器块闭合后继续原本完整正文，不省略任何玩家可见结构。

${tableMapText()}

禁止JSON记录信封、第二个tableEdit、SQL、Markdown代码围栏和额外机器协议。`;
}

function rewriteTablePrompt(message) {
    if (!message || typeof message.content !== 'string' || !message.content.includes(TABLE_PROMPT_MARKER)) return false;
    const content = message.content;
    const index = content.lastIndexOf(OUTPUT_HEADING);
    message.content = index >= 0
        ? `${content.slice(0, index).trimEnd()}\n${relayOutputRules()}`
        : `${content.trimEnd()}\n${relayOutputRules()}`;
    return true;
}

function isManagedRelayRequest(data) {
    if (!data || typeof data !== 'object' || getProviderRoute(data) !== ROUTE.RELAY) return false;
    const messages = Array.isArray(data.messages) ? data.messages : [];
    return messages.some(message => String(message?.content ?? '').includes(RECORD_MARKER));
}

function reinforceRelay(data) {
    if (!isManagedRelayRequest(data) || !Array.isArray(data.messages)) return;

    delete data.json_schema;
    if (data.response_format?.type === 'json_object') delete data.response_format;

    data.messages = data.messages.filter(message => {
        const content = String(message?.content ?? '');
        return !content.includes(RECORD_MARKER) && !content.includes(GUARD_MARKER);
    });
    let rewritten = 0;
    for (const message of data.messages) if (rewriteTablePrompt(message)) rewritten++;
    data.messages.push({ role: 'system', content: relayContract() });

    globalThis.__memoNCurrentTableProtocolProbe = Object.freeze({
        at: Date.now(),
        route: ROUTE.RELAY,
        tableCount: writableSheets().length,
        tablePromptRewritten: rewritten,
    });
    console.log(`[Memo-N] 中转站协议已按当前真实表格重建｜tables=${writableSheets().length}｜prompt=${rewritten}`);
}

const settingsReady = APP.event_types.CHAT_COMPLETION_SETTINGS_READY;
if (settingsReady) {
    APP.eventSource.on(settingsReady, reinforceRelay);
    APP.eventSource.makeLast?.(settingsReady, reinforceRelay);
}

console.log('[Memo-N] 当前表格协议守卫已加载：中转站不再依赖旧七表名称与索引');
