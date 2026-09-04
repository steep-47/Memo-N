import fs from 'node:fs/promises';

let source = await fs.readFile(new URL('../scripts/engine/recordEngine.js', import.meta.url), 'utf8');
source = source
    .replace("import { APP, BASE, EDITOR, USER } from '../../core/manager.js';", 'const { APP, BASE, EDITOR, USER } = globalThis.__memoNMocks;')
    .replace("import { executeMemoTableEdit, restoreMemoSnapshot, saveMemoSnapshot } from '../runtime/safeTableExecutor.js?v=memon73';", 'const { executeMemoTableEdit, restoreMemoSnapshot, saveMemoSnapshot } = globalThis.__memoNMocks;')
    .replace(`import {
    changesToStrictCalls,
    parseRecordEnvelope,
    parseRelayTableEditEnvelope,
    parseRelayTaggedEnvelope,
} from './recordEnvelope.js';`, `const {
    changesToStrictCalls,
    parseRecordEnvelope,
    parseRelayTableEditEnvelope,
    parseRelayTaggedEnvelope,
} = globalThis.__memoNMocks;`);
source = source.replace("import { isNativeDeepSeek } from '../runtime/providerRoute.js?v=memon73';", 'const { isNativeDeepSeek } = globalThis.__memoNMocks;');

const envelopeModule = await import('../scripts/engine/recordEnvelope.js');
const tableEdit = (reply, calls = 'NO_CHANGE') => `<tableEdit><!-- ${calls} --></tableEdit>\n\n${reply}`;

const handlers = new Map();
const on = (event, handler) => {
    const list = handlers.get(event) || [];
    list.push(handler);
    handlers.set(event, list);
};
const events = {
    GENERATION_STARTED: 'start',
    CHAT_COMPLETION_SETTINGS_READY: 'settings',
    CHARACTER_MESSAGE_RENDERED: 'rendered',
    GENERATION_ENDED: 'ended',
};

const previous = {
    is_user: false,
    mes: '旧正文',
    memo_n_hash_sheets: { state: 'before' },
    swipe_id: 0,
    swipes: ['旧正文'],
    swipe_info: [{}],
};
let currentChat = [previous];
let saveFails = false;
let independentMode = false;
const executeCalls = [];
const restoreCalls = [];
let viewRefreshCalls = 0;
const warnings = [];
const errors = [];
const context = { get chat() { return currentChat; }, updateMessageBlock() {} };

globalThis.__memoNMocks = {
    APP: { event_types: events, eventSource: { on, makeFirst() {}, makeLast() {} } },
    BASE: {
        copyHashSheets: structuredClone,
        getChatSheets: () => [
            { name: '当前状态表', getHeader: () => ['日期', '时间', '地点', '当前场景人物'] },
            { name: '角色状态表', getHeader: () => ['姓名'] },
            { name: '背包表', getHeader: () => ['物品名'] },
            { name: '当前任务与约定表', getHeader: () => ['事项'] },
            { name: '人物主表', getHeader: () => ['姓名'] },
            { name: '人物发展表', getHeader: () => ['姓名'] },
            { name: '历史事件表', getHeader: () => ['时间'] },
        ],
        getLastSheetsPiece: () => ({ piece: previous }),
        initHashSheet: () => ({ memo_n_hash_sheets: { state: 'initial' } }),
        refreshContextView: async () => { viewRefreshCalls++; },
    },
    EDITOR: {
        warning: message => warnings.push(String(message)),
        error: message => errors.push(String(message)),
    },
    USER: {
        tableBaseSetting: {
            isExtensionAble: true,
            isAiReadTable: true,
            isAiWriteTable: true,
            injection_mode: 'deep_system',
            step_by_step: false,
        },
        getSettings: () => ({ memo_n_settings: { independent_record_api_enabled: independentMode } }),
        getContext: () => context,
        saveChat: async () => { if (saveFails) throw new Error('injected save failure'); return true; },
    },
    ...envelopeModule,
    isNativeDeepSeek: data => String(data?.chat_completion_source ?? '').trim().toLowerCase() === 'deepseek'
        && !String(data?.reverse_proxy ?? '').trim(),
    restoreMemoSnapshot: snapshot => { restoreCalls.push(structuredClone(snapshot)); return { ok: true, error: '' }; },
    saveMemoSnapshot: piece => { piece.memo_n_hash_sheets = { state: 'saved' }; return true; },
    executeMemoTableEdit: raw => {
        executeCalls.push(raw);
        const text = Array.isArray(raw) ? raw.join('\n') : String(raw);
        if (text.includes('INSERT INTO')) return { ok: false, changed: false, noChange: false, count: 0, error: '存在无法识别或不允许的tableEdit内容' };
        return {
            ok: true,
            changed: !text.includes('NO_CHANGE'),
            noChange: text.includes('NO_CHANGE'),
            count: text.includes('NO_CHANGE') ? 0 : 1,
            error: '',
        };
    },
};

