import fs from 'node:fs';
import assert from 'node:assert/strict';
import {
    parseRelayTableEditEnvelope,
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

// memon73：普通一次 API 的中转站重新与独立/手动记录统一为 tableEdit。
assert.match(engine, /parseRelayTableEditEnvelope/u);
assert.match(engine, /responseMode:\s*relayMode\s*\?\s*'relay_tableedit'/u);
assert.match(engine, /统一走前置tableEdit/u);
assert.match(engine, /reinforceRelayLastUser/u);
assert.match(engine, /relayTableEditPresent/u);
assert.doesNotMatch(engine, /responseMode:\s*relayMode\s*\?\s*'relay_tagged'/u);

// tagged JSON 只允许保留为 memon70-72 旧回复兼容，不得再作为新请求契约。
assert.match(envelopeSource, /仅保留兼容解析/u);
assert.match(engine, /仅兼容 memon70-72/u);
assert.match(engine, /parseRelayTaggedEnvelope/u);
assert.equal(RELAY_TAG_START, 'MEMO_N_CHANGES_V1');
assert.equal(RELAY_TAG_END, 'MEMO_N_CHANGES_END');

// 独立/手动记录继续使用原插件 tableEdit，因此中转 API 记录协议是一致的。
assert.match(independent, /getTableEditTag\(rawContent\)/u);
assert.match(independent, /模型必须且只能返回1个<tableEdit>/u);
assert.match(independent, /runIndependentApi/u);

// 伊依必须位于前置 tableEdit 之后的正常正文内。
assert.match(yiyi, /中转站普通一次API/u);
assert.match(yiyi, /先输出并闭合前置<tableEdit>/u);
assert.match(yiyi, /绝不能放到前置<tableEdit>之前/u);

const longReply = '第一段剧情。\n\n' + '很长的正文。'.repeat(500) + '\n\n1. 选项一\n2. 选项二';
const machine = '<tableEdit><!--\nupdateRow(0,0,{1:"08:30"})\n--></tableEdit>';

// 新协议：tableEdit 在开头，长正文在后面。解析后只留下正文，机器块完整交给严格执行器。
const leading = parseRelayTableEditEnvelope(`${machine}\n${longReply}`);
assert.equal(leading.ok, true);
assert.equal(leading.reply, longReply);
assert.equal(leading.tableEdit, machine);
assert.equal(leading.noChange, false);

// YiYi 块属于正常正文，中转解析器不得误删。
const yiyiBlock = '<yiyiMemory>{"add":[],"update":[],"relationship":{},"emotion":{},"self":{}}</yiyiMemory>';
const withYiYi = parseRelayTableEditEnvelope(`<tableEdit><!-- NO_CHANGE --></tableEdit>\n正文\n${yiyiBlock}`);
assert.equal(withYiYi.ok, true);
assert.equal(withYiYi.reply, `正文\n${yiyiBlock}`);
assert.equal(withYiYi.noChange, true);

// 兼容模型偶尔仍把 tableEdit 放尾部或中间：都能剥离并保留可见正文。
const trailing = parseRelayTableEditEnvelope(`正常正文\n\n${machine}`);
assert.equal(trailing.ok, true);
assert.equal(trailing.reply, '正常正文');

const middle = parseRelayTableEditEnvelope(`正文前半\n${machine}\n正文后半`);
assert.equal(middle.ok, true);
assert.equal(middle.reply, '正文前半\n\n正文后半');

// reasoning fallback 可传入正文作为 fallbackReply。
const reasoning = parseRelayTableEditEnvelope('<tableEdit><!-- NO_CHANGE --></tableEdit>', '正文来自content');
assert.equal(reasoning.ok, true);
assert.equal(reasoning.reply, '正文来自content');
assert.equal(reasoning.noChange, true);

const incomplete = parseRelayTableEditEnvelope('正文\n<tableEdit><!-- updateRow(0,0,{1:"08:30"})');
assert.equal(incomplete.ok, false);
assert.match(incomplete.error, /尚未闭合/u);
assert.equal(incomplete.reply, '正文');

const duplicate = parseRelayTableEditEnvelope('<tableEdit><!-- NO_CHANGE --></tableEdit>\n正文\n<tableEdit><!-- NO_CHANGE --></tableEdit>');
assert.equal(duplicate.ok, false);
assert.match(duplicate.error, /重复/u);
assert.equal(duplicate.reply, '正文');

const missing = parseRelayTableEditEnvelope('只有正文，没有任何机器记录块');
assert.equal(missing.ok, false);
assert.match(missing.error, /未找到中转站tableEdit记录块/u);
assert.equal(missing.reply, '只有正文，没有任何机器记录块');

// memon70-72 tagged JSON 旧回复仍可读，避免升级后旧未完成消息失去兼容。
const legacy = parseRelayTaggedEnvelope(`${RELAY_TAG_START}\n[]\n${RELAY_TAG_END}\n旧正文`);
assert.equal(legacy.ok, true);
assert.equal(legacy.reply, '旧正文');
assert.equal(legacy.noChange, true);

assert.match(loader, /RUNTIME_VERSION = 'memon73'/u);
assert.equal(manifest.version, '0.1.0-memon.73');

console.log('memo-n-relay-once: all assertions passed');
