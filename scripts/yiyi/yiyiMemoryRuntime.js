import { APP, USER } from '../../core/manager.js';
import { applyYiYiMemoryDelta, buildYiYiMemoryContext } from './yiyiMemoryStore.js';

const PROMPT_MARKER = '[Memo-N YiYi memory runtime v1]';
const START = '<yiyiMemory>';
const END = '</yiyiMemory>';
const handled = new WeakMap();
const RECORD_ONLY_MARKERS = ['[Memo七表独立记录v3]', '[Memo七表整理', '世界状态数据库整理器', 'Memo世界状态表格整理器', '只维护表格，不输出剧情正文'];

function contentOf(message) {
    if (typeof message?.content === 'string') return message.content;
    if (Array.isArray(message?.content)) return message.content.map(part => typeof part?.text === 'string' ? part.text : '').join('\n');
    return '';
}
function recentQuery(messages) { return (Array.isArray(messages) ? messages.slice(-8).map(contentOf).join('\n') : '').slice(-6000); }
function hasYiYi(messages) {
    return Array.isArray(messages) && messages.some(message => {
        const content = contentOf(message);
        return !content.includes(PROMPT_MARKER) && content.includes('伊依');
    });
}
function isRecordOnly(messages) {
    const joined = Array.isArray(messages) ? messages.map(contentOf).join('\n') : '';
    return RECORD_ONLY_MARKERS.some(marker => joined.includes(marker));
}
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
async function processChat(chatId) {
    const chat = USER?.getContext?.()?.chat?.[Number(chatId)];
    if (!chat || chat.is_user === true) return;
    const token = `${Number(chat.swipe_id ?? 0)}\u241f${String(chat.mes ?? '')}`;
    if (handled.get(chat) === token) return;
    const persistence = chat.__memoStrictPersistence;
    if (persistence && typeof persistence.then === 'function') { try { await persistence; } catch (_) {} }

    // 一次API模式必须等recordEngine先拆掉外层JSON/tableEdit。若此时仍是原始信封，宁可不动，绝不抢先改坏稳定主链。
    const raw = String(chat.mes ?? '').trim();
    if (raw.startsWith('{') && raw.includes('"changes"') && raw.includes('"reply"')) return;

    const parsed = parseBlock(chat.mes);
    if (!parsed) return;
    handled.set(chat, token);
    chat.mes = parsed.cleaned;
    const swipeId = Number(chat.swipe_id);
    if (Array.isArray(chat.swipes) && Number.isInteger(swipeId) && swipeId >= 0 && swipeId < chat.swipes.length) chat.swipes[swipeId] = chat.mes;
    if (!parsed.error) {
        try { applyYiYiMemoryDelta(parsed.delta); }
        catch (error) { console.error('[Memo-N][伊依] 长期记忆写入失败', error); }
    } else console.warn('[Memo-N][伊依] 记忆增量JSON解析失败', parsed.error);
    try { await USER.saveChat?.(); } catch (error) { console.warn('[Memo-N][伊依] 清理记忆块后聊天保存失败', error); }
    USER.getContext?.()?.updateMessageBlock?.(Number(chatId), chat);
}

const settingsEvent = APP.event_types.CHAT_COMPLETION_SETTINGS_READY;
APP.eventSource.on(settingsEvent, inject);
APP.eventSource.makeFirst?.(settingsEvent, inject);

function onGenerationEnded() {
    const chat = USER?.getContext?.()?.chat;
    if (!Array.isArray(chat)) return;
    for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i]?.is_user === false) { queueMicrotask(() => void processChat(i)); break; }
    }
}
APP.eventSource.on(APP.event_types.GENERATION_ENDED, onGenerationEnded);
APP.eventSource.makeLast?.(APP.event_types.GENERATION_ENDED, onGenerationEnded);

globalThis.MemoNYiYiRuntime = Object.freeze({ inject, processChat });
console.log('[Memo-N][伊依] 自动读取/写回已加载：相关记忆进入同一主请求，不增加API调用；记录/整理专用请求自动绕过');
