import { APP, USER } from '../../core/manager.js';
import { applyYiYiMemoryDelta, getYiYiVault } from './yiyiMemoryStore.js';
import { buildYiYiRecallContext } from './yiyiRecallEngine.js';
import { maintainYiYiMemoryVault } from './yiyiMemoryMaintenance.js';

const PROMPT_MARKER = '[Memo-N YiYi preset memory bridge v1]';
const START = '<yiyiMemory>';
const END = '</yiyiMemory>';
const PRESET_MARKERS = [
    '你叫伊依，是陪伴',
    '伊依独立长期记忆数据',
    '伊依始终在后台陪着',
];
const RECORD_ONLY_MARKERS = ['[Memo七表独立记录v3]', '[Memo七表整理', '世界状态数据库整理器', 'Memo世界状态表格整理器', '只维护表格，不输出剧情正文'];
const handled = new WeakMap();
let activeChat = null;

function contentOf(message) {
    if (typeof message?.content === 'string') return message.content;
    if (Array.isArray(message?.content)) return message.content.map(part => typeof part?.text === 'string' ? part.text : '').join('\n');
    return '';
}

function currentIsDirectYiYi() {
    const context = USER?.getContext?.();
    if (!context || context.groupId) return false;
    if (String(context.name2 ?? '').trim() === '伊依') return true;
    const id = Number(context.characterId);
    const character = Number.isInteger(id) && id >= 0 ? context.characters?.[id] : null;
    return String(character?.name ?? '').trim() === '伊依';
}

function hasYiYiPreset(messages) {
    if (!Array.isArray(messages)) return false;
    return messages.some(message => {
        const content = contentOf(message);
        return PRESET_MARKERS.some(marker => content.includes(marker));
    });
}

function isRecordOnly(messages) {
    const joined = Array.isArray(messages) ? messages.map(contentOf).join('\n') : '';
    return RECORD_ONLY_MARKERS.some(marker => joined.includes(marker));
}

function recentQuery(messages) {
    return (Array.isArray(messages) ? messages.slice(-8).map(contentOf).join('\n') : '').slice(-6000);
}

function contract(context) {
    return `${PROMPT_MARKER}\n${context}\n\n[伊依长期记忆写回协议]\n伊依是后台陪伴者，不是剧情世界NPC；她的记忆只能写入本独立记忆库，绝不写入世界七表。\n完成正常回复后，在回复内容末尾附加：\n${START}{"add":[],"update":[],"relationship":{},"emotion":{},"self":{}}${END}\n如果本轮最终响应是Memo-N JSON信封，本块必须位于reply字符串末尾；如果本轮使用中转站纯文本哨兵，本块必须位于MEMO_N_EDIT_BEGIN之前。无论哪种模式，本块都属于正常回复内容内部，不得放到最终机器记录块之后。\nadd保存以后仍可能有用的共同经历、玩家明确长期信息、伊依形成并值得延续的看法或彼此之间重要互动，每轮最多2条；普通寒暄、一次性动作、纯世界事实不要add。importance只能为normal/high/core。\nupdate只更新本轮召回的#记忆ID，用于纠正旧认知、补充后续结果或更新currentView。\nrelationship可用stage/summary/sharedUnderstanding/boundaries/unresolved/expectations/trustBasis/interactionPattern/initiative/comfort；只有真实互动提供了新证据才更新，不使用好感度数值。\nemotion可用current/cause/residue/intensity/trajectory；intensity只能0/1/2/3，trajectory只能rising/steady/easing；没有实际变化就写{}。\nself可用understanding/changes，只记录以后仍有意义的自我理解变化。\n不得把剧情NPC认知、背包、能力、世界历史、世界地点或纯世界事件写入伊依独立记忆；除非它们构成伊依与玩家共同经历中以后仍有意义的关系背景。不得把推测写成事实。JSON必须严格合法。`;
}

