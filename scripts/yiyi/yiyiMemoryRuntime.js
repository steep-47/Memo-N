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
    return `${PROMPT_MARKER}\n${context}\n\n[伊依长期记忆写回协议]\n完成正常回复后，在回复内容末尾附加：\n${START}{"add":[],"update":[],"relationship":{},"emotion":{},"self":{}}${END}\n如果本轮还有Memo-N的<tableEdit>，本块放在<tableEdit>之前；如果本轮末尾还有<!--MEMO_N_CHANGES_V1 ... MEMO_N_CHANGES_END-->隐藏记录块，本块放在该记录块之前。\n本协议只负责持久化数据，不定义伊依的人格、文风、口癖、行为模板或剧情表现；这些由当前预设与正常上下文决定。\nadd只保存以后仍可能有用的共同经历或明确长期信息，每轮最多2条，importance只能是normal/high/core；普通闲聊、一次性动作和重复事项不要add。update只更新上方已召回的#记忆ID，用于纠正旧认知、补充后续结果或更新currentView。\n冲突/纠正规则：如果新信息证明某条旧记忆本身就是错误事实，不要再add一条互相矛盾的新记忆；直接update该#ID的memory为当前确认事实，并在currentView简短注明已纠正。若旧事件确实发生过、只是后来理解或结果改变，则保留memory，只update currentView。无法确认谁对谁错时不要擅自覆盖，保留原记忆并等待明确证据。\nrelationship可用stage/summary/sharedUnderstanding/boundaries/unresolved/expectations/trustBasis/interactionPattern/initiative/comfort，只在有足够新证据导致当前长期判断确实变化时更新；字段保存当前有效判断，不保存好感度/亲密度数值，不建立固定升级路线。\nemotion可用current/cause/residue/intensity/trajectory；intensity只能为0/1/2/3，trajectory只能为rising/steady/easing。emotion保存连续状态：本轮无实际变化则{}；有变化只写变化字段。不得因为新一轮请求而自动清零，也不得仅为了维持连续性而制造变化。\nself可用understanding/changes，只记录明确形成且以后仍有意义的自我理解变化。\n不得把推测写成事实；不得把剧情NPC可知内容、世界事实、人物好感、背包、能力或世界历史写入伊依独立记忆。JSON必须严格合法，不输出额外字段。`;
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
    return { version: 1, at: Date.now(), fields, memories };
}
function applyTx(tx, direction) {
    if (!tx || tx.version !== 1) return false;
    const vault = getYiYiVault(); let changed = false, emotionChanged = false;
    const fromKey = direction === 'forward' ? 'before' : 'after';
    const toKey = direction === 'forward' ? 'after' : 'before';
    for (const field of tx.fields || []) {
        const target = vault?.[field.section]; if (!target || !(field.key in target)) continue;
        if (same(target[field.key], field[fromKey]) && !same(target[field.key], field[toKey])) {
            target[field.key] = clone(field[toKey]); changed = true;
            if (field.section === 'emotion') emotionChanged = true;
        }
    }
    for (const change of tx.memories || []) {
        const index = vault.memories.findIndex(item => item.id === change.id);
        const current = index >= 0 ? vault.memories[index] : null;
        if (!same(current, change[fromKey])) continue;
        const next = change[toKey];
        if (next === null && index >= 0) { vault.memories.splice(index, 1); changed = true; }
        else if (next !== null && index < 0) { vault.memories.push(clone(next)); changed = true; }
        else if (next !== null && index >= 0 && !same(current, next)) { vault.memories[index] = clone(next); changed = true; }
    }
    if (emotionChanged) vault.emotion.updatedAt = new Date().toISOString();
    if (changed) saveYiYiVault(vault);
    return changed;
}
function ledger(create = true) {
    const meta = USER?.getContext?.()?.chatMetadata;
    if (!meta) return null;
    if ((!meta[LEDGER_KEY] || typeof meta[LEDGER_KEY] !== 'object') && create) meta[LEDGER_KEY] = { version: 1, messages: {} };
    return meta[LEDGER_KEY] || null;
}
function entry(messageId, create = true) {
    const book = ledger(create); if (!book) return null;
    const key = String(Number(messageId));
    if ((!book.messages[key] || typeof book.messages[key] !== 'object') && create) book.messages[key] = { activeSwipe: null, swipes: {} };
    return book.messages[key] || null;
}
function getTx(messageId, swipeId) { return entry(messageId, false)?.swipes?.[String(Number(swipeId))] || null; }
function setTx(messageId, swipeId, tx) {
    const item = entry(messageId, true); if (!item) return;
    item.swipes[String(Number(swipeId))] = tx;
    item.activeSwipe = Number(swipeId);
}
function rollbackEntry(messageId) {
    const item = entry(messageId, false); if (!item) return false;
    const active = Number(item.activeSwipe);
    const changed = Number.isInteger(active) && active >= 0 ? applyTx(item.swipes?.[String(active)], 'backward') : false;
    item.activeSwipe = null;
    return changed;
}
function deleteEntriesFrom(startId) {
    const book = ledger(false); if (!book?.messages) return;
    const ids = Object.keys(book.messages).map(Number).filter(id => Number.isInteger(id) && id >= Number(startId)).sort((a, b) => b - a);
    for (const id of ids) { rollbackEntry(id); delete book.messages[String(id)]; }
}
async function switchSwipe(chatId) {
    const chat = USER?.getContext?.()?.chat?.[Number(chatId)]; if (!chat || chat.is_user === true) return;
    const target = Number(chat.swipe_id); if (!Number.isInteger(target) || target < 0) return;
    const item = entry(chatId, true); const active = Number(item?.activeSwipe);
    if (Number.isInteger(active) && active >= 0 && active !== target) applyTx(item.swipes?.[String(active)], 'backward');
    if (active !== target) applyTx(item.swipes?.[String(target)], 'forward');
    if (item) item.activeSwipe = target;
    try { await USER.saveChat?.(); } catch (error) { console.warn('[Memo-N][伊依] Swipe事务状态保存失败', error); }
}
async function handleSwipeDeleted(payload) {
    const messageId = Number(payload?.messageId), deleted = Number(payload?.swipeId), newSwipeId = Number(payload?.newSwipeId);
    if (!Number.isInteger(messageId) || !Number.isInteger(deleted)) return;
    const item = entry(messageId, false); if (!item) return;
    const active = Number(item.activeSwipe);
    if (active === deleted) applyTx(item.swipes?.[String(deleted)], 'backward');
    const shifted = {};
    for (const [key, tx] of Object.entries(item.swipes || {})) {
        const id = Number(key); if (!Number.isInteger(id) || id === deleted) continue;
        shifted[String(id > deleted ? id - 1 : id)] = tx;
    }
    item.swipes = shifted;
    if (active === deleted) {
        item.activeSwipe = null;
        if (Number.isInteger(newSwipeId) && newSwipeId >= 0) { applyTx(shifted[String(newSwipeId)], 'forward'); item.activeSwipe = newSwipeId; }
    } else if (Number.isInteger(active) && active > deleted) item.activeSwipe = active - 1;
    try { await USER.saveChat?.(); } catch (error) { console.warn('[Memo-N][伊依] Swipe删除事务保存失败', error); }
}
async function handleMessageDeleted(newLength) {
    const start = Number(newLength); if (!Number.isInteger(start) || start < 0) return;
    deleteEntriesFrom(start);
    try { await USER.saveChat?.(); } catch (error) { console.warn('[Memo-N][伊依] 删除消息后的事务账本保存失败', error); }
}
async function handleMessageEdited(messageId) {
    const id = Number(messageId); if (!Number.isInteger(id) || id < 0) return;
    const chat = USER?.getContext?.()?.chat;
    const edited = Array.isArray(chat) ? chat[id] : null;
    deleteEntriesFrom(edited?.is_user === true ? id + 1 : id);
    try { await USER.saveChat?.(); } catch (error) { console.warn('[Memo-N][伊依] 编辑消息后的事务账本保存失败', error); }
}
async function processChat(chatId) {
    if (!isYiYiSession()) return;
    const chat = USER?.getContext?.()?.chat?.[Number(chatId)]; if (!chat || chat.is_user === true) return;
    const token = `${Number(chat.swipe_id ?? 0)}\u241f${String(chat.mes ?? '')}`; if (handled.get(chat) === token) return;
    const persistence = chat.__memoStrictPersistence; if (persistence && typeof persistence.then === 'function') { try { await persistence; } catch (_) {} }
    const raw = String(chat.mes ?? '').trim(); if (raw.startsWith('{') && raw.includes('"changes"') && raw.includes('"reply"')) return;
    const parsed = parseBlock(chat.mes); if (!parsed) return; handled.set(chat, token);
    chat.mes = parsed.cleaned; const swipeId = Number(chat.swipe_id);
    if (Array.isArray(chat.swipes) && Number.isInteger(swipeId) && swipeId >= 0 && swipeId < chat.swipes.length) chat.swipes[swipeId] = chat.mes;
    if (!parsed.error) {
        try {
            const preMaintenance = maintainYiYiMemoryVault(getYiYiVault(), { persist: true });
            const before = preMaintenance.vault;
            const result = applyYiYiMemoryDelta(parsed.delta);
            const postMaintenance = maintainYiYiMemoryVault(result.vault, { persist: true });
            const after = postMaintenance.vault;
            const changed = result.changed || postMaintenance.changed;
            setTx(chatId, swipeId, changed ? txFrom(before, after) : { version: 1, at: Date.now(), fields: [], memories: [] });
            if (postMaintenance.duplicatesMerged) console.log(`[Memo-N][伊依] 本轮安全合并 ${postMaintenance.duplicatesMerged} 条精确重复记忆`);
            if (postMaintenance.stats?.needsReview) console.warn(`[Memo-N][伊依] 长期记忆已达 ${postMaintenance.stats.total} 条；仅限制召回，不会按数量自动删除`);
        } catch (error) { console.error('[Memo-N][伊依] 长期记忆写入失败', error); }
    } else console.warn('[Memo-N][伊依] 记忆增量JSON解析失败', parsed.error);
    try { await USER.saveChat?.(); } catch (error) { console.warn('[Memo-N][伊依] 聊天保存失败', error); }
    USER.getContext?.()?.updateMessageBlock?.(Number(chatId), chat);
}

