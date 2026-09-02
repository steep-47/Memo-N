import { APP } from '../../core/manager.js';
import { ROUTE, getProviderRoute } from './providerRoute.js';

const MARKER = '# dataTable 世界状态记忆';
const HEADING = '# 输出';
const RECORD_PROTOCOL = `# Memo-N表格记录协议
在执行下方原有# 输出要求的同时，提供一个完整<tableEdit>记录块。记录块内部只使用下面三种函数调用语法：
insertRow(tableIndex,{columnIndex:"value",...})
updateRow(tableIndex,rowIndex,{columnIndex:"value",...})
deleteRow(tableIndex,rowIndex)
示例：<tableEdit><!--\ninsertRow(0,{0:"12500年01月01日",1:"08:00"})\n--></tableEdit>
没有变化时输出<tableEdit><!-- NO_CHANGE --></tableEdit>。
不要把insertRow、updateRow、deleteRow写成XML/HTML标签或属性形式。
本协议只补充机器记录；下方原有# 输出内容、格式、模块、顺序和要求保持原样。`;

function apply(data) {
    if (!data || getProviderRoute(data) !== ROUTE.RELAY || !Array.isArray(data.messages)) return;
    let rewritten = 0;
    for (const message of data.messages) {
        const text = String(message?.content ?? '');
        if (!text.includes(MARKER)) continue;
        const at = text.lastIndexOf(HEADING);
        message.content = at >= 0
            ? `${text.slice(0, at).trimEnd()}\n\n${RECORD_PROTOCOL}\n\n${text.slice(at)}`
            : `${text.trimEnd()}\n\n${RECORD_PROTOCOL}`;
        rewritten++;
    }
    globalThis.__memoNRelayTablePromptProbe = { rewritten, preservedOriginalOutput: true, at: Date.now() };
}

APP.eventSource.on(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, apply);
APP.eventSource.makeLast?.(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, apply);
