import { changesToStrictCalls, parseRecordEnvelope, parseRelayTaggedEnvelope, RELAY_TAG_START, RELAY_TAG_END } from '../scripts/engine/recordEnvelope.js';

const valid = parseRecordEnvelope(JSON.stringify({
    reply: '正文',
    changes: [
        { op: 'insert', table: 2, row: null, cells: [{ column: 0, value: '钥匙' }, { column: 2, value: 1 }] },
        { op: 'update', table: 0, row: 0, cells: [{ column: 1, value: '08:02' }] },
        { op: 'delete', table: 3, row: 1, cells: [] },
    ],
}));
if (!valid.ok || valid.changes.length !== 3) throw new Error(`合法信封解析失败：${valid.error}`);
const calls = changesToStrictCalls(valid.changes);
if (!calls[0].startsWith('insertRow(2,') || !calls[1].startsWith('updateRow(0,0,') || calls[2] !== 'deleteRow(3,1)') throw new Error('变更对象未正确编译为严格事务调用');

const noChange = parseRecordEnvelope({ reply: '正文', changes: [] });
if (!noChange.ok || !noChange.noChange || changesToStrictCalls(noChange.changes)[0] !== 'NO_CHANGE') throw new Error('空变更未正确归一为NO_CHANGE');

const invalidCases = [
    { reply: '', changes: [] },
    { reply: '正文', changes: [{ op: 'INSERT INTO', table: 0, row: null, cells: [] }] },
    { reply: '正文', changes: [{ op: 'update', table: 0, row: -1, cells: [{ column: 0, value: 'x' }] }] },
    { reply: '正文', changes: [{ op: 'insert', table: 0, row: 0, cells: [{ column: 0, value: 'x' }] }] },
    { reply: '正文', changes: [{ op: 'delete', table: 0, row: 0, cells: [{ column: 0, value: 'x' }] }] },
    { reply: '正文', changes: [{ op: 'insert', table: 0, row: null, cells: [{ column: 0, value: 'x' }, { column: 0, value: 'y' }] }] },
    { reply: '正文', changes: [], extra: true },
];
for (const sample of invalidCases) if (parseRecordEnvelope(sample).ok) throw new Error(`非法信封被接受：${JSON.stringify(sample)}`);

const recoverable = parseRecordEnvelope({ reply: '可保留正文', changes: [{ op: 'INSERT INTO', table: 2, row: null, cells: [] }] });
if (recoverable.ok || recoverable.reply !== '可保留正文') throw new Error('非法变更时未安全保留可确定的reply正文');

const rawControl = `{"reply":"第一行
第二行","changes":[{"op":"insert","table":4,"row":null,"cells":[{"column":0,"value":"甲
乙"}]}]}`;
const normalizedControl = parseRecordEnvelope(rawControl);
if (!normalizedControl.ok || normalizedControl.reply !== '第一行\n第二行' || normalizedControl.changes[0]?.data?.[0] !== '甲\n乙') {
    throw new Error(`字符串内原始控制字符未被无损规范化：${normalizedControl.error}`);
}
if (!changesToStrictCalls(normalizedControl.changes)[0].includes('甲\\n乙')) throw new Error('规范化后的换行未安全编译为严格调用');

const brokenStructure = parseRecordEnvelope(`{"reply":"正文
第二行","changes":[}`);
if (brokenStructure.ok) throw new Error('控制字符规范化错误修复了残缺JSON结构');

const relayChanges = [
    { op: 'update', table: 0, row: 0, cells: [{ column: 1, value: '08:25' }] },
    { op: 'insert', table: 6, row: null, cells: [{ column: 0, value: '12500年01月01日' }, { column: 3, value: '进入后山猎道' }] },
];
const relayRaw = `正常正文\n\n1. 继续前进。\n\n${RELAY_TAG_START}\n${JSON.stringify(relayChanges)}\n${RELAY_TAG_END}`;
const relay = parseRelayTaggedEnvelope(relayRaw);
if (!relay.ok || relay.reply.includes('MEMO_N_CHANGES') || relay.changes.length !== 2 || relay.changes[0]?.data?.[1] !== '08:25') {
    throw new Error(`中转站隐藏记录块解析失败：${relay.error}`);
}

const leadingRelay = parseRelayTaggedEnvelope(`${RELAY_TAG_START}\n${JSON.stringify(relayChanges)}\n${RELAY_TAG_END}\n\n前置块后的正常正文`);
if (!leadingRelay.ok || leadingRelay.reply !== '前置块后的正常正文' || leadingRelay.changes.length !== 2) {
    throw new Error(`前置记录块解析失败：${leadingRelay.error}`);
}

const legacyCommentRelay = parseRelayTaggedEnvelope(`旧正文\n<!--${RELAY_TAG_START}\n[]\n${RELAY_TAG_END}-->`);
if (!legacyCommentRelay.ok || legacyCommentRelay.reply !== '旧正文' || !legacyCommentRelay.noChange) {
    throw new Error(`旧HTML注释记录块兼容失败：${legacyCommentRelay.error}`);
}

const relayNoChange = parseRelayTaggedEnvelope(`正文\n${RELAY_TAG_START}\n[]\n${RELAY_TAG_END}`);
if (!relayNoChange.ok || !relayNoChange.noChange || relayNoChange.reply !== '正文') throw new Error('中转站NO_CHANGE未正确解析');

const reasoningOnly = parseRelayTaggedEnvelope(`${RELAY_TAG_START}\n[]\n${RELAY_TAG_END}`, '正文来自content');
if (!reasoningOnly.ok || reasoningOnly.reply !== '正文来自content') throw new Error('思考区机器块未能与正文安全合并');

const reasoningWithPrefix = parseRelayTaggedEnvelope(`内部思考文本\n${RELAY_TAG_START}\n[]\n${RELAY_TAG_END}`, '仍以content正文为准');
if (!reasoningWithPrefix.ok || reasoningWithPrefix.reply !== '仍以content正文为准') throw new Error('思考区前缀错误覆盖了content正文');

const incompleteRelay = parseRelayTaggedEnvelope(`正文\n${RELAY_TAG_START}\n[]`);
if (incompleteRelay.ok || !/尚未闭合/.test(incompleteRelay.error) || incompleteRelay.reply !== '正文') throw new Error('未闭合中转站记录块未安全等待/保留正文');

const badRelay = parseRelayTaggedEnvelope(`正文\n${RELAY_TAG_START}\n[{"op":"INSERT INTO"}]\n${RELAY_TAG_END}`);
if (badRelay.ok || badRelay.reply !== '正文') throw new Error('非法中转站变更被接受或正文未保留');

console.log('memo-n-envelope PASS: strict-json + leading mobile-safe relay parsing, legacy comment compatibility, no-change, reasoning fallback, incomplete wait, invalid changes rejected');
