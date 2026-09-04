import { APP, BASE, EDITOR, USER } from '../../core/manager.js';
import { executeMemoTableEdit, restoreMemoSnapshot, saveMemoSnapshot } from '../runtime/safeTableExecutor.js?v=memon9';
import { isDirectDeepSeek } from '../runtime/providerRoute.js';
import {
    RELAY_TAG_END,
    RELAY_TAG_START,
    changesToStrictCalls,
    parseRecordEnvelope,
    parseRelayTaggedEnvelope,
} from './recordEnvelope.js';

const MARKER = '[Memo-N one-call relay v2]';
const WORLD_TABLE_NAMES = ['当前状态表','角色状态表','背包表','当前任务与约定表','人物主表','人物发展表','历史事件表'];
const handled = new WeakMap();
let armed = null;
let pending = null;
let lastRenderedChatId = null;

globalThis.__memoNRecordEngineActive = true;

function independentEnabled() {
    return USER?.getSettings?.()?.memo_n_settings?.independent_record_api_enabled === true;
}

function active() {
    const setting = USER?.tableBaseSetting;
    return !independentEnabled()
        && setting?.isExtensionAble !== false
        && setting?.isAiReadTable !== false
        && setting?.isAiWriteTable !== false
        && setting?.injection_mode !== 'injection_off'
        && setting?.step_by_step !== true;
}

function appendType(type) {
    return ['continue', 'append', 'appendfinal'].includes(String(type ?? '').toLowerCase());
}

function validGeneration(type, dryRun) {
    return active() && !dryRun && !['quiet', 'impersonate'].includes(String(type ?? '').toLowerCase());
}

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

function liveColumnMap() {
    const sheets = BASE.getChatSheets?.() ?? [];
    return WORLD_TABLE_NAMES.map((name, tableIndex) => {
        const sheet = sheets.find(item => item?.name === name);
        const headers = (sheet?.getHeader?.() ?? []).map(value => String(value ?? '').trim()).filter(Boolean);
        if (!headers.length) return `#${tableIndex} ${name}：当前无法读取表头，本轮不得写此表`;
        return `#${tableIndex} ${name}：${headers.map((header, column) => `${column}=${header}`).join('，')}；合法column范围0-${headers.length - 1}`;
    }).join('\n');
}

