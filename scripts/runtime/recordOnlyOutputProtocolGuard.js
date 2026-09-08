import { EDITOR } from '../../core/manager.js';
import LLMApiService from '../../services/llmApi.js';

const PATCH_MARK = '__memoNRecordOnlyOutputProtocolGuardV2';
const PROTOCOL_MARK = '[Memo-N唯一输出格式v1]';
const MEMO_TABLE_NAMES = ['当前状态表','角色状态表','背包表','当前任务与约定表','人物主表','人物发展表','历史事件表'];

const STRICT_OUTPUT_PROTOCOL = `# ${PROTOCOL_MARK}
这是记录专用请求的最终输出格式约束，优先于模板中其他格式示例。

输入中的 <当前七表>、<最近聊天>、<聊天记录>、<当前表格>、<表头信息> 等标签只用于分隔输入资料，不属于输出语法，也不要照它们的XML结构生成操作。

最终回复只采用这一种结构：一个 <tableEdit> 外壳，内部一个HTML注释；注释中每个非空行是一条标准函数调用。

标准成品示例：
<tableEdit><!--
insertRow(1,{"0":"示例角色","11":"青木诀"})
updateRow(1,0,{"12":"炼丹","15":"青云宗外门弟子"})
deleteRow(3,0)
--></tableEdit>

仅使用以下三种函数签名：
insertRow(tableIndex:number,data:{[colIndex:number]:string|number})
updateRow(tableIndex:number,rowIndex:number,data:{[colIndex:number]:string|number})
deleteRow(tableIndex:number,rowIndex:number)

data直接写成函数的JSON对象参数，列键使用数字索引或当前表中完全一致的真实表头名。输出层不使用 <tableIndex>、<operation>、<action>、<data>、<col0> 等操作标签，也不把函数再改写成XML。

没有任何操作时，完整输出：
<tableEdit><!-- NO_CHANGE --></tableEdit>

最终回复只包含这一个完整tableEdit记录块，不附加解释、剧情、Markdown代码围栏或第二种表示法。`;

function requestText(value) {
    if (Array.isArray(value)) return value.map(item => requestText(item)).join('\n');
    if (!value || typeof value !== 'object') return String(value ?? '');
    if (typeof value.content === 'string') return value.content;
    return [value.systemPrompt, value.system_prompt, value.prompt, value.ordered_prompts, value.messages]
        .map(item => requestText(item))
        .filter(Boolean)
        .join('\n');
}

function looksLikeMemoSevenTableRequest(text) {
    const source = String(text ?? '');
    const tableHits = MEMO_TABLE_NAMES.reduce((count, name) => count + (source.includes(name) ? 1 : 0), 0);
    if (tableHits < 5) return false;
    return /(?:insertRow|updateRow|deleteRow|tableEdit|rowIndex|colIndex)/i.test(source);
}

function isMemoRecordOnlyRequest(value) {
    const text = requestText(value);
    return text.includes('Memo独立表格记录器')
        || text.includes('[Memo七表独立记录')
        || text.includes('# Memo独立记录操作协议')
        || text.includes('Memo世界状态表格整理器')
        || looksLikeMemoSevenTableRequest(text);
}

function appendProtocol(value) {
    const text = String(value ?? '').trim();
    if (text.includes(PROTOCOL_MARK)) return text;
    return text ? `${text}\n\n${STRICT_OUTPUT_PROTOCOL}` : STRICT_OUTPUT_PROTOCOL;
}

function injectProtocolIntoMessages(messages) {
    const list = Array.isArray(messages)
        ? messages.map(message => (message && typeof message === 'object' ? { ...message } : message))
        : [];
    if (requestText(list).includes(PROTOCOL_MARK)) return list;

    const systemIndex = list.findIndex(message => String(message?.role ?? '').toLowerCase() === 'system');
    if (systemIndex >= 0) {
        list[systemIndex] = {
            ...list[systemIndex],
            content: appendProtocol(list[systemIndex]?.content),
        };
    } else {
        list.unshift({ role: 'system', content: STRICT_OUTPUT_PROTOCOL });
    }
    return list;
}

function injectProtocolIntoConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) return config;
    if (requestText(config).includes(PROTOCOL_MARK)) return config;

    const next = { ...config };
    if (Array.isArray(next.ordered_prompts)) {
        next.ordered_prompts = injectProtocolIntoMessages(next.ordered_prompts);
        return next;
    }
    if (Array.isArray(next.messages)) {
        next.messages = injectProtocolIntoMessages(next.messages);
        return next;
    }
    if (Object.prototype.hasOwnProperty.call(next, 'systemPrompt') || Object.prototype.hasOwnProperty.call(next, 'prompt')) {
        next.systemPrompt = appendProtocol(next.systemPrompt);
        return next;
    }
    if (Object.prototype.hasOwnProperty.call(next, 'system_prompt')) {
        next.system_prompt = appendProtocol(next.system_prompt);
        return next;
    }
    return next;
}

function patchGenerateRaw(target, key, channel) {
    if (!target || typeof target[key] !== 'function') return false;
    const current = target[key];
    if (current[PATCH_MARK]) return true;

    const wrapped = async function (...args) {
        const guarded = isMemoRecordOnlyRequest(args?.[0]);
        if (!guarded) return await current.apply(this, args);
        const nextArgs = [...args];
        nextArgs[0] = injectProtocolIntoConfig(args?.[0]);
        console.log(`[Memo-N][output-protocol] ${channel} 已强制注入唯一tableEdit函数格式`);
        return await current.apply(this, nextArgs);
    };
    Object.defineProperty(wrapped, PATCH_MARK, { value: true });
    target[key] = wrapped;
    return target[key] === wrapped || target[key]?.[PATCH_MARK] === true;
}

function patchCustomApi() {
    const proto = LLMApiService?.prototype;
    if (!proto || typeof proto.callLLM !== 'function') return false;
    const current = proto.callLLM;
    if (current[PATCH_MARK]) return true;

    const wrapped = async function (...args) {
        const combined = [this?.config?.system_prompt ?? '', args?.[0]];
        if (!isMemoRecordOnlyRequest(combined)) return await current.apply(this, args);

        const config = this?.config;
        if (!config || typeof config !== 'object') {
            const nextArgs = [...args];
            nextArgs[0] = appendProtocol(args?.[0]);
            return await current.apply(this, nextArgs);
        }

        const originalSystem = config.system_prompt;
        config.system_prompt = appendProtocol(originalSystem);
        try {
            console.log('[Memo-N][output-protocol] 自定义API 已强制注入唯一tableEdit函数格式');
            return await current.apply(this, args);
        } finally {
            config.system_prompt = originalSystem;
        }
    };
    Object.defineProperty(wrapped, PATCH_MARK, { value: true });
    proto.callLLM = wrapped;
    return proto.callLLM === wrapped || proto.callLLM?.[PATCH_MARK] === true;
}

function install() {
    const editor = patchGenerateRaw(EDITOR, 'generateRaw', 'EDITOR.generateRaw');
    const custom = patchCustomApi();
    const patchTavern = () => patchGenerateRaw(globalThis.TavernHelper, 'generateRaw', 'TavernHelper.generateRaw');
    const tavern = patchTavern();
    if (!tavern) {
        let tries = 0;
        const retry = setInterval(() => {
            tries += 1;
            if (patchTavern() || tries >= 20) clearInterval(retry);
        }, 500);
    }
    console.log(`[Memo-N] 记录专用唯一输出协议已加载：EDITOR=${editor} TavernHelper=${tavern} CustomAPI=${custom}`);
}

install();

export {
    MEMO_TABLE_NAMES,
    PROTOCOL_MARK,
    STRICT_OUTPUT_PROTOCOL,
    appendProtocol,
    injectProtocolIntoConfig,
    injectProtocolIntoMessages,
    isMemoRecordOnlyRequest,
    looksLikeMemoSevenTableRequest,
};
