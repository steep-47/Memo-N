import { APP, USER } from '../../core/manager.js';
import { applyYiYiMemoryDelta, getYiYiVault, saveYiYiVault } from './yiyiMemoryStore.js';
import { buildYiYiRecallContext } from './yiyiRecallEngine.js';
import { maintainYiYiMemoryVault } from './yiyiMemoryMaintenance.js';

const PROMPT_MARKER = '[Memo-N YiYi memory runtime v8]';
const START = '<yiyiMemory>';
const END = '</yiyiMemory>';
const TX_KEY = 'memo_n_yiyi_transaction_v1';
const LEDGER_KEY = 'memo_n_yiyi_tx_ledger_v1';
const handled = new WeakMap();
const RECORD_ONLY_MARKERS = ['[Memo七表独立记录v3]', '[Memo七表整理', '世界状态数据库整理器', 'Memo世界状态表格整理器', '只维护表格，不输出剧情正文'];
const SECTIONS = Object.freeze({
    relationship: ['stage', 'summary', 'sharedUnderstanding', 'boundaries', 'unresolved', 'expectations', 'trustBasis', 'interactionPattern', 'initiative', 'comfort'],
    emotion: ['current', 'cause', 'residue', 'intensity', 'trajectory'],
    self: ['understanding', 'changes'],
});

