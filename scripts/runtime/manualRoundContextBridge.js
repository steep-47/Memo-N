import { APP, EDITOR, USER } from '../../core/manager.js';
import { reloadCurrentChat } from '/script.js';
import { TableTwoStepSummary } from './separateTableUpdate.js?v=0.17';

const INSTALL_FLAG = '__memoNManualRoundContextBridgeV7';
const TABLE_EDIT_BLOCK_RE = /<tableEdit\b[^>]*>[\s\S]*?<\/tableEdit>/gi;
const OP_LINE_RE = /^\s*(?:insertRow|updateRow|deleteRow)\s*\([\s\S]*\)\s*;?\s*$/;
const VISIBLE_EXTRA_KEYS = ['display_text', 'reasoning', 'reasoning_display_text'];
let manualBusy = false;
let renderRepairBusy = false;

function trailingTableEdit(text) {
    const source = String(text ?? '');
    const matches = [...source.matchAll(TABLE_EDIT_BLOCK_RE)];
    const last = matches.at(-1);
    if (!last || last.index === undefined) return null;
    const end = last.index + last[0].length;
    if (source.slice(end).trim()) return null;
    return {
        block: last[0],
        visible: source.slice(0, last.index).replace(/\s+$/, '').trim(),
    };
}

function trailingBareOperations(text, minCount = 2) {
    const source = String(text ?? '');
    const lines = source.split(/\r?\n/);
    let end = lines.length - 1;
    while (end >= 0 && !lines[end].trim()) end -= 1;
    if (end < 0) return null;

    let start = end;
    let count = 0;
    while (start >= 0 && OP_LINE_RE.test(lines[start])) {
        count += 1;
        start -= 1;
    }
    if (count < minCount) return null;

    const block = lines.slice(start + 1, end + 1).join('\n').trim();
    if (!block) return null;
    return {
        block: `<tableEdit><!--\n${block}\n--></tableEdit>`,
        visible: lines.slice(0, start + 1).join('\n').replace(/\s+$/, '').trim(),
    };
}

function trailingMachineRecord(text, minBareCount = 2) {
    return trailingTableEdit(text) || trailingBareOperations(text, minBareCount);
}

function machineBody(block) {
    return String(block ?? '')
        .replace(/^\s*<tableEdit\b[^>]*>\s*/i, '')
        .replace(/\s*<\/tableEdit>\s*$/i, '')
        .replace(/^\s*<!--\s*/, '')
        .replace(/\s*-->\s*$/, '')
        .trim();
}

function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function stripKnownRecord(text, machineBlock) {
    const original = String(text ?? '');
    if (!original || !machineBlock) return { changed: false, value: original };

    let value = original;
    const block = String(machineBlock).trim();
    const body = machineBody(block);
    const variants = [block, escapeHtml(block)].filter(Boolean);

    for (const variant of variants) {
        if (!value.includes(variant)) continue;
        value = value.split(variant).join('');
    }

    const bodyVariants = [body, escapeHtml(body)].filter(Boolean);
    for (const variant of bodyVariants) {
        const trimmed = value.trimEnd();
        if (!trimmed.endsWith(variant)) continue;
        value = trimmed.slice(0, trimmed.length - variant.length);
    }

    // 已经确认这条消息有手动记录标记时，末尾残留的裸函数串也属于同一机器记录。
    const trailing = trailingMachineRecord(value, 1);
    if (trailing) value = trailing.visible;

    value = value.replace(/\s+$/, '').trim();
    return { changed: value !== original, value };
}

function ensureExtra(value) {
    return value && typeof value === 'object' ? value : {};
}

function getSwipeExtra(piece, swipeId, create = false) {
    if (!Number.isInteger(swipeId) || swipeId < 0) return null;
    if (!Array.isArray(piece.swipe_info)) {
        if (!create) return null;
        piece.swipe_info = [];
    }
    if (!piece.swipe_info[swipeId] || typeof piece.swipe_info[swipeId] !== 'object') {
        if (!create) return null;
        piece.swipe_info[swipeId] = {};
    }
    if (!piece.swipe_info[swipeId].extra || typeof piece.swipe_info[swipeId].extra !== 'object') {
        if (!create) return null;
        piece.swipe_info[swipeId].extra = {};
    }
    return piece.swipe_info[swipeId].extra;
}

