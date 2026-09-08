import fs from 'node:fs/promises';

let source = await fs.readFile(new URL('../scripts/runtime/providerRoute.js', import.meta.url), 'utf8');
source = source.replace("import { oai_settings } from '/scripts/openai.js';", 'const oai_settings = globalThis.__memoRouteSettings;');

globalThis.__memoRouteSettings = {};
const route = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#memo-custom-deepseek-json-route`);

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const direct = { chat_completion_source: 'custom', custom_url: 'https://api.deepseek.com' };
assert(route.isDirectDeepSeek(direct) === true, '官方CUSTOM DeepSeek没有识别为直连');
assert(route.isOfficialCustomDeepSeek(direct) === true, '官方CUSTOM DeepSeek没有获得JSON Output资格');
assert(route.isNativeDeepSeek(direct) === false, '官方CUSTOM DeepSeek不应再走原生prefix路径');
assert(direct.custom_url === 'https://api.deepseek.com', 'JSON路由不应改写官方CUSTOM地址');

const v1 = { chat_completion_source: 'custom', custom_url: 'https://api.deepseek.com/v1/' };
assert(route.isOfficialCustomDeepSeek(v1) === true, '官方/v1基址没有识别为CUSTOM DeepSeek JSON路由');
assert(route.isNativeDeepSeek(v1) === false, '官方/v1基址不应启用prefix');
assert(v1.custom_url === 'https://api.deepseek.com/v1/', '官方/v1地址被意外改写');

const beta = { chat_completion_source: 'custom', custom_url: 'https://api.deepseek.com/beta/' };
assert(route.isOfficialCustomDeepSeek(beta) === true, '已有beta基址应能被JSON桥恢复为普通Chat Completions路径');
assert(route.isNativeDeepSeek(beta) === false, 'CUSTOM beta不应再获得prefix资格');

const proxy = { chat_completion_source: 'custom', custom_url: 'https://api.deepseek.com', reverse_proxy: 'https://proxy.example' };
assert(route.isOfficialCustomDeepSeek(proxy) === false, '存在反代时不应套用官方CUSTOM JSON路由');

const foreign = { chat_completion_source: 'custom', custom_url: 'https://example.com/v1' };
assert(route.isOfficialCustomDeepSeek(foreign) === false, '非DeepSeek CUSTOM被误启用JSON路由');
assert(route.isNativeDeepSeek(foreign) === false, '非DeepSeek CUSTOM被误启用prefix');

const specialPath = { chat_completion_source: 'custom', custom_url: 'https://api.deepseek.com/special' };
assert(route.isDirectDeepSeek(specialPath) === true, '官方特殊路径仍应识别为DeepSeek直连');
assert(route.isOfficialCustomDeepSeek(specialPath) === false, '未知官方路径不应被强行接管为JSON Output');

const native = { chat_completion_source: 'deepseek', custom_url: 'https://unchanged.example' };
assert(route.isNativeDeepSeek(native) === true, 'SillyTavern原生DeepSeek prefix能力被破坏');
assert(route.isOfficialCustomDeepSeek(native) === false, '原生DeepSeek不应进入CUSTOM JSON桥');

console.log('Memo-N custom DeepSeek JSON route tests passed.');
