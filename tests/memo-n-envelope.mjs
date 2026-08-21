import { changesToStrictCalls, parseRecordEnvelope } from '../scripts/engine/recordEnvelope.js';

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

console.log('memo-n-envelope PASS: valid=3, no-change=1, invalid=7, recoverable-body=1, raw-control-normalized=1, broken-structure-rejected=1, SQL-string-impossible=1');
