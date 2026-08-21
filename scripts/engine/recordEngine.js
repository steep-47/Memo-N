import { APP, BASE, EDITOR, USER } from '../../core/manager.js';
import { executeMemoTableEdit, restoreMemoSnapshot, saveMemoSnapshot } from '../runtime/safeTableExecutor.js?v=memon3';
import { buildPresetCharacterRule } from './recordPolicy.js';
import { changesToStrictCalls, parseRecordEnvelope } from './recordEnvelope.js';

const MARKER = '[Memo-N record envelope v1]';
const handled = new WeakMap();
let armed = null;
let pending = null;
let streamRestore = null;

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
    restoreStreaming();
    armed = validGeneration(type, dryRun) ? { type: String(type ?? 'normal'), at: Date.now() } : null;
    if (armed) pending = null;
}
function restoreStreaming() {
    if (!streamRestore) return;
    const { settings, value, timer } = streamRestore;
    streamRestore = null;
    if (timer) clearTimeout(timer);
    settings.stream_openai = value;
}
function preparePrompt(eventData) {
    if (!armed || !active() || eventData?.dryRun === true) return;
    const settings = USER?.getContext?.()?.chatCompletionSettings;
    if (settings?.stream_openai === true) {
        settings.stream_openai = false;
        streamRestore = { settings, value: true, timer: setTimeout(restoreStreaming, 5000) };
    }
}
function forceJsonObject(data) {
    const current = String(data?.custom_include_body ?? '').trim();
    const stripped = current.replace(/(?:^|\n)\s*response_format\s*:\s*\n\s*type\s*:\s*\S+\s*/gi, '\n').trim();
    data.custom_include_body = `${stripped}${stripped ? '\n' : ''}response_format:\n  type: json_object`;
}
function finalContract() {
    const policy = buildPresetCharacterRule(USER?.getSettings?.()?.memo_n_settings ?? {});
    return `${MARKER}
本轮最终响应只能是一个JSON对象，JSON外不得出现任何字符：
{"reply":"给用户看的完整正常回复","changes":[{"op":"insert|update|delete","table":0,"row":0,"cells":[{"column":0,"value":"值"}]}]}
reply必须包含完整正文、状态栏、选项和角色留言，并保持原有写作要求。changes只记录本轮正文已经明确确认的事实变化。
每个变更固定包含op/table/row/cells。insert的row必须为null；update/delete的row必须是整数；delete的cells必须为[]。没有变化时changes必须是[]。
row只能抄当前表格第一列真实存在的数字。空表只能insert。cells中的column是列号整数，value只能是字符串或数字；同一操作不得重复column。
禁止输出函数、SQL、Markdown、tableEdit、解释或额外字段。日期、时间、地点、当前场景人物发生变化时必须维护表0。
${policy}`;
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
    if (!armed || !active() || !data || typeof data !== 'object') { restoreStreaming(); return; }
    const context = USER.getContext?.();
    const base = lastAssistant();
    pending = { at: Date.now(), type: armed.type, session: context?.chat, base, baseMes: String(base?.mes ?? '') };
    armed = null;
    if (Array.isArray(data.messages)) {
        data.messages = data.messages.filter(message => !String(message?.content ?? '').includes(MARKER));
        data.messages.push({ role: 'system', content: finalContract() });
    }
    const custom = String(data.chat_completion_source ?? '').toLowerCase() === 'custom' || Boolean(data.custom_url);
    if (custom) { delete data.json_schema; forceJsonObject(data); }
    else data.json_schema = structuredClone(schema);
    console.log(`[Memo-N] 已接管本轮一次API：${custom ? 'json_object' : 'json_schema'}变更信封`);
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
    Object.defineProperty(chat, '__memoStrictExecution', { configurable: true, writable: true, value: {
        swipeId: Number(chat?.swipe_id ?? 0), mes: String(chat?.mes ?? ''), tableEdit: JSON.stringify(envelope?.changes ?? []),
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
function incompleteJson(envelope) {
    return envelope?.ok === false && /响应不是合法JSON：Unexpected end of JSON input/i.test(String(envelope.error || ''));
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
    const contentEnvelope = content ? parseRecordEnvelope(content) : null;
    if (contentEnvelope?.ok) return { current, envelope: contentEnvelope, source: 'content', fingerprint: `${current}\u241f${reasoning}` };
    const reasoningEnvelope = reasoning ? parseRecordEnvelope(reasoning) : null;
    if (reasoningEnvelope?.ok) return { current, envelope: reasoningEnvelope, source: 'reasoning', fingerprint: `${current}\u241f${reasoning}` };
    const envelope = contentEnvelope || reasoningEnvelope || parseRecordEnvelope('');
    return { current, envelope, source: contentEnvelope ? 'content' : reasoningEnvelope ? 'reasoning' : 'none', fingerprint: `${current}\u241f${reasoning}` };
}
async function waitForCompleteEnvelope(chat, job, appendMode) {
    let selected = selectEnvelope(chat, job, appendMode);
    if (selected.envelope.ok || !incompleteJson(selected.envelope)) return selected;
    for (let attempt = 0; attempt < 25; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 120));
        if (job.session && USER?.getContext?.()?.chat !== job.session) return { ...selected, detached: true };
        const latest = selectEnvelope(chat, job, appendMode);
        if (latest.fingerprint === selected.fingerprint) continue;
        selected = latest;
        if (selected.envelope.ok || !incompleteJson(selected.envelope)) break;
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
    if (job.session === USER?.getContext?.()?.chat) USER.getContext?.()?.updateMessageBlock?.(Number(chatId), chat);
    if (!execution.ok) EDITOR.warning(`Memo-N记录失败：${execution.error}。正文已保留，表格未部分写入。`);
    return execution.ok === true;
}

function handleRendered(chatId) {
    restoreStreaming();
    const chat = USER?.getContext?.()?.chat?.[chatId];
    const persistence = unpack(chatId);
    if (chat && persistence && typeof persistence.then === 'function') {
        Object.defineProperty(chat, '__memoStrictPersistence', { configurable: true, writable: true, value: persistence });
    }
    return persistence;
}

APP.eventSource.on(APP.event_types.GENERATION_STARTED, arm);
APP.eventSource.on(APP.event_types.CHAT_COMPLETION_PROMPT_READY, preparePrompt);
APP.eventSource.makeLast?.(APP.event_types.CHAT_COMPLETION_PROMPT_READY, preparePrompt);
APP.eventSource.on(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, inject);
APP.eventSource.makeLast?.(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, inject);
APP.eventSource.on(APP.event_types.CHARACTER_MESSAGE_RENDERED, handleRendered);
APP.eventSource.makeFirst?.(APP.event_types.CHARACTER_MESSAGE_RENDERED, handleRendered);

console.log('[Memo-N] 一次API JSON变更记录引擎已加载');