const settingsEvent = APP.event_types.CHAT_COMPLETION_SETTINGS_READY;
APP.eventSource.on(settingsEvent, inject); APP.eventSource.makeFirst?.(settingsEvent, inject);
if (APP.event_types.MESSAGE_SWIPED) { APP.eventSource.on(APP.event_types.MESSAGE_SWIPED, switchSwipe); APP.eventSource.makeFirst?.(APP.event_types.MESSAGE_SWIPED, switchSwipe); }
if (APP.event_types.MESSAGE_SWIPE_DELETED) APP.eventSource.on(APP.event_types.MESSAGE_SWIPE_DELETED, handleSwipeDeleted);
if (APP.event_types.MESSAGE_DELETED) APP.eventSource.on(APP.event_types.MESSAGE_DELETED, handleMessageDeleted);
if (APP.event_types.MESSAGE_EDITED) APP.eventSource.on(APP.event_types.MESSAGE_EDITED, handleMessageEdited);
function onGenerationEnded() {
    if (!isYiYiSession()) return;
    const chat = USER?.getContext?.()?.chat; if (!Array.isArray(chat)) return;
    for (let i = chat.length - 1; i >= 0; i--) if (chat[i]?.is_user === false) { queueMicrotask(() => void processChat(i)); break; }
}
APP.eventSource.on(APP.event_types.GENERATION_ENDED, onGenerationEnded); APP.eventSource.makeLast?.(APP.event_types.GENERATION_ENDED, onGenerationEnded);

globalThis.MemoNYiYiRuntime = Object.freeze({ inject, processChat, switchSwipe, handleSwipeDeleted, handleMessageDeleted, handleMessageEdited, isYiYiSession });
console.log('[Memo-N][伊依] 自动记忆v8已加载：只在当前角色确认为“伊依”时启用；其他角色即使提到伊依也不会读写她的长期记忆');
