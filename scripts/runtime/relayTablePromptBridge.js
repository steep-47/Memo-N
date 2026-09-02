import { APP } from '../../core/manager.js';
import { ROUTE, getProviderRoute } from './providerRoute.js';

const MARKER = '# dataTable 世界状态记忆';
const HEADING = '# 输出';
const OUTPUT = `# 输出
Memo-N表格记录协议：先输出一个完整<tableEdit>记录块；有表格变化时写insertRow/updateRow/deleteRow，没有变化时写NO_CHANGE。tableEdit闭合后继续执行原有回复指令。Memo-N不规定其余回复的格式、模块、顺序或内容。`;

function apply(data) {
    if (!data || getProviderRoute(data) !== ROUTE.RELAY || !Array.isArray(data.messages)) return;
    let rewritten = 0;
    for (const message of data.messages) {
        const text = String(message?.content ?? '');
        if (!text.includes(MARKER)) continue;
        const at = text.lastIndexOf(HEADING);
        message.content = at >= 0 ? `${text.slice(0, at).trimEnd()}\n${OUTPUT}` : `${text.trimEnd()}\n${OUTPUT}`;
        rewritten++;
    }
    globalThis.__memoNRelayTablePromptProbe = { rewritten, at: Date.now() };
}

APP.eventSource.on(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, apply);
APP.eventSource.makeLast?.(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, apply);
