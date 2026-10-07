import { APP, USER } from '../../core/manager.js';

const DEFAULT_KEEP_TURNS = 50;
const MODULE_FLAG = '__memoNFixedBlockHistoryInstalled';

function asText(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.map(part => typeof part === 'string' ? part : (part?.text ?? '')).join('\n');
}

function normalizeText(value) {
    return String(value ?? '').replace(/\r\n/g, '\n').trim();
}

function positiveInt(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function getConfig() {
    const settings = USER.tableBaseSetting;
    if (settings.fixed_block_history_enabled === undefined) settings.fixed_block_history_enabled = true;
    if (settings.fixed_block_history_keep_turns === undefined) settings.fixed_block_history_keep_turns = DEFAULT_KEEP_TURNS;
    return {
        enabled: settings.fixed_block_history_enabled !== false,
        keepTurns: positiveInt(settings.fixed_block_history_keep_turns, DEFAULT_KEEP_TURNS, 1, 1000),
    };
}

function rawChatMessages() {
    const chat = USER.getContext?.()?.chat;
    return Array.isArray(chat) ? chat.filter(message => message && typeof message === 'object') : [];
}

function isRawUser(message) {
    return message?.is_user === true;
}

function promptRoleMatchesRaw(message, promptMessage) {
    if (isRawUser(message)) return promptMessage?.role === 'user';
    return message?.is_user === false && promptMessage?.role === 'assistant';
}

function promptText(message) {
    return normalizeText(asText(message?.content));
}

function rawText(message) {
    return normalizeText(message?.mes);
}

/**
 * 将酒馆原始聊天消息按顺序映射到本次 API prompt 中的对应消息。
 * 只匹配真实 user/assistant 聊天消息，系统注入内容不会被认作历史消息。
 */
function mapRawChatToPrompt(rawMessages, promptMessages) {
    const mapping = new Map();
    let promptIndex = 0;

    for (let rawIndex = 0; rawIndex < rawMessages.length; rawIndex += 1) {
        const rawMessage = rawMessages[rawIndex];
        const expectedText = rawText(rawMessage);
        if (!expectedText) continue;

        let matched = -1;
        for (let i = promptIndex; i < promptMessages.length; i += 1) {
            const promptMessage = promptMessages[i];
            if (!promptRoleMatchesRaw(rawMessage, promptMessage)) continue;
            if (promptText(promptMessage) !== expectedText) continue;
            matched = i;
            break;
        }

        if (matched < 0) continue;
        mapping.set(rawIndex, matched);
        promptIndex = matched + 1;
    }

    return mapping;
}

/**
 * 只保留最近 keepTurns 个真实对话轮。
 * 1轮 = 一个用户消息及其后对应的AI回复。
 *
 * 这里不生成摘要、不发送旧 recap、不创建历史块。
 * 旧聊天仍保存在酒馆，只是在本次 API prompt 中不再携带。
 */
function applyFixedBlockHistory(eventData) {
    try {
        if (!eventData || eventData.dryRun === true || !Array.isArray(eventData.chat)) return;

        const { enabled, keepTurns } = getConfig();
        if (!enabled) return;

        const rawMessages = rawChatMessages();
        const rawUserIndexes = [];
        rawMessages.forEach((message, index) => {
            if (isRawUser(message)) rawUserIndexes.push(index);
        });

        if (rawUserIndexes.length <= keepTurns) return;

        const cutoffRawUserIndex = rawUserIndexes[rawUserIndexes.length - keepTurns];
        const mapping = mapRawChatToPrompt(rawMessages, eventData.chat);
        const remove = new Set();

        // 冻结 cutoff 之前的所有真实 user/assistant 消息。
        // 系统消息、Memo 表格注入、世界书等非聊天消息不在删除范围。
        for (let rawIndex = 0; rawIndex < cutoffRawUserIndex; rawIndex += 1) {
            const promptIndex = mapping.get(rawIndex);
            if (promptIndex !== undefined) remove.add(promptIndex);
        }

        if (!remove.size) {
            console.warn('[Memo-N][历史冻结] 未能定位旧聊天消息，本轮不做截断，避免误删提示词');
            return;
        }

        const sorted = [...remove].sort((a, b) => a - b);
        for (let i = sorted.length - 1; i >= 0; i -= 1) {
            eventData.chat.splice(sorted[i], 1);
        }

        eventData.memoNFixedBlockHistory = {
            keptTurns: keepTurns,
            frozenTurns: rawUserIndexes.length - keepTurns,
            removedMessages: sorted.length,
        };

        console.log('[Memo-N][历史冻结]', eventData.memoNFixedBlockHistory);
    } catch (error) {
        console.error('[Memo-N][历史冻结] 处理失败，已保留原始历史', error);
    }
}

function installSettingsUI() {
    const target = $('#step_by_step_options');
    if ($('#memo_n_fixed_block_history').length) return true;
    if (!target.length) return false;

    const config = getConfig();
    target.append(`
        <div id="memo_n_fixed_block_history" class="memo-n-fixed-history-panel">
            <div class="checkbox_label range-block justifyLeft">
                <input type="checkbox" id="memo_n_fixed_history_enabled" ${config.enabled ? 'checked' : ''}>
                <span>历史冻结</span>
            </div>
            <div class="memo-n-fixed-history-values">
                <label>保留最近轮数 <input type="number" id="memo_n_fixed_history_keep" min="1" max="1000" step="1" value="${config.keepTurns}"></label>
            </div>
            <small>超过保留轮数的旧聊天只冻结在 API 上下文之外，不总结、不发送、不删除酒馆原文；长期信息由 Memo 表格负责记录。</small>
        </div>
    `);

    $('#memo_n_fixed_history_enabled').on('change', function () {
        USER.tableBaseSetting.fixed_block_history_enabled = $(this).prop('checked');
        USER.saveSettings();
    });

    $('#memo_n_fixed_history_keep').on('change', function () {
        const value = positiveInt($(this).val(), DEFAULT_KEEP_TURNS, 1, 1000);
        $(this).val(value);
        USER.tableBaseSetting.fixed_block_history_keep_turns = value;
        USER.saveSettings();
    });

    return true;
}

function scheduleSettingsUI(remaining = 20) {
    if (installSettingsUI() || remaining <= 0) return;
    setTimeout(() => scheduleSettingsUI(remaining - 1), 250);
}

if (!globalThis[MODULE_FLAG]) {
    globalThis[MODULE_FLAG] = true;
    APP.eventSource.on(APP.event_types.CHAT_COMPLETION_PROMPT_READY, applyFixedBlockHistory);
    jQuery(() => scheduleSettingsUI());
    APP.eventSource.on(APP.event_types.CHAT_CHANGED, () => scheduleSettingsUI());
    console.log('[Memo-N] 历史冻结已加载：默认只发送最近50轮，旧历史不总结、不发送');
}

export {
    applyFixedBlockHistory,
    mapRawChatToPrompt,
};
