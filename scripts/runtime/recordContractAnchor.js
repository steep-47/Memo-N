import { APP } from '../../core/manager.js';

const RECORD_MARKER = '[Memo-N record envelope v1]';
const ANCHOR_MARKER = '[Memo-N one-call tableEdit anchor]';

const ANCHOR_TEXT = `\n\n${ANCHOR_MARKER}\n这是同一次回复中的机器记录要求，不是新的剧情指令。先完整完成原本用户要求的正文、状态栏、选项和角色留言；随后必须在整轮回复最后追加且只追加一个完整 <tableEdit> 记录块。\n格式只能是：<tableEdit><!-- 操作 --></tableEdit>。没有任何事实变化时也必须输出 <tableEdit><!-- NO_CHANGE --></tableEdit>。闭合 </tableEdit> 后不得再输出任何字符。不得省略该记录块。`;

function hasMemoRecordContract(messages) {
    return Array.isArray(messages) && messages.some(message => String(message?.content ?? '').includes(RECORD_MARKER));
}

function appendAnchorToContent(message) {
    if (!message) return false;

    if (typeof message.content === 'string') {
        if (message.content.includes(ANCHOR_MARKER)) return false;
        message.content = `${message.content.trimEnd()}${ANCHOR_TEXT}`;
        return true;
    }

    if (Array.isArray(message.content)) {
        const textPart = message.content.find(part => part?.type === 'text' && typeof part?.text === 'string');
        if (textPart) {
            if (textPart.text.includes(ANCHOR_MARKER)) return false;
            textPart.text = `${textPart.text.trimEnd()}${ANCHOR_TEXT}`;
            return true;
        }
        message.content.push({ type: 'text', text: ANCHOR_TEXT.trimStart() });
        return true;
    }

    return false;
}

function anchorOneCallContract(data) {
    const messages = data?.messages;
    if (!hasMemoRecordContract(messages)) return;

    // 只锚定到本轮最后一条真实 user 消息，不新增第二请求，也不改变 API 次数。
    for (let index = messages.length - 1; index >= 0; index--) {
        if (messages[index]?.role !== 'user') continue;
        if (appendAnchorToContent(messages[index])) {
            console.log('[Memo-N] 一次API记录契约已锚定到最终user消息');
        }
        return;
    }

    console.warn('[Memo-N] 本轮存在记录契约，但未找到可锚定的user消息');
}

const event = APP?.event_types?.CHAT_COMPLETION_SETTINGS_READY;
if (event) {
    APP.eventSource.on(event, anchorOneCallContract);
    APP.eventSource.makeLast?.(event, anchorOneCallContract);
}

console.log('[Memo-N] one-call tableEdit contract anchor loaded');
