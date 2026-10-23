import fs from 'node:fs/promises';

let source = await fs.readFile(new URL('../scripts/runtime/identityExpectedPromptGuard.js', import.meta.url), 'utf8');
source = source
    .replace(
        "import { APP, USER } from '../../core/manager.js';",
        'const { APP, USER } = globalThis.__memoNUserLastMocks;',
    )
    .replace(
        "import { RECORD_SEMANTICS_RULE } from './recordSemantics.js';",
        'const { RECORD_SEMANTICS_RULE } = globalThis.__memoNUserLastMocks;',
    );

const handlers = [];
globalThis.__memoNUserLastMocks = {
    APP: {
        event_types: { CHAT_COMPLETION_SETTINGS_READY: 'settings' },
        eventSource: {
            on(_event, handler) { handlers.push(handler); },
            makeLast() {},
        },
    },
    USER: {
        tableBaseSetting: {
            isExtensionAble: true,
            isAiReadTable: true,
            isAiWriteTable: true,
            injection_mode: 'deep_system',
            step_by_step: false,
        },
        getSettings: () => ({ memo_n_settings: { independent_record_api_enabled: false } }),
    },
    RECORD_SEMANTICS_RULE: '[Memo-N记录职责收口v1]\n表6跨轮完整事件合并只由冗余整理执行。',
};

await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#memo-n-user-last-api`);
if (handlers.length !== 1) throw new Error(`对象核对守卫监听器数量异常：${handlers.length}`);

const request = {
    messages: [
        { role: 'system', content: 'base system' },
        { role: 'assistant', content: 'history reply' },
        {
            role: 'user',
            content: '继续行动\n\n[Memo-N：保持预设正文格式；完成正文后附带记录块。]',
        },
        {
            role: 'system',
            content: '[Memo-N native tableEdit one-call v1]\n完整记录协议',
        },
    ],
};

handlers[0](request);

if (request.messages.at(-1)?.role !== 'user') {
    throw new Error('严格Chat Completion兼容失败：最后一条消息不是user');
}
if (!request.messages.at(-1)?.content.startsWith('继续行动')) {
    throw new Error('最后user消息被替换或丢失');
}

const contractIndex = request.messages.findIndex(message => String(message?.content ?? '').includes('[Memo-N native tableEdit one-call v1]'));
const guardIndex = request.messages.findIndex(message => String(message?.content ?? '').startsWith('[Memo-N对象核对输出硬约束v4]'));
const userIndex = request.messages.length - 1;
if (contractIndex < 0 || guardIndex < 0) throw new Error('Memo-N系统协议在重排后丢失');
if (!(contractIndex < guardIndex && guardIndex < userIndex)) {
    throw new Error(`Memo-N发送顺序错误：contract=${contractIndex}, guard=${guardIndex}, user=${userIndex}`);
}
if (!request.messages[guardIndex].content.includes('[Memo-N记录职责收口v1]')) {
    throw new Error('一次API没有注入统一记录职责');
}

const recordCount = request.messages.filter(message => String(message?.content ?? '').includes('[Memo-N native tableEdit one-call v1]')).length;
const guardCount = request.messages.filter(message => /^\[Memo-N对象核对输出硬约束v[1234]\]/.test(String(message?.content ?? ''))).length;
if (recordCount !== 1) throw new Error(`主记录协议数量异常：${recordCount}`);
if (guardCount !== 1) throw new Error(`对象核对协议数量异常：${guardCount}`);

console.log('memo-n user-last API PASS: one-call semantics guard precedes the final user message without duplication');
