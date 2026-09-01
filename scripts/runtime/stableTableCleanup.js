import { BASE, DERIVED, EDITOR, USER } from '../../core/manager.js';
import { getTablePromptByPiece } from '../../index.js';
import { handleCustomAPIRequest, handleMainAPIRequest, estimateTokenCount } from '../settings/standaloneAPI.js';
import { updateSystemMessageTableStatus } from '../renderer/tablePushToChat.js';
import { repairMissingColumnsBeforeCleanup } from './tableStructureRepair.js';
import { executeMemoTableEdit, parseMemoTableEdit } from './safeTableExecutor.js';
import { ROUTE, getManualProviderRoute } from './providerRoute.js';
import { changesToStrictCalls } from '../engine/recordEnvelope.js';
import JSON5 from '../../utils/json5.min.mjs';

const INSTALL_FLAG = '__memoStableTableCleanupInstalled';
const DEEP_BEGIN = 'MEMO_N_DEEPSEEK_CLEANUP_BEGIN';
const DEEP_END = 'MEMO_N_DEEPSEEK_CLEANUP_END';
let running = false;

const FALLBACK_SYSTEM = `你是Memo-N世界状态表格整理器。只整理当前实际启用的表格，不写剧情，不猜测未知。表号、列号和表头只以本轮提供的真实表格为准。已有对象优先update，真正新增才insert，明确失效才delete。`;
const FALLBACK_USER = `<当前表格>\n$0\n</当前表格>\n<最近聊天>\n$1\n</最近聊天>\n<当前真实表头>\n$2\n</当前真实表头>\n<附加要求>\n$3\n</附加要求>\n逐表检查重复、过期、错位和应合并的数据；不要为了更完整编造未知信息。`;

