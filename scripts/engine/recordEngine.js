import { APP, BASE, EDITOR, USER } from '../../core/manager.js';
import { executeMemoTableEdit, restoreMemoSnapshot, saveMemoSnapshot } from '../runtime/safeTableExecutor.js?v=memon9';
import { ROUTE, getProviderRoute, providerDebug } from '../runtime/providerRoute.js';
import {
    changesToStrictCalls,
    parseRecordEnvelope,
    parseRelayTableEditEnvelope,
    parseRelayTaggedEnvelope,
} from './recordEnvelope.js';

const MARKER = '[Memo-N record envelope v3]';
const TABLE_PROMPT_MARKER = '# dataTable 世界状态记忆';
const OUTPUT_HEADING = '# 输出';
const handled = new WeakMap();
let armed = null;
let pending = null;
let lastRenderedChatId = null;

globalThis.__memoNRecordEngineActive = true;

function independentEnabled() { return USER?.getSettings?.()?.memo_n_settings?.independent_record_api_enabled === true; }
function active() {
    const setting = USER?.tableBaseSetting;
    return !independentEnabled() && setting?.isExtensionAble !== false && setting?.isAiReadTable !== false
        && setting?.isAiWriteTable !== false && setting?.injection_mode !== 'injection_off' && setting?.step_by_step !== true;
}
function appendType(type) { return ['continue', 'append', 'appendfinal'].includes(String(type ?? '').toLowerCase()); }
function validGeneration(type, dryRun) { return active() && !dryRun && !['quiet', 'impersonate'].includes(String(type ?? '').toLowerCase()); }
function lastAssistant() {
    const chat = USER?.getContext?.()?.chat;
    const last = Array.isArray(chat) ? chat.at(-1) : null;
    return last?.is_user === false ? last : null;
}
function arm(type, _options, dryRun) {
    armed = validGeneration(type, dryRun) ? { type: String(type ?? 'normal'), at: Date.now() } : null;
    lastRenderedChatId = null;
    if (armed) pending = null;
}
function preparePrompt() {}

