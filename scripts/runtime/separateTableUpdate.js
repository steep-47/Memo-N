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
    return `# Memo-N独立记录操作语义\n当前实际表格映射：\n${tableMapText()}\n- 维护本轮最终正文已经明确成立、对后续有用的当前世界状态和重要记忆，不把记录条件误解成“必须相对上一轮发生变化”。\n- 每张表都要把本轮明确事实与当前表比较：应保存但表中缺失的事实用insert补齐；已有行内容改变或新增长期字段用update；明确失效才delete；只有应保存事实已经完整存在且没有变化时才返回无变化。\n- 开局、首次建表或相关表为空时要主动建立基线：当前时空/在场人物进入时空表；角色姓名、年龄、种族、修为、身份、稳定能力/功法等明确资料进入角色特征表；关系、任务、重要事件和重要物品按各表职责记录。\n- table和column必须严格使用上面的当前真实映射；row只能抄当前表第一列真实存在的rowIndex。\n- 已有对象优先update，真正新增才insert，明确失效才delete；空表首次记录只能insert。\n- 不修改表头，不把reasoning、草稿、候选文本或最终正文未采用的内容写入表格。\n- 逐表比较后确实没有缺失、新增、变化或失效时，才按本轮接口协议明确返回空变化。`;
}
function deepSeekContract() {
    return `[Memo-N DeepSeek 独立记录短块协议]\n这是记录专用请求，不输出剧情正文。先逐表比较本轮最终正文中的已确认事实与当前实际表格；表中缺失的应保存事实也属于变化，只有已经完整存在且没有新增、变化或失效时才返回空数组。最终响应必须且只能是：\n${DEEP_BEGIN}\n[]\n${DEEP_END}\nBEGIN/END中间只能是合法JSON数组。没有变化写[]；有变化时数组元素固定为：{"op":"insert|update|delete","table":0,"row":null,"cells":[{"column":0,"value":"值"}]}。\ninsert的row必须为null；update/delete必须使用真实rowIndex；delete的cells必须为[]。\n禁止reply信封、tableEdit、Markdown代码围栏、解释和第二份JSON。\n当前实际表格：\n${tableMapText()}`;
}
function relayContract() {
    return `[Memo-N 中转站独立记录 tableEdit 协议]\n这是记录专用请求，不输出剧情正文。先逐表比较本轮最终正文中的已确认事实与当前实际表格；表中缺失的应保存事实也属于变化，只有已经完整存在且没有新增、变化或失效时才NO_CHANGE。最终必须且只能输出一个完整<tableEdit>...</tableEdit>。\n只允许insertRow(tableIndex,{columnIndex:value,...})、updateRow(tableIndex,rowIndex,{columnIndex:value,...})、deleteRow(tableIndex,rowIndex)。\n没有变化输出<tableEdit><!-- NO_CHANGE --></tableEdit>。\n当前实际表格：\n${tableMapText()}\n禁止JSON、剧情、SQL、Markdown代码围栏或解释。`;
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
    if (!(snapshots instanceof Map)) return false;
    for (const [sheet, data] of snapshots) {
        if (!sheet || typeof sheet.init !== 'function') return false;
        sheet.init(copyValue(data));
    }
    return true;
}
async function persistIndependentSnapshot(piece, options = {}) {
    const sessionChat = options.sessionChat;
    if (sessionChat && USER.getContext?.()?.chat !== sessionChat) return 'detached';
    try {
        saveMemoSnapshot(piece);
        await USER.saveChat();
        if (sessionChat && USER.getContext?.()?.chat !== sessionChat) return 'detached';
        return true;
    } catch (error) {
        console.error('[Memo][independent] 独立记录快照保存失败', error);
        return false;
    }
}
async function runIndependentTransaction(todoChats, referencePiece, isSilentMode, options = {}) {
    const liveBefore = captureLiveSheets();
    const pieceBefore = {
        mes: referencePiece?.mes,
        memo_n_hash_sheets: copyHashSheets(referencePiece?.memo_n_hash_sheets),
        memo_n_swipe_hash_sheets: copyValue(referencePiece?.memo_n_swipe_hash_sheets),
        extra: copyValue(referencePiece?.extra),
        swipe_info: copyValue(referencePiece?.swipe_info),
        swipes: copyValue(referencePiece?.swipes),
    };
    try {
        const result = await runIndependentApi(todoChats, referencePiece, isSilentMode, options);
        if (result !== true) {
            restoreLiveSheets(liveBefore);
            if (referencePiece) Object.assign(referencePiece, pieceBefore);
            return result;
        }
        const persisted = await persistIndependentSnapshot(referencePiece, options);
        if (persisted !== true) {
            restoreLiveSheets(liveBefore);
            if (referencePiece) Object.assign(referencePiece, pieceBefore);
            return persisted;
        }
        return true;
    } catch (error) {
        restoreLiveSheets(liveBefore);
        if (referencePiece) Object.assign(referencePiece, pieceBefore);
        console.error('[Memo][independent] 独立记录事务失败', error);
        return false;
    }
}

export async function TableTwoStepSummary(mode = 'auto', options = {}) {
    const chat = USER.getContext?.()?.chat;
    if (!Array.isArray(chat)) return false;
    const targetPiece = options.targetPiece || [...chat].reverse().find(piece => piece?.is_user === false);
    if (!targetPiece) return false;
    const todoChats = options.todoChats ?? targetPiece.mes;
    const expectedVisible = stripMachine(todoChats);
    const referenceSnapshot = previousBaselineForCurrentPiece(targetPiece);
    if (referenceSnapshot) restoreHashSheets(referenceSnapshot);
    const result = await runIndependentTransaction(todoChats, targetPiece, mode === 'silent', {
        ...options,
        sessionChat: chat,
        expectedVisible,
    });
    if (result === true) {
        try { updateSystemMessageTableStatus?.(); } catch (_) {}
        if (mode !== 'silent') EDITOR.success('独立填表完成');
    }
    return result;
}

export async function manualTableUpdate() {
    const ok = await newPopupConfirm('立即填表', '将根据当前消息和表格执行一次独立记录。是否继续？');
    if (!ok) return false;
    const result = await TableTwoStepSummary('manual', { forceFull:true });
    if (result === true) {
        try { await reloadCurrentChat?.(); } catch (_) {}
    }
    return result;
}
