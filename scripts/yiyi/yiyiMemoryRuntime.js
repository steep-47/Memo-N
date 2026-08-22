import { APP, USER } from '../../core/manager.js';
import { applyYiYiMemoryDelta, buildYiYiMemoryContext, getYiYiVault, saveYiYiVault } from './yiyiMemoryStore.js';

const PROMPT_MARKER = '[Memo-N YiYi memory runtime v2]';
const START = '<yiyiMemory>';
const END = '</yiyiMemory>';
const TX_KEY = 'memo_n_yiyi_transaction_v1';
const ACTIVE_KEY = 'memo_n_yiyi_active_swipe_id';
const handled = new WeakMap();
const RECORD_ONLY_MARKERS = ['[Memo七表独立记录v3]', '[Memo七表整理', '世界状态数据库整理器', 'Memo世界状态表格整理器', '只维护表格，不输出剧情正文'];
const SECTIONS = Object.freeze({
    relationship: ['stage', 'summary', 'sharedUnderstanding', 'boundaries', 'unresolved'],
    emotion: ['current', 'cause', 'residue'],
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
function hasYiYi(messages) { return Array.isArray(messages) && messages.some(message => { const content = contentOf(message); return !content.includes(PROMPT_MARKER) && content.includes('伊依'); }); }
function isRecordOnly(messages) { const joined = Array.isArray(messages) ? messages.map(contentOf).join('\n') : ''; return RECORD_ONLY_MARKERS.some(marker => joined.includes(marker)); }
function contract(context) {
    return `${PROMPT_MARKER}\n${context}\n\n[伊依长期记忆增量]\n完成正常回复后，在回复内容末尾附加：\n${START}{"add":[],"update":[],"relationship":{},"emotion":{},"self":{}}${END}\n如果本轮还有Memo-N的<tableEdit>，本块放在<tableEdit>之前；如果最终响应是Memo-N JSON信封，本块放在reply字符串末尾。\n只记录会影响以后相处的长期信息：重要称呼/玩笑/默契、明确偏好或反感、边界、持续看法、未消退情绪及原因、共同经历、错误与纠正、未完话题/约定、关系阶段变化、自我理解变化。普通闲聊、一次性动作、短暂情绪不形成长期记忆。不得记录剧情NPC可知内容、世界事实、人物好感、背包、能力或历史事件。不得把推测写成事实。没有长期变化时保持空数组和空对象。add每轮最多2条，importance只能是normal/high/core；相同事情不要重复add。update只更新上方已提供的#记忆ID，不自动删除旧记忆；纠正、失效或解决通过currentView等字段更新。relationship可用stage/summary/sharedUnderstanding/boundaries/unresolved；emotion可用current/cause/residue；self可用understanding/changes。只填写真正变化的字段。JSON必须合法，不输出额外字段。`;
}
function inject(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.messages) || isRecordOnly(data.messages) || !hasYiYi(data.messages)) return;
    data.messages = data.messages.filter(message => !contentOf(message).includes(PROMPT_MARKER));
    const query = recentQuery(data.messages);
    data.messages.push({ role: 'system', content: contract(buildYiYiMemoryContext({ query, maxMemories: 16, maxChars: 650 })) });
}
function parseBlock(raw) {
    const source = String(raw ?? ''); const start = source.lastIndexOf(START); if (start < 0) return null;
    const end = source.indexOf(END, start + START.length); if (end < 0) return null;
    const payload = source.slice(start + START.length, end).trim(); const tail = source.slice(end + END.length).trimStart();
    const cleaned = `${source.slice(0, start).trimEnd()}${tail ? `\n${tail}` : ''}`.trim();
    try { return { delta: JSON.parse(payload), cleaned }; } catch (error) { return { error, cleaned }; }
}
function txFrom(before, after) {
    const fields = [];
    for (const [section, keys] of Object.entries(SECTIONS)) for (const key of keys) {
        if (before?.[section]?.[key] !== after?.[section]?.[key]) fields.push({ section, key, before: before?.[section]?.[key] ?? '', after: after?.[section]?.[key] ?? '' });
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
function swipeExtra(chat, swipeId, create = false) {
    if (!Array.isArray(chat?.swipe_info) || !Number.isInteger(swipeId) || swipeId < 0) return null;
    if (!chat.swipe_info[swipeId] && create) chat.swipe_info[swipeId] = {};
    const info = chat.swipe_info[swipeId]; if (!info) return null;
    if ((!info.extra || typeof info.extra !== 'object') && create) info.extra = {};
    return info.extra || null;
}
function getTx(chat, swipeId) { return swipeExtra(chat, swipeId, false)?.[TX_KEY] || null; }
function setTx(chat, swipeId, tx) { const extra = swipeExtra(chat, swipeId, true); if (extra) extra[TX_KEY] = tx; }
function applyTx(tx, direction) {
    if (!tx || tx.version !== 1) return false;
    const vault = getYiYiVault(); let changed = false;
    const fromKey = direction === 'forward' ? 'before' : 'after'; const toKey = direction === 'forward' ? 'after' : 'before';
    for (const field of tx.fields || []) {
        const target = vault?.[field.section]; if (!target || !(field.key in target)) continue;
        if (target[field.key] === field[fromKey] && target[field.key] !== field[toKey]) { target[field.key] = field[toKey]; changed = true; }
    }
    for (const change of tx.memories || []) {
        const index = vault.memories.findIndex(item => item.id === change.id); const current = index >= 0 ? vault.memories[index] : null;
        if (!same(current, change[fromKey])) continue;
        const next = change[toKey];
        if (next === null && index >= 0) { vault.memories.splice(index, 1); changed = true; }
        else if (next !== null && index < 0) { vault.memories.push(clone(next)); changed = true; }
        else if (next !== null && index >= 0 && !same(current, next)) { vault.memories[index] = clone(next); changed = true; }
    }
    if (changed) saveYiYiVault(vault);
    return changed;
}
async function switchSwipe(chatId) {
    const chat = USER?.getContext?.()?.chat?.[Number(chatId)]; if (!chat || chat.is_user === true) return;
    const target = Number(chat.swipe_id); if (!Number.isInteger(target) || target < 0) return;
    const active = Number(chat[ACTIVE_KEY]);
    if (Number.isInteger(active) && active >= 0 && active !== target) applyTx(getTx(chat, active), 'backward');
    if (active !== target) applyTx(getTx(chat, target), 'forward');
    chat[ACTIVE_KEY] = target;
    try { await USER.saveChat?.(); } catch (error) { console.warn('[Memo-N][伊依] Swipe事务状态保存失败', error); }
    console.log(`[Memo-N][伊依] Swipe事务切换：message=${chatId} ${Number.isInteger(active) ? active : '?'} -> ${target}`);
}
async function processChat(chatId) {
    const chat = USER?.getContext?.()?.chat?.[Number(chatId)]; if (!chat || chat.is_user === true) return;
    const token = `${Number(chat.swipe_id ?? 0)}\u241f${String(chat.mes ?? '')}`; if (handled.get(chat) === token) return;
    const persistence = chat.__memoStrictPersistence; if (persistence && typeof persistence.then === 'function') { try { await persistence; } catch (_) {} }
    const raw = String(chat.mes ?? '').trim(); if (raw.startsWith('{') && raw.includes('"changes"') && raw.includes('"reply"')) return;
    const parsed = parseBlock(chat.mes); if (!parsed) return; handled.set(chat, token);
    chat.mes = parsed.cleaned; const swipeId = Number(chat.swipe_id);
    if (Array.isArray(chat.swipes) && Number.isInteger(swipeId) && swipeId >= 0 && swipeId < chat.swipes.length) chat.swipes[swipeId] = chat.mes;
    if (!parsed.error) {
        try {
            const before = getYiYiVault(); const result = applyYiYiMemoryDelta(parsed.delta); const after = result.vault;
            if (result.changed) setTx(chat, swipeId, txFrom(before, after)); else setTx(chat, swipeId, { version: 1, at: Date.now(), fields: [], memories: [] });
            chat[ACTIVE_KEY] = swipeId;
        } catch (error) { console.error('[Memo-N][伊依] 长期记忆写入失败', error); }
    } else console.warn('[Memo-N][伊依] 记忆增量JSON解析失败', parsed.error);
    try { await USER.saveChat?.(); } catch (error) { console.warn('[Memo-N][伊依] 聊天保存失败', error); }
    USER.getContext?.()?.updateMessageBlock?.(Number(chatId), chat);
}

const settingsEvent = APP.event_types.CHAT_COMPLETION_SETTINGS_READY;
APP.eventSource.on(settingsEvent, inject); APP.eventSource.makeFirst?.(settingsEvent, inject);
const swipeEvent = APP.event_types.MESSAGE_SWIPED;
if (swipeEvent) { APP.eventSource.on(swipeEvent, switchSwipe); APP.eventSource.makeFirst?.(swipeEvent, switchSwipe); }
function onGenerationEnded() {
    const chat = USER?.getContext?.()?.chat; if (!Array.isArray(chat)) return;
    for (let i = chat.length - 1; i >= 0; i--) if (chat[i]?.is_user === false) { queueMicrotask(() => void processChat(i)); break; }
}
APP.eventSource.on(APP.event_types.GENERATION_ENDED, onGenerationEnded); APP.eventSource.makeLast?.(APP.event_types.GENERATION_ENDED, onGenerationEnded);

globalThis.MemoNYiYiRuntime = Object.freeze({ inject, processChat, switchSwipe });
console.log('[Memo-N][伊依] 自动记忆v2已加载：Swipe/Regenerate使用逐字段CAS事务回滚，不覆盖其他聊天后来形成的记忆');
