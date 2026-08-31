import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

let source = await fs.readFile(new URL('../scripts/engine/recordEngine.js', import.meta.url), 'utf8');
source = source
    .replace("import { APP, BASE, EDITOR, USER } from '../../core/manager.js';", 'const { APP, BASE, EDITOR, USER } = globalThis.__memoNMocks;')
    .replace("import { executeMemoTableEdit, restoreMemoSnapshot, saveMemoSnapshot } from '../runtime/safeTableExecutor.js?v=memon9';", 'const { executeMemoTableEdit, restoreMemoSnapshot, saveMemoSnapshot } = globalThis.__memoNMocks;')
    .replace("import { ROUTE, getProviderRoute, providerDebug } from '../runtime/providerRoute.js';", 'const { ROUTE, getProviderRoute, providerDebug } = globalThis.__memoNMocks;')
    .replace(/import \{[\s\S]*?\} from '\.\/recordEnvelope\.js';/u, 'const { changesToStrictCalls, parseRecordEnvelope, parseRelayTableEditEnvelope, parseRelayTaggedEnvelope } = globalThis.__memoNMocks;');

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
let executeInputs = [];
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
    APP: { event_types: events, eventSource: { on, makeFirst() {}, makeLast() {} } },
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
    executeMemoTableEdit: input => {
        executeInputs.push(structuredClone(input));
        const text = Array.isArray(input) ? input.join('\n') : String(input ?? '');
        const noChange = /\bNO_CHANGE\b/i.test(text);
        return { ok: true, changed: !noChange, noChange, count: noChange ? 0 : 1, error: '' };
    },
};

await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#memo-n-engine-memon76`);

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

// DeepSeek：JSON对象协议保持不变。
reset();
await run(events.GENERATION_STARTED, 'normal', {}, false);
const deepseekRequest = { memo_n_record_provider: 'deepseek', messages: [{ role: 'user', content: '行动' }] };
await run(events.CHAT_COMPLETION_SETTINGS_READY, deepseekRequest);
assert.deepEqual(deepseekRequest.response_format, { type: 'json_object' });
assert.match(deepseekRequest.messages.at(-1)?.content || '', /本轮最终响应只能是一个JSON对象/u);
const deepseekReply = {
    is_user: false,
    mes: JSON.stringify({ reply: 'DeepSeek正常正文', changes: [{ op: 'update', table: 0, row: 0, cells: [{ column: 1, value: '08:02' }] }] }),
    swipe_id: 0,
    swipes: [''],
    swipe_info: [{}],
};
currentChat.push(deepseekReply);
assert.equal(await finishGenerated(1), true);
assert.equal(deepseekReply.mes, 'DeepSeek正常正文');
assert.ok(Array.isArray(executeInputs.at(-1)), 'DeepSeek changes 应编译成严格调用数组');
assert.match(executeInputs.at(-1)?.[0] || '', /^updateRow\(0,0,/u);

// Relay：普通一次API统一为前置tableEdit，并同时强化最后user + final system。
reset();
await run(events.GENERATION_STARTED, 'normal', {}, false);
const relayRequest = {
    memo_n_record_provider: 'relay',
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: '行动' }],
};
await run(events.CHAT_COMPLETION_SETTINGS_READY, relayRequest);
assert.equal(relayRequest.response_format, undefined);
assert.match(relayRequest.messages[0]?.content || '', /<tableEdit>/u, '最后user消息未被前置tableEdit约束强化');
assert.match(relayRequest.messages.at(-1)?.content || '', /第一段必须先给出且只给出一个完整tableEdit机器块/u, 'final system未注入前置tableEdit契约');
assert.equal(globalThis.__memoNLastRequestProbe?.route, 'relay');
assert.equal(globalThis.__memoNLastRequestProbe?.responseMode, 'relay_tableedit_leading');
assert.equal(globalThis.__memoNLastRequestProbe?.lastUserReinforced, true);
assert.equal(globalThis.__memoNLastRequestProbe?.relayTableEditPresent, true);
assert.equal(globalThis.__memoNLastRequestProbe?.finalRole, 'system');

const relayMachine = '<tableEdit><!--\ninsertRow(4,{0:"赶驴老汉"})\n--></tableEdit>';
const relayReply = {
    is_user: false,
    mes: `${relayMachine}\n中转站正常正文`,
    swipe_id: 0,
    swipes: [''],
    swipe_info: [{}],
};
currentChat.push(relayReply);
assert.equal(await finishGenerated(1), true);
assert.equal(relayReply.mes, '中转站正常正文');
assert.equal(relayReply.swipes[0], '中转站正常正文');
assert.equal(executeInputs.at(-1), relayMachine, 'relay必须把完整tableEdit直接交给统一严格执行器');
assert.equal(relayReply.__memoStrictExecution?.ok, true);

