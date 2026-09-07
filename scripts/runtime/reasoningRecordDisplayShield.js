import { APP, USER } from '../../core/manager.js';
import { reloadCurrentChat } from '/script.js';

const INSTALL_FLAG = '__memoNReasoningRecordDisplayShieldV1';
const TABLE_EDIT_BLOCK_RE = /<tableEdit\b[^>]*>[\s\S]*?<\/tableEdit>/gi;
const OP_LINE_RE = /^\s*(?:insertRow|updateRow|deleteRow)\s*\([\s\S]*\)\s*;?\s*$/;
let repairBusy = false;

function stripTrailingBareOperations(text, minCount = 2) {
    const source = String(text ?? '');
    const lines = source.split(/\r?\n/);
    let end = lines.length - 1;
    while (end >= 0 && !lines[end].trim()) end -= 1;
    if (end < 0) return source;

    let start = end;
    let count = 0;
    while (start >= 0 && OP_LINE_RE.test(lines[start])) {
        count += 1;
        start -= 1;
    }
    if (count < minCount) return source;
    return lines.slice(0, start + 1).join('\n').replace(/\s+$/, '').trim();
}

function cleanReasoningDisplay(text) {
    const source = String(text ?? '');
    if (!source) return source;
    let cleaned = source.replace(TABLE_EDIT_BLOCK_RE, '').trim();
    cleaned = stripTrailingBareOperations(cleaned, 2);
    return cleaned;
}

function shieldExtra(extra) {
    if (!extra || typeof extra !== 'object' || typeof extra.reasoning !== 'string' || !extra.reasoning) return false;

    // underlying reasoning始终保留，Memo解析/Swipe恢复仍可读取；只覆盖用户看到的reasoning_display_text。
    const sourceForDisplay = typeof extra.reasoning_display_text === 'string'
        ? extra.reasoning_display_text
        : extra.reasoning;
    const cleaned = cleanReasoningDisplay(sourceForDisplay);
    if (cleaned === sourceForDisplay) return false;

    extra.reasoning_display_text = cleaned; // 空字符串也是有效覆盖，ST不会回退显示原reasoning。
    return true;
}

function shieldPiece(piece) {
    if (!piece || piece.is_user === true) return false;
    let changed = shieldExtra(piece.extra);
    if (Array.isArray(piece.swipe_info)) {
        for (const info of piece.swipe_info) {
            if (shieldExtra(info?.extra)) changed = true;
        }
    }
    return changed;
}

async function scanCurrentChat({ reload = true } = {}) {
    const chat = USER.getContext?.()?.chat;
    if (!Array.isArray(chat) || !chat.length) return false;
    let changed = false;
    for (const piece of chat) {
        if (shieldPiece(piece)) changed = true;
    }
    if (!changed) return false;
    await Promise.resolve(USER.saveChat?.());
    if (reload) await Promise.resolve(reloadCurrentChat());
    return true;
}

function install() {
    if (globalThis[INSTALL_FLAG]) return;
    globalThis[INSTALL_FLAG] = true;

    const renderedEvent = APP?.event_types?.CHARACTER_MESSAGE_RENDERED;
    if (renderedEvent) {
        APP.eventSource.on(renderedEvent, chatId => {
            if (repairBusy) return;
            const piece = USER.getContext?.()?.chat?.[Number(chatId)];
            if (!shieldPiece(piece)) return;
            repairBusy = true;
            Promise.resolve(USER.saveChat?.())
                .then(() => reloadCurrentChat())
                .catch(error => console.warn('[Memo-N] reasoning机器记录显示隐藏失败', error))
                .finally(() => setTimeout(() => { repairBusy = false; }, 300));
        });
    }

    jQuery(() => {
        scanCurrentChat().catch(error => console.warn('[Memo-N] 初始reasoning机器记录显示清理失败', error));
        setTimeout(() => scanCurrentChat().catch(() => {}), 1000);
    });

    console.log('[Memo-N] reasoning显示守卫已加载：保留底层推理，仅隐藏tableEdit/连续机器操作');
}

install();

export { cleanReasoningDisplay, scanCurrentChat, shieldPiece };
