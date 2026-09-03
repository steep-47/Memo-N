import { APP } from '../../core/manager.js';
import { ROUTE, getProviderRoute } from './providerRoute.js';

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
    if (getProviderRoute(data) === ROUTE.DEEPSEEK) return;
    const messages = data?.messages;
    if (!hasMemoRecordContract(messages)) return;
    for (let index = messages.length - 1; index >= 0; index--) {
        if (messages[index]?.role !== 'user') continue;
        appendAnchorToContent(messages[index]);
        return;
    }
}

const event = APP?.event_types?.CHAT_COMPLETION_SETTINGS_READY;
if (event) {
    APP.eventSource.on(event, anchorOneCallContract);
    APP.eventSource.makeLast?.(event, anchorOneCallContract);
}
