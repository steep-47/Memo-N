import { APP, BASE, EDITOR, USER } from '../../core/manager.js';
import { executeMemoTableEdit, restoreMemoSnapshot, saveMemoSnapshot } from '../runtime/safeTableExecutor.js?v=memon96';
import { ROUTE, getProviderRoute, providerDebug } from '../runtime/providerRoute.js';
import { changesToStrictCalls, parseRecordEnvelope, parseRelayTableEditEnvelope, parseRelayTaggedEnvelope } from './recordEnvelope.js';

const MARKER = '[Memo-N record envelope v7]';
const handled = new WeakMap();
let armed = null;
let pending = null;
let lastRenderedChatId = null;
globalThis.__memoNRecordEngineActive = true;

function independentEnabled() { return USER?.getSettings?.()?.memo_n_settings?.independent_record_api_enabled === true; }
function active() { const setting = USER?.tableBaseSetting; return !independentEnabled() && setting?.isExtensionAble !== false && setting?.isAiReadTable !== false && setting?.isAiWriteTable !== false && setting?.injection_mode !== 'injection_off' && setting?.step_by_step !== true; }
function appendType(type) { return ['continue', 'append', 'appendfinal'].includes(String(type ?? '').toLowerCase()); }
function validGeneration(type, dryRun) { return active() && !dryRun && !['quiet', 'impersonate'].includes(String(type ?? '').toLowerCase()); }
function lastAssistant() { const chat = USER?.getContext?.()?.chat; const last = Array.isArray(chat) ? chat.at(-1) : null; return last?.is_user === false ? last : null; }
function arm(type, _options, dryRun) { armed = validGeneration(type, dryRun) ? { type: String(type ?? 'normal'), at: Date.now() } : null; lastRenderedChatId = null; if (armed) pending = null; }
function preparePrompt() {}
function writableSheets() { return (BASE.getChatSheets?.() ?? []).filter(sheet => sheet?.enable !== false).filter(sheet => sheet?.sendToContext !== false); }
function liveColumnMap() {
    const sheets = writableSheets();
    if (!sheets.length) return '当前没有可写表格。';
    return sheets.map((sheet, tableIndex) => {
        const name = String(sheet?.name ?? `表${tableIndex}`);
        const rawHeaders = sheet?.getHeader?.() ?? [];
        const columns = rawHeaders.map((value, column) => ({ column, header: String(value ?? '').trim() }));
        const usable = columns.filter(item => item.header);
        const state = sheet?.isEmpty?.() ? '空表' : `已有${Math.max(0, Number(sheet?.getRowCount?.() ?? 1) - 1)}行`;
        if (!usable.length) return `#${tableIndex} ${name}：当前无法读取可用表头，本轮不得写此表`;
        return `#${tableIndex} ${name}（${state}）：${usable.map(item => `${item.column}=${item.header}`).join('，')}；允许column仅为[${usable.map(item => item.column).join(',')}]`;
    }).join('\n');
}
function sharedRecordRules() { return `
[当前真实表格与列号映射｜column严格从0开始]
${liveColumnMap()}

记录判断必须比较“本轮最终正文明确成立的事实”与“当前表里已经保存的事实”，不是只问这些事实相对上一轮有没有变化。
- 正文中已经明确成立、属于某表职责、但当前表没有保存：这是待记录内容，insert补齐。
- 当前表已有对应对象，但正文给出新的持续信息或状态改变：update已有行。
- 已有记录明确失效：按表规则delete。
- 空表没有任何既有记录可供比较；只要本轮最终正文出现属于该表职责的明确事实，就必须insert建立基线，不能因为“没有上一轮变化”而NO_CHANGE。
- 只有逐表比较后，应保存的事实已经完整存在，且没有新增、变化、补充或失效，才允许NO_CHANGE/空changes。
生成每个cells或tableEdit对象前，先找到对应table上方“允许column仅为[...]”列表；对象中的每个column/key都必须逐个从该列表原样抄取。列号是0基索引，不把第1列写成1，也不按字段数量自行顺延。某字段找不到对应表头时，只省略该字段，其他合法字段照常记录。
输出记录块前再做一次列号自检：只保留允许列表中的数字；任何不在允许列表中的数字都不应进入最终记录操作。
世界书人物与剧情自动生成NPC完全同规则：只按已确认事实记录，不因来源不同改变记录策略。
伊依是后台陪伴者，不是剧情世界实体：不得写入任何世界状态表；她只使用独立长期记忆库。`; }
function finalContract() { return `${MARKER}
本轮最终响应只能是一个JSON对象，JSON外不得出现任何字符：
{"reply":"给用户看的完整正常回复","changes":[{"op":"insert|update|delete","table":0,"row":null,"cells":[{"column":0,"value":"值"}]}]}
reply用于承载你本来就要生成的可见回复；Memo-N不新增任何正文结构要求。changes记录为了让当前表格与本轮最终正文中已经明确成立的世界事实保持一致而需要执行的操作；表中缺失的已确认事实同样属于changes，不要求它必须相对上一轮发生变化。
每个变更固定包含op/table/row/cells。insert的row必须为null；update/delete的row必须是整数；delete的cells必须为[]。
row只能抄当前表格第一列真实存在的数字。空表只能insert。value只能是字符串或有限数字；同一操作不得重复column。
${sharedRecordRules()}
禁止输出函数、SQL、Markdown、tableEdit、解释或额外字段。`; }
function relayContract() { return `${MARKER}
[Memo-N附加记录任务]
在执行本请求原有回复要求的同时，额外在回复最前面加入且只加入一个完整<tableEdit>机器记录块；有操作就写操作，没有操作输出<tableEdit><!-- NO_CHANGE --></tableEdit>。
这个机器块只是记录前缀，不替代、不结束、不概括原有回复任务。机器块闭合后继续完成原有回复要求直到其自然结束。
记录块内只允许insertRow(tableIndex,{columnIndex:value,...})、updateRow(tableIndex,rowIndex,{columnIndex:value,...})、deleteRow(tableIndex,rowIndex)，或者NO_CHANGE。
只有当前表格里真实存在的rowIndex才能用于updateRow/deleteRow；空表首次记录只能insertRow。
${sharedRecordRules()}`; }
const schema = { name: 'memo_n_record_envelope', strict: true, value: { type: 'object', additionalProperties: false, properties: { reply: { type: 'string' }, changes: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { op: { type: 'string', enum: ['insert', 'update', 'delete'] }, table: { type: 'integer', minimum: 0 }, row: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] }, cells: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { column: { type: 'integer', minimum: 0 }, value: { anyOf: [{ type: 'string' }, { type: 'number' }] } }, required: ['column', 'value'] } } }, required: ['op', 'table', 'row', 'cells'] } } }, required: ['reply', 'changes'] } };
function inject(data) {
    if (!armed || !active() || !data || typeof data !== 'object') return;
    const context = USER.getContext?.(); const session = context?.chat; const base = lastAssistant(); const route = getProviderRoute(data); const relayMode = route === ROUTE.RELAY; const info = providerDebug(data);
    pending = { at: Date.now(), type: armed.type, session, startLength: Array.isArray(session) ? session.length : 0, base, baseMes: String(base?.mes ?? ''), baseSwipeId: Number(base?.swipe_id ?? -1), baseReasoning: base ? reasoningText(base) : '', responseMode: relayMode ? 'relay_tableedit' : 'json', route }; armed = null;
    if (Array.isArray(data.messages)) { data.messages = data.messages.filter(message => !String(message?.content ?? '').includes(MARKER)); data.messages.push({ role: 'system', content: relayMode ? relayContract() : finalContract() }); }
    if (route === ROUTE.DEEPSEEK) { delete data.json_schema; data.response_format = { type: 'json_object' }; }
    else if (relayMode) { delete data.json_schema; if (data.response_format?.type === 'json_object') delete data.response_format; }
    else data.json_schema = structuredClone(schema);
    const messages = Array.isArray(data.messages) ? data.messages : []; const last = messages.at(-1);
    globalThis.__memoNLastRequestProbe = Object.freeze({ at: Date.now(), route, responseMode: relayMode ? 'relay_tableedit_leading' : 'json', messageCount: messages.length, markerPresent: messages.some(message => String(message?.content ?? '').includes(MARKER)), relayTableEditPresent: relayMode && messages.some(message => String(message?.content ?? '').includes('<tableEdit>')), tablePromptReinforced: 0, recordTaskReinforced: false, lastUserReinforced: false, finalRole: String(last?.role ?? ''), provider: info?.route ?? route });
}
function syncSwipe(chat) { const id = Number(chat?.swipe_id); if (Array.isArray(chat?.swipes) && Number.isInteger(id) && id >= 0 && id < chat.swipes.length) chat.swipes[id] = chat.mes; }
function copySnapshot(value) { if (!value || typeof value !== 'object') return null; try { return BASE.copyHashSheets(value); } catch (_) { return structuredClone(value); } }
function previousSnapshot(chatId) { const id = Number(chatId); return Number.isInteger(id) && id > 0 ? BASE.getLastSheetsPiece(id - 1, 1000, false)?.piece?.memo_n_hash_sheets : BASE.initHashSheet?.()?.memo_n_hash_sheets; }
function setStatus(chat, envelope, execution) { const record = envelope?.tableEdit ? String(envelope.tableEdit) : JSON.stringify(envelope?.changes ?? []); Object.defineProperty(chat, '__memoStrictExecution', { configurable: true, writable: true, value: { swipeId: Number(chat?.swipe_id ?? 0), mes: String(chat?.mes ?? ''), tableEdit: record, ok: execution.ok === true, changed: execution.changed === true, noChange: execution.noChange === true, count: Number(execution.count || 0), error: String(execution.error || ''), at: Date.now(), engine: 'Memo-N' } }); }
async function preserveFailureBaseline(chatId, chat, appendMode) { if (!appendMode) { const restored = restoreMemoSnapshot(previousSnapshot(chatId)); if (!restored.ok) return false; } try { saveMemoSnapshot(chat); await USER.saveChat(); return true; } catch (error) { console.error('[Memo-N] 失败基线保存失败', error); return false; } }
function incompleteEnvelope(envelope) { const error = String(envelope?.error || ''); return envelope?.ok === false && (/响应不是合法JSON：Unexpected end of JSON input/i.test(error) || /记录块尚未闭合/.test(error)); }
function reasoningText(chat) { const swipeId = Number(chat?.swipe_id); const swipeReasoning = Number.isInteger(swipeId) && swipeId >= 0 ? chat?.swipe_info?.[swipeId]?.extra?.reasoning : ''; return String(swipeReasoning || chat?.extra?.reasoning || '').trim(); }
function selectEnvelope(chat, job, appendMode) {
    const current = String(chat?.mes ?? ''); const content = (appendMode ? current.slice(job.baseMes.length) : current).trim(); const reasoning = reasoningText(chat); const fingerprint = `${current}\u241f${reasoning}`;
    if (job.responseMode === 'relay_tableedit') {
        const contentTableEdit = content ? parseRelayTableEditEnvelope(content) : null; if (contentTableEdit?.ok) return { current, envelope: contentTableEdit, source: 'relay-tableedit-content', fingerprint };
        const reasoningTableEdit = reasoning ? parseRelayTableEditEnvelope(reasoning, content) : null; if (reasoningTableEdit?.ok) return { current, envelope: reasoningTableEdit, source: 'relay-tableedit-reasoning', fingerprint };
        const legacyContent = content ? parseRelayTaggedEnvelope(content) : null; if (legacyContent?.ok) return { current, envelope: legacyContent, source: 'relay-legacy-tagged-content', fingerprint };
        const legacyReasoning = reasoning ? parseRelayTaggedEnvelope(reasoning, content) : null; if (legacyReasoning?.ok) return { current, envelope: legacyReasoning, source: 'relay-legacy-tagged-reasoning', fingerprint };
        const envelope = contentTableEdit || reasoningTableEdit || parseRelayTableEditEnvelope(''); return { current, envelope, source: 'relay-none', fingerprint };
    }
    const contentEnvelope = content ? parseRecordEnvelope(content) : null; if (contentEnvelope?.ok) return { current, envelope: contentEnvelope, source: 'content', fingerprint };
    const reasoningEnvelope = reasoning ? parseRecordEnvelope(reasoning) : null; if (reasoningEnvelope?.ok) return { current, envelope: reasoningEnvelope, source: 'reasoning', fingerprint };
    const envelope = contentEnvelope || reasoningEnvelope || parseRecordEnvelope(''); return { current, envelope, source: contentEnvelope ? 'content' : reasoningEnvelope ? 'reasoning' : 'none', fingerprint };
}
async function waitForCompleteEnvelope(chat, job, appendMode) { let selected = selectEnvelope(chat, job, appendMode); if (selected.envelope.ok || !incompleteEnvelope(selected.envelope)) return selected; for (let attempt = 0; attempt < 25; attempt++) { await new Promise(resolve => setTimeout(resolve, 120)); if (job.session && USER?.getContext?.()?.chat !== job.session) return { ...selected, detached: true }; const latest = selectEnvelope(chat, job, appendMode); if (latest.fingerprint === selected.fingerprint) continue; selected = latest; if (selected.envelope.ok || !incompleteEnvelope(selected.envelope)) break; } return selected; }
async function unpack(chatId) {
    const job = pending; if (!job || Date.now() - job.at > 300000) { pending = null; return false; } if (job.session && USER?.getContext?.()?.chat !== job.session) { pending = null; return false; }
    const chat = USER?.getContext?.()?.chat?.[chatId]; if (!chat || chat.is_user || handled.get(chat) === chat.mes) return false;
    let current = String(chat.mes ?? ''); const isAppend = appendType(job.type) && job.base === chat && job.baseMes && current.startsWith(job.baseMes); const waited = await waitForCompleteEnvelope(chat, job, isAppend); if (waited.detached) { pending = null; return false; }
    current = waited.current; const envelope = waited.envelope; pending = null;
    if (!envelope.ok) { if (envelope.reply) { chat.mes = isAppend ? `${job.baseMes.trimEnd()}\n\n${envelope.reply}` : envelope.reply; syncSwipe(chat); } await preserveFailureBaseline(chatId, chat, isAppend); setStatus(chat, { changes: [] }, { ok: false, error: envelope.error }); EDITOR.warning(`Memo-N记录未写入：${envelope.error}。正文已保留，不会自动重试。`); return false; }
    chat.mes = isAppend ? `${job.baseMes.trimEnd()}\n\n${envelope.reply}` : envelope.reply; syncSwipe(chat); handled.set(chat, chat.mes);
    const baselineSnapshot = copySnapshot(isAppend ? chat.memo_n_hash_sheets : previousSnapshot(chatId)); const baseline = isAppend ? { ok: !!baselineSnapshot, error: baselineSnapshot ? '' : 'Continue缺少当前表格基线' } : restoreMemoSnapshot(baselineSnapshot);
    const executionInput = envelope.tableEdit ? envelope.tableEdit : changesToStrictCalls(envelope.changes); const execution = baseline.ok ? executeMemoTableEdit(executionInput, chat) : { ok: false, changed: false, noChange: false, count: 0, error: baseline.error }; setStatus(chat, envelope, execution);
    try { await USER.saveChat(); } catch (error) { const rollback = baselineSnapshot ? restoreMemoSnapshot(copySnapshot(baselineSnapshot)) : { ok: false, error: '缺少回滚基线' }; try { if (rollback.ok) saveMemoSnapshot(chat); } catch (snapshotError) { rollback.ok = false; rollback.error = `${rollback.error || ''}；消息快照回滚失败：${snapshotError?.message || snapshotError}`; } const failed = { ok: false, changed: false, noChange: false, count: 0, error: `聊天保存失败：${error?.message || error}${rollback.ok ? '；表格已回滚' : `；表格回滚异常：${rollback.error}`}` }; setStatus(chat, envelope, failed); EDITOR.error(`Memo-N保存失败：${failed.error}`); return false; }
    if (execution.ok && execution.changed) { try { await BASE.refreshContextView?.(); } catch (error) { console.warn('[Memo-N] 表格已保存，但活动表格视图刷新失败', error); } }
    if (job.session === USER?.getContext?.()?.chat) USER.getContext?.()?.updateMessageBlock?.(Number(chatId), chat); if (!execution.ok) EDITOR.warning(`Memo-N记录失败：${execution.error}。正文已保留，表格未部分写入。`); return execution.ok === true;
}
function handleRendered(chatId) { const id = Number(chatId); if (Number.isInteger(id) && id >= 0) lastRenderedChatId = id; }
function candidateMatchesJob(chat, index, job) { if (!chat || chat.is_user === true || !job) return false; if (job.base) { if (chat === job.base) return String(chat.mes ?? '') !== job.baseMes || Number(chat.swipe_id ?? -1) !== job.baseSwipeId || reasoningText(chat) !== job.baseReasoning; return index >= Math.max(0, Number(job.startLength || 0) - 1); } return index >= Number(job.startLength || 0); }
function resolveCompletedChatId(job) { const chat = USER?.getContext?.()?.chat; if (!Array.isArray(chat) || !chat.length || !job || chat !== job.session) return null; if (Number.isInteger(lastRenderedChatId) && lastRenderedChatId >= 0 && lastRenderedChatId < chat.length && candidateMatchesJob(chat[lastRenderedChatId], lastRenderedChatId, job)) return lastRenderedChatId; for (let i = chat.length - 1; i >= 0; i--) if (candidateMatchesJob(chat[i], i, job)) return i; return null; }
function handleGenerationEnded() { const job = pending; if (!job) return; const chatId = resolveCompletedChatId(job); lastRenderedChatId = null; if (!Number.isInteger(chatId)) { pending = null; return; } const chat = USER?.getContext?.()?.chat?.[chatId]; const persistence = unpack(chatId); if (chat && persistence && typeof persistence.then === 'function') { Object.defineProperty(chat, '__memoStrictPersistence', { configurable: true, writable: true, value: persistence }); void persistence.catch(error => console.error('[Memo-N] 生成结束后记录任务异常', error)); } }
APP.eventSource.on(APP.event_types.GENERATION_STARTED, arm);
APP.eventSource.on(APP.event_types.CHAT_COMPLETION_PROMPT_READY, preparePrompt);
APP.eventSource.makeLast?.(APP.event_types.CHAT_COMPLETION_PROMPT_READY, preparePrompt);
APP.eventSource.on(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, inject);
APP.eventSource.makeLast?.(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, inject);
APP.eventSource.on(APP.event_types.CHARACTER_MESSAGE_RENDERED, handleRendered);
APP.eventSource.on(APP.event_types.GENERATION_ENDED, handleGenerationEnded);
APP.eventSource.makeLast?.(APP.event_types.GENERATION_ENDED, handleGenerationEnded);
console.log('[Memo-N] 一次API记录引擎已加载：中转站记录块为附加前缀，原预设输出继续完成');