function storeHiddenRecord(piece, machineBlock, swipeId = Number(piece?.swipe_id), { pieceLevel = true } = {}) {
    if (!piece || !machineBlock) return;
    if (pieceLevel) {
        piece.extra = ensureExtra(piece.extra);
        piece.extra.memo_n_manual_table_edit = machineBlock;
    }
    const swipeExtra = getSwipeExtra(piece, swipeId, true);
    if (swipeExtra) swipeExtra.memo_n_manual_table_edit = machineBlock;
}

function detectLegacyRecord(values) {
    for (const value of values) {
        const record = trailingMachineRecord(value, 2);
        if (record) return record.block;
    }
    return null;
}

function cleanExtraFields(extra, machineBlock) {
    if (!extra || typeof extra !== 'object' || !machineBlock) return false;
    let changed = false;
    for (const key of VISIBLE_EXTRA_KEYS) {
        if (typeof extra[key] !== 'string') continue;
        const cleaned = stripKnownRecord(extra[key], machineBlock);
        if (!cleaned.changed) continue;
        changed = true;
        if (cleaned.value) extra[key] = cleaned.value;
        else delete extra[key];
    }
    return changed;
}

function sanitizePieceInMemory(piece, { legacy = true } = {}) {
    if (!piece || piece.is_user === true) return false;
    let changed = false;

    piece.extra = ensureExtra(piece.extra);
    const activeId = Number(piece.swipe_id);
    const activeSwipeExtra = getSwipeExtra(piece, activeId, false);
    const activeSwipe = Array.isArray(piece.swipes) && Number.isInteger(activeId) && activeId >= 0 && activeId < piece.swipes.length
        ? String(piece.swipes[activeId] ?? '')
        : '';

    let activeBlock = String(
        piece.extra.memo_n_manual_table_edit
        || activeSwipeExtra?.memo_n_manual_table_edit
        || '',
    ).trim();

    if (!activeBlock && legacy) {
        activeBlock = detectLegacyRecord([
            piece.mes,
            activeSwipe,
            piece.extra.display_text,
            piece.extra.reasoning_display_text,
            activeSwipeExtra?.display_text,
            activeSwipeExtra?.reasoning_display_text,
        ]) || '';
        if (activeBlock) {
            storeHiddenRecord(piece, activeBlock, activeId, { pieceLevel: true });
            changed = true;
        }
    }

    if (activeBlock) {
        const mes = stripKnownRecord(piece.mes, activeBlock);
        if (mes.changed) {
            piece.mes = mes.value;
            changed = true;
        }

        if (cleanExtraFields(piece.extra, activeBlock)) changed = true;

        if (Array.isArray(piece.swipes) && Number.isInteger(activeId) && activeId >= 0 && activeId < piece.swipes.length) {
            const swipe = stripKnownRecord(piece.swipes[activeId], activeBlock);
            if (swipe.changed) {
                piece.swipes[activeId] = swipe.value || String(piece.mes ?? '').trim();
                changed = true;
            }
        }

        const extra = getSwipeExtra(piece, activeId, true);
        if (extra && !extra.memo_n_manual_table_edit) {
            extra.memo_n_manual_table_edit = activeBlock;
            changed = true;
        }
        if (cleanExtraFields(extra, activeBlock)) changed = true;
    }

    // 非当前Swipe也逐个处理自己的手动记录；不会拿当前Swipe的记录去误删其他候选。
    if (Array.isArray(piece.swipes)) {
        for (let swipeId = 0; swipeId < piece.swipes.length; swipeId += 1) {
            if (swipeId === activeId) continue;
            const extra = getSwipeExtra(piece, swipeId, false);
            let block = String(extra?.memo_n_manual_table_edit || '').trim();
            if (!block && legacy) {
                block = detectLegacyRecord([
                    piece.swipes[swipeId],
                    extra?.display_text,
                    extra?.reasoning_display_text,
                ]) || '';
                if (block) {
                    storeHiddenRecord(piece, block, swipeId, { pieceLevel: false });
                    changed = true;
                }
            }
            if (!block) continue;

            const swipe = stripKnownRecord(piece.swipes[swipeId], block);
            if (swipe.changed) {
                piece.swipes[swipeId] = swipe.value;
                changed = true;
            }
            const writableExtra = getSwipeExtra(piece, swipeId, true);
            if (cleanExtraFields(writableExtra, block)) changed = true;
        }
    }

    return changed;
}

