import { BASE, EDITOR, USER } from '../../core/manager.js';
import { getTablePromptByPiece } from '../../index.js';
import { handleCustomAPIRequest, handleMainAPIRequest, estimateTokenCount } from '../settings/standaloneAPI.js';
import { updateSystemMessageTableStatus } from '../renderer/tablePushToChat.js';
import { repairMissingColumnsBeforeCleanup } from './tableStructureRepair.js?v=memon54';
import { ensureSevenTableWorld } from './sevenTableMigration.js?v=memon54';
import { executeMemoTableEdit, parseMemoTableEdit } from './safeTableExecutor.js?v=memon5';
import { ROUTE, getManualProviderRoute } from './providerRoute.js';
import { changesToStrictCalls, parseRecordEnvelope } from '../engine/recordEnvelope.js';

const INSTALL_FLAG = '__memoStableTableCleanupInstalled';
let running = false;

const CLEANUP_RULES = `你是Memo世界状态表格整理器。只整理现有七张表，不写剧情。
表头结构由代码维护，你只能整理数据行，不得创建、删除、改名或重排表头。
整理原则：
- 0当前状态表：快照型，只保留最新有效一行；重复旧快照删除。
- 1角色状态表：只保存玩家本人最新状态，最多一行；NPC不得进入此表；修为保留玩家自身体系的原生境界，不换算成人族境界。
- 2背包表：维护当前实际持有库存；同一物品重复行必须先依据聊天判断是否真是两次获得，证据不足不得把重复数量直接相加；已完全失去的物品删除。
- 3当前任务与约定表：只保留尚未结束事项；已完成/失败/取消/失效的行删除，重大结果可留在历史表。
- 4人物主表：NPC身份与关系主表，同一NPC只保留一行。未知字段留空，不根据修为或外貌猜种族/血脉/体系。
- 5人物发展表：NPC最新发展锚点表，同一NPC只保留一行；修为只保存该NPC自身体系的原生境界/阶段；年龄与最后确认时间必须分开维护。
- 表4与表5必须指向同一NPC实体；不要因同名就强行合并，也不要因别名变化重复建人。
- 6历史事件表：只保留真正影响未来推演的重要既成节点；普通修炼、日常生活、重复过程和微小财富变化删除或压缩。
- 人物发展表最新状态与历史冲突时，以时间更晚且已明确发生的事实为准。
- 写任何操作前先检查现有行；能update/delete解决就不要重复insert。
- update/delete只能使用当前真实存在的rowIndex；真正新增必须insert。
- 没有任何需要整理的变化时按本轮最终协议表示NO_CHANGE。
这里只定义整理语义，不定义机器传输格式；最终格式只服从Memo-N当前“记录接口”的唯一协议。`;

const DEEPSEEK_CONTRACT = `[Memo-N DeepSeek 七表整理 JSON 协议]
这是记录专用整理请求，不输出剧情。最终响应只能是一个JSON对象，JSON外不得出现任何字符：
{"reply":"CLEANUP_ONLY","changes":[{"op":"insert|update|delete","table":0,"row":0,"cells":[{"column":0,"value":"值"}]}]}
reply必须固定为"CLEANUP_ONLY"。insert的row必须为null；update/delete的row必须是真实存在的非负整数；delete的cells必须为[]。没有变化时changes必须为[]。
禁止输出<tableEdit>、函数文本、SQL、Markdown代码围栏或解释。`;

const RELAY_CONTRACT = `[Memo-N 中转站七表整理 tableEdit 协议]
这是记录专用整理请求，不输出剧情。最终必须且只能输出一个完整<tableEdit>...</tableEdit>。
只允许insertRow(tableIndex,{columnIndex:value,...})、updateRow(tableIndex,rowIndex,{columnIndex:value,...})、deleteRow(tableIndex,rowIndex)。
没有变化时输出<tableEdit><!-- NO_CHANGE --></tableEdit>。
禁止输出JSON记录信封、剧情、SQL、Markdown代码围栏或解释。`;

function escapeHtml(text) {
    return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function buildRecentChat() {
    const chat = Array.isArray(USER.getContext()?.chat) ? USER.getContext().chat : [];
    const ignoreUser = USER.tableBaseSetting.ignore_user_sent === true;
    const filtered = ignoreUser ? chat.filter(item => item?.is_user === false) : chat;
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
        const compiled = changesToStrictCalls(envelope.changes);
        if (!compiled.ok) return { ok: false, error: compiled.error || 'DeepSeek整理changes编译失败' };
        const executionInput = compiled.tableEdit;
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
        const reference = BASE.getLastSheetsPiece();
        const piece = reference?.piece;
        if (!piece?.memo_n_hash_sheets) return EDITOR.error('表格整理失败：没有找到可整理的表格记录');
        const tableText = getTablePromptByPiece(piece);
        if (!String(tableText || '').trim()) return EDITOR.error('表格整理失败：当前表格内容无法读取');
        const recentChat = await buildRecentChat();
        const userPrompt = `<当前七表>\n${tableText}\n</当前七表>\n<最近聊天>\n${recentChat}\n</最近聊天>\n\n请按0→1→2→3→4人物主表→5人物发展表→6历史事件逐表检查重复、过期、错位和应合并的数据。人物主表的“种族/血脉”“修炼体系/路径”只保留已确认事实；人物发展表的“修为”保留原生体系境界，“年龄”和“最后确认时间”分别维护。不要为了“更完整”编造未知信息。`;
        const route = getManualProviderRoute();
        const contract = route === ROUTE.DEEPSEEK ? DEEPSEEK_CONTRACT : RELAY_CONTRACT;
        let rawContent;
        try {
            rawContent = route === ROUTE.DEEPSEEK
                ? await handleMainAPIRequest(`${CLEANUP_RULES}\n\n${contract}`, userPrompt)
                : await handleCustomAPIRequest(`${CLEANUP_RULES}\n\n${contract}`, userPrompt);
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
            const preview = `<div style="max-height:55vh;overflow:auto"><p>AI准备执行以下表格整理操作：</p><pre style="white-space:pre-wrap">${escapeHtml(result.executionInput)}</pre><p>确认后才会修改当前表格。</p></div>`;
            const confirmed = await EDITOR.callGenericPopup(preview, EDITOR.POPUP_TYPE.CONFIRM, '表格整理确认', { okButton: '执行', cancelButton: '取消' });
            if (!confirmed) return EDITOR.info('表格整理已取消，原表未修改');
            if (!sessionActive()) return EDITOR.info('表格整理已作废：确认期间切换了聊天，未执行任何操作');
        }

        const execution = executeMemoTableEdit(result.executionInput, piece);
        if (!execution.ok) return EDITOR.error(`表格整理执行失败：${execution.error}，原表未执行错误操作`);
        await USER.saveChat();
        if (!sessionActive()) {
            console.warn('[Memo][table-cleanup] 保存期间切换了聊天，不刷新当前新聊天视图');
            return;
        }
        try {
            BASE.refreshContextView();
            updateSystemMessageTableStatus();
        } catch (error) {
            console.warn('[Memo][table-cleanup] 整理已提交，但视图刷新失败', error);
        }
        EDITOR.success(`表格整理完成（${execution.count}项）`);
    } catch (error) {
        console.error('[Memo][table-cleanup] 整理失败:', error);
        EDITOR.error('表格整理失败', error?.message || String(error), error);
    } finally {
        running = false;
    }
}

function install() {
    if (window[INSTALL_FLAG]) return;
    window[INSTALL_FLAG] = true;
    console.log('[Memo] 七表严格整理器已加载：协议由手动记录接口决定');
}
install();
export { runStableCleanup };
