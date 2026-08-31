import { APP, BASE, EDITOR, USER } from '../../core/manager.js';
import { executeMemoTableEdit, restoreMemoSnapshot, saveMemoSnapshot } from '../runtime/safeTableExecutor.js?v=memon9';
import { ROUTE, getProviderRoute, providerDebug } from '../runtime/providerRoute.js';
import {
    changesToStrictCalls,
    parseRecordEnvelope,
    parseRelayTaggedEnvelope,
    RELAY_TAG_START,
    RELAY_TAG_END,
} from './recordEnvelope.js';

const MARKER = '[Memo-N record envelope v1]';
const TABLE_PROMPT_MARKER = '# dataTable 世界状态记忆';
const OUTPUT_HEADING = '# 输出';
const WORLD_TABLE_NAMES = ['当前状态表','角色状态表','背包表','当前任务与约定表','人物主表','人物发展表','历史事件表'];
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
function preparePrompt() {
    // Memo-N 不修改 SillyTavern 的流式设置。
}

function liveColumnMap() {
    const sheets = BASE.getChatSheets?.() ?? [];
    return WORLD_TABLE_NAMES.map((name, tableIndex) => {
        const sheet = sheets.find(item => item?.name === name);
        const headers = (sheet?.getHeader?.() ?? []).map(value => String(value ?? '').trim()).filter(Boolean);
        if (!headers.length) return `#${tableIndex} ${name}：当前无法读取表头，本轮不得写此表`;
        return `#${tableIndex} ${name}：${headers.map((header, column) => `${column}=${header}`).join('，')}；合法column范围0-${headers.length - 1}`;
    }).join('\n');
}

function sharedRecordRules() {
    return `
[当前真实列号映射｜column严格从0开始]
${liveColumnMap()}

写cells前必须先在对应table的映射中找到列名，再抄左侧数字作为column；不得按“第1列=1”编号，不得写超出合法范围的column，不得创造不存在的列。没有对应列就不记录该字段。
世界书人物与剧情自动生成NPC完全同规则：只按已确认事实记录，不因来源不同改变记录策略。
伊依是后台陪伴者，不是剧情世界实体：禁止把伊依写入#0/#3/#4/#5/#6；她只使用独立长期记忆库。`;
}

function finalContract() {
    return `${MARKER}
本轮最终响应只能是一个JSON对象，JSON外不得出现任何字符：
{"reply":"给用户看的完整正常回复","changes":[{"op":"insert|update|delete","table":0,"row":0,"cells":[{"column":0,"value":"值"}]}]}
reply必须包含完整正文、状态栏、选项和角色留言，并保持原有写作要求。changes只记录本轮正文已经明确确认的事实变化。
每个变更固定包含op/table/row/cells。insert的row必须为null；update/delete的row必须是整数；delete的cells必须为[]。没有变化时changes必须是[]。
row只能抄当前表格第一列真实存在的数字。空表只能insert。value只能是字符串或有限数字；同一操作不得重复column。
日期、时间、地点、当前场景人物发生变化时必须维护表0。
${sharedRecordRules()}
禁止输出函数、SQL、Markdown、tableEdit、解释或额外字段。`;
}

function relayOutputRules() {
    return `# 输出
- 本轮为Memo-N中转站隐藏JSON记录模式：先输出完整正常正文，正文后必须追加且只追加一个隐藏记录块。
- 正文必须继续包含原本要求的状态栏、行动选项、伊依留言等结构；隐藏记录块不能替代正文。
- 隐藏记录块格式必须严格为：
${RELAY_TAG_START}
[{"op":"update","table":0,"row":0,"cells":[{"column":1,"value":"08:30"}]}]
${RELAY_TAG_END}
- 记录块内部只能是一个JSON数组；数组元素固定使用op/table/row/cells，语义与DeepSeek changes完全一致。
- insert的row必须为null；update/delete的row必须是真实存在的非负整数；delete的cells必须为[]。
- 七表确实没有任何事实变化时仍不得省略记录块，必须输出空数组：
${RELAY_TAG_START}
[]
${RELAY_TAG_END}
- 隐藏记录块必须位于整轮回复最后；${RELAY_TAG_END}之后不得再输出任何字符。
- 不得输出<tableEdit>、JSON信封根对象、SQL、Markdown代码围栏或解释。
- 日期、时间、地点、当前场景人物任一发生变化时必须维护表0。`;
}