function inject(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.messages) || currentIsDirectYiYi()) return;
    if (!hasYiYiPreset(data.messages) || isRecordOnly(data.messages)) return;
    activeChat = USER?.getContext?.()?.chat ?? null;
    data.messages = data.messages.filter(message => !contentOf(message).includes(PROMPT_MARKER));
    const query = recentQuery(data.messages);
    data.messages.push({ role: 'system', content: contract(buildYiYiRecallContext({ query, maxMemories: 10, maxChars: 900 })) });
    globalThis.__memoNYiYiPresetBridge = { at: Date.now(), injected: true };
}

function parseBlock(raw) {
    const source = String(raw ?? '');
    const start = source.lastIndexOf(START);
    if (start < 0) return null;
    const end = source.indexOf(END, start + START.length);
    if (end < 0) return null;
    const payload = source.slice(start + START.length, end).trim();
    const tail = source.slice(end + END.length).trimStart();
    const cleaned = `${source.slice(0, start).trimEnd()}${tail ? `\n${tail}` : ''}`.trim();
    try { return { delta: JSON.parse(payload), cleaned }; }
    catch (error) { return { error, cleaned }; }
}

function findLastAssistantIndex(chat) {
    if (!Array.isArray(chat)) return -1;
    for (let i = chat.length - 1; i >= 0; i--) if (chat[i]?.is_user === false) return i;
    return -1;
}

async function processLatest() {
    const context = USER?.getContext?.();
    const chat = context?.chat;
    if (!Array.isArray(chat) || chat !== activeChat || currentIsDirectYiYi()) return;
    const index = findLastAssistantIndex(chat);
    if (index < 0) return;
    const piece = chat[index];
    const token = `${Number(piece.swipe_id ?? 0)}\u241f${String(piece.mes ?? '')}`;
    if (handled.get(piece) === token) return;

    const persistence = piece.__memoStrictPersistence;
    if (persistence && typeof persistence.then === 'function') {
        try { await persistence; } catch (_) {}
    }

    let parsed = parseBlock(piece.mes);
    const raw = String(piece.mes ?? '').trim();
    if (!parsed && raw.startsWith('{') && raw.includes('"reply"') && raw.includes('"changes"')) {
        queueMicrotask(() => void processLatest());
        return;
    }
    if (!parsed) return;
    handled.set(piece, token);

    piece.mes = parsed.cleaned;
    const swipeId = Number(piece.swipe_id);
    if (Array.isArray(piece.swipes) && Number.isInteger(swipeId) && swipeId >= 0 && swipeId < piece.swipes.length) piece.swipes[swipeId] = piece.mes;

    if (parsed.error) {
        console.warn('[Memo-N][伊依] 预设模式记忆增量JSON解析失败', parsed.error);
    } else {
        try {
            maintainYiYiMemoryVault(getYiYiVault(), { persist: true });
            const result = applyYiYiMemoryDelta(parsed.delta);
            const maintained = maintainYiYiMemoryVault(result.vault, { persist: true });
            globalThis.__memoNYiYiPresetBridge = {
                at: Date.now(), injected: true, written: true,
                changed: result.changed || maintained.changed,
                total: maintained.stats?.total ?? maintained.vault?.memories?.length ?? 0,
            };
            console.log(`[Memo-N][伊依] 预设模式长期记忆已处理｜changed=${result.changed || maintained.changed}｜total=${globalThis.__memoNYiYiPresetBridge.total}`);
        } catch (error) {
            console.error('[Memo-N][伊依] 预设模式长期记忆写入失败', error);
        }
    }

    try { await USER.saveChat?.(); } catch (error) { console.warn('[Memo-N][伊依] 预设模式聊天保存失败', error); }
    context?.updateMessageBlock?.(index, piece);
}

const settingsEvent = APP.event_types.CHAT_COMPLETION_SETTINGS_READY;
APP.eventSource.on(settingsEvent, inject);
APP.eventSource.makeFirst?.(settingsEvent, inject);

const endEvent = APP.event_types.GENERATION_ENDED;
APP.eventSource.on(endEvent, () => queueMicrotask(() => void processLatest()));
APP.eventSource.makeLast?.(endEvent, () => queueMicrotask(() => void processLatest()));

console.log('[Memo-N][伊依] 预设角色桥已加载：世界角色卡中只要检测到伊依预设，就启用同一个全局长期记忆库');