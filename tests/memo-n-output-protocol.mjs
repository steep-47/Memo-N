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
if (!injectedMessages[0].content.includes('updateRow(1,0,{"12":"炼丹","15":"青云宗外门弟子"},"")')) throw new Error('非身份表update没有保留一次性API的第4参数空expected');
if (injectedMessages[1].content !== manualMessages[1].content) throw new Error('注入协议时不应改写用户输入资料');

const injectedTwice = injectProtocolIntoMessages(injectedMessages);
const markerCount = injectedTwice.map(item => item?.content || '').join('\n').split(PROTOCOL_MARK).length - 1;
if (markerCount !== 1) throw new Error(`唯一协议重复注入：${markerCount}`);

const customService = new LLMApiService();
const customArrayResult = await customService.callLLM(manualMessages);
if (!Array.isArray(customArrayResult)) throw new Error('自定义API数组请求被错误改成非数组');
if (!String(customArrayResult[0]?.content ?? '').includes(PROTOCOL_MARK)) {
    throw new Error('自定义API messages数组没有实际收到唯一输出协议');
}
if (customArrayResult.at(-1)?.role !== 'user') {
    throw new Error('自定义API协议注入破坏了最后一条user消息');
}
if (customService.config.system_prompt !== '') {
    throw new Error('数组请求不应依赖或污染未被LLMApiService使用的config.system_prompt');
}
if (manualMessages[0].content.includes(PROTOCOL_MARK)) {
    throw new Error('自定义API协议注入不应原地污染调用方messages');
}

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

for (const token of [
    'insertRow(tableIndex:number,data:{[colIndex:number]:string|number})',
    'updateRow(tableIndex:number,rowIndex:number,data:{[colIndex:number]:string|number},expected:string)',
    'deleteRow(tableIndex:number,rowIndex:number,expected:string)',
    'updateRow固定4个参数',
    'deleteRow固定3个参数',
    '<tableEdit><!-- NO_CHANGE --></tableEdit>',
]) {
    if (!STRICT_OUTPUT_PROTOCOL.includes(token)) throw new Error(`协议缺少一次性API统一要素：${token}`);
}

const oneCall = await fs.readFile(new URL('../scripts/engine/recordEngine.js', import.meta.url), 'utf8');
const independent = await fs.readFile(new URL('../scripts/runtime/separateTableUpdate.js', import.meta.url), 'utf8');
for (const token of [
    'insertRow(tableIndex,{columnIndex:"value"})',
    'updateRow(tableIndex,rowIndex,{columnIndex:"value"},"expected")',
    'deleteRow(tableIndex,rowIndex,"expected")',
]) {
    if (!oneCall.includes(token)) throw new Error(`一次性API缺少标准签名：${token}`);
    if (!independent.includes(token)) throw new Error(`独立API没有同步一次性API签名：${token}`);
}
if (!independent.includes('其他表的update/delete也保持相同完整签名，但expected固定填写空字符串""')) {
    throw new Error('独立API没有同步一次性API的非身份表空expected规则');
}
if (!independent.includes('const messages=await buildIndependentMessages')
    || !independent.includes('useMain?await handleMainAPIRequest(messages,null,isSilentMode):await handleCustomAPIRequest(messages,null,true,isSilentMode)')) {
    throw new Error('独立API主地址/自定义地址没有复用同一份messages；provider不应改变记录协议');
}

const loader = await fs.readFile(new URL('../loader.js', import.meta.url), 'utf8');
const protocolPos = loader.indexOf('./scripts/runtime/recordOnlyOutputProtocolGuard.js');
const transportPos = loader.indexOf('./scripts/runtime/recordOnlyTransportGuard.js');
if (protocolPos < 0 || transportPos < 0 || transportPos >= protocolPos) {
    throw new Error('记录包装器安装顺序错误：通用传输层应先安装、统一格式锁后安装');
}
for (const obsolete of ['independentApiTransportSync.js', 'independentApiDataAttributeSync.js']) {
    if (loader.includes(obsolete)) throw new Error(`正式链路不应再加载独立API专用协议适配：${obsolete}`);
}
if (!loader.includes('独立API与一次性API共享同一套函数签名和严格执行规则')) {
    throw new Error('loader没有声明统一协议架构');
}

console.log('memo-n output protocol PASS: independent API differs only by provider; fixed 2/4/3 signatures and strict executor semantics match one-call mode');
