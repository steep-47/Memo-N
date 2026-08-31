import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

let source = await fs.readFile(new URL('../scripts/engine/recordEngine.js', import.meta.url), 'utf8');
source = source
    .replace("import { APP, BASE, EDITOR, USER } from '../../core/manager.js';", 'const { APP, BASE, EDITOR, USER } = globalThis.__memoNMocks;')
    .replace("import { executeMemoTableEdit, restoreMemoSnapshot, saveMemoSnapshot } from '../runtime/safeTableExecutor.js?v=memon9';", 'const { executeMemoTableEdit, restoreMemoSnapshot, saveMemoSnapshot } = globalThis.__memoNMocks;')
    .replace("import { ROUTE, getProviderRoute, providerDebug } from '../runtime/providerRoute.js';", 'const { ROUTE, getProviderRoute, providerDebug } = globalThis.__memoNMocks;')
    .replace(/import \{[\s\S]*?\} from '\.\/recordEnvelope\.js';/u, 'const { changesToStrictCalls, parseRecordEnvelope, parseRelayTaggedEnvelope, RELAY_TAG_START, RELAY_TAG_END } = globalThis.__memoNMocks;');

const envelope = await import('../scripts/engine/recordEnvelope.js');
const handlers = new Map();
const on = (event, handler) => {
    const list = handlers.get(event) || [];
    list.push(handler);
    handlers.set(event, list);
};
const events = {
    GENERATION_STARTED: 'start',
    CHAT_COMPLETION_PROMPT_READY: 'prompt',
    CHAT_COMPLETION_SETTINGS_READY: 'settings',
    CHARACTER_MESSAGE_RENDERED: 'rendered',
    GENERATION_ENDED: 'ended',
};

const previous = {
    is_user: false,
    mes: '旧正文',
    memo_n_hash_sheets: { state: [['before']] },
    swipe_id: 0,
    swipes: ['旧正文'],
    swipe_info: [{}],
};
let currentChat = [previous];
let saveFails = false;
let executeCalls = [];
let restoreCalls = [];
let viewRefreshCalls = 0;
let updateBlockCalls = 0;
let warnings = [];
let errors = [];

const context = {
    get chat() { return currentChat; },
    updateMessageBlock() { updateBlockCalls++; },
};

const ROUTE = Object.freeze({ DEEPSEEK: 'deepseek', RELAY: 'relay' });
const normalizeRoute = value => value === ROUTE.RELAY ? ROUTE.RELAY : ROUTE.DEEPSEEK;

globalThis.__memoNMocks = {
    APP: {
        event_types: events,
        eventSource: { on, makeFirst() {}, makeLast() {} },
    },
    BASE: {
        copyHashSheets: structuredClone,
        getChatSheets: () => [],
        getLastSheetsPiece: () => ({ piece: previous }),
        initHashSheet: () => ({ memo_n_hash_sheets: { state: [['initial']] } }),
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
        saveChat: async () => {
            if (saveFails) throw new Error('injected save failure');
            return true;
        },
    },
    ROUTE,
    getProviderRoute: data => normalizeRoute(data?.memo_n_record_provider),
    providerDebug: data => ({ route: normalizeRoute(data?.memo_n_record_provider), automaticDetection: false }),
    ...envelope,
    restoreMemoSnapshot: snapshot => {
        restoreCalls.push(structuredClone(snapshot));
        return { ok: true, error: '' };
    },
    saveMemoSnapshot: piece => {
        piece.memo_n_hash_sheets = { state: [['saved']] };
        return true;
    },
    executeMemoTableEdit: calls => {
        executeCalls.push(structuredClone(calls));
        const noChange = calls.length === 1 && calls[0] === 'NO_CHANGE';
        return { ok: true, changed: !noChange, noChange, count: noChange ? 0 : calls.length, error: '' };
    },
};

await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#memo-n-engine-memon72`);

const run = async (event, ...args) => {
    for (const handler of handlers.get(event) || []) await handler(...args);
};

async function finishGenerated(chatId) {
    const renderedReturns = [];
    for (const handler of handlers.get(events.CHARACTER_MESSAGE_RENDERED) || []) renderedReturns.push(handler(chatId));
    assert.ok(renderedReturns.every(value => value === undefined), 'CHARACTER_MESSAGE_RENDERED 监听器不得返回 Promise 阻塞 UI');
    await run(events.GENERATION_ENDED);
    const chat = currentChat[chatId];
    assert.ok(chat?.__memoStrictPersistence && typeof chat.__memoStrictPersistence.then === 'function', 'GENERATION_ENDED 必须挂载严格持久化 Promise');
    return await chat.__memoStrictPersistence;
}