function recordContract() {
    return `${MARKER}
本轮先按原有预设正常输出完整正文，正文保持原本的状态栏、行动选项、伊依留言等结构，不要把正文包进JSON。正文完成后，再追加一个用于Memo-N记录的隐藏块。

最终输出顺序固定为：完整正常正文 → 其他已有的隐藏数据块（如yiyiMemory） → Memo-N隐藏记录块。Memo-N隐藏记录块必须是最后一项，闭合后不再添加内容。

隐藏记录块格式：
${RELAY_TAG_START}
[{"op":"insert|update|delete","table":0,"row":0,"cells":[{"column":0,"value":"值"}]}]
${RELAY_TAG_END}

隐藏块中只放本轮changes的合法JSON数组；正文不进入JSON。changes是同一轮回复的记忆维护结果，必须以最终正文中已经明确成立的事实为准，结合当前已有七表逐表核对，尽量完整维护所有应变化的字段。

[当前真实列号映射｜column严格从0开始]
${liveColumnMap()}

[逐表记忆审计｜完成reply后按0→1→2→3→4→5→6全部检查]
#0 当前状态表：维护当前日期、时间、地点、当前场景人物。只要正文明确发生时间推进、地点改变、场景人物进入/离开，就检查对应字段；该表最多维护当前有效状态，不保存流水账。
#1 角色状态表：只记录玩家本人。检查姓名、性别、种族、年龄、修为、灵根/体质、灵力、神识、身体状态、灵石、钱财、技能/术法、擅长、其他状态等本轮新确认或变化内容。未知信息留空，不根据名字、外貌或常识猜测。
#2 背包表：检查玩家实际获得、消耗、丢失、交付、数量变化、品质/状态变化的物品。只保存当前实际持有库存；已经失去且不再持有的项目按现有表语义更新或删除。
#3 当前任务与约定表：检查新接受的任务、命令、承诺、约定、期限、地点、相关人物，以及本轮状态变化。已经明确完成、取消、失效的事项不继续当作进行中事项保留。
#4 人物主表：只记录值得持续识别的NPC稳定信息。首次明确出现的重要NPC应检查是否需要建立；已有NPC优先update，不重复insert。维护姓名、性别、种族/血脉、修炼体系/路径、别名/称呼、身份/所属、外貌特征、性格、与玩家关系、长期重要信息。正式姓名出现后应更新旧的描述性称呼记录，而不是另建同一人物。
#5 人物发展表：对已经进入长期追踪的NPC检查本轮最新发展锚点，包括姓名、原生修为/境界、主要能力、当前地点、年龄、最后确认时间、当前重要状态、主要目标/重要事项。年龄与最后确认时间是不同字段；只更新本轮实际新确认或发生变化的字段，不模拟离线成长。
#6 历史事件表：只记录会影响未来推演的重要既成节点，例如突破/失败、势力加入退出、婚姻或重要亲属变化、重伤残疾/寿元重大损耗、重大机缘、战争/宗门覆灭导致处境改变、死亡等。普通日常、普通修炼、微小财富变化不要写入历史表。

[完整性判断]
- 不要因为某项变化看起来“小”就漏掉：只要它属于七表当前状态字段且正文已明确确认，就应检查是否需要insert/update/delete。
- 同一段正文可能同时影响多张表；例如“到新地点并遇见新NPC且接受约定”应分别检查表0、表3、表4、表5，而不是只记其中一项。
- 玩家本人只进表1；NPC不进表1。NPC稳定身份进表4，最新发展进表5，重大既成节点才进表6。
- 表4和表5通过同一NPC姓名关联；确认同一人后不要重复建档。身份信息不足时宁可暂不合并，也不要猜测。
- 修为只记录人物自身原生修炼体系的真实名称/阶段，不按战力换算成人族境界。
- 未知、未确认、仅推测、模型自行补全的内容不记录；不要为了“详细”制造事实。
- 完成逐表检查后，再生成changes；changes应覆盖本轮所有确定需要维护的字段，而不是只挑最显眼的几项。

[操作规则]
- insert仅用于当前表中没有该对象/事实且本轮首次明确确认；insert的row必须为null。
- update用于当前表中已经存在的对象/事实；row必须抄当前表第一列真实存在的整数，只写本轮变化或新确认的字段。
- delete只用于当前表中真实存在且已明确失效/消失的记录；delete的cells必须为[]。
- insert/update的cells只能使用上方当前真实列号映射中存在的column，不得创造列，不得越界。
- 没有任何事实变化时changes必须为[]。
- 伊依是后台陪伴者，不是剧情世界实体，不写入世界七表。
- 隐藏块只使用上述固定标记和JSON数组；不输出tableEdit、SQL、Markdown代码围栏、解释或额外字段。`;
}

function clearCustomResponseFormat(data) {
    const current = String(data?.custom_include_body ?? '').trim();
    if (!current) return;
    const cleaned = current
        .replace(/(?:^|\n)\s*response_format\s*:\s*(?:\n\s*type\s*:\s*\S+|[^\n]*)\s*/gi, '\n')
        .trim();
    if (cleaned) data.custom_include_body = cleaned;
    else delete data.custom_include_body;
}

