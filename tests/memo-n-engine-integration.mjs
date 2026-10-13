import fs from 'node:fs/promises';

let source = await fs.readFile(new URL('../scripts/engine/recordEngine.js', import.meta.url), 'utf8');
source = source
    .replace("import { APP, BASE, EDITOR, USER } from '../../core/manager.js';", 'const { APP, BASE, EDITOR, USER } = globalThis.__memoNMocks;')
    .replace(/import \{ executeMemoTableEdit, restoreMemoSnapshot, saveMemoSnapshot \} from '\.\.\/runtime\/safeTableExecutor\.js(?:\?[^']*)?';/, 'const { executeMemoTableEdit, restoreMemoSnapshot, saveMemoSnapshot } = globalThis.__memoNMocks;')
    .replace(/import \{[\s\S]*?\} from '\.\/recordEnvelope\.js(?:\?[^']*)?';/, `const {
        changesToStrictCalls, parseRecordEnvelope, parseRelayTableEditEnvelope, parseRelayTaggedEnvelope,
    } = globalThis.__memoNMocks;`);

const envelopeModule = await import('../scripts/engine/recordEnvelope.js');
let roundToken;
const tableEdit = (reply, calls = 'NO_CHANGE', token = roundToken) => `${reply}<tableEdit memo-round="${token}"><!-- ${calls} --></tableEdit>`;

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
            { name: '当前状态表', getHeader: () => ['日期', '时间', '地点', '当前场景人物'], getRowCount: () => 2 },
            { name: '角色状态表', getHeader: () => ['姓名'], getRowCount: () => 2 },
            { name: '背包表', getHeader: () => ['物品名'], getRowCount: () => 1 },
            { name: '当前任务与约定表', getHeader: () => ['事项'], getRowCount: () => 1 },
            { name: '人物主表', getHeader: () => ['姓名'], getRowCount: () => 3 },
            { name: '人物发展表', getHeader: () => ['姓名'], getRowCount: () => 2 },
            { name: '历史事件表', getHeader: () => ['时间'], getRowCount: () => 1 },
        ],
        getLastSheetsPiece: () => ({ piece: previous }),
        initHashSheet: () => ({ memo_n_hash_sheets: { state: 'initial' } }),
        refreshContextView: async () => { viewRefreshCalls++; },
    },
    EDITOR: {
        info() {}, success() {},
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
    roundToken = request.messages.at(-1)?.content.match(/memo-round="([^"]+)"/)?.[1];
    return request;
};

const request = await armRequest();
if (request.response_format?.type !== 'json_object' || !request.json_schema?.stale) throw new Error('预设结构化输出参数被改写');
if (request.custom_include_body !== 'seed: 1\nresponse_format:\n  type: json_object') throw new Error('CUSTOM请求字段被改写');
if (!Array.isArray(request.stop) || request.stop.length !== 2) throw new Error('酒馆停止词被改写');
if (!roundToken || !request.messages[0]?.content.includes(`memo-round="${roundToken}"`)) throw new Error('最后用户消息缺少本轮标识');
if (request.messages.at(-1)?.role !== 'system') throw new Error('单次API记录协议没有位于请求末尾');
const contract = request.messages.at(-1)?.content || '';
for (const required of ['[Memo-N native tableEdit one-call v1]', '正文生成后附带唯一正式记录块', '根节点结束标签前', '正文中明确成立的事实', '外貌特征', '未知信息留空', '当前数据行数=1', '0=日期，1=时间，2=地点，3=当前场景人物', '#6 历史事件表：当前数据行数=0', 'NO_CHANGE']) {
    if (!contract.includes(required)) throw new Error('当前记录协议缺少：' + required);
}

const first = {
    is_user: false,
    mes: tableEdit('第一轮正常正文', 'updateRow(0,0,{1:"08:02"})'),
    swipe_id: 0,
    swipes: [''],
    swipe_info: [{}],
};
currentChat.push(first);
await complete(1);
if (first.mes !== '第一轮正常正文' || first.swipes[0] !== first.mes) throw new Error('首轮正文或Swipe未剥离记录块');
if (executeCalls.length !== 1 || !String(executeCalls[0]).includes('updateRow(0,0,')) throw new Error('首轮tableEdit未进入严格事务');
if (!first.extra?.memo_n_record_block?.includes('updateRow(0,0,')) throw new Error('首轮已执行记录块没有保存为执行记录');

currentChat.push({ is_user: true, mes: '继续行动' });
const secondRequest = await armRequest('normal', 'deepseek', [
    { role: 'assistant', content: first.mes },
    { role: 'user', content: '继续行动' },
]);
if (secondRequest.response_format?.type !== 'json_object' || !secondRequest.json_schema?.stale
    || secondRequest.messages.at(-1)?.role !== 'system'
    || !secondRequest.messages.at(-1)?.content.includes('[Memo-N native tableEdit one-call v1]')) {
    throw new Error('第二轮请求协议发生漂移');
}
if (secondRequest.messages[0]?.content !== first.mes || first.mes.includes('<tableEdit')) throw new Error('历史正文被记录范例污染');
if (roundToken === contract.match(/memo-round="([^"]+)"/)?.[1]) throw new Error('跨轮标识未更新');
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
const reasoningBlock = tableEdit('', 'updateRow(0,0,{1:"08:15"})');
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
    mes: `<tableEdit memo-round="${roundToken}"><!-- updateRow(0,0,`,
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
if (!warnings.some(message => message.includes('未找到本轮正式Memo-N记录块'))) throw new Error('漏写记录块缺少明确提示');

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

saveFails = false;
currentChat = [previous];
await armRequest();
const statusContinuity = {
    is_user: false,
    mes: tableEdit(
        '【12500-01-03 09:40｜云陆·陈家村后山】\n【钱财：13文】\n【状态：神识·初生】\n\n状态连续性模拟正文',
        'updateRow(0,0,{0:"12500-01-03",1:"09:40",2:"云陆·陈家村后山",3:"陈尘"})\nupdateRow(1,0,{7:"初生",10:"13文"})',
    ),
    swipe_id: 0,
    swipes: [''],
    swipe_info: [{}],
};
currentChat.push(statusContinuity);
const callsBeforeStatusContinuity = executeCalls.length;
await complete(1);
const statusCall = String(executeCalls.at(-1) || '');
if (statusContinuity.mes.includes('<tableEdit>') || !statusContinuity.mes.includes('【钱财：13文】\n【状态：神识·初生】')) throw new Error('钱财戳/状态戳模拟污染正文或丢失');
if (executeCalls.length !== callsBeforeStatusContinuity + 1 || !statusCall.includes('updateRow(0,0,') || !statusCall.includes('updateRow(1,0,') || !statusCall.includes('10:"13文"') || !statusCall.includes('7:"初生"')) {
    throw new Error('钱财/神识与最终落点没有通过同一事务');
}

independentMode = true;
const untouchedRequest = await armRequest();
if (untouchedRequest.messages.length !== 1 || untouchedRequest.messages[0]?.content !== '行动') throw new Error('独立记录模式仍改写了正文请求消息');
if (untouchedRequest.response_format?.type !== 'json_object' || !untouchedRequest.json_schema?.stale || !untouchedRequest.custom_include_body.includes('response_format')) throw new Error('独立记录模式仍改写了正文请求参数');

independentMode = false;
const otherProviderRequest = await armRequest('normal', 'openai');
if (!otherProviderRequest.messages.at(-1)?.content.includes('[Memo-N native tableEdit one-call v1]')) throw new Error('非DeepSeek正文API没有使用同一单次记录链路');

const proxiedDeepSeekRequest = await armRequest('normal', 'deepseek', [{ role: 'user', content: '行动' }], { reverse_proxy: 'https://relay.invalid/v1' });
if (!proxiedDeepSeekRequest.messages.at(-1)?.content.includes('[Memo-N native tableEdit one-call v1]')) throw new Error('代理DeepSeek没有使用统一记录协议');
const toolDeepSeekRequest = await armRequest('normal', 'deepseek', [{ role: 'user', content: '行动' }], { tools: [{ type: 'function', function: { name: 'x' } }] });
if (!toolDeepSeekRequest.messages.at(-1)?.content.includes('[Memo-N native tableEdit one-call v1]')) throw new Error('带工具请求没有使用统一记录协议');

// Starting an ineligible generation must invalidate any older pending round.
currentChat = [previous];
await armRequest();
const callsBeforeQuiet = executeCalls.length;
await run(events.GENERATION_STARTED, 'quiet', {}, false);
const quietRequest = { messages: [{ role: 'user', content: 'quiet' }] };
await run(events.CHAT_COMPLETION_SETTINGS_READY, quietRequest);
if (quietRequest.messages.length !== 1) throw Error('quiet generation unexpectedly injected a record contract');
const quietMessage = { is_user: false, mes: '静默生成正文', swipe_id: 0, swipes: ['静默生成正文'], swipe_info: [{}] };
currentChat.push(quietMessage);
await complete(1);
if (executeCalls.length !== callsBeforeQuiet || quietMessage.__memoStrictPersistence) throw Error('quiet generation consumed a stale pending record round');

// Reject a previous round's block without executing it or losing body text.
currentChat = [previous];
await armRequest();
const staleBody = tableEdit('错轮正文', 'updateRow(0,0,{1:"10:00"})', 'previous-round');
const stale = { is_user: false, mes: staleBody, swipe_id: 0, swipes: [staleBody], swipe_info: [{}] };
currentChat.push(stale);
const beforeStale = executeCalls.length;
await complete(1);
if (executeCalls.length !== beforeStale || stale.mes !== staleBody || stale.__memoStrictExecution?.ok !== false) throw Error('错轮记录被执行或正文被改写');

// Exact whitespace is part of the preset, including inside a single XML root.
currentChat = [previous];
await armRequest();
const xmlBody = '  <reply>\n正文\n' + tableEdit('') + '</reply>  ';
const xmlMessage = { is_user: false, mes: xmlBody, swipe_id: 0, swipes: [xmlBody], swipe_info: [{}] };
currentChat.push(xmlMessage);
await complete(1);
if (xmlMessage.mes !== '  <reply>\n正文\n</reply>  ') throw Error('XML正文或首尾空白未保留');

// A chat switch while waiting for a streamed record must never write old data.
currentChat = [previous];
await armRequest();
const detached = { is_user: false, mes: `<tableEdit memo-round="${roundToken}"><!--`, swipe_id: 0, swipes: [''], swipe_info: [{}] };
currentChat.push(detached);
const beforeDetach = executeCalls.length;
const completion = complete(1);
await new Promise(resolve => setTimeout(resolve, 20));
currentChat = [];
await completion;
if (executeCalls.length !== beforeDetach) throw Error('切换聊天后仍写入旧会话');

console.log('memo-n-engine-integration PASS: preset parameters, token isolation, two turns, reasoning fallback, delayed stream, plain body, Continue separators, invalid operations, aborted generation, save rollback, status continuity, independent mode, provider neutrality, XML whitespace, chat switch');
