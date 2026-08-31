import { BASE, DERIVED, EDITOR, USER } from '../../core/manager.js';
import { getTablePromptByPiece } from '../../index.js';
import { handleCustomAPIRequest, handleMainAPIRequest, estimateTokenCount } from '../settings/standaloneAPI.js';
import { updateSystemMessageTableStatus } from '../renderer/tablePushToChat.js';
import { repairMissingColumnsBeforeCleanup } from './tableStructureRepair.js';
import { ensureSevenTableWorld } from './sevenTableMigration.js';
import { executeMemoTableEdit, parseMemoTableEdit } from './safeTableExecutor.js';
import { ROUTE, getManualProviderRoute } from './providerRoute.js';
import { changesToStrictCalls, parseRecordEnvelope } from '../engine/recordEnvelope.js';
import JSON5 from '../../utils/json5.min.mjs';

const INSTALL_FLAG = '__memoStableTableCleanupInstalled';
let running = false;

const FALLBACK_SYSTEM = `[Memo七表整理v3]
你是Memo世界状态表格整理器。只整理现有七张表，不写剧情。表头结构由代码维护，不得创建、删除、改名或重排表头。
0当前状态只保留最新有效快照；1角色状态只保存玩家本人；2背包保存当前实际持有库存；3任务约定只保留未结束事项；4人物主表同一NPC一行；5人物发展表同一NPC一行并分别维护年龄与最后确认时间；6历史只保存影响未来推演的重要既成节点。
优先更新已有行，不猜测未知，不模拟离线生活。这里只规定整理语义，不规定机器传输格式；最终格式只服从Memo-N当前“记录接口”的唯一协议。`;
const FALLBACK_USER = `<当前七表>\n$0\n</当前七表>\n<最近聊天>\n$1\n</最近聊天>\n<固定表头>\n$2\n</固定表头>\n<附加要求>\n$3\n</附加要求>\n逐表检查重复、过期、错位和应合并的数据。已有对象优先update，真正新增才insert，明确失效才delete；不要为了“更完整”编造未知信息。`;

const DEEPSEEK_CONTRACT = `[Memo-N DeepSeek 七表整理 JSON 协议｜本段优先级最高]
忽略此前模板中任何关于最终输出格式、完整重建、<新的表格>、tableEdit或其他机器格式的要求；此前模板只作为“整理语义”参考。
这是记录专用整理请求，不输出剧情。最终响应只能是一个JSON对象，JSON外不得出现任何字符：
{"reply":"CLEANUP_ONLY","changes":[{"op":"insert|update|delete","table":0,"row":0,"cells":[{"column":0,"value":"值"}]}]}
reply必须固定为"CLEANUP_ONLY"。insert的row必须为null；update/delete的row必须是真实存在的非负整数；delete的cells必须为[]。没有变化时changes必须为[]。
禁止输出<tableEdit>、函数文本、SQL、Markdown代码围栏或解释。`;
const RELAY_CONTRACT = `[Memo-N 中转站七表整理 tableEdit 协议｜本段优先级最高]
忽略此前模板中任何关于最终输出格式、完整JSON重建、<新的表格>或其他机器格式的要求；此前模板只作为“整理语义”参考。
这是记录专用整理请求，不输出剧情。最终必须且只能输出一个完整<tableEdit>...</tableEdit>。
只允许insertRow(tableIndex,{columnIndex:value,...})、updateRow(tableIndex,rowIndex,{columnIndex:value,...})、deleteRow(tableIndex,rowIndex)。
没有变化时输出<tableEdit><!-- NO_CHANGE --></tableEdit>。
禁止输出JSON记录信封、剧情、SQL、Markdown代码围栏或解释。`;