function requestText(value) {
    if (Array.isArray(value)) return value.map(requestText).join('\n');
    if (!value || typeof value !== 'object') return String(value ?? '');
    if (typeof value.content === 'string') return value.content;
    return requestText(value.ordered_prompts || value.messages || value.prompt || value.systemPrompt || '');
}

function isMemoRecordOnlyConfig(config) {
    const text = requestText(config);
    return text.includes('Memo独立表格记录器')
        || text.includes('[Memo七表独立记录')
        || text.includes('# Memo独立记录操作协议')
        || text.includes('Memo世界状态表格整理器');
}

async function withManualRawIsolation(task) {
    const helper = globalThis.TavernHelper;
    const original = helper?.generateRaw;
    if (!helper || typeof original !== 'function') return await task();

    const isolated = function (config, ...rest) {
        if (!isMemoRecordOnlyConfig(config)) return original.call(this, config, ...rest);
        const next = { ...(config || {}), should_stream: false };
        console.log('[Memo-N] 手动记录raw请求已切换为非流式隔离传输');
        return original.call(this, next, ...rest);
    };

    helper.generateRaw = isolated;
    try {
        return await task();
    } finally {
        if (helper.generateRaw === isolated) helper.generateRaw = original;
    }
}

function livePieceAt(index, fallback = null) {
    const chat = USER.getContext?.()?.chat;
    if (Array.isArray(chat) && Number.isInteger(index) && index >= 0 && index < chat.length) {
        return chat[index];
    }
    if (fallback && Array.isArray(chat) && chat.includes(fallback)) return fallback;
    return USER.getChatPiece?.()?.piece || fallback;
}

async function cleanupLegacyVisibleRecords() {
    const chat = USER.getContext?.()?.chat;
    if (!Array.isArray(chat) || !chat.length) return false;

    let changed = false;
    for (const piece of chat) {
        if (sanitizePieceInMemory(piece, { legacy: true })) changed = true;
    }

    if (!changed) return false;
    await Promise.resolve(USER.saveChat?.());
    await Promise.resolve(reloadCurrentChat());
    console.log('[Memo-N] 已从正文、Swipe、display_text与reasoning显示通道清理旧手动机器记录');
    return true;
}

function detachLegacyManualClickHandlers() {
    try {
        if (globalThis.jQuery) {
            jQuery(document).off('click', '#trigger_step_by_step_button');
            jQuery('#trigger_step_by_step_button').off('click');
        }
    } catch (error) {
        console.warn('[Memo-N] 移除旧手动更新点击处理器失败，将继续依赖捕获阶段拦截', error);
    }
}

function configureManualUi() {
    detachLegacyManualClickHandlers();
    const input = $('#separateReadContextLayers');
    const label = $('label[for="separateReadContextLayers"]');
    if (label.length) {
        label.text('上下文轮数');
        label.attr('title', '1轮 = 当前待记录AI回复之前的用户消息 + 当前待记录AI回复；AI回复本身作为本轮待记录内容单独发送');
    }
    if (input.length) input.attr('title', '按对话轮读取。1轮会带上触发当前AI回复的用户消息，当前AI回复本身不重复放入上下文。');
}

