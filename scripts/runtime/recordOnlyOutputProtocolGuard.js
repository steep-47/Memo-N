import { EDITOR } from '../../core/manager.js';
import LLMApiService from '../../services/llmApi.js';

const PATCH_MARK = '__memoNRecordOnlyOutputProtocolGuardV4';
const PROTOCOL_MARK = '[Memo-N唯一输出格式v2]';
const TRANSPORT_MARK = '# Memo独立记录操作协议';
const MEMO_TABLE_NAMES = ['当前状态表','角色状态表','背包表','当前任务与约定表','人物主表','人物发展表','历史事件表'];

const STRICT_OUTPUT_PROTOCOL = `# ${PROTOCOL_MARK}
${TRANSPORT_MARK}
这是Memo记录请求的唯一输出格式。必须使用XML操作标签，禁止生成insertRow()/updateRow()/deleteRow()函数调用文本，避免括号、逗号和字符串引号造成整批解析失败。

最终回复只包含一个<tableEdit>外壳。无操作时输出：
<tableEdit><!-- NO_CHANGE --></tableEdit>

新增示例：
<tableEdit>
<insertRow tableIndex="1"><data columnIndex="0" value="示例角色"/><data columnIndex="11" value="青木诀"/></insertRow>
</tableEdit>

更新示例：
<tableEdit>
<updateRow tableIndex="4" rowIndex="0" expected="老叔公"><data columnIndex="5" value="练气士"/></updateRow>
</tableEdit>

删除示例：
<tableEdit>
<deleteRow tableIndex="2" rowIndex="1" expected="蛐蛐罐"/>
</tableEdit>

规则：
- insertRow只允许tableIndex属性；历史表自动追加，不要填写rowIndex。
- updateRow和deleteRow必须同时填写tableIndex、rowIndex、expected属性。
- 表2背包、表4人物主表、表5人物发展表的expected必须原样抄写执行前当前目标行第一列；其他表expected使用空字符串。
- 每个data标签必须同时有columnIndex和value属性；同一操作内列号不得重复。columnIndex必须使用当前表真实列号。
- 属性值中的英文双引号写成 &quot;，& 写成 &amp;，小于号写成 &lt;，大于号写成 &gt;。不要把未转义的英文双引号放入value；普通中文引号「」可直接使用。
- 背包数量归零或确认全部售出、耗尽、交付、不再持有时使用deleteRow；部分消耗只更新剩余数量。
- 表2/4/5新增对象时，data的columnIndex="0"必须包含对象名。
- 输出只包含XML操作标签，不用HTML注释包裹操作，不输出JSON、Markdown代码围栏或额外说明。`;

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
        || text.includes(TRANSPORT_MARK)
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
    console.log(`[Memo-N] 记录专用唯一输出协议v2已加载：对象身份保护签名已对齐｜EDITOR=${editor} TavernHelper=${tavern} CustomAPI=${custom}`);
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
    isMemoRecordOnlyRequest,
    looksLikeMemoSevenTableRequest,
};