// Relay reasoning fallback：正文保留，机器块从当前Swipe reasoning读取。
reset();
await run(events.GENERATION_STARTED, 'normal', {}, false);
await run(events.CHAT_COMPLETION_SETTINGS_READY, { memo_n_record_provider: 'relay', messages: [] });
const reasoningMachine = '<tableEdit><!-- updateRow(0,0,{1:"08:15"}) --></tableEdit>';
const relayReasoning = {
    is_user: false,
    mes: 'reasoning回退正文',
    swipe_id: 0,
    swipes: ['reasoning回退正文'],
    swipe_info: [{ extra: { reasoning: reasoningMachine } }],
};
currentChat.push(relayReasoning);
assert.equal(await finishGenerated(1), true);
assert.equal(relayReasoning.mes, 'reasoning回退正文');
assert.equal(executeInputs.at(-1), reasoningMachine);

// NO_CHANGE：仍通过tableEdit统一执行。
reset();
await run(events.GENERATION_STARTED, 'normal', {}, false);
await run(events.CHAT_COMPLETION_SETTINGS_READY, { memo_n_record_provider: 'relay', messages: [] });
const noChangeMachine = '<tableEdit><!-- NO_CHANGE --></tableEdit>';
const relayNoChange = {
    is_user: false,
    mes: `${noChangeMachine}\n无需变更正文`,
    swipe_id: 0,
    swipes: [''],
    swipe_info: [{}],
};
currentChat.push(relayNoChange);
assert.equal(await finishGenerated(1), true);
assert.equal(relayNoChange.mes, '无需变更正文');
assert.equal(executeInputs.at(-1), noChangeMachine);
assert.equal(relayNoChange.__memoStrictExecution?.noChange, true);

// 缺失tableEdit：正文保留，不猜、不执行、不重试。
const beforeMissingExecuteCount = executeInputs.length;
reset();
await run(events.GENERATION_STARTED, 'normal', {}, false);
await run(events.CHAT_COMPLETION_SETTINGS_READY, { memo_n_record_provider: 'relay', messages: [] });
const relayMissing = { is_user: false, mes: '只有正文，没有机器记录块', swipe_id: 0, swipes: [''], swipe_info: [{}] };
currentChat.push(relayMissing);
assert.equal(await finishGenerated(1), false);
assert.equal(relayMissing.mes, '只有正文，没有机器记录块');
assert.equal(executeInputs.length, beforeMissingExecuteCount);
assert.ok(warnings.some(message => message.includes('未找到中转站tableEdit记录块')));

// memon70-72 tagged JSON 只做旧回复兼容，不是新请求协议。
reset();
await run(events.GENERATION_STARTED, 'normal', {}, false);
await run(events.CHAT_COMPLETION_SETTINGS_READY, { memo_n_record_provider: 'relay', messages: [] });
const legacyTagged = {
    is_user: false,
    mes: `${envelope.RELAY_TAG_START}\n[]\n${envelope.RELAY_TAG_END}\n旧正文`,
    swipe_id: 0,
    swipes: [''],
    swipe_info: [{}],
};
currentChat.push(legacyTagged);
assert.equal(await finishGenerated(1), true);
assert.equal(legacyTagged.mes, '旧正文');
assert.ok(Array.isArray(executeInputs.at(-1)) && executeInputs.at(-1)[0] === 'NO_CHANGE');

// 保存失败仍完整回滚。
reset();
await run(events.GENERATION_STARTED, 'normal', {}, false);
await run(events.CHAT_COMPLETION_SETTINGS_READY, { memo_n_record_provider: 'deepseek', messages: [] });
const saveFailure = {
    is_user: false,
    mes: JSON.stringify({ reply: '保存失败仍保留正文', changes: [{ op: 'insert', table: 2, row: null, cells: [{ column: 0, value: '钥匙' }] }] }),
    swipe_id: 0,
    swipes: [''],
    swipe_info: [{}],
};
currentChat.push(saveFailure);
saveFails = true;
assert.equal(await finishGenerated(1), false);
assert.equal(saveFailure.mes, '保存失败仍保留正文');
assert.equal(saveFailure.__memoStrictExecution?.ok, false);
assert.match(saveFailure.__memoStrictExecution?.error || '', /表格已回滚/u);
assert.ok(errors.some(message => message.includes('Memo-N保存失败')));
assert.ok(restoreCalls.length >= 2);

assert.ok(viewRefreshCalls >= 3);
assert.ok(updateBlockCalls >= 4);
console.log('memo-n-engine-integration PASS: deepseek-json=1, relay-leading-tableedit=1, relay-user-reinforce=1, request-probe=1, relay-reasoning=1, relay-nochange=1, relay-missing-safe=1, legacy-tagged=1, save-rollback=1');