function reset() {
    currentChat = [previous];
    saveFails = false;
    warnings = [];
    errors = [];
}

// 1) DeepSeek：手动 route -> JSON 对象协议 -> 严格事务 -> 正文拆包。
reset();
await run(events.GENERATION_STARTED, 'normal', {}, false);
const deepseekRequest = {
    memo_n_record_provider: 'deepseek',
    messages: [{ role: 'user', content: '行动' }],
};
await run(events.CHAT_COMPLETION_SETTINGS_READY, deepseekRequest);
assert.deepEqual(deepseekRequest.response_format, { type: 'json_object' }, 'DeepSeek 必须强制 JSON object');
assert.match(deepseekRequest.messages.at(-1)?.content || '', /本轮最终响应只能是一个JSON对象/u, 'DeepSeek 最终 JSON 契约未注入');

const deepseekReply = {
    is_user: false,
    mes: JSON.stringify({
        reply: 'DeepSeek正常正文',
        changes: [{ op: 'update', table: 0, row: 0, cells: [{ column: 1, value: '08:02' }] }],
    }),
    swipe_id: 0,
    swipes: [''],
    swipe_info: [{}],
};
currentChat.push(deepseekReply);
assert.equal(await finishGenerated(1), true, 'DeepSeek 严格持久化应成功');
assert.equal(deepseekReply.mes, 'DeepSeek正常正文');
assert.equal(deepseekReply.swipes[0], 'DeepSeek正常正文');
assert.match(executeCalls.at(-1)?.[0] || '', /^updateRow\(0,0,/u, 'DeepSeek changes 未进入严格执行器');
assert.equal(deepseekReply.__memoStrictExecution?.ok, true);

// 2) 中转站：前置 tagged JSON + 完整正文；同时强化最后 user 和最终 system。
reset();
await run(events.GENERATION_STARTED, 'normal', {}, false);
const relayRequest = {
    memo_n_record_provider: 'relay',
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: '行动' }],
};
await run(events.CHAT_COMPLETION_SETTINGS_READY, relayRequest);
assert.equal(relayRequest.response_format, undefined, '中转站必须移除 JSON object 强制格式');
const relayContract = relayRequest.messages.at(-1)?.content || '';
assert.match(relayContract, /第一段必须先给出且只给出一个记录块/u, '中转站前置 JSON 契约未注入');
assert.doesNotMatch(relayContract, /<tableEdit>/u, '普通中转一次 API 不得再要求 tableEdit');
assert.match(relayRequest.messages[0]?.content || '', /MEMO_N_CHANGES_V1/u, '最后 user 消息未被中转协议强化');
assert.equal(globalThis.__memoNLastRequestProbe?.route, 'relay');
assert.equal(globalThis.__memoNLastRequestProbe?.lastUserReinforced, true);
assert.equal(globalThis.__memoNLastRequestProbe?.relayTagPresent, true);
assert.equal(globalThis.__memoNLastRequestProbe?.finalRole, 'system');

