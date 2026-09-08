import fs from 'node:fs/promises';

const bridge = await fs.readFile(new URL('../scripts/runtime/customDeepSeekStrictToolBridge.js', import.meta.url), 'utf8');
const route = await fs.readFile(new URL('../scripts/runtime/providerRoute.js', import.meta.url), 'utf8');
const loader = await fs.readFile(new URL('../loader.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await fs.readFile(new URL('../manifest.json', import.meta.url), 'utf8'));

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

assert(bridge.includes("const TOOL_NAME = 'memo_n_finish'"), '缺少唯一Memo-N严格工具');
assert(bridge.includes('strict: true'), 'DeepSeek函数没有启用strict模式');
assert(bridge.includes("stealth: true"), 'Memo-N工具必须是stealth，防止酒馆递归第二次API');
assert(bridge.includes('delete data.tool_choice;'), 'DeepSeek V4 thinking请求必须移除tool_choice');
assert(!bridge.includes("data.tool_choice = { type: 'function', function: { name: TOOL_NAME } }"), '不得在DeepSeek V4 thinking模式强制指定tool_choice');
assert(!bridge.includes("data.tool_choice = 'auto'"), '不得向DeepSeek V4 thinking模式发送auto tool_choice');
assert(bridge.includes("url.pathname = '/beta'"), 'DeepSeek strict工具没有切到官方beta端点');
assert(bridge.includes("required: ['reply', 'changes']"), '严格工具缺少reply/changes必填约束');
assert(bridge.includes("required: ['op', 'table', 'row', 'cells']"), '严格变更项字段不完整');
assert(bridge.includes("additionalProperties: false"), '严格工具没有封闭对象额外字段');
assert(bridge.includes('parseRecordEnvelope(parameters)'), '工具参数没有经过现有Memo严格记录校验器');
assert(!bridge.includes("response_format = { type: 'json_object' }"), '不得重新启用会空content的JSON Output');
assert(!bridge.includes("DEEPSEEK_REPLY_PREFIX"), 'CUSTOM严格工具不应再依赖tableEdit前缀续写');

assert(route.includes('export function isOfficialCustomDeepSeek'), '缺少官方CUSTOM DeepSeek识别');
assert(route.includes("return sourceOf(data) === 'deepseek' && !reverseProxyOf(data);"), 'CUSTOM DeepSeek不应再被伪装成native prefix路径');

assert(loader.includes("const RUNTIME_VERSION = '0.41-deepseek-thinking-strict-tool'"), 'loader运行时版本不是0.41');
assert(loader.includes("const DISPLAY_VERSION = '0.41'"), 'loader显示版本不是0.41');
assert(loader.includes("['CUSTOM DeepSeek严格工具单API', './scripts/runtime/customDeepSeekStrictToolBridge.js']"), 'loader没有加载strict tool桥');
assert(!loader.includes("['CUSTOM DeepSeek单API JSON输出', './scripts/runtime/customDeepSeekJsonBridge.js']"), 'loader不应重新加载0.37 JSON Output桥');
assert(manifest.version === '0.41', 'manifest版本不是0.41');

console.log('Memo-N custom DeepSeek V4 thinking strict-tool transport guards passed.');