await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#memo-n-engine-relay`);
const run = async (event, ...args) => {
    for (const handler of handlers.get(event) || []) await handler(...args);
};
const complete = async chatId => {
    await run(events.CHARACTER_MESSAGE_RENDERED, chatId);
    await run(events.GENERATION_ENDED);
    const persistence = currentChat[chatId]?.__memoStrictPersistence;
    if (persistence) await persistence;
};
const armRequest = async (type = 'normal', sourceName = 'deepseek', messages = [{ role: 'user', content: '行动' }], extras = {}) => {
    await run(events.GENERATION_STARTED, type, {}, false);
    const request = {
        chat_completion_source: sourceName,
        messages: structuredClone(messages),
        response_format: { type: 'json_object' },
        json_schema: { stale: true },
        custom_include_body: 'seed: 1\nresponse_format:\n  type: json_object',
        stop: ['User:', '用户：'],
        ...extras,
    };
    await run(events.CHAT_COMPLETION_SETTINGS_READY, request);
    return request;
};

const request = await armRequest();
if (request.response_format || request.json_schema) throw new Error('一次API仍强制整篇JSON');
if (/response_format/.test(request.custom_include_body) || !/seed:\s*1/.test(request.custom_include_body)) throw new Error('CUSTOM响应格式清理破坏其他请求字段');
if (!Array.isArray(request.stop) || request.stop.length !== 2) throw new Error('正常正文模式错误删除了酒馆停止词');
if (!request.messages[0]?.content.includes('<tableEdit>') || !request.messages[0]?.content.includes('完整正常正文')) throw new Error('最后一条用户消息缺少本轮tableEdit协议锚点');
if (request.messages.at(-1)?.role !== 'assistant' || request.messages.at(-1)?.content !== '<tableEdit><!--\n') {
    throw new Error('内置直连DeepSeek没有获得原生助手硬前缀');
}
const contract = request.messages.at(-2)?.content || '';
if (!contract.includes('[Memo-N native tableEdit one-call v1]') || !contract.includes('<tableEdit><!--') || !contract.includes('实际输出的第一段先给出一个完整的Memo-N')) {
    throw new Error('前置记录协议未正确注入');
}

const first = {
    is_user: false,
    // DeepSeek前缀续写接口可以只返回已提供前缀之后的内容。
    mes: 'updateRow(0,0,{1:"08:02"})\n--></tableEdit>\n\n第一轮正常正文',
    swipe_id: 0,
    swipes: [''],
    swipe_info: [{}],
};
currentChat.push(first);
await complete(1);
if (first.mes !== '第一轮正常正文' || first.swipes[0] !== first.mes) throw new Error('首轮正文或Swipe未剥离记录块');
if (executeCalls.length !== 1 || !String(executeCalls[0]).includes('updateRow(0,0,')) throw new Error('首轮tableEdit未进入严格事务');
if (!first.extra?.memo_n_record_block?.includes('updateRow(0,0,')) throw new Error('首轮已执行记录块没有保存为下一轮历史范例');