const relayChanges = [{ op: 'insert', table: 4, row: null, cells: [{ column: 0, value: '赶驴老汉' }] }];
const relayReply = {
    is_user: false,
    mes: `${envelope.RELAY_TAG_START}\n${JSON.stringify(relayChanges)}\n${envelope.RELAY_TAG_END}\n中转站正常正文`,
    swipe_id: 0,
    swipes: [''],
    swipe_info: [{}],
};
currentChat.push(relayReply);
assert.equal(await finishGenerated(1), true, '中转站前置 tagged JSON 严格持久化应成功');
assert.equal(relayReply.mes, '中转站正常正文');
assert.equal(relayReply.swipes[0], '中转站正常正文');
assert.match(executeCalls.at(-1)?.[0] || '', /^insertRow\(4,/u, '中转站 changes 未进入严格执行器');
assert.equal(relayReply.__memoStrictExecution?.ok, true);

// 3) 中转站机器块藏在 reasoning：content 正文仍应保留并写表。
reset();
await run(events.GENERATION_STARTED, 'normal', {}, false);
await run(events.CHAT_COMPLETION_SETTINGS_READY, { memo_n_record_provider: 'relay', messages: [] });
const reasoningChanges = [{ op: 'update', table: 0, row: 0, cells: [{ column: 1, value: '08:15' }] }];
const relayReasoning = {
    is_user: false,
    mes: 'reasoning回退正文',
    swipe_id: 0,
    swipes: ['reasoning回退正文'],
    swipe_info: [{ extra: { reasoning: `${envelope.RELAY_TAG_START}\n${JSON.stringify(reasoningChanges)}\n${envelope.RELAY_TAG_END}` } }],
};
currentChat.push(relayReasoning);
assert.equal(await finishGenerated(1), true, 'reasoning 中的中转记录块应被读取');
assert.equal(relayReasoning.mes, 'reasoning回退正文');
assert.match(executeCalls.at(-1)?.[0] || '', /^updateRow\(0,0,/u);

// 4) 中转站 NO_CHANGE：空数组前置记录块必须安全保存快照，不产生伪变更。
reset();
await run(events.GENERATION_STARTED, 'normal', {}, false);
await run(events.CHAT_COMPLETION_SETTINGS_READY, { memo_n_record_provider: 'relay', messages: [] });
const relayNoChange = {
    is_user: false,
    mes: `${envelope.RELAY_TAG_START}\n[]\n${envelope.RELAY_TAG_END}\n无需变更正文`,
    swipe_id: 0,
    swipes: [''],
    swipe_info: [{}],
};
currentChat.push(relayNoChange);
assert.equal(await finishGenerated(1), true);
assert.equal(relayNoChange.mes, '无需变更正文');
assert.deepEqual(executeCalls.at(-1), ['NO_CHANGE']);
assert.equal(relayNoChange.__memoStrictExecution?.noChange, true);

// 5) 正文正常但机器块缺失：保留正文、不执行、不自动猜写。
const beforeMissingExecuteCount = executeCalls.length;
reset();
await run(events.GENERATION_STARTED, 'normal', {}, false);
await run(events.CHAT_COMPLETION_SETTINGS_READY, { memo_n_record_provider: 'relay', messages: [] });
const relayMissing = {
    is_user: false,
    mes: '只有正文，没有中转机器记录块',
    swipe_id: 0,
    swipes: [''],
    swipe_info: [{}],
};
currentChat.push(relayMissing);
assert.equal(await finishGenerated(1), false, '缺失机器块必须安全失败');
assert.equal(relayMissing.mes, '只有正文，没有中转机器记录块');
assert.equal(executeCalls.length, beforeMissingExecuteCount, '缺失机器块时不得猜测执行任何表格操作');
assert.equal(relayMissing.__memoStrictExecution?.ok, false);
assert.ok(warnings.some(message => message.includes('未找到中转站记录块')), '缺失机器块必须给出明确提示');

// 6) 保存失败：正文保留，严格状态标记失败，并执行快照回滚。
reset();
await run(events.GENERATION_STARTED, 'normal', {}, false);
await run(events.CHAT_COMPLETION_SETTINGS_READY, { memo_n_record_provider: 'deepseek', messages: [] });
const saveFailure = {
    is_user: false,
    mes: JSON.stringify({
        reply: '保存失败仍保留正文',
        changes: [{ op: 'insert', table: 2, row: null, cells: [{ column: 0, value: '钥匙' }] }],
    }),
    swipe_id: 0,
    swipes: [''],
    swipe_info: [{}],
};
currentChat.push(saveFailure);
saveFails = true;
assert.equal(await finishGenerated(1), false, 'saveChat 失败必须返回 false');
assert.equal(saveFailure.mes, '保存失败仍保留正文');
assert.equal(saveFailure.__memoStrictExecution?.ok, false);
assert.match(saveFailure.__memoStrictExecution?.error || '', /表格已回滚/u);
assert.ok(errors.some(message => message.includes('Memo-N保存失败')));
assert.ok(restoreCalls.length >= 2, '保存失败必须进行基线/回滚恢复');

assert.ok(viewRefreshCalls >= 3, '成功写入的变化场景应刷新活动表格视图');
assert.ok(updateBlockCalls >= 4, '成功持久化后应更新对应消息块');

console.log('memo-n-engine-integration PASS: deepseek-json=1, relay-leading-tagged=1, relay-user-reinforce=1, request-probe=1, relay-reasoning=1, relay-nochange=1, relay-missing-safe=1, save-rollback=1');
