import fs from 'node:fs/promises';

let source = await fs.readFile(new URL('../scripts/runtime/providerRoute.js', import.meta.url), 'utf8');
source = source.replace("import { oai_settings } from '/scripts/openai.js';", 'const oai_settings = globalThis.__memoRouteSettings;');

globalThis.__memoRouteSettings = {};
const route = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#memo-custom-deepseek-prefix-route`);

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const direct = { chat_completion_source: 'custom', custom_url: 'https://api.deepseek.com' };
assert(route.isDirectDeepSeek(direct) === true, '官方CUSTOM DeepSeek没有识别为直连');
assert(route.isNativeDeepSeek(direct) === true, '官方CUSTOM DeepSeek没有获得前缀传输资格');
assert(direct.custom_url === 'https://api.deepseek.com/beta', '官方CUSTOM DeepSeek没有切到beta前缀基址');

const v1 = { chat_completion_source: 'custom', custom_url: 'https://api.deepseek.com/v1/' };
assert(route.isNativeDeepSeek(v1) === true, '官方/v1基址没有获得前缀传输资格');
assert(v1.custom_url === 'https://api.deepseek.com/beta', '官方/v1基址没有规范到beta');

const alreadyBeta = { chat_completion_source: 'custom', custom_url: 'https://api.deepseek.com/beta/' };
assert(route.isNativeDeepSeek(alreadyBeta) === true, '已使用beta的官方CUSTOM DeepSeek被错误拒绝');
assert(alreadyBeta.custom_url === 'https://api.deepseek.com/beta', 'beta基址规范化异常');

const proxy = { chat_completion_source: 'custom', custom_url: 'https://api.deepseek.com', reverse_proxy: 'https://proxy.example' };
assert(route.isNativeDeepSeek(proxy) === false, '存在反代时不应改写CUSTOM DeepSeek');
assert(proxy.custom_url === 'https://api.deepseek.com', '存在反代时错误改写了custom_url');

const foreign = { chat_completion_source: 'custom', custom_url: 'https://example.com/v1' };
assert(route.isDirectDeepSeek(foreign) === false, '非DeepSeek CUSTOM被误判为直连DeepSeek');
assert(route.isNativeDeepSeek(foreign) === false, '非DeepSeek CUSTOM被误启用前缀');
assert(foreign.custom_url === 'https://example.com/v1', '非DeepSeek CUSTOM地址被改写');

const specialPath = { chat_completion_source: 'custom', custom_url: 'https://api.deepseek.com/special' };
assert(route.isDirectDeepSeek(specialPath) === true, '官方特殊路径应仍识别为DeepSeek直连');
assert(route.isNativeDeepSeek(specialPath) === false, '未知官方路径不应被强行改成beta');
assert(specialPath.custom_url === 'https://api.deepseek.com/special', '未知官方路径被错误改写');

const native = { chat_completion_source: 'deepseek', custom_url: 'https://unchanged.example' };
assert(route.isNativeDeepSeek(native) === true, '原生DeepSeek前缀能力被破坏');
assert(native.custom_url === 'https://unchanged.example', '原生DeepSeek不应修改custom_url');

console.log('Memo-N custom DeepSeek prefix route tests passed.');
