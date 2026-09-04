import fs from 'node:fs/promises';

let source = await fs.readFile(new URL('../scripts/engine/recordEngine.js', import.meta.url), 'utf8');
source = source
    .replace("import { APP, BASE, EDITOR, USER } from '../../core/manager.js';", 'const { APP, BASE, EDITOR, USER } = globalThis.__memoNMocks;')
    .replace("import { executeMemoTableEdit, restoreMemoSnapshot, saveMemoSnapshot } from '../runtime/safeTableExecutor.js?v=memon9';", 'const { executeMemoTableEdit, restoreMemoSnapshot, saveMemoSnapshot } = globalThis.__memoNMocks;')
    .replace("import { isDirectDeepSeek } from '../runtime/providerRoute.js';", 'const { isDirectDeepSeek } = globalThis.__memoNMocks;')
    .replace(`import {
    RELAY_TAG_END,
    RELAY_TAG_START,
    changesToStrictCalls,
    parseRecordEnvelope,
    parseRelayTaggedEnvelope,
} from './recordEnvelope.js';`, `const {
    RELAY_TAG_END,
    RELAY_TAG_START,
    changesToStrictCalls,
    parseRecordEnvelope,
    parseRelayTaggedEnvelope,
} = globalThis.__memoNMocks;`);