function inject(data) {
    if (!armed || !active() || !data || typeof data !== 'object') return;

    if (!isDirectDeepSeek(data)) {
        armed = null;
        pending = null;
        return;
    }

    const context = USER.getContext?.();
    const base = lastAssistant();
    pending = {
        at: Date.now(),
        type: armed.type,
        session: context?.chat,
        base,
        baseMes: String(base?.mes ?? ''),
    };
    armed = null;

    if (Array.isArray(data.messages)) {
        data.messages = data.messages.filter(message => !String(message?.content ?? '').includes(MARKER));
        data.messages.push({ role: 'system', content: recordContract() });
    }

    delete data.response_format;
    delete data.json_schema;
    clearCustomResponseFormat(data);
    console.log('[Memo-N] 已接管本轮一次API：正常正文 + 尾部隐藏记录块 + 七表逐表审计');
}

function syncSwipe(chat) {
    const id = Number(chat?.swipe_id);
    if (Array.isArray(chat?.swipes) && Number.isInteger(id) && id >= 0 && id < chat.swipes.length) chat.swipes[id] = chat.mes;
}

function copySnapshot(value) {
    if (!value || typeof value !== 'object') return null;
    try { return BASE.copyHashSheets(value); }
    catch (_) { return structuredClone(value); }
}

function previousSnapshot(chatId) {
    const id = Number(chatId);
    return Number.isInteger(id) && id > 0
        ? BASE.getLastSheetsPiece(id - 1, 1000, false)?.piece?.memo_n_hash_sheets
        : BASE.initHashSheet?.()?.memo_n_hash_sheets;
}

function setStatus(chat, envelope, execution) {
    Object.defineProperty(chat, '__memoStrictExecution', {
        configurable: true,
        writable: true,
        value: {
            swipeId: Number(chat?.swipe_id ?? 0),
            mes: String(chat?.mes ?? ''),
            tableEdit: JSON.stringify(envelope?.changes ?? []),
            ok: execution.ok === true,
            changed: execution.changed === true,
            noChange: execution.noChange === true,
            count: Number(execution.count || 0),
            error: String(execution.error || ''),
            at: Date.now(),
            engine: 'Memo-N',
        },
    });
}

async function preserveFailureBaseline(chatId, chat, appendMode) {
    if (!appendMode) {
        const restored = restoreMemoSnapshot(previousSnapshot(chatId));
        if (!restored.ok) return false;
    }
    try {
        saveMemoSnapshot(chat);
        await USER.saveChat();
        return true;
    } catch (error) {
        console.error('[Memo-N] 失败基线保存失败', error);
        return false;
    }
}

function reasoningText(chat) {
    const swipeId = Number(chat?.swipe_id);
    const swipeReasoning = Number.isInteger(swipeId) && swipeId >= 0
        ? chat?.swipe_info?.[swipeId]?.extra?.reasoning
        : '';
    return String(swipeReasoning || chat?.extra?.reasoning || '').trim();
}

