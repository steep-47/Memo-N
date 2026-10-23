import { APP, BASE, EDITOR, USER } from '../../core/manager.js';
import { defaultSettings } from '../../data/pluginSetting.js';
import { HISTORY_TABLE_RULES } from './recordSemantics.js';
import {
    ensureSevenTableWorld,
    normalizeSettingsStructure,
    syncGlobalTemplates,
    STANDARD_NAMES,
} from './sevenTableMigration.js?v=memon83';
import { repairMissingColumnsBeforeCleanup } from './tableStructureRepair.js?v=memon83';

const INSTALL_FLAG = '__memoNWorldTableStructurePreflightV2';
const TARGET_SELECTORS = '#trigger_step_by_step_button, #table_clear_up';
let running = false;
let ruleSyncQueued = false;

function expectedHeaders(tableName) {
    const structure = (USER.tableBaseSetting?.tableStructure || []).find(item => item?.tableName === tableName);
    return Array.isArray(structure?.columns) ? structure.columns.map(value => String(value ?? '').trim()).filter(Boolean) : [];
}

function setIfDifferent(target, key, value) {
    if (!target || target[key] === value) return false;
    target[key] = value;
    return true;
}

function syncRuleData(target, structure) {
    if (!target || !structure) return false;
    const values = {
        note: String(structure.note || ''),
        initNode: String(structure.initNode || ''),
        insertNode: String(structure.insertNode || ''),
        updateNode: String(structure.updateNode || ''),
        deleteNode: String(structure.deleteNode || ''),
    };
    let changed = false;
    for (const [key, value] of Object.entries(values)) {
        changed = setIfDifferent(target, key, value) || changed;
    }
    const description = [values.note, values.initNode, values.insertNode, values.updateNode, values.deleteNode]
        .filter(Boolean)
        .join('\n');
    changed = setIfDifferent(target, 'description', description) || changed;
    return changed;
}

function primeCanonicalRuleSource() {
    const history = defaultSettings?.tableStructure?.find?.(item => item?.tableName === '历史事件表');
    let changed = false;
    if (history) {
        for (const [key, value] of Object.entries(HISTORY_TABLE_RULES)) {
            changed = setIfDifferent(history, key, value) || changed;
        }
    }

    const settingsChanged = normalizeSettingsStructure();
    if (settingsChanged) {
        changed = true;
        try { USER.saveSettings?.(); }
        catch (error) { console.warn('[Memo-N][rule-migration] 保存七表标准规则设置失败', error); }
    }

    try {
        if (syncGlobalTemplates()) changed = true;
    } catch (error) {
        console.warn('[Memo-N][rule-migration] 全局模板规则同步失败，保留当前聊天数据', error);
    }
    return changed;
}

function syncCurrentChatRuleMetadata({ persist = true } = {}) {
    const context = USER.getContext?.();
    const sessionChat = context?.chat;
    if (!Array.isArray(sessionChat)) return false;

    const structures = Array.isArray(USER.tableBaseSetting?.tableStructure)
        ? USER.tableBaseSetting.tableStructure
        : [];
    const byName = new Map(structures.map(item => [item?.tableName, item]));
    let changed = false;

    for (const sheet of BASE.getChatSheets?.() || []) {
        if (!STANDARD_NAMES.includes(sheet?.name)) continue;
        const structure = byName.get(sheet.name);
        if (!structure) continue;

        let sheetChanged = false;
        if (sheet.source?.data) sheetChanged = syncRuleData(sheet.source.data, structure) || sheetChanged;
        if (sheet.data && sheet.data !== sheet.source?.data) sheetChanged = syncRuleData(sheet.data, structure) || sheetChanged;
        if (!sheetChanged) continue;

        // null 明确绕过 Sheet.save 的默认 targetPiece 参数：只写 chatMetadata 中的表格元数据，
        // 不创建/移动/覆盖任何消息级 memo_n_hash_sheets 或 Swipe 快照。
        const saved = sheet.save?.(null, true);
        if (saved === false) throw new Error(`标准表 ${sheet.name} 规则元数据保存失败`);
        changed = true;
    }

    if (changed && persist && USER.getContext?.()?.chat === sessionChat) {
        try {
            const saving = USER.saveChat?.();
            if (saving?.catch) saving.catch(error => console.error('[Memo-N][rule-migration] 保存聊天规则迁移失败', error));
        } catch (error) {
            console.error('[Memo-N][rule-migration] 保存聊天规则迁移失败', error);
        }
        console.log('[Memo-N][rule-migration] 已同步当前旧聊天的七表规则元数据；数据行与历史快照未改动');
    }
    return changed;
}

