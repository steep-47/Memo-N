import fs from 'node:fs/promises';

let source = await fs.readFile(new URL('../scripts/engine/recordEngine.js', import.meta.url), 'utf8');
source = source
    .replace("import { APP, BASE, EDITOR, USER } from '../../core/manager.js';", 'const { APP, BASE, EDITOR, USER } = globalThis.__memoNMocks;')
    .replace("import { executeMemoTableEdit, restoreMemoSnapshot, saveMemoSnapshot } from '../runtime/safeTableExecutor.js?v=memon4';", 'const { executeMemoTableEdit, restoreMemoSnapshot, saveMemoSnapshot } = globalThis.__memoNMocks;')
    .replace("import { buildPresetCharacterRule } from './recordPolicy.js';", 'const { buildPresetCharacterRule } = globalThis.__memoNMocks;')
    .replace("import { changesToStrictCalls, parseRecordEnvelope } from './recordEnvelope.js';", 'const { changesToStrictCalls, parseRecordEnvelope } = globalThis.__memoNMocks;');

const { parseRecordEnvelope, changesToStrictCalls } = await import('../scripts/engine/recordEnvelope.js');
const handlers = new Map();
const on = (event, handler) => { const list = handlers.get(event) || []; list.push(handler); handlers.set(event, list); };
const events = { GENERATION_STARTED: 'start', CHAT_COMPLETION_PROMPT_READY: 'prompt', CHAT_COMPLETION_SETTINGS_READY: 'settings', CHARACTER_MESSAGE_RENDERED: 'rendered' };
const previous = { is_user: false, mes: '旧正文', memo_n_hash_sheets: { state: 'before' }, swipe_id: 0, swipes: ['旧正文'], swipe_info: [{}] };
let currentChat = [previous];
let saveFails = false;
let executeCalls = [];
let restoreCalls = [];
let warnings = [];
let errors = [];
const context = { get chat() { return currentChat; }, chatCompletionSettings: { stream_openai: true }, updateMessageBlock() {} };

globalThis.__memoNMocks = {
    APP: { event_types: events, eventSource: { on, makeFirst() {}, makeLast() {} } },
    BASE: {
        copyHashSheets: structuredClone,
        getLastSheetsPiece: () => ({ piece: previous }),
        initHashSheet: () => ({ memo_n_hash_sheets: { state: 'initial' } }),
    },
    EDITOR: { warning: message => warnings.push(String(message)), error: message => errors.push(String(message)) },
    USER: {
        tableBaseSetting: { isExtensionAble: true, isAiReadTable: true, isAiWriteTable: true, injection_mode: 'deep_system', step_by_step: false },
        getSettings: () => ({ memo_n_settings: { independent_record_api_enabled: false, preset_character_policy: 'changes_only' } }),
        getContext: () => context,
        saveChat: async () => { if (saveFails) throw new Error('injected save failure'); return true; },
    },
    buildPresetCharacterRule: () => '预设人物只记录剧情变化',
    parseRecordEnvelope,
    changesToStrictCalls,
    restoreMemoSnapshot: snapshot => { restoreCalls.push(structuredClone(snapshot)); return { ok: true, error: '' }; },
    saveMemoSnapshot: piece => { piece.memo_n_hash_sheets = { state: 'saved' }; return true; },
    executeMemoTableEdit: calls => { executeCalls.push(calls); return { ok: true, changed: calls[0] !== 'NO_CHANGE', noChange: calls[0] === 'NO_CHANGE', count: calls[0] === 'NO_CHANGE' ? 0 : calls.length, error: '' }; },
};

await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#memo-n-engine`);
const run = async (event, ...args) => { for (const handler of handlers.get(event) || []) await handler(...args); };

await run(events.GENERATION_STARTED, 'normal', {}, false);
await run(events.CHAT_COMPLETION_PROMPT_READY, { dryRun: false });
const request = { chat_completion_source: 'custom', custom_url: 'https://proxy.example/v1', messages: [{ role: 'user', content: '行动' }] };
await run(events.CHAT_COMPLETION_SETTINGS_READY, request);
if (!request.custom_include_body.includes('response_format:\n  type: json_object')) throw new Error('自定义端点未强制JSON对象');
if (request.messages.at(-1)?.role !== 'system' || !request.messages.at(-1)?.content.includes('[Memo-N record envelope v1]')) throw new Error('最终系统信封契约未注入');
if (context.chatCompletionSettings.stream_openai !== false) throw new Error('请求发出前过早恢复流式设置');

const reply = { is_user: false, mes: JSON.stringify({ reply: '新正文', changes: [{ op: 'update', table: 0, row: 0, cells: [{ column: 1, value: '08:02' }] }] }), swipe_id: 0, swipes: [''], swipe_info: [{}] };
currentChat.push(reply);
const renderPromise = handlers.get(events.CHARACTER_MESSAGE_RENDERED)?.[0]?.(1);
if (reply.__memoStrictPersistence !== renderPromise) throw new Error('渲染事件未立即暴露保存Promise');
await renderPromise;
if (context.chatCompletionSettings.stream_openai !== true) throw new Error('响应处理时未恢复用户流式设置');
if (reply.mes !== '新正文' || reply.swipes[0] !== '新正文') throw new Error('正文拆包或Swipe正文同步失败');
if (executeCalls.length !== 1 || !executeCalls[0][0].startsWith('updateRow(0,0,')) throw new Error('变更对象未进入严格事务');
if (reply.__memoStrictExecution?.ok !== true || reply.__memoStrictExecution?.engine !== 'Memo-N') throw new Error('真实成功状态未写入');
if (await reply.__memoStrictPersistence !== true) throw new Error('写入提示未绑定真实保存结果');

