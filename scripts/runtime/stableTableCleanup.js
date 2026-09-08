import { BASE, EDITOR, USER } from '../../core/manager.js';
import { getTableEditTag, getTablePromptByPiece } from '../../index.js';
import { handleCustomAPIRequest, handleMainAPIRequest, estimateTokenCount } from '../settings/standaloneAPI.js';
import { PopupConfirm } from '../../components/popupConfirm.js';
import { updateSystemMessageTableStatus } from '../renderer/tablePushToChat.js';
import { repairMissingColumnsBeforeCleanup } from './tableStructureRepair.js?v=memon82';
import { ensureSevenTableWorld } from './sevenTableMigration.js?v=memon82';
import { executeMemoTableEdit, parseMemoTableEdit } from './safeTableExecutor.js?v=memon82';

const INSTALL_FLAG = '__memoStableTableCleanupInstalled';
const CLEANUP_STALL_MS = 180_000;
const CLEANUP_STALLED = '__memo_cleanup_stalled__';
let running = false;

const SYSTEM_PROMPT = `你是Memo世界状态表格整理器。这个功能的第一目标是把现有七张表整理成干净、无重复、无过期、无错位的当前最终状态；第二目标是在整理过程中修复能够由当前表格与最近聊天明确证明的数据问题。它不是“手动更新记录”的替代品，不以某一轮新剧情为中心，而是对七表做全局整理与修理。
只整理现有七张表，不写剧情，不输出完整JSON表格。
你的最终回复必须且只能包含一个完整<tableEdit>...</tableEdit>。
表头结构由代码维护，你只能通过insertRow/updateRow/deleteRow整理数据行，不得创建、删除、改名或重排表头。
整理优先级：
1. 合并或删除重复记录；同一实体只保留当前有效记录。
2. 清理已明确过期、结束、失效或不再持有的记录。
3. 纠正明显错表、错位、字段混写和同一实体被拆成多行的问题。
4. 修复与当前最终状态冲突的旧值；以更晚且已明确确认的事实为准。
5. 当前表中存在明确漏项，而最近聊天能够直接证明时允许补回；证据不足保持原状，不为了“完整”制造事实。
整理原则：
- 0当前状态表：快照型，只保留最新有效一行；重复旧快照删除。
- 1角色状态表：只保存玩家本人最新状态，最多一行；NPC不得进入此表；修为保留玩家自身体系的原生境界，不换算成人族境界；外貌特征只保存已确认的稳定外观和持久变化。
- 2背包表：维护当前实际持有库存；同一物品重复行必须先依据聊天判断是否真是两次获得，证据不足不得把重复数量直接相加；已完全失去的物品删除。
- 3当前任务与约定表：只保留尚未结束事项；已完成/失败/取消/失效的行删除，重大结果可留在历史表。
- 4人物主表：NPC身份与关系主表，同一NPC只保留一行。保存姓名、性别、种族/血脉、修炼体系/路径、别名/称呼、身份/所属、外貌特征、性格、与玩家关系、长期重要信息。未知字段留空，不根据修为或外貌猜种族/血脉/体系。
- 5人物发展表：NPC最新发展锚点表，同一NPC只保留一行；字段为姓名、修为、主要能力、当前地点、年龄、最后确认时间、当前状态、主要目标/重要事项。修为只保存该NPC自身体系的原生境界/阶段；“实力约等于某人族境界”只是战力参照，不得据此改写修为。年龄是人物当前年龄；最后确认时间是该行发展锚点最后被剧情明确确认的世界时间。两列必须分开，不得把年龄写入最后确认时间，也不得把日期写入年龄。没有实际信息留空。
- 表4与表5必须指向同一NPC实体；不要因同名就强行合并，也不要因别名变化重复建人。
- 6历史事件表：只保留真正影响未来推演的重要既成节点；突破/失败、势力变化、婚姻或重要亲属变化、重伤残疾/寿元重大损耗、重大机缘、战争/宗门覆灭导致处境改变、死亡可保留；普通修炼、日常生活、重复过程和微小财富变化删除或压缩。
- 人物发展表最新状态与历史冲突时，以时间更晚且已明确发生的事实为准。
- 写任何操作前先检查现有行；能update/delete解决就不要重复insert。
- 没有任何需要整理或修复的变化时输出<tableEdit><!-- NO_CHANGE --></tableEdit>。
- updateRow只能更新当前真实存在的rowIndex；不得把越界update当作新增。真正新增必须明确使用insertRow。
- data键优先使用数字列索引；也可使用当前表中完全一致的真实表头名。禁止使用不存在、近似或自行编造的列名。
- 函数调用必须放在同一个HTML注释中，例如<tableEdit><!-- updateRow(...); deleteRow(...); --></tableEdit>。`;

