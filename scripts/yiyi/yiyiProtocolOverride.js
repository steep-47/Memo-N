import { APP } from '../../core/manager.js';

const MARKER = '[Memo-N YiYi current protocol override v2]';
const RUNTIME_MARKER = '[Memo-N YiYi memory runtime v10]';
const RECORD_ONLY_MARKERS = [
    '[Memo当前表格独立记录v5]',
    '[Memo-N DeepSeek 独立记录短块协议]',
    '[Memo-N 中转站独立记录 tableEdit 协议]',
    '[Memo-N DeepSeek 表格整理短块协议]',
    '[Memo-N 中转站表格整理 tableEdit 协议]',
    '这是记录专用请求，不输出剧情正文',
];

function contentOf(message) {
    if (typeof message?.content === 'string') return message.content;
    if (Array.isArray(message?.content)) return message.content.map(part => typeof part?.text === 'string' ? part.text : '').join('\n');
    return '';
}
function isRecordOnly(messages) {
    const joined = messages.map(contentOf).join('\n');
    return RECORD_ONLY_MARKERS.some(marker => joined.includes(marker));
}

function inject(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.messages)) return;
    const hasRuntime = data.messages.some(message => contentOf(message).includes(RUNTIME_MARKER));
    if (!hasRuntime) return;

    // 独立记录/整理是纯世界表机器请求，绝不能让伊依长期记忆协议参与输出。
    if (isRecordOnly(data.messages)) {
        data.messages = data.messages.filter(message => !contentOf(message).includes(RUNTIME_MARKER) && !contentOf(message).includes(MARKER));
        console.log('[Memo-N][伊依] 已从记录专用请求移除伊依长期记忆协议');
        return;
    }

    data.messages = data.messages.filter(message => !contentOf(message).includes('[Memo-N YiYi current protocol override'));
    data.messages.push({
        role: 'system',
        content: `${MARKER}\n对上方伊依长期记忆协议中的旧机器格式说明作如下最终覆盖：\n- Memo-N当前世界表格不是固定七表；表号、表头、列号只服从本轮Memo-N实际注入。\n- DeepSeek普通一次API若要求MEMO_N_DEEPSEEK_JSON_BEGIN/END前置短变化块：先完整闭合该前置块，再输出正常回复；<yiyiMemory>放在正常回复末尾，不放进前置变化数组。\n- 中转站普通一次API若要求前置<tableEdit>：先完整闭合<tableEdit>，再输出正常回复；<yiyiMemory>放在正常回复末尾，不得放到<tableEdit>之前或内部。\n- 若本轮没有上述世界记录协议，只按伊依长期记忆运行时本身要求处理。\n本段只修正机器协议顺序，不改变伊依人格、召回内容和长期记忆判断规则。`,
    });
}

const event = APP.event_types.CHAT_COMPLETION_SETTINGS_READY;
APP.eventSource.on(event, inject);
APP.eventSource.makeLast?.(event, inject);
console.log('[Memo-N][伊依] 直接角色当前记录协议覆盖已加载：记录专用请求隔离开启');