function escapeHtml(text) { return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function replaceAll(text, values) {
    let output = String(text ?? '');
    values.forEach((value, index) => { output = output.replace(new RegExp(`\\$${index}`, 'g'), () => String(value ?? '')); });
    return output;
}
function tableHeadersText() {
    const sheets = BASE.getChatSheets?.() || [];
    return sheets.filter(sheet => sheet?.enable !== false).map((sheet, tableIndex) => `${tableIndex} ${sheet.name}: ${(sheet.getHeader?.() || []).map((h, i) => `${i}=${String(h ?? '')}`).join('，')}`).join('\n');
}
function selectedTemplate() {
    const key = USER.tableBaseSetting.lastSelectedTemplate || 'rebuild_base';
    if (key === 'rebuild_base') return {
        key,
        system_prompt: USER.tableBaseSetting.rebuild_default_system_message_template || FALLBACK_SYSTEM,
        user_prompt_begin: USER.tableBaseSetting.rebuild_default_message_template || FALLBACK_USER,
    };
    const item = USER.tableBaseSetting.rebuild_message_template_list?.[key];
    return item ? { key, ...item } : { key: 'rebuild_base', system_prompt: FALLBACK_SYSTEM, user_prompt_begin: FALLBACK_USER };
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
        if (Array.isArray(parsed) && parsed.length) systemPrompt = parsed.map(message => ({ ...message, content: replaceAll(message?.content ?? '', values) }));
    } catch (_) {}
    return { templateKey: template.key, systemPrompt, userPrompt };
}
function withFinalContract(systemPrompt, contract) {
    if (Array.isArray(systemPrompt)) return [...systemPrompt, { role: 'system', content: contract }];
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
        const line = `${item?.name || (item?.is_user ? 'user' : 'assistant')}: ${String(item?.mes ?? '')}`.replace(/<tableEdit>[\s\S]*?<\/tableEdit>/gi, '').trim();
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

function parseCleanupResponse(rawContent, route) {
    if (route === ROUTE.DEEPSEEK) {
        const envelope = parseRecordEnvelope(rawContent);
        if (!envelope.ok) return { ok: false, error: envelope.error || 'DeepSeek整理JSON解析失败' };
        if (String(envelope.reply || '') !== 'CLEANUP_ONLY') return { ok: false, error: 'DeepSeek整理reply必须为CLEANUP_ONLY' };
        const executionInput = changesToStrictCalls(envelope.changes);
        const parsed = parseMemoTableEdit(executionInput);
        return parsed.ok ? { ok: true, parsed, executionInput } : { ok: false, error: parsed.error };
    }
    const text = String(rawContent ?? '').trim();
    const matches = [...text.matchAll(/<tableEdit\b[^>]*>[\s\S]*?<\/tableEdit>/gi)].map(match => match[0]);
    if (matches.length !== 1) return { ok: false, error: `模型必须且只能返回1个tableEdit，实际为${matches.length}个` };
    const executionInput = matches[0];
    const parsed = parseMemoTableEdit(executionInput);
    return parsed.ok ? { ok: true, parsed, executionInput } : { ok: false, error: parsed.error };
}

async function runStableCleanup() {
    if (running) return EDITOR.warning('表格整理正在进行中');
    running = true;
    const sessionChat = USER.getContext?.()?.chat;
    const sessionActive = () => USER.getContext?.()?.chat === sessionChat;
    try {
        ensureSevenTableWorld();
        repairMissingColumnsBeforeCleanup();
        const piece = BASE.getLastSheetsPiece()?.piece;
        if (!piece?.memo_n_hash_sheets) return EDITOR.error('表格整理失败：没有找到可整理的表格记录');
        const tableText = getTablePromptByPiece(piece);
        if (!String(tableText || '').trim()) return EDITOR.error('表格整理失败：当前表格内容无法读取');
        const recentChat = await buildRecentChat();
        const prompt = buildTemplatePrompt(tableText, recentChat);
        const route = getManualProviderRoute();
        const contract = route === ROUTE.DEEPSEEK ? DEEPSEEK_CONTRACT : RELAY_CONTRACT;
        const finalSystemPrompt = withFinalContract(prompt.systemPrompt, contract);
        console.log(`[Memo][table-cleanup] template=${prompt.templateKey} route=${route}`);

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
        if (!result.ok) {
            const tail = String(rawContent).replace(/\s+/g, ' ').trim().slice(-260);
            console.warn('[Memo][table-cleanup] 整理协议解析失败:', result.error, rawContent);
            return EDITOR.error(`表格整理失败：${result.error}，原表未修改｜末尾：${tail}`);
        }
        if (result.parsed.noChange) return EDITOR.success('表格检查完成：当前无需整理');
        if (USER.tableBaseSetting.bool_silent_refresh !== true) {
            const preview = `<div style="max-height:55vh;overflow:auto"><p>AI准备执行以下表格整理操作：</p><pre style="white-space:pre-wrap">${escapeHtml(Array.isArray(result.executionInput) ? result.executionInput.join('\n') : result.executionInput)}</pre><p>确认后才会修改当前表格。</p></div>`;
            const confirmed = await EDITOR.callGenericPopup(preview, EDITOR.POPUP_TYPE.CONFIRM, '表格整理确认', { okButton: '执行', cancelButton: '取消' });
            if (!confirmed) return EDITOR.info('表格整理已取消，原表未修改');
            if (!sessionActive()) return EDITOR.info('表格整理已作废：确认期间切换了聊天，未执行任何操作');
        }
        const execution = executeMemoTableEdit(result.executionInput, piece);
        if (!execution.ok) return EDITOR.error(`表格整理执行失败：${execution.error}，原表未执行错误操作`);
        await USER.saveChat();
        if (!sessionActive()) { console.warn('[Memo][table-cleanup] 保存期间切换了聊天，不刷新当前新聊天视图'); return; }
        try { BASE.refreshContextView(); updateSystemMessageTableStatus(); } catch (error) { console.warn('[Memo][table-cleanup] 整理已提交，但视图刷新失败', error); }
        EDITOR.success(`表格整理完成（${execution.count}项）`);
    } catch (error) {
        console.error('[Memo][table-cleanup] 整理失败:', error);
        EDITOR.error('表格整理失败', error?.message || String(error), error);
    } finally { running = false; }
}

function install() {
    if (window[INSTALL_FLAG]) return;
    window[INSTALL_FLAG] = true;
    console.log('[Memo] 七表严格整理器已加载：保留总结模板，协议由手动记录接口决定');
}
install();
export { runStableCleanup };