const envelopeModule = await import('../scripts/engine/recordEnvelope.js');
const { RELAY_TAG_END, RELAY_TAG_START } = envelopeModule;
const relay = (reply, changes = []) => `${reply}\n\n${RELAY_TAG_START}\n${JSON.stringify(changes)}\n${RELAY_TAG_END}`;

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
        getSettings: () => ({ memo_n_settings: { independent_record_api_enabled: false } }),
        getContext: () => context,
        saveChat: async () => { if (saveFails) throw new Error('injected save failure'); return true; },
    },
    isDirectDeepSeek: data => ['deepseek', 'custom'].includes(String(data?.chat_completion_source || '')),
    ...envelopeModule,
    restoreMemoSnapshot: snapshot => { restoreCalls.push(structuredClone(snapshot)); return { ok: true, error: '' }; },
    saveMemoSnapshot: piece => { piece.memo_n_hash_sheets = { state: 'saved' }; return true; },
    executeMemoTableEdit: calls => {
        executeCalls.push(calls);
        return {
            ok: true,
            changed: calls[0] !== 'NO_CHANGE',
            noChange: calls[0] === 'NO_CHANGE',
            count: calls[0] === 'NO_CHANGE' ? 0 : calls.length,
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
const armRequest = async (type = 'normal', sourceName = 'deepseek') => {
    await run(events.GENERATION_STARTED, type, {}, false);
    const request = {
        chat_completion_source: sourceName,
        messages: [{ role: 'user', content: '行动' }],
        response_format: { type: 'json_object' },
        json_schema: { stale: true },
        custom_include_body: 'seed: 1\nresponse_format:\n  type: json_object',
        stop: ['User:', '用户：'],
    };
    await run(events.CHAT_COMPLETION_SETTINGS_READY, request);
    return request;
};

const request = await armRequest();
if (request.response_format || request.json_schema) throw new Error('一次API仍强制整篇JSON');
if (/response_format/.test(request.custom_include_body) || !/seed:\s*1/.test(request.custom_include_body)) throw new Error('CUSTOM响应格式清理破坏其他请求字段');
if (!Array.isArray(request.stop) || request.stop.length !== 2) throw new Error('正常正文模式错误删除了酒馆停止词');
const contract = request.messages.at(-1)?.content || '';
if (!contract.includes('[Memo-N one-call relay v2]') || !contract.includes(RELAY_TAG_START) || !contract.includes('先按原有预设正常输出完整正文')) {
    throw new Error('尾部隐藏记录协议未正确注入');
}

const first = {
    is_user: false,
    mes: relay('第一轮正常正文', [{ op: 'update', table: 0, row: 0, cells: [{ column: 1, value: '08:02' }] }]),
    swipe_id: 0,
    swipes: [''],
    swipe_info: [{}],
};
currentChat.push(first);
await complete(1);
if (first.mes !== '第一轮正常正文' || first.swipes[0] !== first.mes) throw new Error('首轮正文或Swipe未剥离隐藏记录块');
if (executeCalls.length !== 1 || !executeCalls[0][0].startsWith('updateRow(0,0,')) throw new Error('首轮变更未进入严格事务');

currentChat.push({ is_user: true, mes: '继续行动' });
const secondRequest = await armRequest();
if (secondRequest.response_format || secondRequest.json_schema || !secondRequest.messages.at(-1)?.content.includes(RELAY_TAG_START)) {
    throw new Error('第二轮请求协议发生漂移');
}
const second = {
    is_user: false,
    mes: relay('第二轮正常正文', [{ op: 'insert', table: 4, row: null, cells: [{ column: 0, value: '赶驴老汉' }] }]),
    swipe_id: 0,
    swipes: [''],
    swipe_info: [{}],
};
currentChat.push(second);
await complete(3);
if (second.mes !== '第二轮正常正文' || executeCalls.length !== 2) throw new Error('第二轮正文或记录失败');

currentChat = [previous];
await armRequest();
const reasoningBlock = `${RELAY_TAG_START}\n${JSON.stringify([{ op: 'update', table: 0, row: 0, cells: [{ column: 1, value: '08:15' }] }])}\n${RELAY_TAG_END}`;
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
    mes: `延迟完成正文\n\n${RELAY_TAG_START}\n[`,
    swipe_id: 0,
    swipes: [''],
    swipe_info: [{}],
};
currentChat.push(delayed);
setTimeout(() => {
    delayed.mes = relay('延迟完成正文', [{ op: 'insert', table: 2, row: null, cells: [{ column: 0, value: '钥匙' }] }]);
}, 180);
await complete(1);
if (delayed.mes !== '延迟完成正文' || executeCalls.length !== 4) throw new Error('提前结束事件没有等待隐藏记录块闭合');

currentChat = [previous];
await armRequest();
const plain = { is_user: false, mes: '模型漏写记录块但正文正常', swipe_id: 0, swipes: [''], swipe_info: [{}] };
currentChat.push(plain);
await complete(1);
if (plain.mes !== '模型漏写记录块但正文正常' || executeCalls.length !== 4) throw new Error('漏写记录块时未保留正常正文或错误执行表格');
if (!warnings.some(message => message.includes('未找到Memo-N隐藏记录块'))) throw new Error('漏写记录块缺少明确提示');

currentChat = [{ ...previous, memo_n_hash_sheets: { state: 'continue' } }];
const continuing = currentChat[0];
await armRequest('continue');
continuing.mes = `${continuing.mes}\n\n${relay('续写正文', [])}`;
await complete(0);
if (continuing.mes !== '旧正文\n\n续写正文' || !executeCalls.at(-1)?.includes('NO_CHANGE')) throw new Error('Continue增量拆包或基线处理失败');

currentChat = [previous];
await armRequest();
const invalid = {
    is_user: false,
    mes: relay('非法变更仍保留正文', [{ op: 'INSERT INTO', table: 2, row: null, cells: [] }]),
    swipe_id: 0,
    swipes: [''],
    swipe_info: [{}],
};
currentChat.push(invalid);
await complete(1);
if (invalid.mes !== '非法变更仍保留正文' || invalid.__memoStrictExecution?.ok !== false) throw new Error('非法变更未安全保留正文');

currentChat = [previous];
await armRequest();
const failing = {
    is_user: false,
    mes: relay('保存失败正文', [{ op: 'insert', table: 2, row: null, cells: [{ column: 0, value: '药草' }] }]),
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

console.log('memo-n-engine-integration PASS: normal-content=1, json-mode-removed=1, stop-preserved=1, multi-turn=2, reasoning-machine-channel=1, delayed-close=1, plain-reply-fallback=1, continue=1, invalid-change=1, save-rollback=1');