currentChat.push({ is_user: true, mes: '继续行动' });
const secondRequest = await armRequest('normal', 'deepseek', [
    { role: 'assistant', content: first.mes },
    { role: 'user', content: '继续行动' },
]);
if (secondRequest.response_format || secondRequest.json_schema
    || secondRequest.messages.at(-1)?.role !== 'assistant'
    || secondRequest.messages.at(-1)?.content !== '<tableEdit><!--\n') {
    throw new Error('第二轮请求协议发生漂移');
}
if (!/^<tableEdit><!--\s*updateRow\(0,0,/.test(secondRequest.messages[0]?.content || '')) throw new Error('第二轮历史副本没有恢复上一轮已执行记录块');
if (first.mes.includes('<tableEdit>')) throw new Error('历史范例恢复错误污染了手机聊天正文');
const second = {
    is_user: false,
    mes: tableEdit('第二轮正常正文', 'insertRow(4,{0:"赶驴老汉"})'),
    swipe_id: 0,
    swipes: [''],
    swipe_info: [{}],
};
currentChat.push(second);
await complete(3);
if (second.mes !== '第二轮正常正文' || executeCalls.length !== 2) throw new Error('第二轮正文或记录失败');

currentChat = [previous];
await armRequest();
const reasoningBlock = '<tableEdit><!-- updateRow(0,0,{1:"08:15"}) --></tableEdit>';
const splitChannels = {
    is_user: false,
    mes: '正文来自content',
    swipe_id: 0,
    swipes: [''],
    swipe_info: [{ extra: { reasoning: reasoningBlock } }],
};
currentChat.push(splitChannels);
await complete(1);
if (splitChannels.mes !== '正文来自content' || executeCalls.length !== 3) throw new Error('思考区机器块未与content正文安全合并');

currentChat = [previous];
await armRequest();
const delayed = {
    is_user: false,
    mes: '<tableEdit><!-- updateRow(0,0,',
    swipe_id: 0,
    swipes: [''],
    swipe_info: [{}],
};
currentChat.push(delayed);
setTimeout(() => {
    delayed.mes = tableEdit('延迟完成正文', 'insertRow(2,{0:"钥匙"})');
}, 180);
await complete(1);
if (delayed.mes !== '延迟完成正文' || executeCalls.length !== 4) throw new Error('提前结束事件没有等待记录块闭合');

currentChat = [previous];
await armRequest('normal', 'openai');
const plain = { is_user: false, mes: '模型漏写记录块但正文正常', swipe_id: 0, swipes: [''], swipe_info: [{}] };
currentChat.push(plain);
await complete(1);
if (plain.mes !== '模型漏写记录块但正文正常' || executeCalls.length !== 4) throw new Error('漏写记录块时未保留正常正文或错误执行表格');
if (!warnings.some(message => message.includes('未找到Memo-N记录块'))) throw new Error('漏写记录块缺少明确提示');

currentChat = [{ ...previous, memo_n_hash_sheets: { state: 'continue' } }];
const continuing = currentChat[0];
await armRequest('continue');
continuing.mes = `${continuing.mes}\n\n${tableEdit('续写正文')}`;
await complete(0);
if (continuing.mes !== '旧正文\n\n续写正文' || !String(executeCalls.at(-1)).includes('NO_CHANGE')) throw new Error('Continue增量拆包或基线处理失败');

currentChat = [previous];
await armRequest();
const invalid = {
    is_user: false,
    mes: tableEdit('非法变更仍保留正文', 'INSERT INTO memo VALUES (1)'),
    swipe_id: 0,
    swipes: [''],
    swipe_info: [{}],
};
currentChat.push(invalid);
await complete(1);
if (invalid.mes !== '非法变更仍保留正文' || invalid.__memoStrictExecution?.ok !== false) throw new Error('非法变更未安全保留正文');

currentChat = [previous];
const callsBeforeAbortedGeneration = executeCalls.length;
await armRequest();
await run(events.GENERATION_ENDED);
if (executeCalls.length !== callsBeforeAbortedGeneration || previous.__memoStrictPersistence) throw new Error('中断生成错误处理了上一条助手消息');

currentChat = [previous];
await armRequest();
const failing = {
    is_user: false,
    mes: tableEdit('保存失败正文', 'insertRow(2,{0:"药草"})'),
    swipe_id: 0,
    swipes: [''],
    swipe_info: [{}],
};
currentChat.push(failing);
saveFails = true;
await complete(1);
if (failing.mes !== '保存失败正文') throw new Error('保存失败时正文未保留');
if (failing.__memoStrictExecution?.ok !== false || !failing.__memoStrictExecution?.error.includes('表格已回滚')) throw new Error('保存失败未执行事务回滚');
if (!errors.some(message => message.includes('Memo-N保存失败')) || restoreCalls.length < 2) throw new Error('保存失败缺少错误提示或基线恢复');

independentMode = true;
const untouchedRequest = await armRequest();
if (untouchedRequest.messages.length !== 1 || untouchedRequest.messages[0]?.content !== '行动') throw new Error('独立记录模式仍改写了正文请求消息');
if (untouchedRequest.response_format?.type !== 'json_object' || !untouchedRequest.json_schema?.stale || !untouchedRequest.custom_include_body.includes('response_format')) throw new Error('独立记录模式仍改写了正文请求参数');

independentMode = false;
const otherProviderRequest = await armRequest('normal', 'openai');
if (!otherProviderRequest.messages.at(-1)?.content.includes('[Memo-N native tableEdit one-call v1]')) throw new Error('非DeepSeek正文API没有使用同一单次记录链路');

const proxiedDeepSeekRequest = await armRequest('normal', 'deepseek', [{ role: 'user', content: '行动' }], { reverse_proxy: 'https://relay.invalid/v1' });
if (proxiedDeepSeekRequest.messages.at(-1)?.role === 'assistant') throw new Error('代理DeepSeek被错误注入仅原生端点支持的硬前缀');
const toolDeepSeekRequest = await armRequest('normal', 'deepseek', [{ role: 'user', content: '行动' }], { tools: [{ type: 'function', function: { name: 'x' } }] });
if (toolDeepSeekRequest.messages.at(-1)?.role === 'assistant') throw new Error('带工具请求被错误注入DeepSeek不支持的硬前缀');

console.log('memo-n-engine-integration PASS: independent-main-request-untouched=1, deepseek-hard-prefix=2, prefix-reconstruction=1, native-tableedit=1, normal-content=1, json-mode-removed=1, stop-preserved=1, last-user-anchor=1, multi-turn=2, reasoning-machine-channel=1, delayed-close=1, plain-reply-fallback=1, continue=1, invalid-change=1, aborted-generation-isolation=1, save-rollback=1, provider-neutral=1, prefix-safety-fallback=2');
