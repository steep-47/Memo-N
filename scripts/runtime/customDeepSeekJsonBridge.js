import { APP } from '../../core/manager.js';
import { isOfficialCustomDeepSeek } from './providerRoute.js?v=memon-json37';

const OLD_MARKER = '[Memo-N native tableEdit one-call v1]';
const JSON_MARKER = '[Memo-N DeepSeek JSON one-call v1]';
const DETAIL_ANCHOR = '[当前真实列号映射｜column严格从0开始]';
const USER_MARKER = '\n\n[Memo-N本轮输出顺序：';
const OLD_PREFIX = '<tableEdit><!--\n';

function normalizeOfficialBase(rawUrl) {
    const value = String(rawUrl ?? '').trim();
    if (!value) return value;
    try {
        const normalized = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
        const url = new URL(normalized);
        const host = url.hostname.toLowerCase().replace(/\.$/, '');
        if (host !== 'deepseek.com' && !host.endsWith('.deepseek.com')) return value;
        const path = url.pathname.replace(/\/+$/, '');
        if (path !== '/beta') return value;
        url.pathname = '';
        url.search = '';
        url.hash = '';
        return url.toString().replace(/\/$/, '');
    } catch (_) {
        return value;
    }
}

function jsonDetailsFrom(oldContract) {
    const text = String(oldContract ?? '');
    const at = text.indexOf(DETAIL_ANCHOR);
    if (at < 0) return '';
    return text.slice(at)
        .replace(/insertRow/g, 'insert')
        .replace(/updateRow/g, 'update')
        .replace(/deleteRow/g, 'delete')
        .replace(/tableEdit/g, '机器记录')
        .replace(/完成逐表检查后，再生成机器记录；/g, '完成逐表检查后，再生成changes；')
        .replace(/- 记录块必须是实际输出第一段[^\n]*/g,
            '- 最终响应只输出一个JSON对象；reply保存完整玩家可见回复，changes保存本轮全部必要表格变更。');
}

function buildJsonContract(oldContract) {
    const details = jsonDetailsFrom(oldContract);
    return `${JSON_MARKER}
本轮只调用当前这一次正文API，同时完成正常回复与世界记录。
最终响应必须且只能是一个合法JSON对象，JSON外不得出现任何字符：
{"reply":"给玩家看的完整正常回复","changes":[{"op":"insert|update|delete","table":0,"row":0,"cells":[{"column":0,"value":"值"}]}]}

reply必须包含本轮完整玩家可见内容，包括原预设要求的状态栏、正文、行动选项和伊依留言等；不得为了记录省略任何本来应输出的部分。
changes只保存依据最终reply及当前七表确认需要执行的表格变更。没有任何变化时changes必须为[]。
每个changes项目固定包含op、table、row、cells：insert的row为null；update/delete的row必须是当前表真实存在的整数；delete的cells为[]；cells只使用当前真实column编号，value为字符串或数字。
先在内部确定完整reply与玩家下次输入前的最终落点，再逐表核对并形成changes；不要把正文放进changes，也不要输出tableEdit、函数调用、SQL、Markdown代码围栏或额外字段。

${details}`.trim();
}

function rewriteUserReminder(content) {
    const text = String(content ?? '');
    const at = text.lastIndexOf(USER_MARKER);
    const clean = at >= 0 ? text.slice(0, at).trimEnd() : text;
    return `${clean}\n\n[Memo-N本轮JSON输出：最终只输出一个合法JSON对象 {"reply":"完整正常回复","changes":[...]}。reply必须保留状态栏、正文、行动选项和其他原定结构；changes按当前实时七表记录全部必要变化，无变化为[]。]`;
}

function stripInjectedTableExample(content) {
    return String(content ?? '').replace(
        /^<tableEdit\b[^>]*>[\s\S]*?<\/tableEdit>\s*\n\[以上仅为上一轮记录格式范例，不代表本轮表格仍有相同行或rowIndex；本轮只服从当前实时表格边界。\]\s*\n*/i,
        '',
    );
}

function enforceDeepSeekJson(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.messages)) return;

    // 兼容0.36已加载过的旧路由：先把官方CUSTOM /beta恢复成正常Chat Completions基址。
    if (String(data?.chat_completion_source ?? '').trim().toLowerCase() === 'custom') {
        data.custom_url = normalizeOfficialBase(data.custom_url);
    }
    if (!isOfficialCustomDeepSeek(data)) return;

    // 若旧0.36前缀逻辑在本轮先执行过，删除它放入请求尾部的assistant前缀。
    if (data.messages.at(-1)?.role === 'assistant' && data.messages.at(-1)?.content === OLD_PREFIX) {
        data.messages.pop();
    }

    let contractCount = 0;
    let userCount = 0;
    for (const message of data.messages) {
        const content = String(message?.content ?? '');
        if (content.includes(OLD_MARKER)) {
            message.content = buildJsonContract(content);
            contractCount++;
            continue;
        }
        if (message?.role === 'user' && content.includes('[Memo-N本轮输出顺序：')) {
            message.content = rewriteUserReminder(content);
            userCount++;
            continue;
        }
        if (message?.role === 'assistant' && /^<tableEdit\b/i.test(content)) {
            message.content = stripInjectedTableExample(content);
        }
    }

    // DeepSeek官方Chat Completions明确支持JSON Output；这里用API级合法JSON保证，
    // 不再要求模型自行拼接/闭合<tableEdit>文本块。
    delete data.json_schema;
    data.response_format = { type: 'json_object' };

    globalThis.__memoNCustomDeepSeekJson = {
        at: Date.now(),
        contractCount,
        userCount,
        responseFormat: 'json_object',
    };
    console.log(`[Memo-N] 官方CUSTOM DeepSeek已切换为单API JSON Output｜contract=${contractCount}｜user=${userCount}`);
}

const event = APP.event_types.CHAT_COMPLETION_SETTINGS_READY;
APP.eventSource.on(event, enforceDeepSeekJson);
APP.eventSource.makeLast?.(event, enforceDeepSeekJson);

console.log('[Memo-N] CUSTOM DeepSeek JSON单API桥已加载：不再使用tableEdit前缀续写');