function escapeHtml(text) { return String(text ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function replaceAll(text, values) {
    let output = String(text ?? '');
    values.forEach((value, index) => { output = output.replace(new RegExp(`\\$${index}`, 'g'), () => String(value ?? '')); });
    return output;
}
function writableSheets() {
    return (BASE.getChatSheets?.() ?? []).filter(sheet => sheet?.enable !== false).filter(sheet => sheet?.sendToContext !== false);
}
function tableHeadersText() {
    return writableSheets().map((sheet, tableIndex) => `${tableIndex} ${sheet.name}: ${(sheet.getHeader?.() || []).map((h, i) => `${i}=${String(h ?? '')}`).join('，')}`).join('\n');
}
function selectedTemplate() {
    const key = USER.tableBaseSetting.lastSelectedTemplate || 'rebuild_base';
    if (key === 'rebuild_base') return {
        key,
        system_prompt: USER.tableBaseSetting.rebuild_default_system_message_template || FALLBACK_SYSTEM,
        user_prompt_begin: USER.tableBaseSetting.rebuild_default_message_template || FALLBACK_USER,
    };
    const item = USER.tableBaseSetting.rebuild_message_template_list?.[key];
    return item ? { key, ...item } : { key:'rebuild_base', system_prompt:FALLBACK_SYSTEM, user_prompt_begin:FALLBACK_USER };
}
function buildTemplatePrompt(tableText, recentChat) {
    const template = selectedTemplate();
    const additional = DERIVED?.any?.additionalPrompt ?? USER.tableBaseSetting.additionalPrompt ?? '';
    const values = [tableText, recentChat, tableHeadersText(), additional];
    const systemRaw = replaceAll(template.system_prompt || FALLBACK_SYSTEM, values);
    const userPrompt = replaceAll(template.user_prompt_begin || FALLBACK_USER, values);
    let systemPrompt = systemRaw;
    try {
        const parsed = JSON5.parse(systemRaw);
        if (Array.isArray(parsed) && parsed.length) systemPrompt = parsed.map(message => ({ ...message, content:replaceAll(message?.content ?? '', values) }));
    } catch (_) {}
    return { templateKey:template.key, systemPrompt, userPrompt };
}
function finalContract(route) {
    const map = tableHeadersText() || '当前没有可写表格';
    if (route === ROUTE.DEEPSEEK) return `[Memo-N DeepSeek 表格整理短块协议]\n只输出下面一个机器块，不写剧情或解释：\n${DEEP_BEGIN}\n[]\n${DEEP_END}\nBEGIN/END中间只能是合法JSON数组；没有变化写[]。数组元素格式：{"op":"insert|update|delete","table":0,"row":null,"cells":[{"column":0,"value":"值"}]}。insert的row必须为null；update/delete必须使用真实rowIndex；delete的cells必须为[]。\n当前实际表格：\n${map}`;
    return `[Memo-N 中转站表格整理 tableEdit 协议]\n最终必须且只能输出一个完整<tableEdit>...</tableEdit>。只允许insertRow/updateRow/deleteRow；没有变化输出<tableEdit><!-- NO_CHANGE --></tableEdit>。\n当前实际表格：\n${map}\n禁止JSON、剧情和解释。`;
}
function withFinalContract(systemPrompt, contract) {
    if (Array.isArray(systemPrompt)) return [...systemPrompt, { role:'system', content:contract }];
    return `${String(systemPrompt || FALLBACK_SYSTEM).trim()}\n\n${contract}`;
}
async function buildRecentChat() {
    const chat = Array.isArray(USER.getContext()?.chat) ? USER.getContext().chat : [];
    const filtered = USER.tableBaseSetting.ignore_user_sent === true ? chat.filter(item => item?.is_user === false) : chat;
    const maxRows = Math.max(1, Number(USER.tableBaseSetting.clear_up_stairs) || 9);
    const useTokenLimit = USER.tableBaseSetting.use_token_limit === true;
    const tokenLimit = Math.max(0, Number(USER.tableBaseSetting.rebuild_token_limit_value) || 0);
    const collected = [];
    let totalTokens = 0;
    for (let i = filtered.length - 1; i >= 0 && collected.length < maxRows; i--) {
        const item = filtered[i];
        const line = `${item?.name || (item?.is_user ? 'user' : 'assistant')}: ${String(item?.mes ?? '')}`.replace(/<tableEdit\b[^>]*>[\s\S]*?<\/tableEdit>/gi, '').trim();
        if (!line) continue;
        if (useTokenLimit && tokenLimit > 0) {
            const tokens = estimateTokenCount(line);
            if (collected.length > 0 && totalTokens + tokens > tokenLimit) break;
            totalTokens += tokens;
        }
        collected.push(line);
    }
    return collected.reverse().join('\n');
}
function parseDeepSeek(rawContent) {
    const source = String(rawContent ?? '').trim();
    const start = source.indexOf(DEEP_BEGIN);
    const end = start >= 0 ? source.indexOf(DEEP_END, start + DEEP_BEGIN.length) : -1;
    if (start < 0 || end < 0) return { ok:false, error:'DeepSeek整理缺少完整短JSON块' };
    if (source.slice(0, start).trim() || source.slice(end + DEEP_END.length).trim()) return { ok:false, error:'DeepSeek整理块之外存在额外内容' };
    let changes;
    try { changes = JSON.parse(source.slice(start + DEEP_BEGIN.length, end).trim()); }
    catch (error) { return { ok:false, error:`DeepSeek整理JSON无效：${error?.message || error}` }; }
    if (!Array.isArray(changes)) return { ok:false, error:'DeepSeek整理内容必须是JSON数组' };
    const executionInput = changesToStrictCalls(changes);
    const parsed = parseMemoTableEdit(executionInput.length ? executionInput : 'NO_CHANGE');
    return parsed.ok ? { ok:true, parsed, executionInput:executionInput.length ? executionInput : ['NO_CHANGE'] } : { ok:false, error:parsed.error };
}
function parseCleanupResponse(rawContent, route) {
    if (route === ROUTE.DEEPSEEK) return parseDeepSeek(rawContent);
    const text = String(rawContent ?? '').trim();
    const matches = [...text.matchAll(/<tableEdit\b[^>]*>[\s\S]*?<\/tableEdit>/gi)].map(match => match[0]);
    if (matches.length !== 1) return { ok:false, error:`模型必须且只能返回1个tableEdit，实际为${matches.length}个` };
    const parsed = parseMemoTableEdit(matches[0]);
    return parsed.ok ? { ok:true, parsed, executionInput:matches[0] } : { ok:false, error:parsed.error };
}

async function runStableCleanup() {
    if (running) return EDITOR.warning('表格整理正在进行中');
    running = true;
    const sessionChat = USER.getContext?.()?.chat;
    const sessionActive = () => USER.getContext?.()?.chat === sessionChat;
    try {
        repairMissingColumnsBeforeCleanup({ notify:false });
        const piece = BASE.getLastSheetsPiece()?.piece;
        if (!piece?.memo_n_hash_sheets) return EDITOR.error('表格整理失败：没有找到可整理的表格记录');
        const tableText = getTablePromptByPiece(piece);
        if (!String(tableText || '').trim()) return EDITOR.error('表格整理失败：当前表格内容无法读取');
        const recentChat = await buildRecentChat();
        const prompt = buildTemplatePrompt(tableText, recentChat);
        const route = getManualProviderRoute();
        const finalSystemPrompt = withFinalContract(prompt.systemPrompt, finalContract(route));
        let rawContent;
        try {
            rawContent = route === ROUTE.DEEPSEEK
                ? await handleMainAPIRequest(finalSystemPrompt, prompt.userPrompt)
                : await handleCustomAPIRequest(finalSystemPrompt, prompt.userPrompt);
        } catch (error) {
            return EDITOR.error('表格整理API请求失败', error?.message || String(error), error);
        }
        if (!sessionActive()) return EDITOR.info('表格整理已作废：API等待期间切换了聊天，未执行任何操作');
        if (rawContent === 'suspended') return EDITOR.info('表格整理已取消');
        if (typeof rawContent !== 'string' || !rawContent.trim() || /^错误[:：]/.test(rawContent.trim())) return EDITOR.error('表格整理失败：API返回为空或错误内容，原表未修改');
        const result = parseCleanupResponse(rawContent, route);
        if (!result.ok) return EDITOR.error(`表格整理失败：${result.error}，原表未修改`);
        if (result.parsed.noChange) return EDITOR.success('表格检查完成：当前无需整理');
        if (USER.tableBaseSetting.bool_silent_refresh !== true) {
            const previewText = Array.isArray(result.executionInput) ? result.executionInput.join('\n') : result.executionInput;
            const confirmed = await EDITOR.callGenericPopup(`<div style="max-height:55vh;overflow:auto"><p>AI准备执行以下表格整理操作：</p><pre style="white-space:pre-wrap">${escapeHtml(previewText)}</pre><p>确认后才会修改当前表格。</p></div>`, EDITOR.POPUP_TYPE.CONFIRM, '表格整理确认', { okButton:'执行', cancelButton:'取消' });
            if (!confirmed) return EDITOR.info('表格整理已取消，原表未修改');
            if (!sessionActive()) return EDITOR.info('表格整理已作废：确认期间切换了聊天，未执行任何操作');
        }
        const execution = executeMemoTableEdit(result.executionInput, piece);
        if (!execution.ok) return EDITOR.error(`表格整理执行失败：${execution.error}，原表未执行错误操作`);
        await USER.saveChat();
        if (!sessionActive()) return;
        try { BASE.refreshContextView?.(); updateSystemMessageTableStatus?.(); } catch (error) { console.warn('[Memo][table-cleanup] 整理已提交，但视图刷新失败', error); }
        EDITOR.success(`表格整理完成（${execution.count}项）`);
    } catch (error) {
        console.error('[Memo][table-cleanup] 整理失败:', error);
        EDITOR.error('表格整理失败', error?.message || String(error), error);
    } finally { running = false; }
}

if (!window[INSTALL_FLAG]) {
    window[INSTALL_FLAG] = true;
    console.log('[Memo] 当前表格严格整理器已加载：表序与表头运行时读取，记录接口手动决定');
}

export { runStableCleanup };
