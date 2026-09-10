import fs from 'node:fs/promises';

let source = await fs.readFile(new URL('../scripts/runtime/recordOnlyOutputProtocolGuard.js', import.meta.url), 'utf8');
source = source
    .replace("import { EDITOR } from '../../core/manager.js';", 'const { EDITOR } = globalThis.__memoNProtocolMocks;')
    .replace("import LLMApiService from '../../services/llmApi.js';", 'const { LLMApiService } = globalThis.__memoNProtocolMocks;');

class LLMApiService {
    constructor() { this.config = { system_prompt: '' }; }
    async callLLM(prompt) { return prompt; }
}

globalThis.TavernHelper = { async generateRaw(config) { return config; } };
globalThis.__memoNProtocolMocks = {
    EDITOR: { async generateRaw(config) { return config; } },
    LLMApiService,
};

const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#memo-n-output-protocol`);
const {
    PROTOCOL_MARK,
    STRICT_OUTPUT_PROTOCOL,
    injectProtocolIntoConfig,
    injectProtocolIntoMessages,
    isMemoRecordOnlyRequest,
} = module;

const manualMessages = [
    { role: 'system', content: '你是Memo独立表格记录器。# Memo独立记录操作协议' },
    { role: 'user', content: '<当前表格>这里是输入XML分隔结构</当前表格>' },
];
if (!isMemoRecordOnlyRequest({ ordered_prompts: manualMessages })) {
    throw new Error('未识别手动记录请求');
}

const injectedMessages = injectProtocolIntoMessages(manualMessages);
if (!injectedMessages[0].content.includes(PROTOCOL_MARK)) throw new Error('未把唯一输出协议注入system消息');
if (!injectedMessages[0].content.includes('insertRow(1,{"0":"示例角色","11":"青木诀"})')) throw new Error('唯一协议缺少完整标准成品示例');
if (injectedMessages[1].content !== manualMessages[1].content) throw new Error('注入协议时不应改写用户输入资料');

const injectedTwice = injectProtocolIntoMessages(injectedMessages);
const markerCount = injectedTwice.map(item => item?.content || '').join('\n').split(PROTOCOL_MARK).length - 1;
if (markerCount !== 1) throw new Error(`唯一协议重复注入：${markerCount}`);

const noDollar3Request = {
    ordered_prompts: [
        { role: 'system', content: '请整理下面这些状态数据。' },
        { role: 'user', content: '当前状态表 角色状态表 背包表 当前任务与约定表 人物主表 人物发展表 历史事件表；现有规则里可用 insertRow/updateRow/deleteRow。' },
    ],
};
if (!isMemoRecordOnlyRequest(noDollar3Request)) {
    throw new Error('删除$3协议占位后，七表请求仍应被结构签名识别');
}

const cleanupConfig = {
    systemPrompt: '你是Memo世界状态表格整理器。',
    prompt: '<当前七表>...</当前七表>',
};
const cleanupInjected = injectProtocolIntoConfig(cleanupConfig);
if (!cleanupInjected.systemPrompt.includes(PROTOCOL_MARK)) throw new Error('整理请求未注入唯一输出协议');
if (cleanupConfig.systemPrompt.includes(PROTOCOL_MARK)) throw new Error('注入不应原地污染调用方config');

if (!STRICT_OUTPUT_PROTOCOL.includes('只用于分隔输入资料，不属于输出语法')) throw new Error('协议未明确区分输入XML与输出语法');
for (const token of ['insertRow(', 'updateRow(', 'deleteRow(', '<tableEdit><!-- NO_CHANGE --></tableEdit>']) {
    if (!STRICT_OUTPUT_PROTOCOL.includes(token)) throw new Error(`协议缺少标准输出要素：${token}`);
}

const loader = await fs.readFile(new URL('../loader.js', import.meta.url), 'utf8');
const protocolPos = loader.indexOf('./scripts/runtime/recordOnlyOutputProtocolGuard.js');
const transportPos = loader.indexOf('./scripts/runtime/recordOnlyTransportGuard.js');
if (protocolPos < 0 || transportPos < 0 || transportPos >= protocolPos) {
    throw new Error('包装器安装顺序错误：传输兼容层应先安装，唯一格式锁后安装成为最外层');
}
if (!loader.includes('格式锁注入 -> API -> 兼容规范化 -> 严格执行器')) {
    throw new Error('loader未声明实际记录链路顺序');
}
if (!loader.includes("const DISPLAY_VERSION = '0.51'")) throw new Error('loader版本未升级到0.51');

console.log('memo-n output protocol PASS: manual/cleanup forced system protocol, no-$3 signature fallback, idempotent, canonical example present, wrapper composition correct');
