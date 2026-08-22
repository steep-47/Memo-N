import { APP } from '../../core/manager.js';
import { oai_settings } from '/scripts/openai.js';

const BEGIN = 'MEMO_N_EDIT_BEGIN';
const END = 'MEMO_N_EDIT_END';
const TABLE_MARKER = '# dataTable 世界状态记忆';
const RECORD_MARKER = '[Memo-N record envelope v1]';

function isRelay(data) {
    const source = String(data?.chat_completion_source ?? oai_settings?.chat_completion_source ?? '').trim().toLowerCase();
    const customUrl = String(data?.custom_url ?? oai_settings?.custom_url ?? '').trim();
    const reverseProxy = String(data?.reverse_proxy ?? oai_settings?.reverse_proxy ?? '').trim();
    return source === 'custom' || Boolean(customUrl) || Boolean(reverseProxy);
}

function sentinelRules() {
    return `\n【Memo-N中转站记录协议】\n完整正常正文必须优先，状态栏、选项、角色留言等原预设结构不得省略。\n正文全部结束后，追加且只追加一个纯文本机器块：\n${BEGIN}\nupdateRow(0,0,{1:"08:30"})\n${END}\n有事实变化时，块内仅允许 insertRow(tableIndex,{columnIndex:value,...})、updateRow(tableIndex,rowIndex,{columnIndex:value,...})、deleteRow(tableIndex,rowIndex)。\n没有事实变化时块内只写 NO_CHANGE。\n机器块必须位于整轮输出最后；${END} 后不得再输出任何字符。\n禁止输出 <tableEdit> 标签、JSON信封、SQL或Markdown代码围栏。`;
}

function rewritePrompt(data) {
    if (!data || typeof data !== 'object' || !isRelay(data) || !Array.isArray(data.messages)) return;
    let touched = 0;
    for (const message of data.messages) {
        const text = String(message?.content ?? '');
        if (!text) continue;
        if (text.includes(TABLE_MARKER) || text.includes(RECORD_MARKER)) {
            // 移除旧XML协议的强制表述，追加纯文本哨兵协议；不改user消息。
            message.content = text
                .replace(/完整回复结束后必须追加且只追加一个<tableEdit>[\s\S]*?日期、时间、地点、当前场景人物发生变化时必须维护表0。/g, '完整回复结束后执行Memo-N中转站记录协议。日期、时间、地点、当前场景人物发生变化时必须维护表0。')
                .replace(/完整正常正文，再在正文末尾追加一个且仅一个<tableEdit>记录块/g, '完整正常正文，再在正文末尾追加一个且仅一个Memo-N纯文本记录块')
                .replace(/无任何事实变化时必须输出<tableEdit><!-- NO_CHANGE --><\/tableEdit>。有变化时输出<tableEdit><!-- 函数调用 --><\/tableEdit>。/g, '无任何事实变化时记录块写NO_CHANGE；有变化时写函数调用。')
                .replace(/<tableEdit>之后不得再输出任何字符/g, `${END}之后不得再输出任何字符`)
                + sentinelRules();
            touched++;
        }
    }
    globalThis.__memoNSentinelPrompt = { at: Date.now(), touched };
    console.log(`[Memo-N] 中转站纯文本哨兵协议已注入：messages=${touched}`);
}

function convertSentinelInText(text) {
    const raw = String(text ?? '');
    const start = raw.indexOf(BEGIN);
    if (start < 0) return { found: false, text: raw };
    const end = raw.indexOf(END, start + BEGIN.length);
    if (end < 0) return { found: false, text: raw };
    const body = raw.slice(start + BEGIN.length, end).trim();
    const before = raw.slice(0, start).trimEnd();
    const after = raw.slice(end + END.length).trim();
    if (after) return { found: false, text: raw };
    const tableEdit = `<tableEdit><!--\n${body || 'NO_CHANGE'}\n--></tableEdit>`;
    return { found: true, text: `${before}\n${tableEdit}`.trim() };
}

function convertBeforeRecordEngine() {
    const chat = APP.getContext?.()?.chat;
    const piece = Array.isArray(chat) ? chat.at(-1) : null;
    if (!piece || piece.is_user) return;

    const content = convertSentinelInText(piece.mes);
    if (content.found) {
        piece.mes = content.text;
        const id = Number(piece.swipe_id);
        if (Array.isArray(piece.swipes) && Number.isInteger(id) && id >= 0 && id < piece.swipes.length) piece.swipes[id] = piece.mes;
        console.log('[Memo-N] 已在GENERATION_ENDED前将正文纯文本哨兵转换为内部tableEdit');
        return;
    }

    const id = Number(piece.swipe_id);
    const info = Number.isInteger(id) && id >= 0 ? piece?.swipe_info?.[id] : null;
    const reasoning = String(info?.extra?.reasoning || piece?.extra?.reasoning || '');
    const converted = convertSentinelInText(reasoning);
    if (converted.found) {
        if (info?.extra) info.extra.reasoning = converted.text;
        else {
            if (!piece.extra || typeof piece.extra !== 'object') piece.extra = {};
            piece.extra.reasoning = converted.text;
        }
        console.log('[Memo-N] 已在GENERATION_ENDED前将reasoning纯文本哨兵转换为内部tableEdit');
    }
}

const requestEvent = APP.event_types.CHAT_COMPLETION_SETTINGS_READY;
APP.eventSource.on(requestEvent, rewritePrompt);
APP.eventSource.makeLast?.(requestEvent, rewritePrompt);

const endedEvent = APP.event_types.GENERATION_ENDED;
APP.eventSource.on(endedEvent, convertBeforeRecordEngine);
APP.eventSource.makeFirst?.(endedEvent, convertBeforeRecordEngine);

console.log('[Memo-N] 中转站纯文本哨兵桥已加载：规避预设Regex清理XML标签；不改user消息');