function writableSheets() {
    return (BASE.getChatSheets?.() ?? [])
        .filter(sheet => sheet?.enable !== false)
        .filter(sheet => sheet?.sendToContext !== false);
}
function liveColumnMap() {
    const sheets = writableSheets();
    if (!sheets.length) return '当前没有可写表格。';
    return sheets.map((sheet, tableIndex) => {
        const name = String(sheet?.name ?? `表${tableIndex}`);
        const headers = (sheet?.getHeader?.() ?? []).map(value => String(value ?? '').trim()).filter(Boolean);
        const state = sheet?.isEmpty?.() ? '空表' : `已有${Math.max(0, Number(sheet?.getRowCount?.() ?? 1) - 1)}行`;
        if (!headers.length) return `#${tableIndex} ${name}：当前无法读取表头，本轮不得写此表`;
        return `#${tableIndex} ${name}（${state}）：${headers.map((header, column) => `${column}=${header}`).join('，')}；合法column范围0-${headers.length - 1}`;
    }).join('\n');
}
function sharedRecordRules() {
    return `
[当前真实表格与列号映射｜column严格从0开始]
${liveColumnMap()}

记录判断必须比较“本轮最终正文明确成立的事实”与“当前表里已经保存的事实”，不是只问这些事实相对上一轮有没有变化。
- 正文中已经明确成立、属于某表职责、但当前表没有保存：这是待记录内容，insert补齐。
- 当前表已有对应对象，但正文给出新的持续信息或状态改变：update已有行。
- 已有记录明确失效：按表规则delete。
- 空表没有任何既有记录可供比较；只要本轮最终正文出现属于该表职责的明确事实，就必须insert建立基线，不能因为“没有上一轮变化”而NO_CHANGE。
- 只有逐表比较后，应保存的事实已经完整存在，且没有新增、变化、补充或失效，才允许NO_CHANGE/空changes。
写cells前必须先在对应table的映射中找到列名，再抄左侧数字作为column；不得按“第1列=1”编号，不得写超出合法范围的column，不得创造不存在的列。没有对应列就不记录该字段。
世界书人物与剧情自动生成NPC完全同规则：只按已确认事实记录，不因来源不同改变记录策略。
伊依是后台陪伴者，不是剧情世界实体：不得写入任何世界状态表；她只使用独立长期记忆库。`;
}
function visibleReplyRules() {
    return `
[可见回复协议保持不变]
Memo-N机器记录只增加传输外壳，不改变原始预设对用户可见回复的任何要求。
- 完整保留原始提示中本轮要求出现的全部模块、顺序、标签、分隔与格式；包括但不限于时间/地点戳、金钱/财物戳、状态栏、正文、行动选项、角色留言、伊依留言等。
- “完整正常正文/回复”指原预设要求的整个可见输出，不是只指故事段落；不得因为先输出机器记录块而省略、合并、改写或重排外围结构。
- 如果原预设没有要求某个模块，本规则不额外创造；如果原预设要求，就照原格式完整输出。`;
}
function finalContract() {
    return `${MARKER}
本轮最终响应只能是一个JSON对象，JSON外不得出现任何字符：
{"reply":"给用户看的完整正常回复","changes":[{"op":"insert|update|delete","table":0,"row":null,"cells":[{"column":0,"value":"值"}]}]}
reply必须包含原预设本轮要求的完整可见输出。changes记录为了让当前表格与本轮最终正文中已经明确成立的世界事实保持一致而需要执行的操作；表中缺失的已确认事实同样属于changes，不要求它必须相对上一轮发生变化。
每个变更固定包含op/table/row/cells。insert的row必须为null；update/delete的row必须是整数；delete的cells必须为[]。
row只能抄当前表格第一列真实存在的数字。空表只能insert。value只能是字符串或有限数字；同一操作不得重复column。
${visibleReplyRules()}
${sharedRecordRules()}
禁止输出函数、SQL、Markdown、tableEdit、解释或额外字段。`;
}
function relayOutputRules() {
    return `# 输出
- 本轮为Memo-N中转站前置tableEdit记录模式。先在内部规划原预设要求的完整可见回复，再逐表比较其中已经明确成立的事实与当前表格；表中缺失的事实也必须形成记录操作。
- 实际输出时，第一段必须先输出且只输出一个完整<tableEdit>机器块，然后立刻继续原预设要求的完整可见回复；不要等正文写完后再补机器块。
- 格式严格为：\n<tableEdit><!--\ninsertRow(0,{0:"日期",1:"时间"})\n--></tableEdit>
- 只允许insertRow(tableIndex,{columnIndex:value,...})、updateRow(tableIndex,rowIndex,{columnIndex:value,...})、deleteRow(tableIndex,rowIndex)。
- updateRow/deleteRow只能使用当前表格第一列真实存在的rowIndex；空表首次记录只能insertRow。
- 空表只要正文出现属于该表职责的明确事实就必须insert；不能把“表里什么都没有”判成NO_CHANGE。
- 只有应保存事实已经完整存在且没有新增、补充、变化或失效时，才输出<tableEdit><!-- NO_CHANGE --></tableEdit>。
${visibleReplyRules()}
- 不得输出JSON记录信封、tagged JSON哨兵、SQL、Markdown代码围栏或解释。`;
}
function relayContract() {
    return `${MARKER}
本轮使用Memo-N中转站前置tableEdit记录协议。先在内部规划原预设要求的完整可见回复，然后逐表比较最终回复里已经明确成立的事实与当前表格。
真正开始输出时，第一段必须先给出且只给出一个完整tableEdit机器块；机器块闭合后立即原样继续原预设要求的完整可见回复：
<tableEdit><!--
insertRow(0,{0:"日期",1:"时间"})
--></tableEdit>
机器块只是前缀，不得把后续“完整回复”缩减成只有故事正文。
只有当前表格里真实存在的rowIndex才能用于updateRow/deleteRow；空表首次记录只能insertRow。唯一允许的操作是insertRow(tableIndex,{columnIndex:value,...})、updateRow(tableIndex,rowIndex,{columnIndex:value,...})、deleteRow(tableIndex,rowIndex)。
${visibleReplyRules()}
${sharedRecordRules()}
不得使用JSON记录信封、tagged JSON哨兵、SQL、Markdown代码围栏或解释。`;
}
function reinforceRelayTablePrompt(messages) {
    let rewritten = 0;
    const output = relayOutputRules();
    for (const message of messages) {
        const content = String(message?.content ?? '');
        if (!content.includes(TABLE_PROMPT_MARKER)) continue;
        const index = content.lastIndexOf(OUTPUT_HEADING);
        message.content = index >= 0 ? `${content.slice(0, index).trimEnd()}\n${output}` : `${content.trimEnd()}\n${output}`;
        rewritten++;
    }
    return rewritten;
}
function reinforceRelayLastUser(messages) {
    if (!Array.isArray(messages)) return false;
    const reminder = `\n\n[Memo-N输出硬约束：先输出完整<tableEdit><!-- 表格操作或NO_CHANGE --></tableEdit>；闭合后必须继续原预设要求的全部可见输出结构，时间/地点戳、金钱/财物戳、状态栏、正文、选项、角色/伊依留言等凡原预设要求者一项不省略、不重排。空表中缺失的已确认事实必须补齐。]`;
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (message?.role !== 'user' || typeof message.content !== 'string') continue;
        if (!message.content.includes('<tableEdit>')) message.content = `${message.content.trimEnd()}${reminder}`;
        return true;
    }
    return false;
}
const schema = {
    name: 'memo_n_record_envelope', strict: true,
    value: {
        type: 'object', additionalProperties: false,
        properties: {
            reply: { type: 'string' },
            changes: { type: 'array', items: { type: 'object', additionalProperties: false,
                properties: { op: { type: 'string', enum: ['insert', 'update', 'delete'] }, table: { type: 'integer', minimum: 0 },
                    row: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
                    cells: { type: 'array', items: { type: 'object', additionalProperties: false,
                        properties: { column: { type: 'integer', minimum: 0 }, value: { anyOf: [{ type: 'string' }, { type: 'number' }] } }, required: ['column', 'value'] } } },
                required: ['op', 'table', 'row', 'cells'] } },
        }, required: ['reply', 'changes'],
    },
};
function inject(data) {
    if (!armed || !active() || !data || typeof data !== 'object') return;
    const context = USER.getContext?.();
    const session = context?.chat;
    const base = lastAssistant();
    const route = getProviderRoute(data);
    const relayMode = route === ROUTE.RELAY;
    const info = providerDebug(data);
    let reinforced = 0;
    let userReinforced = false;
    pending = { at: Date.now(), type: armed.type, session, startLength: Array.isArray(session) ? session.length : 0, base,
        baseMes: String(base?.mes ?? ''), baseSwipeId: Number(base?.swipe_id ?? -1), baseReasoning: base ? reasoningText(base) : '',
        responseMode: relayMode ? 'relay_tableedit' : 'json', route };
    armed = null;
    if (Array.isArray(data.messages)) {
        data.messages = data.messages.filter(message => !String(message?.content ?? '').includes(MARKER));
        reinforced = relayMode ? reinforceRelayTablePrompt(data.messages) : 0;
        userReinforced = relayMode ? reinforceRelayLastUser(data.messages) : false;
        data.messages.push({ role: 'system', content: relayMode ? relayContract() : finalContract() });
    }
    if (route === ROUTE.DEEPSEEK) { delete data.json_schema; data.response_format = { type: 'json_object' }; }
    else if (relayMode) { delete data.json_schema; if (data.response_format?.type === 'json_object') delete data.response_format; }
    else data.json_schema = structuredClone(schema);
    const messages = Array.isArray(data.messages) ? data.messages : [];
    const last = messages.at(-1);
    globalThis.__memoNLastRequestProbe = Object.freeze({ at: Date.now(), route, responseMode: relayMode ? 'relay_tableedit_leading' : 'json',
        messageCount: messages.length, markerPresent: messages.some(message => String(message?.content ?? '').includes(MARKER)),
        relayTableEditPresent: relayMode && messages.some(message => String(message?.content ?? '').includes('<tableEdit>')),
        tablePromptReinforced: reinforced, lastUserReinforced: userReinforced, finalRole: String(last?.role ?? '') });
}
function syncSwipe(chat) { const id = Number(chat?.swipe_id); if (Array.isArray(chat?.swipes) && Number.isInteger(id) && id >= 0 && id < chat.swipes.length) chat.swipes[id] = chat.mes; }
function copySnapshot(value) { if (!value || typeof value !== 'object') return null; try { return BASE.copyHashSheets(value); } catch (_) { return structuredClone(value); } }
function previousSnapshot(chatId) { const id = Number(chatId); return Number.isInteger(id) && id > 0 ? BASE.getLastSheetsPiece(id - 1, 1000, false)?.piece?.memo_n_hash_sheets : BASE.initHashSheet?.()?.memo_n_hash_sheets; }
function setStatus(chat, envelope, execution) {
    const record = envelope?.tableEdit ? String(envelope.tableEdit) : JSON.stringify(envelope?.changes ?? []);
    Object.defineProperty(chat, '__memoStrictExecution', { configurable: true, writable: true, value: { swipeId: Number(chat?.swipe_id ?? 0), mes: String(chat?.mes ?? ''), tableEdit: record,
        ok: execution.ok === true, changed: execution.changed === true, noChange: execution.noChange === true, count: Number(execution.count || 0), error: String(execution.error || ''), at: Date.now(), engine: 'Memo-N' } });
}
async function preserveFailureBaseline(chatId, chat, appendMode) {
    if (!appendMode) { const restored = restoreMemoSnapshot(previousSnapshot(chatId)); if (!restored.ok) return false; }
    try { saveMemoSnapshot(chat); await USER.saveChat(); return true; } catch (error) { console.error('[Memo-N] 失败基线保存失败', error); return false; }
}
function incompleteEnvelope(envelope) { const error = String(envelope?.error || ''); return envelope?.ok === false && (/响应不是合法JSON：Unexpected end of JSON input/i.test(error) || /记录块尚未闭合/.test(error)); }
function reasoningText(chat) {
    const swipeId = Number(chat?.swipe_id);
    const swipeReasoning = Number.isInteger(swipeId) && swipeId >= 0 ? chat?.swipe_info?.[swipeId]?.extra?.reasoning : '';
    return String(swipeReasoning || chat?.extra?.reasoning || '').trim();
}
function selectEnvelope(chat, job, appendMode) {
    const current = String(chat?.mes ?? '');
    const content = (appendMode ? current.slice(job.baseMes.length) : current).trim();
    const reasoning = reasoningText(chat);
    const fingerprint = `${current}\u241f${reasoning}`;
    if (job.responseMode === 'relay_tableedit') {
        const contentTableEdit = content ? parseRelayTableEditEnvelope(content) : null;
        if (contentTableEdit?.ok) return { current, envelope: contentTableEdit, source: 'relay-tableedit-content', fingerprint };
        const reasoningTableEdit = reasoning ? parseRelayTableEditEnvelope(reasoning, content) : null;
        if (reasoningTableEdit?.ok) return { current, envelope: reasoningTableEdit, source: 'relay-tableedit-reasoning', fingerprint };
        const legacyContent = content ? parseRelayTaggedEnvelope(content) : null;
        if (legacyContent?.ok) return { current, envelope: legacyContent, source: 'relay-legacy-tagged-content', fingerprint };
        const legacyReasoning = reasoning ? parseRelayTaggedEnvelope(reasoning, content) : null;
        if (legacyReasoning?.ok) return { current, envelope: legacyReasoning, source: 'relay-legacy-tagged-reasoning', fingerprint };
        const envelope = contentTableEdit || reasoningTableEdit || parseRelayTableEditEnvelope('');
        return { current, envelope, source: 'relay-none', fingerprint };
    }
    const contentEnvelope = content ? parseRecordEnvelope(content) : null;
    if (contentEnvelope?.ok) return { current, envelope: contentEnvelope, source: 'content', fingerprint };
    const reasoningEnvelope = reasoning ? parseRecordEnvelope(reasoning) : null;
    if (reasoningEnvelope?.ok) return { current, envelope: reasoningEnvelope, source: 'reasoning', fingerprint };
    const envelope = contentEnvelope || reasoningEnvelope || parseRecordEnvelope('');
    return { current, envelope, source: contentEnvelope ? 'content' : reasoningEnvelope ? 'reasoning' : 'none', fingerprint };
}
async function waitForCompleteEnvelope(chat, job, appendMode) {
    let selected = selectEnvelope(chat, job, appendMode);
    if (selected.envelope.ok || !incompleteEnvelope(selected.envelope)) return selected;
    for (let attempt = 0; attempt < 25; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 120));
        if (job.session && USER?.getContext?.()?.chat !== job.session) return { ...selected, detached: true };
        const latest = selectEnvelope(chat, job, appendMode);
        if (latest.fingerprint === selected.fingerprint) continue;
        selected = latest;
        if (selected.envelope.ok || !incompleteEnvelope(selected.envelope)) break;
    }
    return selected;
}
async function unpack(chatId) {
    const job = pending;
    if (!job || Date.now() - job.at > 300000) { pending = null; return false; }
    if (job.session && USER?.getContext?.()?.chat !== job.session) { pending = null; return false; }
    const chat = USER?.getContext?.()?.chat?.[chatId];
    if (!chat || chat.is_user || handled.get(chat) === chat.mes) return false;
    let current = String(chat.mes ?? '');
    const isAppend = appendType(job.type) && job.base === chat && job.baseMes && current.startsWith(job.baseMes);
    const waited = await waitForCompleteEnvelope(chat, job, isAppend);
    if (waited.detached) { pending = null; return false; }
    current = waited.current;
    const envelope = waited.envelope;
    pending = null;
    if (!envelope.ok) {
        if (envelope.reply) { chat.mes = isAppend ? `${job.baseMes.trimEnd()}\n\n${envelope.reply}` : envelope.reply; syncSwipe(chat); }
        await preserveFailureBaseline(chatId, chat, isAppend);
        setStatus(chat, { changes: [] }, { ok: false, error: envelope.error });
        EDITOR.warning(`Memo-N记录未写入：${envelope.error}。正文已保留，不会自动重试。`);
        return false;
    }
    chat.mes = isAppend ? `${job.baseMes.trimEnd()}\n\n${envelope.reply}` : envelope.reply;
    syncSwipe(chat);
    handled.set(chat, chat.mes);
    const baselineSnapshot = copySnapshot(isAppend ? chat.memo_n_hash_sheets : previousSnapshot(chatId));
    const baseline = isAppend ? { ok: !!baselineSnapshot, error: baselineSnapshot ? '' : 'Continue缺少当前表格基线' } : restoreMemoSnapshot(baselineSnapshot);
    const executionInput = envelope.tableEdit ? envelope.tableEdit : changesToStrictCalls(envelope.changes);
    const execution = baseline.ok ? executeMemoTableEdit(executionInput, chat) : { ok: false, changed: false, noChange: false, count: 0, error: baseline.error };
    setStatus(chat, envelope, execution);
    try { await USER.saveChat(); }
    catch (error) {
        const rollback = baselineSnapshot ? restoreMemoSnapshot(copySnapshot(baselineSnapshot)) : { ok: false, error: '缺少回滚基线' };
        try { if (rollback.ok) saveMemoSnapshot(chat); } catch (snapshotError) { rollback.ok = false; rollback.error = `${rollback.error || ''}；消息快照回滚失败：${snapshotError?.message || snapshotError}`; }
        const failed = { ok: false, changed: false, noChange: false, count: 0, error: `聊天保存失败：${error?.message || error}${rollback.ok ? '；表格已回滚' : `；表格回滚异常：${rollback.error}`}` };
        setStatus(chat, envelope, failed); EDITOR.error(`Memo-N保存失败：${failed.error}`); return false;
    }
    if (execution.ok && execution.changed) { try { await BASE.refreshContextView?.(); } catch (error) { console.warn('[Memo-N] 表格已保存，但活动表格视图刷新失败', error); } }
    if (job.session === USER?.getContext?.()?.chat) USER.getContext?.()?.updateMessageBlock?.(Number(chatId), chat);
    if (!execution.ok) EDITOR.warning(`Memo-N记录失败：${execution.error}。正文已保留，表格未部分写入。`);
    return execution.ok === true;
}
function handleRendered(chatId) { const id = Number(chatId); if (Number.isInteger(id) && id >= 0) lastRenderedChatId = id; }
function candidateMatchesJob(chat, index, job) {
    if (!chat || chat.is_user === true || !job) return false;
    if (job.base) {
        if (chat === job.base) return String(chat.mes ?? '') !== job.baseMes || Number(chat.swipe_id ?? -1) !== job.baseSwipeId || reasoningText(chat) !== job.baseReasoning;
        return index >= Math.max(0, Number(job.startLength || 0) - 1);
    }
    return index >= Number(job.startLength || 0);
}
function resolveCompletedChatId(job) {
    const chat = USER?.getContext?.()?.chat;
    if (!Array.isArray(chat) || !chat.length || !job || chat !== job.session) return null;
    if (Number.isInteger(lastRenderedChatId) && lastRenderedChatId >= 0 && lastRenderedChatId < chat.length && candidateMatchesJob(chat[lastRenderedChatId], lastRenderedChatId, job)) return lastRenderedChatId;
    for (let i = chat.length - 1; i >= 0; i--) if (candidateMatchesJob(chat[i], i, job)) return i;
    return null;
}
function handleGenerationEnded() {
    const job = pending;
    if (!job) return;
    const chatId = resolveCompletedChatId(job);
    lastRenderedChatId = null;
    if (!Number.isInteger(chatId)) { pending = null; return; }
    const chat = USER?.getContext?.()?.chat?.[chatId];
    const persistence = unpack(chatId);
    if (chat && persistence && typeof persistence.then === 'function') {
        Object.defineProperty(chat, '__memoStrictPersistence', { configurable: true, writable: true, value: persistence });
        void persistence.catch(error => console.error('[Memo-N] 生成结束后记录任务异常', error));
    }
}
APP.eventSource.on(APP.event_types.GENERATION_STARTED, arm);
APP.eventSource.on(APP.event_types.CHAT_COMPLETION_PROMPT_READY, preparePrompt);
APP.eventSource.makeLast?.(APP.event_types.CHAT_COMPLETION_PROMPT_READY, preparePrompt);
APP.eventSource.on(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, inject);
APP.eventSource.makeLast?.(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, inject);
APP.eventSource.on(APP.event_types.CHARACTER_MESSAGE_RENDERED, handleRendered);
APP.eventSource.on(APP.event_types.GENERATION_ENDED, handleGenerationEnded);
APP.eventSource.makeLast?.(APP.event_types.GENERATION_ENDED, handleGenerationEnded);
console.log('[Memo-N] 一次API记录引擎已加载：正文协议统一保持原预设，中转站仅额外增加前置tableEdit');