function relayContract() {
    return `${MARKER}
本轮使用Memo-N中转站隐藏JSON记录协议。先正常输出给用户看的完整回复，保持原有正文、状态栏、选项和角色留言格式；不要把正文包进JSON，也不得为了记录省略任何正文组成部分。
完整回复结束后必须追加且只追加一个隐藏记录块，结束标记后不得再输出任何字符：
${RELAY_TAG_START}
[{"op":"update","table":0,"row":0,"cells":[{"column":1,"value":"08:30"}]}]
${RELAY_TAG_END}
隐藏块内部只能是changes JSON数组。每个变更固定包含op/table/row/cells；insert的row必须为null；update/delete的row只能使用当前表格第一列真实存在的rowIndex；delete的cells必须为[]。空表首次记录只能insert。
没有任何事实变化时仍必须输出：
${RELAY_TAG_START}
[]
${RELAY_TAG_END}
${sharedRecordRules()}
不得使用<tableEdit>、JSON信封根对象、额外哨兵、SQL、Markdown代码围栏或解释。${RELAY_TAG_END}之后不得再输出任何字符。`;
}

function reinforceRelayTablePrompt(messages) {
    let rewritten = 0;
    const output = relayOutputRules();
    for (const message of messages) {
        const content = String(message?.content ?? '');
        if (!content.includes(TABLE_PROMPT_MARKER)) continue;
        const index = content.lastIndexOf(OUTPUT_HEADING);
        message.content = index >= 0
            ? `${content.slice(0, index).trimEnd()}\n${output}`
            : `${content.trimEnd()}\n${output}`;
        rewritten++;
    }
    return rewritten;
}

