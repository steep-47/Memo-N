import fs from 'node:fs/promises';

let source = await fs.readFile(new URL('../scripts/runtime/customDeepSeekJsonBridge.js', import.meta.url), 'utf8');
source = source
    .replace("import { APP } from '../../core/manager.js';", 'const { APP } = globalThis.__memoJsonBridgeMocks;')
    .replace("import { isOfficialCustomDeepSeek } from './providerRoute.js?v=memon-json37';", 'const { isOfficialCustomDeepSeek } = globalThis.__memoJsonBridgeMocks;');

const handlers = [];
globalThis.__memoJsonBridgeMocks = {
    APP: {
        event_types: { CHAT_COMPLETION_SETTINGS_READY: 'settings' },
        eventSource: {
            on(_event, handler) { handlers.push(handler); },
            makeLast(_event, handler) {
                const at = handlers.indexOf(handler);
                if (at >= 0) handlers.splice(at, 1);
                handlers.push(handler);
            },
        },
    },
    isOfficialCustomDeepSeek(data) {
        if (String(data?.chat_completion_source || '').toLowerCase() !== 'custom') return false;
        if (String(data?.reverse_proxy || '').trim()) return false;
        try {
            const url = new URL(String(data?.custom_url || ''));
            const host = url.hostname.toLowerCase();
            const path = url.pathname.replace(/\/+$/, '');
            return (host === 'deepseek.com' || host.endsWith('.deepseek.com'))
                && (path === '' || path === '/v1' || path === '/beta');
        } catch (_) {
            return false;
        }
    },
};

await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#memo-custom-deepseek-json-bridge-test`);
if (!handlers.length) throw new Error('JSON桥没有注册请求处理器');

const request = {
    chat_completion_source: 'custom',
    custom_url: 'https://api.deepseek.com/beta',
    messages: [
        {
            role: 'assistant',
            content: '<tableEdit><!-- NO_CHANGE --></tableEdit>\n[以上仅为上一轮记录格式范例，不代表本轮表格仍有相同行或rowIndex；本轮只服从当前实时表格边界。]\n\n上一轮正文',
        },
        {
            role: 'user',
            content: '继续\n\n[Memo-N本轮输出顺序：旧tableEdit提醒]',
        },
        {
            role: 'system',
            content: `[Memo-N native tableEdit one-call v1]\n旧tableEdit说明\n[当前真实列号映射｜column严格从0开始]\n#0 当前状态表：0=日期，1=时间\n[当前真实行号边界｜本轮唯一依据，优先于全部历史聊天与旧tableEdit]\n#0 当前状态表：当前数据行数=1\n[操作规则]\n- insertRow仅用于新增。\n- updateRow用于已有。\n- deleteRow只用于失效。\n- 完成逐表检查后，再生成tableEdit；记录操作应完整。\n- 记录块必须是实际输出第一段，</tableEdit>之后立刻输出正文。`,
        },
        { role: 'assistant', content: '<tableEdit><!--\n' },
    ],
    json_schema: { stale: true },
};

for (const handler of handlers) handler(request);

if (request.custom_url !== 'https://api.deepseek.com') throw new Error('0.36 beta地址没有恢复成普通DeepSeek Chat Completions基址');
if (request.json_schema) throw new Error('JSON桥不应给DeepSeek Chat Completions发送json_schema');
if (request.response_format?.type !== 'json_object') throw new Error('没有启用DeepSeek官方JSON Output');
if (request.messages.at(-1)?.content === '<tableEdit><!--\n') throw new Error('旧tableEdit助手前缀没有删除');

const system = request.messages.find(message => message.role === 'system')?.content || '';
if (!system.includes('[Memo-N DeepSeek JSON one-call v1]')) throw new Error('系统记录契约没有切换到JSON单API');
if (!system.includes('{"reply":"给玩家看的完整正常回复","changes":')) throw new Error('JSON契约缺少固定reply/changes结构');
if (system.includes('insertRow') || system.includes('updateRow') || system.includes('deleteRow')) throw new Error('JSON契约仍混入旧函数调用格式');
if (system.includes('</tableEdit>') || system.includes('<tableEdit')) throw new Error('JSON契约仍混入旧tableEdit输出格式');
if (!system.includes('#0 当前状态表：0=日期，1=时间')) throw new Error('切JSON时丢失了当前七表真实列号规则');

const user = request.messages.find(message => message.role === 'user')?.content || '';
if (!user.includes('[Memo-N本轮JSON输出：')) throw new Error('最后用户锚点没有切到JSON输出');
if (user.includes('[Memo-N本轮输出顺序：')) throw new Error('旧tableEdit用户锚点仍残留');

const history = request.messages.find(message => message.role === 'assistant')?.content || '';
if (history.startsWith('<tableEdit')) throw new Error('上一轮注入的tableEdit格式范例没有移除');
if (!history.includes('上一轮正文')) throw new Error('移除旧格式范例时误删了历史正文');

const foreign = {
    chat_completion_source: 'custom',
    custom_url: 'https://example.com/v1',
    messages: [{ role: 'system', content: '[Memo-N native tableEdit one-call v1]' }],
};
for (const handler of handlers) handler(foreign);
if (foreign.response_format) throw new Error('非DeepSeek CUSTOM被误启用JSON Output');
if (!foreign.messages[0].content.includes('[Memo-N native tableEdit one-call v1]')) throw new Error('非DeepSeek CUSTOM提示被误改写');

console.log('Memo-N custom DeepSeek JSON bridge tests passed.');
