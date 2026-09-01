import { BASE, EDITOR, USER } from '../../core/manager.js';
import { newPopupConfirm } from '../../components/popupConfirm.js';
import { reloadCurrentChat } from '/script.js';
import { getTableEditTag, getTablePrompt, getTablePromptByPiece } from '../../index.js';
import { handleCustomAPIRequest, handleMainAPIRequest } from '../settings/standaloneAPI.js';
import { updateSystemMessageTableStatus } from '../renderer/tablePushToChat.js';
import { repairMissingColumnsBeforeCleanup } from './tableStructureRepair.js?v=memon6';
import { executeMemoTableEdit, restoreMemoSnapshot, saveMemoSnapshot } from './safeTableExecutor.js?v=memon6';
import { ROUTE, getManualProviderRoute } from './providerRoute.js';
import { changesToStrictCalls, parseRecordEnvelope } from '../engine/recordEnvelope.js';
import JSON5 from '../../utils/json5.min.mjs';

const DEEP_BEGIN = 'MEMO_N_DEEPSEEK_RECORD_BEGIN';
const DEEP_END = 'MEMO_N_DEEPSEEK_RECORD_END';

function writableSheets() {
    return (BASE.getChatSheets?.() ?? [])
        .filter(sheet => sheet?.enable !== false)
        .filter(sheet => sheet?.sendToContext !== false);
}
function tableMapText() {
    const sheets = writableSheets();
    if (!sheets.length) return '当前没有可写表格。';
    return sheets.map((sheet, table) => {
        const headers = (sheet?.getHeader?.() ?? []).map(value => String(value ?? '').trim()).filter(Boolean);
        return `#${table} ${String(sheet?.name ?? `表${table}`)}：${headers.map((header, column) => `${column}=${header}`).join('，')}`;
    }).join('\n');
}
function independentOperationRules() {
    return `# Memo-N独立记录操作语义\n当前实际表格映射：\n${tableMapText()}\n- 只维护本轮最终正文已经明确发生或确认的变化，不写剧情，不猜测未知。\n- table和column必须严格使用上面的当前真实映射；row只能抄当前表第一列真实存在的rowIndex。\n- 已有对象优先update，真正新增才insert，明确失效才delete；空表首次记录只能insert。\n- 不修改表头，不把reasoning、草稿、候选文本或最终正文未采用的内容写入表格。\n- 没有变化必须按本轮接口协议明确返回空变化，不得省略机器结果。`;
}
function deepSeekContract() {
    return `[Memo-N DeepSeek 独立记录短块协议]\n这是记录专用请求，不输出剧情正文。最终响应必须且只能是：\n${DEEP_BEGIN}\n[]\n${DEEP_END}\nBEGIN/END中间只能是合法JSON数组。没有变化写[]；有变化时数组元素固定为：{"op":"insert|update|delete","table":0,"row":null,"cells":[{"column":0,"value":"值"}]}。\ninsert的row必须为null；update/delete必须使用真实rowIndex；delete的cells必须为[]。\n禁止reply信封、tableEdit、Markdown代码围栏、解释和第二份JSON。\n当前实际表格：\n${tableMapText()}`;
}
function relayContract() {
    return `[Memo-N 中转站独立记录 tableEdit 协议]\n这是记录专用请求，不输出剧情正文。最终必须且只能输出一个完整<tableEdit>...</tableEdit>。\n只允许insertRow(tableIndex,{columnIndex:value,...})、updateRow(tableIndex,rowIndex,{columnIndex:value,...})、deleteRow(tableIndex,rowIndex)。\n没有变化输出<tableEdit><!-- NO_CHANGE --></tableEdit>。\n当前实际表格：\n${tableMapText()}\n禁止JSON、剧情、SQL、Markdown代码围栏或解释。`;
}
function isAppendGeneration(type) {
    const value = String(type ?? '').toLowerCase();
    return value === 'continue' || value === 'append' || value === 'appendfinal';
}
function stripMachine(text) {
    return String(text ?? '')
        .replace(/<tableEdit\b[^>]*>[\s\S]*?<\/tableEdit>/gi, '')
        .replace(new RegExp(`${DEEP_BEGIN}[\\s\\S]*?${DEEP_END}`, 'g'), '')
        .replace(/<(think|thinking)>[\s\S]*?<\/\1>/gi, '')
        .trim();
}
function stripTableEditOnly(text) {
    return String(text ?? '').replace(/<tableEdit\b[^>]*>[\s\S]*?<\/tableEdit>/gi, '').trim();
}
function copyValue(value) {
    if (value === undefined) return undefined;
    try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value)); }
}
function copyHashSheets(value) {
    if (!value || typeof value !== 'object') return null;
    try { return BASE.copyHashSheets(value); } catch (_) { return copyValue(value); }
}
function machineBlockFromCalls(calls) {
    const list = Array.isArray(calls) && calls.length ? calls : ['NO_CHANGE'];
    return `<tableEdit><!--\n${list.join('\n')}\n--></tableEdit>`;
}
function attachMachineRecord(piece, machineBlock) {
    if (!piece) return;
    const visible = stripTableEditOnly(piece.mes);
    piece.mes = `${visible}\n\n${String(machineBlock ?? '').trim()}`.trim();
    if (Array.isArray(piece.swipes)) {
        const id = Number(piece.swipe_id);
        if (Number.isInteger(id) && id >= 0 && id < piece.swipes.length) piece.swipes[id] = piece.mes;
    }
}
function extractRelayMachineBlock(rawContent, matches) {
    const blocks = String(rawContent ?? '').match(/<tableEdit\b[^>]*>[\s\S]*?<\/tableEdit>/gi);
    if (Array.isArray(blocks) && blocks.length === 1) return blocks[0];
    return `<tableEdit>${String(matches?.[0] ?? '<!-- NO_CHANGE -->')}</tableEdit>`;
}
function buildRecentContext(targetPiece) {
    const chat = Array.isArray(USER.getContext?.()?.chat) ? USER.getContext().chat : [];
    const layers = Math.max(0, Number(USER.tableBaseSetting.separateReadContextLayers) || 1);
    if (!layers) return '';
    const targetIndex = targetPiece ? chat.indexOf(targetPiece) : -1;
    const source = targetIndex >= 0 ? chat.slice(0, targetIndex) : chat;
    const candidates = source.filter(item => item?.is_user === false);
    return candidates.slice(-layers).map(item => `${item.name || 'assistant'}: ${stripMachine(item.mes)}`).join('\n');
}
async function readLorebook() {
    if (!USER.tableBaseSetting.separateReadLorebook || !window.TavernHelper) return '';
    try {
        const books = await window.TavernHelper.getCharLorebooks({ type:'all' });
        const names = [books?.primary, ...(Array.isArray(books?.additional) ? books.additional : [])].filter(Boolean);
        const chunks = [];
        for (const name of names) {
            const entries = await window.TavernHelper.getLorebookEntries(name);
            if (Array.isArray(entries)) chunks.push(...entries.map(entry => String(entry?.content ?? '')).filter(Boolean));
        }
        return chunks.join('\n');
    } catch (error) {
        console.warn('[Memo][independent] 世界书读取失败，继续使用现有表格与聊天上下文', error);
        return '';
    }
}
function parsePromptTemplate() {
    const raw = String(USER.tableBaseSetting.step_by_step_user_prompt || '').trim();
    try {
        const parsed = JSON5.parse(raw);
        if (!Array.isArray(parsed) || !parsed.length) throw new Error('提示词不是非空消息数组');
        return parsed;
    } catch (error) {
        throw new Error(`独立填表提示词格式错误：${error?.message || error}`);
    }
}
function appendProtocolContract(messages, route) {
    const result = messages.map(message => ({ ...message }));
    const contract = route === ROUTE.DEEPSEEK ? deepSeekContract() : relayContract();
    result.push({ role:'system', content:contract });
    return result;
}
async function buildIndependentMessages(todoChats, originText, targetPiece, route) {
    const contextChats = buildRecentContext(targetPiece);
    const lorebook = await readLorebook();
    const template = parsePromptTemplate();
    const replace = value => String(value ?? '')
        .replace(/(?<!\\)\$0/g, () => originText)
        .replace(/(?<!\\)\$1/g, () => contextChats)
        .replace(/(?<!\\)\$2/g, () => stripMachine(todoChats))
        .replace(/(?<!\\)\$3/g, () => independentOperationRules())
        .replace(/(?<!\\)\$4/g, () => lorebook);
    return appendProtocolContract(template.map(message => ({ ...message, content:replace(message?.content) })), route);
}
function exactPromptForPiece(referencePiece) {
    return referencePiece?.memo_n_hash_sheets ? getTablePromptByPiece(referencePiece) : getTablePrompt(referencePiece);
}
function resolveRecordSlice(todoChats, referencePiece, options = {}) {
    const full = String(todoChats ?? '');
    const append = !options.forceFull && isAppendGeneration(options.generationType) && options.baseMes && full.startsWith(String(options.baseMes));
    if (!append) return { recordText:full, originText:exactPromptForPiece(referencePiece), append:false };
    return { recordText:full.slice(String(options.baseMes).length).trim(), originText:exactPromptForPiece(referencePiece), append:true };
}
function parseDeepSeekBlock(rawContent) {
    const source = String(rawContent ?? '').trim();
    const start = source.indexOf(DEEP_BEGIN);
    const end = start >= 0 ? source.indexOf(DEEP_END, start + DEEP_BEGIN.length) : -1;
    if (start < 0 || end < 0) return { ok:false, error:'DeepSeek独立记录缺少完整短JSON块' };
    if (source.slice(0, start).trim() || source.slice(end + DEEP_END.length).trim()) return { ok:false, error:'DeepSeek独立记录短块之外存在额外内容' };
    let changes;
    try { changes = JSON.parse(source.slice(start + DEEP_BEGIN.length, end).trim()); }
    catch (error) { return { ok:false, error:`DeepSeek独立记录JSON无效：${error?.message || error}` }; }
    if (!Array.isArray(changes)) return { ok:false, error:'DeepSeek独立记录内容必须是JSON数组' };
    const envelope = parseRecordEnvelope({ reply:'RECORD_ONLY', changes });
    if (!envelope.ok) return { ok:false, error:`DeepSeek独立记录变化无效：${envelope.error}` };
    const calls = changesToStrictCalls(envelope.changes);
    return { ok:true, executionInput:calls, machineBlock:machineBlockFromCalls(calls), noChange:envelope.noChange === true };
}
function parseIndependentResult(rawContent, route) {
    if (route === ROUTE.DEEPSEEK) return parseDeepSeekBlock(rawContent);
    const { matches } = getTableEditTag(rawContent);
    if (!Array.isArray(matches) || matches.length !== 1) return { ok:false, error:`中转站模型必须且只能返回1个<tableEdit>，实际为${matches?.length ?? 0}个` };
    return { ok:true, executionInput:matches, machineBlock:extractRelayMachineBlock(rawContent, matches), noChange:/\bNO_CHANGE\b/i.test(String(matches[0] ?? '')) };
}
async function runIndependentApi(todoChats, referencePiece, isSilentMode, options = {}) {
    const slice = resolveRecordSlice(todoChats, referencePiece, options);
    if (slice.append && !stripMachine(slice.recordText)) return true;
    const route = getManualProviderRoute();
    const messages = await buildIndependentMessages(slice.recordText, slice.originText, referencePiece, route);
    let rawContent;
    try {
        rawContent = route === ROUTE.DEEPSEEK
            ? await handleMainAPIRequest(messages, null, isSilentMode)
            : await handleCustomAPIRequest(messages, null, true, isSilentMode);
    } catch (error) {
        EDITOR.warning(`独立记录API请求失败：${error?.message || error}`);
        return false;
    }
    if (rawContent === 'suspended') return false;
    if (typeof rawContent !== 'string' || !rawContent.trim() || /^错误[:：]/.test(rawContent.trim())) {
        EDITOR.warning('独立记录失败：API返回为空或错误内容，原表未修改。');
        return false;
    }
    if (options.sessionChat && USER.getContext?.()?.chat !== options.sessionChat) return 'detached';
    if (options.expectedVisible !== undefined && stripMachine(referencePiece?.mes) !== String(options.expectedVisible)) return 'stale';
    const parsed = parseIndependentResult(rawContent, route);
    if (!parsed.ok) {
        console.error('[Memo][independent] 模型记录协议解析失败:', parsed.error, rawContent);
        EDITOR.warning(`独立记录失败：${parsed.error}。原表未修改。`);
        return false;
    }
    const result = executeMemoTableEdit(parsed.executionInput, referencePiece);
    if (!result.ok) {
        EDITOR.warning(`独立记录失败：${result.error}。原表未执行错误操作。`);
        return false;
    }
    attachMachineRecord(referencePiece, parsed.machineBlock);
    await USER.saveChat();
    if (options.sessionChat && USER.getContext?.()?.chat !== options.sessionChat) return 'detached';
    console.log(`[Memo][independent] ${route === ROUTE.DEEPSEEK ? 'DeepSeek短JSON' : '中转站tableEdit'}严格记录完成：${result.noChange ? 'NO_CHANGE' : `${result.count}项操作`}`);
    return true;
}
function previousBaselineForCurrentPiece(piece) {
    const chat = USER.getContext?.()?.chat;
    if (!Array.isArray(chat)) return null;
    const index = chat.indexOf(piece);
    if (index < 0) return null;
    for (let i = index - 1; i >= 0; i--) {
        const candidate = chat[i];
        if (candidate?.is_user === false && candidate?.memo_n_hash_sheets && typeof candidate.memo_n_hash_sheets === 'object') return copyHashSheets(candidate.memo_n_hash_sheets);
    }
    return null;
}
function restoreHashSheets(snapshot) {
    const result = restoreMemoSnapshot(snapshot);
    if (!result.ok) console.error('[Memo][independent] 恢复表格基线失败', result.error);
    return result.ok;
}
function captureLiveSheets() {
    const snapshots = new Map();
    for (const sheet of BASE.getChatSheets?.() ?? []) {
        const data = sheet?.filterSavingData?.();
        if (!data || typeof data !== 'object') throw new Error(`无法备份表格 ${sheet?.name || '未知表'}`);
        snapshots.set(sheet, copyValue(data));
    }
    return snapshots;
}
function restoreLiveSheets(snapshots) {
    for (const [sheet, data] of snapshots ?? []) sheet.loadJson(copyValue(data));
}
function capturePieceState(piece) {
    const id = Number(piece?.swipe_id);
    return {
        hash:copyHashSheets(piece?.memo_n_hash_sheets),
        hadHash:!!piece && Object.prototype.hasOwnProperty.call(piece, 'memo_n_hash_sheets'),
        extra:copyValue(piece?.extra), mes:String(piece?.mes ?? ''), swipeId:id,
        swipe:Array.isArray(piece?.swipes) && Number.isInteger(id) && id >= 0 && id < piece.swipes.length ? piece.swipes[id] : undefined,
        swipeInfo:Array.isArray(piece?.swipe_info) && Number.isInteger(id) && id >= 0 && piece.swipe_info[id] ? copyValue(piece.swipe_info[id]) : undefined,
    };
}
function restorePieceState(piece, state) {
    if (!piece || !state) return;
    if (state.hadHash) piece.memo_n_hash_sheets = copyHashSheets(state.hash); else delete piece.memo_n_hash_sheets;
    piece.extra = copyValue(state.extra) ?? {};
    piece.mes = state.mes;
    const id = state.swipeId;
    if (Array.isArray(piece.swipes) && Number.isInteger(id) && id >= 0 && id < piece.swipes.length) piece.swipes[id] = state.swipe ?? state.mes;
    if (Array.isArray(piece.swipe_info) && Number.isInteger(id) && id >= 0) {
        if (state.swipeInfo !== undefined) piece.swipe_info[id] = copyValue(state.swipeInfo);
        else if (piece.swipe_info[id]) {
            delete piece.swipe_info[id].memo_n_swipe_hash_sheets;
            if (piece.swipe_info[id].extra) delete piece.swipe_info[id].extra.memo_n_swipe_hash_sheets;
        }
    }
}
function prepareAutoBaseline(piece, options) {
    const append = !options.forceFull && isAppendGeneration(options.generationType);
    const baseline = append && piece?.memo_n_hash_sheets ? copyHashSheets(piece.memo_n_hash_sheets) : previousBaselineForCurrentPiece(piece);
    if (baseline) return restoreHashSheets(baseline);
    const empty = BASE.initHashSheet?.();
    return empty?.memo_n_hash_sheets ? restoreHashSheets(empty.memo_n_hash_sheets) : false;
}
function refreshCommittedViews({ reload = false } = {}) {
    try {
        BASE.refreshContextView?.();
        updateSystemMessageTableStatus?.();
        if (reload) reloadCurrentChat();
    } catch (error) { console.warn('[Memo] 记录已经提交，但视图刷新失败', error); }
}
export async function TableTwoStepSummary(mode = 'manual', options = {}) {
    if (USER.tableBaseSetting.isExtensionAble === false) return false;
    if (!['auto','manual'].includes(mode)) return false;
    if (mode === 'auto' && USER.tableBaseSetting.step_by_step === false) return false;
    const currentPiece = USER.getChatPiece?.()?.piece;
    const todoPiece = options.targetPiece || currentPiece;
    if (!todoPiece) {
        if (mode === 'manual') EDITOR.error('未找到待填表的对话片段，请至少生成一条角色回复。');
        return false;
    }
    const todoChats = options.todoChats ?? String(todoPiece.mes ?? '');
    if (mode === 'manual') {
        const confirmResult = await newPopupConfirm(`<p>累计 ${String(todoChats).length} 长度的文本，是否开始独立填表？</p>`, '取消', '执行填表', 'stepwiseSummaryConfirm', '不再提示', '一直选是');
        if (confirmResult === false) return false;
        return manualSummaryChat(todoChats, confirmResult, { ...options, targetPiece:todoPiece });
    }
    return manualSummaryChat(todoChats, 'dont_remind_active', { ...options, targetPiece:todoPiece });
}
export async function manualSummaryChat(todoChats, confirmResult, options = {}) {
    const sessionChat = USER.getContext?.()?.chat;
    const sessionActive = () => USER.getContext?.()?.chat === sessionChat;
    const currentPiece = USER.getChatPiece?.()?.piece;
    const initialPiece = options.targetPiece || currentPiece;
    if (!initialPiece || !Array.isArray(sessionChat) || !sessionChat.includes(initialPiece)) return false;
    const isAutoMode = confirmResult === 'dont_remind_active';
    if (isAutoMode) {
        const targetBackup = capturePieceState(initialPiece);
        const sheetBackup = captureLiveSheets();
        const liveHash = currentPiece && currentPiece !== initialPiece ? copyHashSheets(currentPiece.memo_n_hash_sheets) : null;
        try {
            if (!prepareAutoBaseline(initialPiece, options)) throw new Error('无法恢复独立记录前的明确表格基线');
            if (initialPiece === currentPiece) repairMissingColumnsBeforeCleanup({ notify:false });
            saveMemoSnapshot(initialPiece);
            const effectiveOptions = { ...(options.forceFull ? { ...options, generationType:'normal', baseMes:'' } : options), sessionChat };
            const latestTodo = options.forceFull ? String(initialPiece.mes ?? '') : String(todoChats ?? '');
            const ok = await runIndependentApi(latestTodo, initialPiece, true, effectiveOptions);
            if (ok === 'detached') return 'detached';
            if (ok === 'stale' || !ok) {
                restorePieceState(initialPiece, targetBackup);
                if (sessionActive()) { restoreLiveSheets(sheetBackup); if (targetBackup.hash) restoreHashSheets(targetBackup.hash); }
                return ok === 'stale' ? 'stale' : false;
            }
            return true;
        } catch (error) {
            console.error('[Memo][independent] 自动记录失败，恢复执行前状态', error);
            restorePieceState(initialPiece, targetBackup);
            if (sessionActive()) { restoreLiveSheets(sheetBackup); if (targetBackup.hash) restoreHashSheets(targetBackup.hash); }
            return false;
        } finally {
            if (sessionActive()) {
                if (currentPiece && currentPiece !== initialPiece && liveHash) restoreHashSheets(liveHash);
                refreshCommittedViews();
            }
        }
    }
    const backup = capturePieceState(initialPiece);
    const sheetBackup = captureLiveSheets();
    const baseline = previousBaselineForCurrentPiece(initialPiece);
    try {
        const baselineReady = baseline ? restoreHashSheets(baseline) : (() => {
            const empty = BASE.initHashSheet?.();
            return empty?.memo_n_hash_sheets ? restoreHashSheets(empty.memo_n_hash_sheets) : false;
        })();
        if (!baselineReady) throw new Error('无法恢复手动填表前的明确表格基线');
        repairMissingColumnsBeforeCleanup({ notify:false });
        saveMemoSnapshot(initialPiece);
        const ok = await runIndependentApi(todoChats, initialPiece, false, { generationType:'manual', sessionChat });
        if (ok === 'detached') return 'detached';
        if (!ok) throw new Error('手动填表未成功完成');
        refreshCommittedViews({ reload:true });
        return true;
    } catch (error) {
        console.error('[Memo][manual-refill] 手动填表失败，恢复原状态', error);
        restorePieceState(initialPiece, backup);
        if (sessionActive()) {
            restoreLiveSheets(sheetBackup);
            if (backup.hash) restoreHashSheets(backup.hash);
            await USER.saveChat?.();
            refreshCommittedViews();
            EDITOR.warning('手动填表失败：已恢复执行前的原表格、正文和Swipe快照，不会留下半成品。');
        }
        return false;
    }
}