function scheduleRuleMetadataSync() {
    if (ruleSyncQueued) return;
    const sessionChat = USER.getContext?.()?.chat;
    if (!Array.isArray(sessionChat)) return;
    ruleSyncQueued = true;
    setTimeout(() => {
        ruleSyncQueued = false;
        if (USER.getContext?.()?.chat !== sessionChat) return;
        try {
            primeCanonicalRuleSource();
            syncCurrentChatRuleMetadata();
        } catch (error) {
            console.error('[Memo-N][rule-migration] 当前聊天规则自动迁移失败，未重建或覆盖数据行', error);
        }
    }, 0);
}

function verifySevenTableStructure() {
    const sheets = BASE.getChatSheets?.() || [];
    const missingTables = STANDARD_NAMES.filter(name => !sheets.some(sheet => sheet?.name === name));
    if (missingTables.length) throw new Error(`仍缺少标准表：${missingTables.join('、')}`);

    for (const name of STANDARD_NAMES) {
        const sheet = sheets.find(item => item?.name === name);
        const expected = expectedHeaders(name);
        if (!expected.length) continue;
        const actual = (sheet?.getHeader?.() || []).map(value => String(value ?? '').trim());
        const missingHeaders = expected.filter(header => !actual.includes(header));
        if (missingHeaders.length) throw new Error(`${name}仍缺少表头：${missingHeaders.join('、')}`);
    }
    return true;
}

function repairWorldTableStructure() {
    if (running) return true;
    const piece = USER.getChatPiece?.()?.piece;
    if (!piece) return true;

    running = true;
    try {
        primeCanonicalRuleSource();
        const liveSheets = BASE.getChatSheets?.() || [];
        if (liveSheets.length === 0) {
            const orphanSnapshot = piece?.memo_n_hash_sheets && typeof piece.memo_n_hash_sheets === 'object'
                ? Object.keys(piece.memo_n_hash_sheets).length
                : 0;
            if (orphanSnapshot > 0) {
                throw new Error('当前表格目录为空，但聊天仍保留旧表格快照；为避免覆盖旧数据，本次不会用空模板强行重建');
            }
            BASE.initHashSheet?.(true);
        }

        // 缺少整张标准表时由七表迁移器按标准模板补建；已有表的数据保持原样。
        ensureSevenTableWorld();

        // 缺表头、旧别名表头、列顺序错位等由结构修复器按字段名投影修复，
        // 同时同步当前 Swipe 快照，避免界面重载后又被旧结构覆盖。
        const repaired = repairMissingColumnsBeforeCleanup({
            notify: false,
            piece,
            syncSnapshot: true,
        }) || [];

        verifySevenTableStructure();

        if (repaired.length) {
            console.log('[Memo-N][structure-preflight] 已在独立操作前修复表格结构：', repaired);
        } else {
            console.log('[Memo-N][structure-preflight] 七表结构检查通过');
        }
        return true;
    } catch (error) {
        console.error('[Memo-N][structure-preflight] 表格结构修复失败', error);
        EDITOR.error(`表格结构修复失败：${error?.message || error}。已停止本次操作，避免在坏结构上继续记录/整理。`);
        return false;
    } finally {
        running = false;
    }
}

function install() {
    if (globalThis[INSTALL_FLAG]) return;
    globalThis[INSTALL_FLAG] = true;

    primeCanonicalRuleSource();

    // 打开或切换旧聊天时只同步标准表的规则元数据；不重建表、不改表头、不改任何数据行或历史快照。
    const chatEvents = new Set([
        APP.event_types?.CHAT_CHANGED,
        APP.event_types?.CHAT_LOADED,
    ].filter(Boolean));
    for (const event of chatEvents) APP.eventSource.on(event, scheduleRuleMetadataSync);
    scheduleRuleMetadataSync();

    // 使用捕获阶段，保证先于旧的 jQuery 点击处理器完成结构修复。
    document.addEventListener('click', event => {
        const target = event.target?.closest?.(TARGET_SELECTORS);
        if (!target) return;
        if (repairWorldTableStructure()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }, true);

    console.log('[Memo-N] 七表前置守卫v2已加载：旧聊天自动同步标准规则元数据；缺表/缺表头仅在操作前修复');
}

install();

export {
    repairWorldTableStructure,
    scheduleRuleMetadataSync,
    syncCurrentChatRuleMetadata,
    verifySevenTableStructure,
};