function legacyEnvelopeCandidate(raw) {
    const text = String(raw ?? '').trim().replace(/^```(?:json)?\s*/i, '');
    return text.startsWith('{') && text.includes('"reply"') && text.includes('"changes"');
}

function selectEnvelope(chat, job, appendMode) {
    const current = String(chat?.mes ?? '');
    const content = (appendMode ? current.slice(job.baseMes.length) : current).trim();
    const reasoning = reasoningText(chat);
    const fingerprint = `${current}\u241f${reasoning}`;

    const contentRelay = parseRelayTaggedEnvelope(content);
    if (contentRelay.ok) return { current, envelope: contentRelay, source: 'relay-content', fingerprint };

    // Some OpenAI-compatible relays place the trailing machine block in reasoning
    // while keeping the visible reply in content. Content always remains the reply.
    const reasoningRelay = content && reasoning ? parseRelayTaggedEnvelope(reasoning, content) : null;
    if (reasoningRelay?.ok) return { current, envelope: reasoningRelay, source: 'relay-reasoning', fingerprint };

    // Keep compatibility with a response that was already in flight under the old
    // whole-response JSON contract when the extension was updated.
    const legacyContent = legacyEnvelopeCandidate(content) ? parseRecordEnvelope(content) : null;
    if (legacyContent?.ok) return { current, envelope: legacyContent, source: 'legacy-content', fingerprint };
    const legacyReasoning = legacyEnvelopeCandidate(reasoning) ? parseRecordEnvelope(reasoning) : null;
    if (legacyReasoning?.ok) return { current, envelope: legacyReasoning, source: 'legacy-reasoning', fingerprint };

    if (/尚未闭合/.test(contentRelay.error)) {
        return { current, envelope: contentRelay, source: 'relay-content-incomplete', fingerprint };
    }
    if (reasoningRelay && /尚未闭合/.test(reasoningRelay.error)) {
        return { current, envelope: reasoningRelay, source: 'relay-reasoning-incomplete', fingerprint };
    }

    if (content) {
        return { current, envelope: contentRelay, source: 'plain-content', fingerprint };
    }

    if (reasoning) {
        return {
            current,
            envelope: { ok: false, error: '生成在思考阶段结束，未收到正常正文' },
            source: 'reasoning-incomplete',
            fingerprint,
        };
    }

    return {
        current,
        envelope: contentRelay,
        source: 'none',
        fingerprint,
    };
}

function incompleteEnvelope(envelope) {
    const error = String(envelope?.error || '');
    return envelope?.ok === false && /Memo-N隐藏记录块尚未闭合|响应不是合法JSON：Unexpected end of JSON input|生成在思考阶段结束/i.test(error);
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
    if (waited.source === 'relay-reasoning') console.log('[Memo-N] 已从当前Swipe思考区读取隐藏记录块，正文保持content');
    if (waited.source.startsWith('legacy-')) console.log('[Memo-N] 已兼容拆包更新前仍在生成的旧JSON信封');
    handled.set(chat, chat.mes);

    const baselineSnapshot = copySnapshot(isAppend ? chat.memo_n_hash_sheets : previousSnapshot(chatId));
    const baseline = isAppend
        ? { ok: !!baselineSnapshot, error: baselineSnapshot ? '' : 'Continue缺少当前表格基线' }
        : restoreMemoSnapshot(baselineSnapshot);

    const execution = baseline.ok
        ? executeMemoTableEdit(changesToStrictCalls(envelope.changes), chat)
        : { ok: false, changed: false, noChange: false, count: 0, error: baseline.error };

    setStatus(chat, envelope, execution);

    try {
        await USER.saveChat();
    } catch (error) {
        const rollback = baselineSnapshot ? restoreMemoSnapshot(copySnapshot(baselineSnapshot)) : { ok: false, error: '缺少回滚基线' };
        try {
            if (rollback.ok) saveMemoSnapshot(chat);
        } catch (snapshotError) {
            rollback.ok = false;
            rollback.error = `${rollback.error || ''}；消息快照回滚失败：${snapshotError?.message || snapshotError}`;
        }
        const failed = {
            ok: false,
            changed: false,
            noChange: false,
            count: 0,
            error: `聊天保存失败：${error?.message || error}${rollback.ok ? '；表格已回滚' : `；表格回滚异常：${rollback.error}`}`,
        };
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
    if (Number.isInteger(lastRenderedChatId)
        && lastRenderedChatId >= 0
        && lastRenderedChatId < chat.length
        && chat[lastRenderedChatId]?.is_user === false) return lastRenderedChatId;
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
APP.eventSource.on(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, inject);
APP.eventSource.makeLast?.(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, inject);
APP.eventSource.on(APP.event_types.CHARACTER_MESSAGE_RENDERED, handleRendered);
APP.eventSource.on(APP.event_types.GENERATION_ENDED, handleGenerationEnded);
APP.eventSource.makeLast?.(APP.event_types.GENERATION_ENDED, handleGenerationEnded);

console.log('[Memo-N] DeepSeek一次API记录引擎已加载：逐表审计版');
