import { APP, USER } from '../../core/manager.js';
import { saveReply } from '/script.js';
import { oai_settings } from '/scripts/openai.js';
import { ToolManager } from '/scripts/tool-calling.js';
import { parseRecordEnvelope } from '../engine/recordEnvelope.js';
import { isOfficialCustomDeepSeek } from './providerRoute.js?v=memon-strict-tool41';

const TOOL_NAME = 'memo_n_finish';
const OLD_MARKER = '[Memo-N native tableEdit one-call v1]';
const TOOL_MARKER = '[Memo-N DeepSeek strict-tool one-call v2]';
const DETAIL_ANCHOR = '[当前真实列号映射｜column严格从0开始]';
const USER_MARKER = '[Memo-N本轮输出顺序：';

const TOOL_PARAMETERS = {
    type: 'object',
    additionalProperties: false,
    properties: {
        reply: {
            type: 'string',
            description: '给玩家看的完整正常回复，必须保留原预设要求的状态栏、正文、行动选项及其他全部应有内容。',
        },
        changes: {
            type: 'array',
            description: '本轮依据最终reply与当前七表需要执行的全部表格变更；没有变化时为空数组。',
            items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    op: { type: 'string', enum: ['insert', 'update', 'delete'] },
                    table: { type: 'integer' },
                    row: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
                    cells: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                column: { type: 'integer' },
                                value: { anyOf: [{ type: 'string' }, { type: 'number' }] },
                            },
                            required: ['column', 'value'],
                        },
                    },
                },
                required: ['op', 'table', 'row', 'cells'],
            },
        },
    },
    required: ['reply', 'changes'],
};

let bridgeJob = null;

function independentEnabled() {
    return USER?.getSettings?.()?.memo_n_settings?.independent_record_api_enabled === true;
}

function recordActive() {
    const setting = USER?.tableBaseSetting;
    return !independentEnabled()
        && setting?.isExtensionAble !== false
        && setting?.isAiReadTable !== false
        && setting?.isAiWriteTable !== false
        && setting?.injection_mode !== 'injection_off'
        && setting?.step_by_step !== true;
}

function validType(type, dryRun) {
    const value = String(type ?? 'normal').toLowerCase();
    return recordActive()
        && !dryRun
        && !['quiet', 'impersonate', 'continue', 'append', 'appendfinal'].includes(value);
}

function officialProbe() {
    return {
        chat_completion_source: oai_settings?.chat_completion_source,
        custom_url: oai_settings?.custom_url,
        reverse_proxy: oai_settings?.reverse_proxy,
    };
}

function betaUrl(rawUrl) {
    const value = String(rawUrl ?? '').trim();
    if (!value) return value;
    try {
        const normalized = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
        const url = new URL(normalized);
        const host = url.hostname.toLowerCase().replace(/\.$/, '');
        if (host !== 'deepseek.com' && !host.endsWith('.deepseek.com')) return value;
        const path = url.pathname.replace(/\/+$/, '');
        if (path && path !== '/v1' && path !== '/beta') return value;
        url.pathname = '/beta';
        url.search = '';
        url.hash = '';
        return url.toString().replace(/\/$/, '');
    } catch (_) {
        return value;
    }
}

function restoreFunctionCalling() {
    if (!bridgeJob) return;
    if (typeof bridgeJob.previousFunctionCalling !== 'undefined') {
        oai_settings.function_calling = bridgeJob.previousFunctionCalling;
    }
    bridgeJob = null;
}

function armBridge(type, _options, dryRun) {
    restoreFunctionCalling();
    if (!validType(type, dryRun) || !isOfficialCustomDeepSeek(officialProbe())) return;

    const previousFunctionCalling = oai_settings.function_calling;
    oai_settings.function_calling = true;

    const supported = ToolManager.canPerformToolCalls(String(type ?? 'normal'), oai_settings);
    if (!supported) {
        oai_settings.function_calling = previousFunctionCalling;
        console.warn('[Memo-N] 当前SillyTavern工具调用设置不支持严格工具模式，本轮保持原记录链路');
        return;
    }

    const context = USER.getContext?.();
    const session = context?.chat;
    bridgeJob = {
        at: Date.now(),
        type: String(type ?? 'normal'),
        session,
        startLength: Array.isArray(session) ? session.length : 0,
        previousFunctionCalling,
    };
}