function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function stopListener(handle) {
    try {
        handle?.stop?.();
    } catch (error) {
        console.warn('[Memo][table-cleanup] 停止流式监听失败', error);
    }
}

function stopGeneration(helper, generationId) {
    try {
        return helper?.stopGenerationById?.(generationId) === true;
    } catch (error) {
        console.warn('[Memo][table-cleanup] 停止指定生成失败', error);
        return false;
    }
}

/**
 * 只用于“表格整理”的主API请求。
 * 不按总耗时截断；只有在确认收到过本次生成的流式事件后，
 * 连续 CLEANUP_STALL_MS 都没有任何新事件，才判为疑似断流。
 * 流式事件即使暂时没有可见正文，也代表连接仍在活动，可覆盖模型推理阶段。
 */
async function requestMainApiWithHeartbeat(systemPrompt, userPrompt) {
    const helper = globalThis.TavernHelper;
    const canMonitor = helper
        && typeof helper.generateRaw === 'function'
        && typeof helper._eventOn === 'function'
        && typeof helper.stopGenerationById === 'function';

    if (!canMonitor) {
        console.warn('[Memo][table-cleanup] 酒馆助手缺少流式监控接口，退回原主API请求方式');
        return await handleMainAPIRequest(systemPrompt, userPrompt);
    }

    const generationId = `memo_cleanup_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const startedAt = Date.now();
    let lastProgressAt = startedAt;
    let hasStreamProgress = false;
    let finished = false;
    let abortResolved = false;

    const popup = new PopupConfirm();
    let resolveAbort;
    const abortPromise = new Promise(resolve => {
        resolveAbort = resolve;
    });

    const abort = (reason) => {
        if (abortResolved || finished) return;
        abortResolved = true;
        stopGeneration(helper, generationId);
        resolveAbort({ kind: 'abort', reason });
    };

    const markProgress = (_text, id) => {
        if (id !== generationId) return;
        hasStreamProgress = true;
        lastProgressAt = Date.now();
    };

    const listeners = [
        helper._eventOn('js_stream_token_received_incrementally', markProgress),
        helper._eventOn('js_stream_token_received_fully', markProgress),
    ];

    const popupPromise = popup
        .show('正在使用【主API】整理表格：正在发送请求…', '后台继续', '中止执行')
        .then(result => {
            if (result === true) abort('manual');
        })
        .catch(error => console.warn('[Memo][table-cleanup] 进度弹窗异常', error));

    const progressTimer = setInterval(() => {
        if (finished || abortResolved) return;
        const now = Date.now();
        const elapsedSec = Math.floor((now - startedAt) / 1000);

        if (hasStreamProgress) {
            const idleMs = now - lastProgressAt;
            const idleSec = Math.floor(idleMs / 1000);
            popup.text = `正在使用【主API】整理表格：已等待 ${elapsedSec} 秒 · 最近有进展 ${idleSec} 秒前`;
            if (idleMs >= CLEANUP_STALL_MS) {
                console.warn(`[Memo][table-cleanup] 检测到本次流式生成连续 ${idleSec} 秒无新增事件，停止本次整理`);
                abort('stalled');
            }
        } else {
            popup.text = `正在使用【主API】整理表格：已等待 ${elapsedSec} 秒 · 等待首个流式进展`;
        }
    }, 1000);

    const generationPromise = Promise.resolve(
        helper.generateRaw({
            generation_id: generationId,
            ordered_prompts: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            should_stream: true,
        }),
    ).then(
        value => ({ kind: 'response', value }),
        error => ({ kind: 'error', error }),
    );

    try {
        const settled = await Promise.race([generationPromise, abortPromise]);
        if (settled.kind === 'abort') {
            generationPromise.catch(() => {});
            return settled.reason === 'stalled' ? CLEANUP_STALLED : 'suspended';
        }
        if (settled.kind === 'error') throw settled.error;
        return settled.value;
    } finally {
        finished = true;
        clearInterval(progressTimer);
        for (const listener of listeners) stopListener(listener);
        popup.close();
        void popupPromise;
    }
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
        const line = `${item?.name || (item?.is_user ? 'user' : 'assistant')}: ${String(item?.mes ?? '')}`
            .replace(/<tableEdit>[\s\S]*?<\/tableEdit>/gi, '')
            .trim();
        if (!line) continue;

        if (useTokenLimit && tokenLimit > 0) {
            const tokens = await estimateTokenCount(line);
            if (collected.length > 0 && totalTokens + tokens > tokenLimit) break;
            totalTokens += tokens;
        }
        collected.push(line);
    }

    return collected.reverse().join('\n');
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
        if (!piece?.memo_n_hash_sheets) {
            return EDITOR.error('表格整理失败：没有找到可整理的表格记录');
        }

        const tableText = getTablePromptByPiece(piece);
        if (!String(tableText || '').trim()) {
            return EDITOR.error('表格整理失败：当前表格内容无法读取');
        }

        const recentChat = await buildRecentChat();
        const userPrompt = `<当前七表>
${tableText}
</当前七表>
<最近聊天>
${recentChat}
</最近聊天>

这是“表格整理”，请以当前七表整体最终状态为中心做全局检查，而不是只记录最近一轮。按0当前状态→1角色状态→2背包→3任务约定→4人物主表→5人物发展表→6历史事件逐表检查：重复与可合并行、已经过期/失效的行、错表或错位内容、字段混写、旧值与已确认新事实冲突，以及最近聊天能够直接证明的明确漏项。人物主表的“种族/血脉”“修炼体系/路径”只保留已确认事实；人物发展表的“修为”保留原生体系境界，“年龄”和“最后确认时间”分别维护。按现有rowIndex生成必要的tableEdit操作，不要为了“更完整”编造未知信息。`;

        const useMainApi = USER.tableBaseSetting.use_main_api !== false;
        let rawContent;
        try {
            rawContent = useMainApi
                ? await requestMainApiWithHeartbeat(SYSTEM_PROMPT, userPrompt)
                : await handleCustomAPIRequest(SYSTEM_PROMPT, userPrompt);
        } catch (error) {
            return EDITOR.error('表格整理API请求失败', error?.message || String(error), error);
        }

        if (!sessionActive()) {
            return EDITOR.info('表格整理已作废：API等待期间切换了聊天，未执行任何操作');
        }
        if (rawContent === 'suspended') {
            return EDITOR.info('表格整理已取消，原表未修改');
        }
        if (rawContent === CLEANUP_STALLED) {
            return EDITOR.warning('表格整理已停止：检测到流式生成已经有过进展，但连续3分钟没有任何新内容；原表未修改');
        }
        if (typeof rawContent !== 'string' || !rawContent.trim() || /^错误[:：]/.test(rawContent.trim())) {
            return EDITOR.error('表格整理失败：API返回为空或错误内容，原表未修改');
        }

        const { matches } = getTableEditTag(rawContent);
        if (!matches || matches.length !== 1) {
            const tail = rawContent.replace(/\s+/g, ' ').trim().slice(-260);
            console.warn('[Memo][table-cleanup] tableEdit块数量异常:', matches?.length ?? 0, rawContent);
            return EDITOR.error(`表格整理失败：模型必须且只能返回1个tableEdit，实际为${matches?.length ?? 0}个，原表未修改｜末尾：${tail}`);
        }

        const parsed = parseMemoTableEdit(matches);
        if (!parsed.ok) return EDITOR.error(`表格整理失败：${parsed.error}，原表未修改`);
        if (parsed.noChange) return EDITOR.success('表格检查完成：当前无需整理');

        const joined = matches[0];
        if (USER.tableBaseSetting.bool_silent_refresh !== true) {
            const preview = `<div style="max-height:55vh;overflow:auto"><p>AI准备执行以下表格整理操作：</p><pre style="white-space:pre-wrap">${escapeHtml(joined)}</pre><p>确认后才会修改当前表格。</p></div>`;
            const confirmed = await EDITOR.callGenericPopup(
                preview,
                EDITOR.POPUP_TYPE.CONFIRM,
                '表格整理确认',
                { okButton: '执行', cancelButton: '取消' },
            );
            if (!confirmed) return EDITOR.info('表格整理已取消，原表未修改');
            if (!sessionActive()) {
                return EDITOR.info('表格整理已作废：确认期间切换了聊天，未执行任何操作');
            }
        }

        const result = executeMemoTableEdit(matches, piece);
        if (!result.ok) {
            return EDITOR.error(`表格整理执行失败：${result.error}，原表未执行错误操作`);
        }

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

        EDITOR.success(`表格整理完成（${result.count}项）`);
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
    console.log('[Memo] 七表严格tableEdit整理器已加载：主API整理支持流式进度心跳、按generation_id中止与断流保护');
}

install();

export {
    CLEANUP_STALL_MS,
    CLEANUP_STALLED,
    requestMainApiWithHeartbeat,
    runStableCleanup,
};