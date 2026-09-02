import { APP } from '../../core/manager.js';
import { ROUTE, getProviderRoute } from './providerRoute.js';

const MARKER = '# dataTable 世界状态记忆';
const HEADING = '# 输出';
const OUTPUT = `# Memo-N附加记录
在执行原有输出要求的同时，额外在回复最前面加入一个完整<tableEdit>机器记录块。这个机器块只是附加记录前缀，不替代、不结束、也不概括原有输出任务；闭合后继续完成原有输出要求直到其自然结束。
记录块内部只使用下面三种函数调用语法：
insertRow(tableIndex,{columnIndex:"value",...})
updateRow(tableIndex,rowIndex,{columnIndex:"value",...})
deleteRow(tableIndex,rowIndex)
示例：<tableEdit><!--\ninsertRow(0,{0:"12500年01月01日",1:"08:00"})\n--></tableEdit>
没有变化时固定输出<tableEdit><!-- NO_CHANGE --></tableEdit>。
不要把insertRow、updateRow、deleteRow写成XML/HTML标签或属性形式。Memo-N只增加这个机器记录前缀，其余输出继续由原有指令决定。`;

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