const schema = {
    name: 'memo_n_record_envelope', strict: true,
    value: {
        type: 'object', additionalProperties: false,
        properties: {
            reply: { type: 'string' },
            changes: {
                type: 'array', items: { type: 'object', additionalProperties: false,
                    properties: { op: { type: 'string', enum: ['insert', 'update', 'delete'] }, table: { type: 'integer', minimum: 0 },
                        row: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
                        cells: { type: 'array', items: { type: 'object', additionalProperties: false,
                            properties: { column: { type: 'integer', minimum: 0 }, value: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
                            required: ['column', 'value'] } } },
                    required: ['op', 'table', 'row', 'cells'] },
            },
        }, required: ['reply', 'changes'],
    },
};

function inject(data) {
    if (!armed || !active() || !data || typeof data !== 'object') return;
    const context = USER.getContext?.();
    const base = lastAssistant();
    const route = getProviderRoute(data);
    const relayMode = route === ROUTE.RELAY;
    const info = providerDebug(data);

    pending = {
        at: Date.now(),
        type: armed.type,
        session: context?.chat,
        base,
        baseMes: String(base?.mes ?? ''),
        responseMode: relayMode ? 'relay_tagged' : 'json',
        route,
    };
    armed = null;

    if (Array.isArray(data.messages)) {
        data.messages = data.messages.filter(message => !String(message?.content ?? '').includes(MARKER));
        const reinforced = relayMode ? reinforceRelayTablePrompt(data.messages) : 0;
        data.messages.push({ role: 'system', content: relayMode ? relayContract() : finalContract() });
        if (relayMode) console.log(`[Memo-N] 中转站隐藏JSON约束已同步强化到七表提示｜tablePrompt=${reinforced}`);
    }

    if (route === ROUTE.DEEPSEEK) {
        delete data.json_schema;
        data.response_format = { type: 'json_object' };
        console.log(`[Memo-N] 已接管本轮一次API：DeepSeek JSON记录信封｜route=${info.route}`);
    } else if (relayMode) {
        delete data.json_schema;
        if (data.response_format?.type === 'json_object') delete data.response_format;
        console.log(`[Memo-N] 已接管本轮一次API：中转站隐藏JSON记录块｜route=${info.route}`);
    } else {
        data.json_schema = structuredClone(schema);
        console.log(`[Memo-N] 已接管本轮一次API：JSON记录信封｜route=${route}`);
    }
}

function syncSwipe(chat) {
    const id = Number(chat?.swipe_id);
    if (Array.isArray(chat?.swipes) && Number.isInteger(id) && id >= 0 && id < chat.swipes.length) chat.swipes[id] = chat.mes;
}
function copySnapshot(value) {
    if (!value || typeof value !== 'object') return null;
    try { return BASE.copyHashSheets(value); } catch (_) { return structuredClone(value); }
}
function previousSnapshot(chatId) {
    const id = Number(chatId);
    return Number.isInteger(id) && id > 0 ? BASE.getLastSheetsPiece(id - 1, 1000, false)?.piece?.memo_n_hash_sheets : BASE.initHashSheet?.()?.memo_n_hash_sheets;
}
function setStatus(chat, envelope, execution) {
    const record = JSON.stringify(envelope?.changes ?? []);
    Object.defineProperty(chat, '__memoStrictExecution', { configurable: true, writable: true, value: {
        swipeId: Number(chat?.swipe_id ?? 0), mes: String(chat?.mes ?? ''), tableEdit: record,
        ok: execution.ok === true, changed: execution.changed === true, noChange: execution.noChange === true,
        count: Number(execution.count || 0), error: String(execution.error || ''), at: Date.now(), engine: 'Memo-N',
    } });
}
async function preserveFailureBaseline(chatId, chat, appendMode) {
    if (!appendMode) {
        const restored = restoreMemoSnapshot(previousSnapshot(chatId));
        if (!restored.ok) return false;
    }
    try { saveMemoSnapshot(chat); await USER.saveChat(); return true; } catch (error) { console.error('[Memo-N] 失败基线保存失败', error); return false; }
}
function incompleteEnvelope(envelope) {
    const error = String(envelope?.error || '');
    return envelope?.ok === false && (/响应不是合法JSON：Unexpected end of JSON input/i.test(error) || /记录块尚未闭合/.test(error));
}
function reasoningText(chat) {
    const swipeId = Number(chat?.swipe_id);
    const swipeReasoning = Number.isInteger(swipeId) && swipeId >= 0
        ? chat?.swipe_info?.[swipeId]?.extra?.reasoning
        : '';
    return String(swipeReasoning || chat?.extra?.reasoning || '').trim();
}
function selectEnvelope(chat, job, appendMode) {
    const current = String(chat?.mes ?? '');
    const content = (appendMode ? current.slice(job.baseMes.length) : current).trim();
    const reasoning = reasoningText(chat);
    const fingerprint = `${current}\u241f${reasoning}`;

    if (job.responseMode === 'relay_tagged') {
        const contentRelay = content ? parseRelayTaggedEnvelope(content) : null;
        if (contentRelay?.ok) return { current, envelope: contentRelay, source: 'relay-tagged-content', fingerprint };
        const reasoningRelay = reasoning ? parseRelayTaggedEnvelope(reasoning, content) : null;
        if (reasoningRelay?.ok) return { current, envelope: reasoningRelay, source: 'relay-tagged-reasoning', fingerprint };
        const envelope = contentRelay || reasoningRelay || parseRelayTaggedEnvelope('');
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
        if (envelope.reply) {
            chat.mes = isAppend ? `${job.baseMes.trimEnd()}\n\n${envelope.reply}` : envelope.reply;
            syncSwipe(chat);
        }
        await preserveFailureBaseline(chatId, chat, isAppend);
        setStatus(chat, { changes: [] }, { ok: false, error: envelope.error });
        EDITOR.warning(`Memo-N记录未写入：${envelope.error}。正文已保留，不会自动重试。`);
        return false;
    }
    chat.mes = isAppend ? `${job.baseMes.trimEnd()}\n\n${envelope.reply}` : envelope.reply;
    syncSwipe(chat);
    if (waited.source === 'reasoning') console.log('[Memo-N] 已从当前Swipe思考区读取完整JSON信封');
    if (waited.source === 'relay-tagged-reasoning') console.log('[Memo-N] 已从当前Swipe思考区读取中转站隐藏JSON记录块');
    if (waited.source === 'relay-tagged-content') console.log('[Memo-N] 已从中转站正文尾部读取隐藏JSON记录块');
    handled.set(chat, chat.mes);
    const baselineSnapshot = copySnapshot(isAppend ? chat.memo_n_hash_sheets : previousSnapshot(chatId));
    const baseline = isAppend ? { ok: !!baselineSnapshot, error: baselineSnapshot ? '' : 'Continue缺少当前表格基线' } : restoreMemoSnapshot(baselineSnapshot);
    const calls = changesToStrictCalls(envelope.changes);
    const execution = baseline.ok ? executeMemoTableEdit(calls, chat) : { ok: false, changed: false, noChange: false, count: 0, error: baseline.error };
    setStatus(chat, envelope, execution);
    try {
        await USER.saveChat();
    } catch (error) {
        const rollback = baselineSnapshot ? restoreMemoSnapshot(copySnapshot(baselineSnapshot)) : { ok: false, error: '缺少回滚基线' };
        try { if (rollback.ok) saveMemoSnapshot(chat); } catch (snapshotError) { rollback.ok = false; rollback.error = `${rollback.error || ''}；消息快照回滚失败：${snapshotError?.message || snapshotError}`; }
        const failed = { ok: false, changed: false, noChange: false, count: 0, error: `聊天保存失败：${error?.message || error}${rollback.ok ? '；表格已回滚' : `；表格回滚异常：${rollback.error}`}` };
        setStatus(chat, envelope, failed);
        EDITOR.error(`Memo-N保存失败：${failed.error}`);
        return false;
    }
    if (execution.ok && execution.changed) {
        try { await BASE.refreshContextView?.(); }
        catch (error) { console.warn('[Memo-N] 表格已保存，但活动表格视图刷新失败', error); }
    }
    if (job.session === USER?.getContext?.()?.chat) USER.getContext?.()?.updateMessageBlock?.(Number(chatId), chat);
    if (!execution.ok) EDITOR.warning(`Memo-N记录失败：${execution.error}。正文已保留，表格未部分写入。`);
    return execution.ok === true;
}

function handleRendered(chatId) {
    const id = Number(chatId);
    if (Number.isInteger(id) && id >= 0) lastRenderedChatId = id;
}

function resolveCompletedChatId() {
    const chat = USER?.getContext?.()?.chat;
    if (!Array.isArray(chat) || !chat.length) return null;
    if (Number.isInteger(lastRenderedChatId) && lastRenderedChatId >= 0 && lastRenderedChatId < chat.length && chat[lastRenderedChatId]?.is_user === false) {
        return lastRenderedChatId;
    }
    for (let i = chat.length - 1; i >= 0; i--) if (chat[i]?.is_user === false) return i;
    return null;
}

function handleGenerationEnded() {
    if (!pending) return;
    const chatId = resolveCompletedChatId();
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

console.log('[Memo-N] 一次API记录引擎已加载：DeepSeek走JSON信封，中转站走隐藏JSON记录块');