async function postManualCleanup(targetIndex, fallbackPiece) {
    let livePiece = livePieceAt(targetIndex, fallbackPiece);
    let changed = sanitizePieceInMemory(livePiece, { legacy: true });
    if (changed) await Promise.resolve(USER.saveChat?.());

    // TableTwoStepSummary内部会reload；这里重新取得reload后的实时piece，再强制重绘，不能继续只处理旧对象引用。
    await Promise.resolve(reloadCurrentChat());
    livePiece = livePieceAt(targetIndex, fallbackPiece);
    changed = sanitizePieceInMemory(livePiece, { legacy: true });
    if (changed) {
        await Promise.resolve(USER.saveChat?.());
        await Promise.resolve(reloadCurrentChat());
    }

    // 某些扩展会在生成结束事件之后再写display/reasoning显示字段，再做一次延迟复核。
    setTimeout(async () => {
        try {
            const delayedPiece = livePieceAt(targetIndex, fallbackPiece);
            const repaired = sanitizePieceInMemory(delayedPiece, { legacy: true });
            if (repaired) {
                await Promise.resolve(USER.saveChat?.());
                await Promise.resolve(reloadCurrentChat());
            }
        } catch (error) {
            console.warn('[Memo-N] 手动更新完成后的延迟显示复核失败', error);
        }
    }, 250);
}

async function runManualUpdate() {
    if (manualBusy) {
        EDITOR.info('手动更新正在执行，请等待当前这一次完成。');
        return;
    }
    manualBusy = true;
    const beforeChat = USER.getContext?.()?.chat;
    const targetPiece = USER.getChatPiece?.()?.piece;
    const targetIndex = Array.isArray(beforeChat) ? beforeChat.indexOf(targetPiece) : -1;
    try {
        const result = await withManualRawIsolation(() => TableTwoStepSummary('manual'));
        if (result === false || result === 'stale' || result === 'detached') return;
        await postManualCleanup(targetIndex, targetPiece);
        EDITOR.success('独立填表完成');
    } catch (error) {
        console.error('[Memo-N][manual-round-context] 手动更新启动失败', error);
        EDITOR.error(`手动更新启动失败：${error?.message || error}`);
    } finally {
        manualBusy = false;
    }
}

function install() {
    if (globalThis[INSTALL_FLAG]) return;
    globalThis[INSTALL_FLAG] = true;

    document.addEventListener('click', event => {
        const target = event.target?.closest?.('#trigger_step_by_step_button');
        if (!target) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        runManualUpdate();
    }, true);

    const renderedEvent = APP?.event_types?.CHARACTER_MESSAGE_RENDERED;
    if (renderedEvent) {
        APP.eventSource.on(renderedEvent, chatId => {
            if (renderRepairBusy) return;
            const piece = USER.getContext?.()?.chat?.[Number(chatId)];
            const activeId = Number(piece?.swipe_id);
            const marker = piece?.extra?.memo_n_manual_table_edit || getSwipeExtra(piece || {}, activeId, false)?.memo_n_manual_table_edit;
            if (!marker) return;
            if (!sanitizePieceInMemory(piece, { legacy: false })) return;
            renderRepairBusy = true;
            Promise.resolve(USER.saveChat?.())
                .then(() => reloadCurrentChat())
                .catch(error => console.warn('[Memo-N] 渲染后手动记录显示修复失败', error))
                .finally(() => setTimeout(() => { renderRepairBusy = false; }, 300));
        });
    }

    jQuery(() => {
        // index.js 的ready回调内部有异步模板加载，因此这里需要重复解绑/配置，确保旧按钮处理器不会在稍后重新挂回来。
        configureManualUi();
        setTimeout(configureManualUi, 500);
        setTimeout(configureManualUi, 1500);
        setTimeout(configureManualUi, 3000);

        cleanupLegacyVisibleRecords().catch(error => console.warn('[Memo-N] 清理旧手动记录显示失败', error));
        setTimeout(() => cleanupLegacyVisibleRecords().catch(() => {}), 800);
    });

    console.log('[Memo-N] v0.17 手动记录可见通道隔离：实时piece + 单入口 + 非流式raw + 全显示字段清理');
}

install();

export {
    cleanupLegacyVisibleRecords,
    sanitizePieceInMemory,
    trailingBareOperations,
    trailingMachineRecord,
    trailingTableEdit,
};
