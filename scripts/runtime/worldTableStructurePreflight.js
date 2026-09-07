import { BASE, EDITOR, USER } from '../../core/manager.js';
import { ensureSevenTableWorld, STANDARD_NAMES } from './sevenTableMigration.js?v=memon83';
import { repairMissingColumnsBeforeCleanup } from './tableStructureRepair.js?v=memon83';

const INSTALL_FLAG = '__memoNWorldTableStructurePreflightV1';
const TARGET_SELECTORS = '#trigger_step_by_step_button, #table_clear_up';
let running = false;

function expectedHeaders(tableName) {
    const structure = (USER.tableBaseSetting?.tableStructure || []).find(item => item?.tableName === tableName);
    return Array.isArray(structure?.columns) ? structure.columns.map(value => String(value ?? '').trim()).filter(Boolean) : [];
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
        // sevenTableMigration 在已有至少一张表时可以补齐缺表；若整组表都丢失，
        // 先从当前七表模板重建空结构，再进入统一迁移/表头修复流程。
        if ((BASE.getChatSheets?.() || []).length === 0) {
            BASE.initHashSheet?.(true);
        }

        ensureSevenTableWorld();
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

    // 使用捕获阶段，保证先于旧的 jQuery 点击处理器完成结构修复。
    document.addEventListener('click', event => {
        const target = event.target?.closest?.(TARGET_SELECTORS);
        if (!target) return;
        if (repairWorldTableStructure()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }, true);

    console.log('[Memo-N] 独立操作七表结构前置修复已加载：缺表/缺表头先修，随后再记录或整理');
}

install();

export { repairWorldTableStructure, verifySevenTableStructure };
