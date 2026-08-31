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

// 独立/手动记录继续保留原插件 tableEdit 链。
assert.match(independent, /getTableEditTag\(rawContent\)/u);
assert.match(independent, /模型必须且只能返回1个<tableEdit>/u);
assert.match(independent, /runIndependentApi/u);

// 伊依必须排在最终中转哨兵之前。
assert.match(yiyi, /MEMO_N_CHANGES_V1/u);
assert.match(yiyi, /记录块之前/u);

const changes = [{ op: 'update', table: 0, row: 0, cells: [{ column: 1, value: '08:30' }] }];
const normal = parseRelayTaggedEnvelope(`正常正文\n\n${RELAY_TAG_START}\n${JSON.stringify(changes)}\n${RELAY_TAG_END}`);
assert.equal(normal.ok, true);
assert.equal(normal.reply, '正常正文');
assert.deepEqual(changesToStrictCalls(normal.changes), ['updateRow(0,0,{"1":"08:30"})']);

const noChange = parseRelayTaggedEnvelope(`正文\n${RELAY_TAG_START}\n[]\n${RELAY_TAG_END}`);
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

const polluted = parseRelayTaggedEnvelope(`正文\n${RELAY_TAG_START}\n[]\n${RELAY_TAG_END}\n额外尾巴`);
assert.equal(polluted.ok, false);
assert.match(polluted.error, /后存在额外内容/u);

const missing = parseRelayTaggedEnvelope('只有正文，没有任何机器记录块');
assert.equal(missing.ok, false);
assert.match(missing.error, /未找到中转站记录块/u);
assert.equal(missing.reply, '只有正文，没有任何机器记录块');

assert.match(loader, /RUNTIME_VERSION = 'memon71'/u);
assert.equal(manifest.version, '0.1.0-memon.71');

console.log('memo-n-relay-once: all assertions passed');
