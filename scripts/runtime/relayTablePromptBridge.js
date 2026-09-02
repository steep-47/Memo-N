import { APP } from '../../core/manager.js';
import { ROUTE, getProviderRoute } from './providerRoute.js';

const RECORD_MARKER = '[Memo-N record envelope v7]';
const RELAY_CONTRACT = `${RECORD_MARKER}
[Memo-N附加记录任务]
先完整执行本请求原有回复要求；原有正文、格式、模块和顺序不因Memo-N改变。
原有回复全部完成后，在回复最末尾追加且只追加一个<tableEdit>机器记录块。
记录块内部只使用以下函数调用语法：
insertRow(tableIndex,{columnIndex:"value",...})
updateRow(tableIndex,rowIndex,{columnIndex:"value",...})
deleteRow(tableIndex,rowIndex)
没有表格变化时追加<tableEdit><!-- NO_CHANGE --></tableEdit>。
示例：<tableEdit><!--\ninsertRow(0,{0:"12500年01月01日",1:"08:00"})\n--></tableEdit>
不要把insertRow、updateRow、deleteRow写成XML/HTML标签或属性形式。
机器记录块只是末尾附录，不属于正文格式，也不替代或省略原有回复内容。`;

function apply(data) {
    if (!data || getProviderRoute(data) !== ROUTE.RELAY || !Array.isArray(data.messages)) return;
    let contractRewritten = 0;
    for (const message of data.messages) {
        const text = String(message?.content ?? '');
        if (!text.includes(RECORD_MARKER)) continue;
        message.content = RELAY_CONTRACT;
        contractRewritten++;
    }
    globalThis.__memoNRelayTablePromptProbe = {
        contractRewritten,
        originalTablePromptUntouched: true,
        tableEditPosition: 'tail',
        at: Date.now(),
    };
}

APP.eventSource.on(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, apply);
APP.eventSource.makeLast?.(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, apply);
