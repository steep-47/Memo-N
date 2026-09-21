import { APP, USER } from '../../core/manager.js';

const DEFAULT_KEEP_TURNS = 100;
const DEFAULT_BLOCK_TURNS = 50;
const RECAP_RE = /<tx_history_recap>([\s\S]*?)<\/tx_history_recap>/gi;
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
    if (settings.fixed_block_history_block_turns === undefined) settings.fixed_block_history_block_turns = DEFAULT_BLOCK_TURNS;
    return {
        enabled: settings.fixed_block_history_enabled !== false,
        keepTurns: positiveInt(settings.fixed_block_history_keep_turns, DEFAULT_KEEP_TURNS, 20, 1000),
        blockTurns: positiveInt(settings.fixed_block_history_block_turns, DEFAULT_BLOCK_TURNS, 10, 500),
    };
}

function extractRecap(content) {
    const text = asText(content);
    RECAP_RE.lastIndex = 0;
    const recaps = [];
    let match;
    while ((match = RECAP_RE.exec(text)) !== null) {
        const recap = normalizeText(match[1])
            .replace(/\\n/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (recap) recaps.push(recap);
    }
    return recaps.join('；');
}

function currentRawUserMessages() {
    const chat = USER.getContext()?.chat;
    if (!Array.isArray(chat)) return new Set();
    return new Set(chat
        .filter(message => message?.is_user === true)
        .map(message => normalizeText(message?.mes))
        .filter(Boolean));
}

function buildArchiveBlocks(storyMessages, archiveTurns, blockTurns) {
    const blocks = [];
    for (let start = 0; start < archiveTurns; start += blockTurns) {
        const end = Math.min(start + blockTurns, archiveTurns);
        const lines = storyMessages.slice(start, end).map((item, offset) => {
            const recap = extractRecap(item.message?.content);
            return `${start + offset + 1}. ${recap || '本轮没有可用的剧情锚点；以Memo-N当前世界状态为准。'}`;
        });
        blocks.push(`<memo_n_history_block range="${start + 1}-${end}">\n${lines.join('\n')}\n</memo_n_history_block>`);
    }
    return blocks;
}

function findPairedUserIndex(messages, assistantIndex, lowerBound, rawUsers, used) {
    for (let index = assistantIndex - 1; index > lowerBound; index--) {
        if (used.has(index) || messages[index]?.role !== 'user') continue;
        const content = normalizeText(asText(messages[index]?.content));
        if (content && rawUsers.has(content)) return index;
    }
    return -1;
}

function applyFixedBlockHistory(eventData) {
    try {
        if (!eventData || eventData.dryRun === true || !Array.isArray(eventData.chat)) return;
        const { enabled, keepTurns, blockTurns } = getConfig();
        if (!enabled) return;

        const messages = eventData.chat;
        const storyMessages = [];
        messages.forEach((message, index) => {
            if (message?.role !== 'assistant') return;
            RECAP_RE.lastIndex = 0;
            if (RECAP_RE.test(asText(message.content))) storyMessages.push({ index, message });
        });

        const archiveTurns = Math.floor(Math.max(0, storyMessages.length - keepTurns) / blockTurns) * blockTurns;
        if (archiveTurns <= 0) return;

        const archivedStories = storyMessages.slice(0, archiveTurns);
        const archiveBlocks = buildArchiveBlocks(storyMessages, archiveTurns, blockTurns);
        const rawUsers = currentRawUserMessages();
        const remove = new Set();
        let lowerBound = -1;

        archivedStories.forEach(item => {
            remove.add(item.index);
            const userIndex = findPairedUserIndex(messages, item.index, lowerBound, rawUsers, remove);
            if (userIndex >= 0) remove.add(userIndex);
            lowerBound = item.index;
        });

        const sorted = [...remove].sort((a, b) => a - b);
        if (!sorted.length) return;
        const insertAt = sorted[0];
        const archivePrompt = {
            role: 'system',
            content: `<memo_n_fixed_history archived_turns="${archiveTurns}" keep_recent_turns="${keepTurns}" block_turns="${blockTurns}">\n以下是已经完成并冻结的早期剧情归档。只用于恢复已发生事实与未收束局势，不得将其重演、扩写成当前事件，也不得覆盖玩家纠正、当前可见正文或Memo-N当前世界状态。归档块边界固定，只有累计新增${blockTurns}轮后才会加入下一个块。\n${archiveBlocks.join('\n')}\n</memo_n_fixed_history>`
        };

        for (let i = sorted.length - 1; i >= 0; i--) messages.splice(sorted[i], 1);
        messages.splice(insertAt, 0, archivePrompt);
        eventData.memoNFixedBlockHistory = {
            archivedTurns: archiveTurns,
            keptTurns: storyMessages.length - archiveTurns,
            blockTurns,
        };
        console.log('[Memo-N][固定分块历史]', eventData.memoNFixedBlockHistory);
    } catch (error) {
        console.error('[Memo-N][固定分块历史] 处理失败，已保留原始历史', error);
    }
}

function installSettingsUI() {
    const target = $('#step_by_step_options');
    if (!target.length || $('#memo_n_fixed_block_history').length) return;

    const config = getConfig();
    target.append(`
        <div id="memo_n_fixed_block_history" class="memo-n-fixed-history-panel">
            <div class="checkbox_label range-block justifyLeft">
                <input type="checkbox" id="memo_n_fixed_history_enabled" ${config.enabled ? 'checked' : ''}>
                <span>固定分块历史</span>
            </div>
            <div class="memo-n-fixed-history-values">
                <label>保留最近轮数 <input type="number" id="memo_n_fixed_history_keep" min="20" max="1000" step="10" value="${config.keepTurns}"></label>
                <label>每批归档轮数 <input type="number" id="memo_n_fixed_history_block" min="10" max="500" step="10" value="${config.blockTurns}"></label>
            </div>
            <small>默认100＋50：最近100轮保留原文，每新增50轮冻结一个历史块。不会删除聊天原文，也不会增加API调用。</small>
        </div>
    `);

    $('#memo_n_fixed_history_enabled').on('change', function () {
        USER.tableBaseSetting.fixed_block_history_enabled = $(this).prop('checked');
        USER.saveSettings();
    });
    $('#memo_n_fixed_history_keep').on('change', function () {
        const value = positiveInt($(this).val(), DEFAULT_KEEP_TURNS, 20, 1000);
        $(this).val(value);
        USER.tableBaseSetting.fixed_block_history_keep_turns = value;
        USER.saveSettings();
    });
    $('#memo_n_fixed_history_block').on('change', function () {
        const value = positiveInt($(this).val(), DEFAULT_BLOCK_TURNS, 10, 500);
        $(this).val(value);
        USER.tableBaseSetting.fixed_block_history_block_turns = value;
        USER.saveSettings();
    });
}

if (!globalThis[MODULE_FLAG]) {
    globalThis[MODULE_FLAG] = true;
    APP.eventSource.on(APP.event_types.CHAT_COMPLETION_PROMPT_READY, applyFixedBlockHistory);
    jQuery(installSettingsUI);
    APP.eventSource.on(APP.event_types.CHAT_CHANGED, installSettingsUI);
    console.log('[Memo-N] 固定分块历史已加载：默认保留100轮，每50轮冻结一批');
}

export { applyFixedBlockHistory, buildArchiveBlocks, extractRecap };