currentChat = [previous];
await run(events.GENERATION_STARTED, 'normal', {}, false);
await run(events.CHAT_COMPLETION_PROMPT_READY, { dryRun: false });
await run(events.CHAT_COMPLETION_SETTINGS_READY, { chat_completion_source: 'custom', messages: [] });
const delayed = { is_user: false, mes: '{"reply":"延迟完成正文","changes":[', swipe_id: 0, swipes: [''], swipe_info: [{}] };
currentChat.push(delayed);
setTimeout(() => { delayed.mes = JSON.stringify({ reply: '延迟完成正文', changes: [{ op: 'insert', table: 4, row: null, cells: [{ column: 0, value: '赶驴老汉' }] }] }); }, 180);
await run(events.CHARACTER_MESSAGE_RENDERED, 1);
if (delayed.mes !== '延迟完成正文' || delayed.__memoStrictExecution?.ok !== true) throw new Error('提前渲染的半截JSON未等待完整');
if (executeCalls.length !== 2 || !executeCalls[1][0].startsWith('insertRow(4,')) throw new Error('延迟完成的JSON未进入严格事务');

currentChat = [previous];
await run(events.GENERATION_STARTED, 'normal', {}, false);
await run(events.CHAT_COMPLETION_SETTINGS_READY, { chat_completion_source: 'custom', messages: [] });
const reasoningOnly = { is_user: false, mes: '', swipe_id: 0, swipes: [''], swipe_info: [{ extra: { reasoning: JSON.stringify({ reply: '思考区拆出的正常正文', changes: [{ op: 'update', table: 0, row: 0, cells: [{ column: 1, value: '08:15' }] }] }) } }] };
currentChat.push(reasoningOnly);
await run(events.CHARACTER_MESSAGE_RENDERED, 1);
if (reasoningOnly.mes !== '思考区拆出的正常正文' || reasoningOnly.swipes[0] !== reasoningOnly.mes) throw new Error('未从当前Swipe思考区拆出正文');
if (executeCalls.length !== 3 || !executeCalls[2][0].startsWith('updateRow(0,0,')) throw new Error('思考区JSON未进入严格事务');

currentChat = [previous];
await run(events.GENERATION_STARTED, 'normal', {}, false);
await run(events.CHAT_COMPLETION_SETTINGS_READY, { chat_completion_source: 'custom', messages: [] });
const rawControlReasoning = { is_user: false, mes: '', swipe_id: 0, swipes: [''], swipe_info: [{ extra: { reasoning: `{"reply":"含原始换行的
正常正文","changes":[{"op":"update","table":0,"row":0,"cells":[{"column":1,"value":"08:16"}]}]}` } }] };
currentChat.push(rawControlReasoning);
await run(events.CHARACTER_MESSAGE_RENDERED, 1);
if (rawControlReasoning.mes !== '含原始换行的\n正常正文' || rawControlReasoning.__memoStrictExecution?.ok !== true) throw new Error('思考区字符串内原始换行未被规范化并拆包');
if (executeCalls.length !== 4 || !executeCalls[3][0].startsWith('updateRow(0,0,')) throw new Error('规范化后的思考区JSON未进入严格事务');

await run(events.GENERATION_STARTED, 'normal', {}, false);
await run(events.CHAT_COMPLETION_SETTINGS_READY, { chat_completion_source: 'custom', messages: [] });
const foreignChat = [];
currentChat = foreignChat;
await run(events.CHARACTER_MESSAGE_RENDERED, 0);
if (executeCalls.length !== 4) throw new Error('切换聊天后仍执行旧任务');

currentChat = [previous];
await run(events.GENERATION_STARTED, 'normal', {}, false);
await run(events.CHAT_COMPLETION_SETTINGS_READY, { chat_completion_source: 'custom', messages: [] });
const invalidChange = { is_user: false, mes: JSON.stringify({ reply: '非法变更仍保留正文', changes: [{ op: 'INSERT INTO', table: 2, row: null, cells: [] }] }), swipe_id: 0, swipes: [''], swipe_info: [{}] };
currentChat.push(invalidChange);
await run(events.CHARACTER_MESSAGE_RENDERED, 1);
if (invalidChange.mes !== '非法变更仍保留正文' || invalidChange.swipes[0] !== invalidChange.mes) throw new Error('非法变更未安全保留正文');
if (executeCalls.length !== 4 || invalidChange.__memoStrictExecution?.ok !== false) throw new Error('非法变更被执行或未标记失败');

currentChat = [previous];
await run(events.GENERATION_STARTED, 'normal', {}, false);
await run(events.CHAT_COMPLETION_SETTINGS_READY, { chat_completion_source: 'custom', messages: [] });
const failing = { is_user: false, mes: JSON.stringify({ reply: '保存失败正文', changes: [{ op: 'insert', table: 2, row: null, cells: [{ column: 0, value: '钥匙' }] }] }), swipe_id: 0, swipes: [''], swipe_info: [{}] };
currentChat.push(failing);
saveFails = true;
await run(events.CHARACTER_MESSAGE_RENDERED, 1);
if (failing.mes !== '保存失败正文') throw new Error('保存失败时正文未保留');
if (failing.__memoStrictExecution?.ok !== false || !failing.__memoStrictExecution?.error.includes('表格已回滚')) throw new Error('保存失败未标记事务回滚');
if (!errors.some(message => message.includes('Memo-N保存失败'))) throw new Error('保存失败未显示严重错误提示');
if (restoreCalls.length < 3) throw new Error('保存失败没有执行基线恢复');

console.log('memo-n-engine-integration PASS: custom-json=1, final-system=1, stream-hold=1, partial-wait=1, reasoning-channel=1, raw-control-normalized=1, unpack=1, strict-transaction=4, swipe-sync=1, session-cancel=1, save-rollback=1');
