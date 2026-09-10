import fs from 'node:fs/promises';

const engine = await fs.readFile(new URL('../scripts/engine/recordEngine.js', import.meta.url), 'utf8');
const loader = await fs.readFile(new URL('../loader.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await fs.readFile(new URL('../manifest.json', import.meta.url), 'utf8'));

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

assert(engine.includes("const MARKER = '[Memo-N native tableEdit one-call v1]'"), '正常记录未恢复memon72原生tableEdit单API协议');
assert(engine.includes("console.log('[Memo-N] 单次API原生tableEdit记录引擎已加载')"), '缺少memon72稳定记录引擎标记');
assert(engine.includes('reinforcePreviousAssistant'), '缺少跨轮记录格式锚定');
assert(engine.includes('reinforceLastUser'), '缺少本轮输出格式锚定');
assert(engine.includes('parseRelayTableEditEnvelope(content)'), '缺少原生tableEdit解析');
assert(!engine.includes('DEEPSEEK_REPLY_PREFIX'), '稳定链不得重新加入DeepSeek prefix');
assert(!engine.includes('isNativeDeepSeek'), '稳定链不得重新加入DeepSeek prefix路由');
assert(!engine.includes("data.response_format = { type: 'json_object' }"), '稳定链不得重新加入JSON Output');
assert(!engine.includes('memo_n_finish'), '稳定链不得重新加入strict tool');

assert(loader.includes("const RUNTIME_VERSION = '0.51-story-prompt-compaction-1'"), 'loader运行时版本不是0.51精简提示版');
assert(loader.includes("const DISPLAY_VERSION = '0.51'"), 'loader显示版本不是0.51');
assert(loader.includes("['单次API记录引擎', './scripts/engine/recordEngine.js']"), 'loader没有加载单一recordEngine');
assert(!loader.includes("['CUSTOM DeepSeek严格工具单API', './scripts/runtime/customDeepSeekStrictToolBridge.js']"), 'loader不得加载strict tool桥');
assert(!loader.includes("['CUSTOM DeepSeek单API JSON输出', './scripts/runtime/customDeepSeekJsonBridge.js']"), 'loader不得加载JSON Output桥');
assert(manifest.version === '0.51', 'manifest版本不是0.51');

console.log('Memo-N memon72 stable one-call record transport guards passed.');
