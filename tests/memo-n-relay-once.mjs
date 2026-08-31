import fs from 'node:fs';
import assert from 'node:assert/strict';
import {
    changesToStrictCalls,
    parseRelayTaggedEnvelope,
    RELAY_TAG_START,
    RELAY_TAG_END,
} from '../scripts/engine/recordEnvelope.js';

const engine = fs.readFileSync(new URL('../scripts/engine/recordEngine.js', import.meta.url), 'utf8');
const independent = fs.readFileSync(new URL('../scripts/runtime/separateTableUpdate.js', import.meta.url), 'utf8');
const yiyi = fs.readFileSync(new URL('../scripts/yiyi/yiyiMemoryRuntime.js', import.meta.url), 'utf8');
const loader = fs.readFileSync(new URL('../loader.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

// 普通一次 API 的中转站必须走隐藏 JSON changes 块，不再要求正文模型生成 tableEdit。
assert.match(engine, /parseRelayTaggedEnvelope/u, 'recordEngine 必须使用中转站 tagged JSON 解析器');
assert.match(engine, /responseMode:\s*relayMode\s*\?\s*'relay_tagged'/u, '中转站一次 API 必须标记为 relay_tagged');
assert.match(engine, /RELAY_TAG_START/u, '中转站一次 API 提示必须包含记录块起始标记');
assert.match(engine, /RELAY_TAG_END/u, '中转站一次 API 提示必须包含记录块结束标记');
assert.doesNotMatch(engine, /relay_tableedit/u, '普通一次 API 不得退回 relay_tableedit 模式');
assert.doesNotMatch(engine, /parseTableEditEnvelope/u, '普通一次 API 不得保留旧 tableEdit 专用解析器');
assert.doesNotMatch(engine, /未找到中转站tableEdit记录块/u, '旧的中转 tableEdit 缺失错误不得残留在普通一次 API');

// 原插件的独立/手动记录是纯记录请求，继续使用 tableEdit，不跟普通正文协议混用。
assert.match(independent, /getTableEditTag\(rawContent\)/u, '独立记录必须继续解析 tableEdit');
assert.match(independent, /模型必须且只能返回1个<tableEdit>/u, '独立记录必须继续要求唯一 tableEdit');
assert.match(independent, /runIndependentApi/u, '手动/自动独立记录底层执行器必须保留');

// 伊依与中转隐藏块同轮出现时，隐藏记录块必须仍是最终尾部。
assert.match(yiyi, /MEMO_N_CHANGES_V1/u, '伊依写回协议必须认识中转站隐藏记录块');
assert.match(yiyi, /隐藏记录块之前/u, '伊依块必须要求放在中转隐藏记录块之前');

// 实际解析模拟：正文尾部、reasoning fallback、NO_CHANGE、半截块、尾部污染。
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

assert.match(loader, /RUNTIME_VERSION = 'memon70'/u, 'Loader 缓存版本必须为 memon70');
assert.equal(manifest.version, '0.1.0-memon.70', 'manifest 版本必须为 memon70');

console.log('memo-n-relay-once: all assertions passed');
