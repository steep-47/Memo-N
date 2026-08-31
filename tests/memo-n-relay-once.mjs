import fs from 'node:fs';
import assert from 'node:assert/strict';
import {
    changesToStrictCalls,
    parseRelayTaggedEnvelope,
    RELAY_TAG_START,
    RELAY_TAG_END,
} from '../scripts/engine/recordEnvelope.js';

const engine = fs.readFileSync(new URL('../scripts/engine/recordEngine.js', import.meta.url), 'utf8');
const envelopeSource = fs.readFileSync(new URL('../scripts/engine/recordEnvelope.js', import.meta.url), 'utf8');
const independent = fs.readFileSync(new URL('../scripts/runtime/separateTableUpdate.js', import.meta.url), 'utf8');
const yiyi = fs.readFileSync(new URL('../scripts/yiyi/yiyiMemoryRuntime.js', import.meta.url), 'utf8');
const loader = fs.readFileSync(new URL('../loader.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

assert.match(engine, /parseRelayTaggedEnvelope/u);
assert.match(engine, /responseMode:\s*relayMode\s*\?\s*'relay_tagged'/u);
assert.doesNotMatch(engine, /relay_tableedit/u);
assert.doesNotMatch(engine, /parseTableEditEnvelope/u);

// 中转哨兵必须是普通文本，不能使用可能被 SillyTavern/Markdown/主题渲染链清掉的 HTML comment。
assert.equal(RELAY_TAG_START, 'MEMO_N_CHANGES_V1');
assert.equal(RELAY_TAG_END, 'MEMO_N_CHANGES_END');
assert.doesNotMatch(envelopeSource, /const RELAY_TAG_START = '<!--/u);
assert.doesNotMatch(envelopeSource, /const RELAY_TAG_END = '.*-->'/u);

// memon72：长正文前先输出机器记录块，并在最后 user 消息再强化一次，避免 relay 弱化 system 指令。
assert.match(engine, /第一段必须先输出且只输出一个Memo-N记录块/u);
assert.match(engine, /reinforceRelayLastUser/u);
assert.match(engine, /lastUserReinforced/u);
assert.match(engine, /__memoNLastRequestProbe/u);

// 独立/手动记录继续保留原插件 tableEdit 链。
assert.match(independent, /getTableEditTag\(rawContent\)/u);
assert.match(independent, /模型必须且只能返回1个<tableEdit>/u);
assert.match(independent, /runIndependentApi/u);

// 伊依在前置中转记录块闭合之后，作为正常正文的一部分写回。
assert.match(yiyi, /中转站前置记录块/u);
assert.match(yiyi, /先输出并闭合该记录块/u);
assert.match(yiyi, /属于正常正文的一部分/u);

const changes = [{ op: 'update', table: 0, row: 0, cells: [{ column: 1, value: '08:30' }] }];

// 新协议：机器块在开头，长正文在后面。解析后只留下正文。
const longReply = '第一段剧情。\n\n' + '很长的正文。'.repeat(500) + '\n\n1. 选项一\n2. 选项二';
const leading = parseRelayTaggedEnvelope(`${RELAY_TAG_START}\n${JSON.stringify(changes)}\n${RELAY_TAG_END}\n${longReply}`);
assert.equal(leading.ok, true);
assert.equal(leading.reply, longReply);
assert.deepEqual(changesToStrictCalls(leading.changes), ['updateRow(0,0,{"1":"08:30"})']);

// 伊依块位于正常正文内部时，中转解析器不得误删它；后续伊依运行时再单独处理。
const yiyiBlock = '<yiyiMemory>{"add":[],"update":[],"relationship":{},"emotion":{},"self":{}}</yiyiMemory>';
const withYiYi = parseRelayTaggedEnvelope(`${RELAY_TAG_START}\n[]\n${RELAY_TAG_END}\n正文\n${yiyiBlock}`);
assert.equal(withYiYi.ok, true);
assert.equal(withYiYi.reply, `正文\n${yiyiBlock}`);

// 兼容 memon71/旧回复：机器块在尾部仍然可解析。
const trailing = parseRelayTaggedEnvelope(`正常正文\n\n${RELAY_TAG_START}\n${JSON.stringify(changes)}\n${RELAY_TAG_END}`);
assert.equal(trailing.ok, true);
assert.equal(trailing.reply, '正常正文');

// 记录块位于正文中间也能安全剥离并拼回可见文本。
const middle = parseRelayTaggedEnvelope(`正文前半\n${RELAY_TAG_START}\n[]\n${RELAY_TAG_END}\n正文后半`);
assert.equal(middle.ok, true);
assert.equal(middle.reply, '正文前半\n\n正文后半');
assert.equal(middle.noChange, true);

const noChange = parseRelayTaggedEnvelope(`${RELAY_TAG_START}\n[]\n${RELAY_TAG_END}\n正文`);
assert.equal(noChange.ok, true);
assert.equal(noChange.noChange, true);
assert.deepEqual(changesToStrictCalls(noChange.changes), ['NO_CHANGE']);

const reasoning = parseRelayTaggedEnvelope(`${RELAY_TAG_START}\n[]\n${RELAY_TAG_END}`, '正文来自content');
assert.equal(reasoning.ok, true);
assert.equal(reasoning.reply, '正文来自content');

const incomplete = parseRelayTaggedEnvelope(`正文\n${RELAY_TAG_START}\n[]`);
assert.equal(incomplete.ok, false);
assert.match(incomplete.error, /尚未闭合/u);
assert.equal(incomplete.reply, '正文');

const duplicate = parseRelayTaggedEnvelope(`${RELAY_TAG_START}\n[]\n${RELAY_TAG_END}\n正文\n${RELAY_TAG_START}\n[]\n${RELAY_TAG_END}`);
assert.equal(duplicate.ok, false);
assert.match(duplicate.error, /重复/u);

const missing = parseRelayTaggedEnvelope('只有正文，没有任何机器记录块');
assert.equal(missing.ok, false);
assert.match(missing.error, /未找到中转站记录块/u);
assert.equal(missing.reply, '只有正文，没有任何机器记录块');

assert.match(loader, /RUNTIME_VERSION = 'memon72'/u);
assert.equal(manifest.version, '0.1.0-memon.72');

console.log('memo-n-relay-once: all assertions passed');
