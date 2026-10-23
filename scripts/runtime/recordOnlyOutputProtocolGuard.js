import { EDITOR } from '../../core/manager.js';
import LLMApiService from '../../services/llmApi.js';
import { RECORD_SEMANTICS_MARK, RECORD_SEMANTICS_RULE } from './recordSemantics.js';

const PATCH_MARK = '__memoNRecordOnlyOutputProtocolGuardV9';
const PROTOCOL_MARK = '[Memo-N唯一输出格式v4]';
const TRANSPORT_MARK = '# Memo独立记录操作协议';
const CLEANUP_MARKER = 'Memo世界状态表格整理器';
const REDUNDANCY_MARKER = 'Memo冗余合并专用整理器';
const MEMO_TABLE_NAMES = ['当前状态表','角色状态表','背包表','当前任务与约定表','人物主表','人物发展表','历史事件表'];

const STRICT_OUTPUT_PROTOCOL = `# ${PROTOCOL_MARK}
${TRANSPORT_MARK}
这是记录专用请求的最终输出格式约束。独立API与一次性API使用同一套记录函数协议；独立API只改变API地址/Key/model，不改变函数签名、对象核对规则或严格执行规则。

输入中的 <当前七表>、<最近聊天>、<聊天记录>、<当前表格>、<表头信息> 等标签只用于分隔输入资料，不属于输出语法，也不要照它们的XML结构生成操作。

最终回复只采用这一种结构：一个 <tableEdit> 外壳，内部一个HTML注释；注释中每个非空行是一条标准函数调用。

标准成品示例：
<tableEdit><!--
insertRow(1,{"0":"示例角色","11":"青木诀"})
updateRow(1,0,{"12":"炼丹","15":"青云宗外门弟子"},"")
updateRow(4,0,{"5":"练气士"},"老叔公")
deleteRow(2,1,"蛐蛐罐")
--></tableEdit>

统一函数签名，与一次性API完全一致：
insertRow(tableIndex:number,data:{[colIndex:number]:string|number})
updateRow(tableIndex:number,rowIndex:number,data:{[colIndex:number]:string|number},expected:string)
deleteRow(tableIndex:number,rowIndex:number,expected:string)
insertRow固定2个参数；updateRow固定4个参数；deleteRow固定3个参数。禁止输出第5个参数，也禁止省略update/delete的expected参数。

表2背包、表4人物主表、表5人物发展表的expected必须原样抄写执行前当前目标row第一列对象名，不能写计划修改后的名称，也不能根据旧聊天猜。其他表的update/delete也使用完全相同的完整签名，但expected固定填写空字符串""。表2/4/5新增对象时，insertRow的data第0列必须写对象名。

背包库存数量归零或确认全部售出、耗尽、全部交付、不再持有时使用deleteRow；不得只update数量0并保留旧库存。部分消耗保留剩余数量；可重复使用物品不因使用而删除；未知数量不猜删。

字符串内容需要引用词语时优先使用中文「」；英文双引号必须正确转义，不得把内层引号直接嵌进双引号字符串。

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

function isMemoCleanupRequest(value) {
    return requestText(value).includes(CLEANUP_MARKER);
}

function isMemoRedundancyRequest(value) {
    return requestText(value).includes(REDUNDANCY_MARKER);
}

function shouldIncludeRecordSemantics(value) {
    return !isMemoCleanupRequest(value) && !isMemoRedundancyRequest(value);
}

function isMemoRecordOnlyRequest(value) {
    const text = requestText(value);
    return text.includes('Memo独立表格记录器')
        || text.includes('[Memo七表独立记录')
        || text.includes(TRANSPORT_MARK)
        || text.includes(CLEANUP_MARKER)
        || text.includes(REDUNDANCY_MARKER)
        || looksLikeMemoSevenTableRequest(text);
}

function appendRecordSemantics(value) {
    const text = String(value ?? '').trim();
    if (text.includes(RECORD_SEMANTICS_MARK)) return text;
    return text ? `${text}\n\n${RECORD_SEMANTICS_RULE}` : RECORD_SEMANTICS_RULE;
}

function stripRecordSemantics(value) {
    let text = String(value ?? '');
    if (!text.includes(RECORD_SEMANTICS_MARK)) return text;
    text = text.replace(RECORD_SEMANTICS_RULE, '');
    return text.replace(/\n{3,}/g, '\n\n').trimEnd();
}

function appendProtocol(value, { includeRecordSemantics = true } = {}) {
    let text = String(value ?? '').trim();
    if (!text.includes(PROTOCOL_MARK)) {
        text = text ? `${text}\n\n${STRICT_OUTPUT_PROTOCOL}` : STRICT_OUTPUT_PROTOCOL;
    }
    return includeRecordSemantics ? appendRecordSemantics(text) : text;
}

function keepFinalUser(messages) {
    const list = Array.isArray(messages) ? messages : [];
    let userIndex = -1;
    for (let index = list.length - 1; index >= 0; index--) {
        if (String(list[index]?.role ?? '').toLowerCase() === 'user') {
            userIndex = index;
            break;
        }
    }
    if (userIndex < 0 || userIndex === list.length - 1) return list;
    const trailing = list.splice(userIndex + 1);
    const [user] = list.splice(userIndex, 1);
    list.push(...trailing, user);
    return list;
}

function placeRecordSemanticsBeforeFinalUser(messages) {
    const list = Array.isArray(messages) ? messages : [];
    let userIndex = -1;
    for (let index = list.length - 1; index >= 0; index--) {
        if (String(list[index]?.role ?? '').toLowerCase() === 'user') {
            userIndex = index;
            break;
        }
    }

    for (let index = 0; index < list.length; index++) {
        if (String(list[index]?.role ?? '').toLowerCase() !== 'system') continue;
        if (!String(list[index]?.content ?? '').includes(RECORD_SEMANTICS_MARK)) continue;
        list[index] = { ...list[index], content: stripRecordSemantics(list[index]?.content) };
    }

    const boundary = userIndex >= 0 ? userIndex : list.length;
    let systemIndex = -1;
    for (let index = boundary - 1; index >= 0; index--) {
        if (String(list[index]?.role ?? '').toLowerCase() === 'system') {
            systemIndex = index;
            break;
        }
    }

    if (systemIndex >= 0) {
        list[systemIndex] = {
            ...list[systemIndex],
            content: appendRecordSemantics(list[systemIndex]?.content),
        };
    } else {
        list.splice(boundary, 0, { role: 'system', content: RECORD_SEMANTICS_RULE });
    }
    return list;
}

function injectProtocolIntoMessages(messages) {
    const list = Array.isArray(messages)
        ? messages.map(message => (message && typeof message === 'object' ? { ...message } : message))
        : [];
    const includeRecordSemantics = shouldIncludeRecordSemantics(list);
    const systemIndex = list.findIndex(message => String(message?.role ?? '').toLowerCase() === 'system');
    if (systemIndex >= 0) {
        list[systemIndex] = {
            ...list[systemIndex],
            content: appendProtocol(list[systemIndex]?.content, { includeRecordSemantics: false }),
        };
    } else {
        list.unshift({
            role: 'system',
            content: appendProtocol('', { includeRecordSemantics: false }),
        });
    }
    keepFinalUser(list);
    if (includeRecordSemantics) placeRecordSemanticsBeforeFinalUser(list);
    return list;
}

function injectProtocolIntoConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) return config;

    const next = { ...config };
    if (Array.isArray(next.ordered_prompts)) {
        next.ordered_prompts = injectProtocolIntoMessages(next.ordered_prompts);
        return next;
    }
    if (Array.isArray(next.messages)) {
        next.messages = injectProtocolIntoMessages(next.messages);
        return next;
    }
    const includeRecordSemantics = shouldIncludeRecordSemantics(next);
    if (Object.prototype.hasOwnProperty.call(next, 'systemPrompt') || Object.prototype.hasOwnProperty.call(next, 'prompt')) {
        next.systemPrompt = appendProtocol(next.systemPrompt, { includeRecordSemantics });
        return next;
    }
    if (Object.prototype.hasOwnProperty.call(next, 'system_prompt')) {
        next.system_prompt = appendProtocol(next.system_prompt, { includeRecordSemantics });
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
        console.log(`[Memo-N][output-protocol] ${channel} 已注入统一tableEdit协议，并把最终记录职责放在最后user之前`);
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

        if (Array.isArray(args?.[0])) {
            const nextArgs = [...args];
            nextArgs[0] = injectProtocolIntoMessages(args[0]);
            console.log('[Memo-N][output-protocol] 自定义API messages已统一协议，最终职责紧贴最后user之前');
            return await current.apply(this, nextArgs);
        }

        const config = this?.config;
        const includeRecordSemantics = shouldIncludeRecordSemantics(combined);
        if (!config || typeof config !== 'object') {
            const nextArgs = [...args];
            nextArgs[0] = appendProtocol(args?.[0], { includeRecordSemantics });
            return await current.apply(this, nextArgs);
        }

        const originalSystem = config.system_prompt;
        config.system_prompt = appendProtocol(originalSystem, { includeRecordSemantics });
        try {
            console.log('[Memo-N][output-protocol] 自定义API 已注入统一tableEdit协议');
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
    console.log(`[Memo-N] 记录专用唯一输出协议v4已加载：统一记录职责｜最后user兼容｜整理请求不注入记录职责｜EDITOR=${editor} TavernHelper=${tavern} CustomAPI=${custom}`);
}

install();

export {
    MEMO_TABLE_NAMES,
    PATCH_MARK,
    PROTOCOL_MARK,
    STRICT_OUTPUT_PROTOCOL,
    TRANSPORT_MARK,
    appendProtocol,
    injectProtocolIntoConfig,
    injectProtocolIntoMessages,
    isMemoCleanupRequest,
    isMemoRecordOnlyRequest,
    isMemoRedundancyRequest,
    keepFinalUser,
    looksLikeMemoSevenTableRequest,
    placeRecordSemanticsBeforeFinalUser,
    shouldIncludeRecordSemantics,
};