function clone(value) { try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value)); } }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function contentOf(message) {
    if (typeof message?.content === 'string') return message.content;
    if (Array.isArray(message?.content)) return message.content.map(part => typeof part?.text === 'string' ? part.text : '').join('\n');
    return '';
}
function recentQuery(messages) { return (Array.isArray(messages) ? messages.slice(-8).map(contentOf).join('\n') : '').slice(-6000); }
function isYiYiSession() {
    const context = USER?.getContext?.();
    if (!context || context.groupId) return false;
    if (String(context.name2 ?? '').trim() === '伊依') return true;
    const id = Number(context.characterId);
    const character = Number.isInteger(id) && id >= 0 ? context.characters?.[id] : null;
    return String(character?.name ?? '').trim() === '伊依';
}
function isRecordOnly(messages) { const joined = Array.isArray(messages) ? messages.map(contentOf).join('\n') : ''; return RECORD_ONLY_MARKERS.some(marker => joined.includes(marker)); }
function contract(context) {
    return `${PROMPT_MARKER}\n${context}\n\n[伊依长期记忆写回协议]\n完成正常回复后，在回复内容末尾附加：\n${START}{"add":[],"update":[],"relationship":{},"emotion":{},"self":{}}${END}\n如果本轮使用Memo-N中转站前置记录块（MEMO_N_CHANGES_V1 ... MEMO_N_CHANGES_END），必须先输出并闭合该记录块，然后再输出正常正文；本${START}块属于正常正文的一部分，仍放在整段正常回复末尾。若本轮还有<tableEdit>，本块放在<tableEdit>之前；如果最终响应是Memo-N JSON信封，本块放在reply字符串末尾。\n本协议只负责持久化数据，不定义伊依的人格、文风、口癖、行为模板或剧情表现；这些由当前预设与正常上下文决定。\nadd只保存以后仍可能有用的共同经历或明确长期信息，每轮最多2条，importance只能是normal/high/core；普通闲聊、一次性动作和重复事项不要add。update只更新上方已召回的#记忆ID，用于纠正旧认知、补充后续结果或更新currentView。\n冲突/纠正规则：如果新信息证明某条旧记忆本身就是错误事实，不要再add一条互相矛盾的新记忆；直接update该#ID的memory为当前确认事实，并在currentView简短注明已纠正。若旧事件确实发生过、只是后来理解或结果改变，则保留memory，只update currentView。无法确认谁对谁错时不要擅自覆盖，保留原记忆并等待明确证据。\nrelationship可用stage/summary/sharedUnderstanding/boundaries/unresolved/expectations/trustBasis/interactionPattern/initiative/comfort，只在有足够新证据导致当前长期判断确实变化时更新；字段保存当前有效判断，不保存好感度/亲密度数值，不建立固定升级路线。\nemotion可用current/cause/residue/intensity/trajectory；intensity只能为0/1/2/3，trajectory只能为rising/steady/easing。emotion保存连续状态：本轮无实际变化则{}；有变化只写变化字段。不得因为新一轮请求而自动清零，也不得仅为了维持连续性而制造变化。\nself可用understanding/changes，只记录明确形成且以后仍有意义的自我理解变化。\n不得把推测写成事实；不得把剧情NPC可知内容、世界事实、人物好感、背包、能力或世界历史写入伊依独立记忆。JSON必须严格合法，不输出额外字段。`;
}
function inject(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.messages) || !isYiYiSession() || isRecordOnly(data.messages)) return;
    data.messages = data.messages.filter(message => !contentOf(message).includes(PROMPT_MARKER));
    const query = recentQuery(data.messages);
    data.messages.push({ role: 'system', content: contract(buildYiYiRecallContext({ query, maxMemories: 10, maxChars: 650 })) });
}
function parseBlock(raw) {
    const source = String(raw ?? '');
    const start = source.lastIndexOf(START); if (start < 0) return null;
    const end = source.indexOf(END, start + START.length); if (end < 0) return null;
    const payload = source.slice(start + START.length, end).trim();
    const tail = source.slice(end + END.length).trimStart();
    const cleaned = `${source.slice(0, start).trimEnd()}${tail ? `\n${tail}` : ''}`.trim();
    try { return { delta: JSON.parse(payload), cleaned }; } catch (error) { return { error, cleaned }; }
}
function txFrom(before, after) {
    const fields = [];
    for (const [section, keys] of Object.entries(SECTIONS)) for (const key of keys) {
        if (!same(before?.[section]?.[key], after?.[section]?.[key])) fields.push({ section, key, before: clone(before?.[section]?.[key] ?? ''), after: clone(after?.[section]?.[key] ?? '') });
    }
    const a = new Map((before?.memories || []).map(item => [item.id, item]));
    const b = new Map((after?.memories || []).map(item => [item.id, item]));
    const memories = [];
    for (const id of new Set([...a.keys(), ...b.keys()])) {
        const oldItem = a.get(id) || null, newItem = b.get(id) || null;
        if (!same(oldItem, newItem)) memories.push({ id, before: clone(oldItem), after: clone(newItem) });
    }
    return { fields, memories };
}
function inverseTransaction(vault, tx) {
    const next = clone(vault);
    let changed = false;
    for (const item of tx?.fields || []) {
        const current = next?.[item.section]?.[item.key];
        if (!same(current, item.after)) continue;
        next[item.section] ??= {};
        next[item.section][item.key] = clone(item.before);
        changed = true;
    }
    for (const item of tx?.memories || []) {
        const index = (next.memories || []).findIndex(memory => memory.id === item.id);
        const current = index >= 0 ? next.memories[index] : null;
        if (!same(current, item.after)) continue;
        if (item.before === null) {
            if (index >= 0) { next.memories.splice(index, 1); changed = true; }
        } else if (index >= 0) { next.memories[index] = clone(item.before); changed = true; }
        else { next.memories.push(clone(item.before)); changed = true; }
    }
    return changed ? next : null;
}
function ledgerKey(chat) { return `${Number(chat?.swipe_id ?? 0)}\u241f${String(chat?.mes ?? '')}`; }
function ledger(chat) { chat.extra ??= {}; chat.extra[LEDGER_KEY] ??= {}; return chat.extra[LEDGER_KEY]; }
function currentTransaction(chat) { return chat?.extra?.[TX_KEY] || null; }
function setTransaction(chat, tx) { chat.extra ??= {}; if (tx) chat.extra[TX_KEY] = tx; else delete chat.extra[TX_KEY]; }
async function rollback(chat, tx) {
    if (!tx) return false;
    const next = inverseTransaction(getYiYiVault(), tx);
    if (!next) return false;
    await saveYiYiVault(next);
    return true;
}
async function process(chat) {
    if (!chat || chat.is_user || handled.get(chat) === chat.mes) return;
    const parsed = parseBlock(chat.mes);
    if (!parsed) return;
    const before = getYiYiVault();
    let after = before;
    if (!parsed.error) after = maintainYiYiMemoryVault(applyYiYiMemoryDelta(before, parsed.delta));
    const tx = parsed.error ? null : txFrom(before, after);
    if (!parsed.error && !same(before, after)) await saveYiYiVault(after);
    chat.mes = parsed.cleaned;
    const id = Number(chat.swipe_id);
    if (Array.isArray(chat.swipes) && Number.isInteger(id) && id >= 0 && id < chat.swipes.length) chat.swipes[id] = chat.mes;
    if (tx && (tx.fields.length || tx.memories.length)) setTransaction(chat, tx);
    handled.set(chat, chat.mes);
    try { await USER.saveChat(); } catch (error) {
        if (tx) await rollback(chat, tx);
        throw error;
    }
}
async function onMessage(chatId) {
    const chat = USER?.getContext?.()?.chat?.[Number(chatId)];
    if (chat) await process(chat);
}
async function onSwipe(chatId) {
    const chat = USER?.getContext?.()?.chat?.[Number(chatId)];
    if (!chat) return;
    const key = ledgerKey(chat);
    const map = ledger(chat);
    const previous = currentTransaction(chat);
    if (previous && !map[key]) await rollback(chat, previous);
    if (map[key]) setTransaction(chat, map[key]); else setTransaction(chat, null);
    await process(chat);
    const current = currentTransaction(chat);
    if (current) map[ledgerKey(chat)] = clone(current);
}
async function onDelete(chatId) {
    const chat = USER?.getContext?.()?.chat?.[Number(chatId)];
    const tx = currentTransaction(chat);
    if (tx) await rollback(chat, tx);
}

APP.eventSource.on(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, inject);
APP.eventSource.makeLast?.(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, inject);
APP.eventSource.on(APP.event_types.CHARACTER_MESSAGE_RENDERED, onMessage);
APP.eventSource.on(APP.event_types.MESSAGE_SWIPED, onSwipe);
APP.eventSource.on(APP.event_types.MESSAGE_DELETED, onDelete);

console.log('[Memo-N] 伊依长期记忆运行时已加载');