function detailRules(oldContract) {
    const text = String(oldContract ?? '');
    const at = text.indexOf(DETAIL_ANCHOR);
    if (at < 0) return '';
    return text.slice(at)
        .replaceAll('insertRow', 'insert操作')
        .replaceAll('updateRow', 'update操作')
        .replaceAll('deleteRow', 'delete操作')
        .replaceAll('tableEdit', 'changes机器记录')
        .replace(/- 记录块必须是实际输出第一段[^\n]*/g,
            '- 最终只调用一次memo_n_finish；reply放完整玩家可见回复，changes放本轮全部必要表格变更。')
        .replace(/完成逐表检查后，再生成changes机器记录/g, '完成逐表检查后，再形成changes');
}

function toolContract(oldContract) {
    const details = detailRules(oldContract);
    return `${TOOL_MARKER}\n本轮仍只调用当前这一次正文API，同时完成正常回复与世界记录。\nDeepSeek V4思考模式下不发送tool_choice，因此由模型按本规则选择唯一的 ${TOOL_NAME} 作为本轮最终交付通道。完成思考后必须且只调用一次 ${TOOL_NAME}；不要在工具调用之外另输出最终正文或第二套机器格式。\n\n工具参数中的reply是给玩家看的完整最终回复：先按原预设完成应有的状态栏、正文、行动选项及其他全部结构，再把这份完整定稿原样放入reply。\n工具参数中的changes只记录依据最终reply与当前七表确定需要执行的全部变更；没有任何变化时changes必须为[]。\n每个changes项目固定包含op、table、row、cells。insert时row=null；update/delete时row使用当前表真实存在的整数rowIndex；delete时cells=[]；cells只使用当前真实column编号，value只写字符串或数字。\n先确定完整reply与玩家下次输入前的最终落点，再逐表核对changes。不要输出<tableEdit>、函数文本、SQL、Markdown代码围栏、JSON正文或其他机器格式。\n\n${details}`.trim();
}

function rewriteUserReminder(content) {
    const text = String(content ?? '');
    const at = text.lastIndexOf(USER_MARKER);
    const clean = at >= 0 ? text.slice(0, at).trimEnd() : text;
    return `${clean}\n\n[Memo-N本轮唯一交付：思考完成后调用一次${TOOL_NAME}。reply必须包含本来应有的状态栏、正文、行动选项和其他可见结构；changes按当前实时七表完整记录必要变化，无变化为[]。不要直接输出最终正文，也不要输出tableEdit/JSON等第二套机器格式。]`;
}

function stripOldHistoryExample(content) {
    return String(content ?? '').replace(
        /^<tableEdit\b[^>]*>[\s\S]*?<\/tableEdit>\s*\n\[以上仅为上一轮记录格式范例，不代表本轮表格仍有相同行或rowIndex；本轮只服从当前实时表格边界。\]\s*\n*/i,
        '',
    );
}

function strictToolDefinition() {
    return {
        type: 'function',
        function: {
            name: TOOL_NAME,
            description: '这是本轮唯一有效的最终交付通道。思考完成后调用一次，提交完整玩家可见回复与Memo-N七表变更。',
            strict: true,
            parameters: structuredClone(TOOL_PARAMETERS),
        },
    };
}

function enforceStrictTool(data) {
    if (!bridgeJob || Date.now() - bridgeJob.at > 300000) return;
    if (!data || typeof data !== 'object' || !Array.isArray(data.messages)) return;
    if (bridgeJob.session && USER.getContext?.()?.chat !== bridgeJob.session) return;
    if (!isOfficialCustomDeepSeek(data)) return;

    data.custom_url = betaUrl(data.custom_url || oai_settings?.custom_url);
    delete data.response_format;
    delete data.json_schema;

    let contractCount = 0;
    for (const message of data.messages) {
        const content = String(message?.content ?? '');
        if (content.includes(OLD_MARKER)) {
            message.content = toolContract(content);
            contractCount++;
            continue;
        }
        if (message?.role === 'user' && content.includes(USER_MARKER)) {
            message.content = rewriteUserReminder(content);
            continue;
        }
        if (message?.role === 'assistant' && /^<tableEdit\b/i.test(content)) {
            message.content = stripOldHistoryExample(content);
        }
    }

    // SillyTavern在function calling开启时会默认补tool_choice='auto'。
    // DeepSeek V4 thinking mode官方明确要求不要发送tool_choice，因此最后阶段覆盖tools后彻底删除该字段。
    data.tools = [strictToolDefinition()];
    delete data.tool_choice;

    globalThis.__memoNStrictToolState = {
        at: Date.now(),
        active: true,
        contractCount,
        endpoint: data.custom_url,
        tool: TOOL_NAME,
        toolChoiceOmitted: !Object.prototype.hasOwnProperty.call(data, 'tool_choice'),
    };
    console.log(`[Memo-N] 官方CUSTOM DeepSeek已启用strict单API工具交付｜无tool_choice｜contract=${contractCount}`);
}

function syncSwipe(piece) {
    const swipeId = Number(piece?.swipe_id);
    if (Array.isArray(piece?.swipes) && Number.isInteger(swipeId) && swipeId >= 0 && swipeId < piece.swipes.length) {
        piece.swipes[swipeId] = piece.mes;
    }
}

async function putEnvelopeIntoCurrentReply(rawEnvelope) {
    const job = bridgeJob;
    if (!job || !job.session || USER.getContext?.()?.chat !== job.session) throw new Error('聊天上下文已变化');

    const raw = JSON.stringify(rawEnvelope);
    const chat = job.session;
    let piece = chat.at(-1);

    if (piece?.is_user === false) {
        piece.mes = raw;
        syncSwipe(piece);
        return piece;
    }

    const saveType = ['swipe', 'regenerate'].includes(String(job.type).toLowerCase()) ? job.type : 'normal';
    await saveReply({ type: saveType, getMessage: raw });
    piece = chat.at(-1);
    if (!piece || piece.is_user !== false) throw new Error('无法建立本轮助手回复');
    return piece;
}

async function handleMemoFinish(parameters) {
    try {
        const validated = parseRecordEnvelope(parameters);
        if (!validated.ok) throw new Error(validated.error || '严格工具参数无效');

        // parseRecordEnvelope只负责验证。它会把cells转为执行器内部data，
        // 因而交回recordEngine时必须保留工具参数原始的reply+changes[cells]结构，避免二次解析失真。
        const rawEnvelope = {
            reply: validated.reply,
            changes: structuredClone(parameters.changes),
        };
        await putEnvelopeIntoCurrentReply(rawEnvelope);
        globalThis.__memoNStrictToolState = {
            ...(globalThis.__memoNStrictToolState || {}),
            completed: true,
            completedAt: Date.now(),
            changes: rawEnvelope.changes.length,
        };
        return '';
    } finally {
        // stealth工具返回后SillyTavern直接停止本轮，不递归Generate，因此仍保持一次API。
        restoreFunctionCalling();
    }
}

ToolManager.unregisterFunctionTool(TOOL_NAME);
ToolManager.registerFunctionTool({
    name: TOOL_NAME,
    displayName: 'Memo-N',
    description: '这是Memo-N本轮唯一最终交付通道：提交完整回复与七表变化。',
    parameters: TOOL_PARAMETERS,
    action: handleMemoFinish,
    formatMessage: async () => '',
    shouldRegister: () => !!bridgeJob,
    stealth: true,
});

APP.eventSource.on(APP.event_types.GENERATION_STARTED, armBridge);
APP.eventSource.on(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, enforceStrictTool);
APP.eventSource.makeLast?.(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, enforceStrictTool);
APP.eventSource.on(APP.event_types.GENERATION_ENDED, restoreFunctionCalling);
APP.eventSource.on(APP.event_types.GENERATION_STOPPED, restoreFunctionCalling);
APP.eventSource.on(APP.event_types.CHAT_CHANGED, restoreFunctionCalling);

console.log('[Memo-N] CUSTOM DeepSeek strict-tool单API桥已加载：thinking模式不发送tool_choice，stealth不触发第二次生成');
