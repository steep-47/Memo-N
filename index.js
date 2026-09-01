import { APP, BASE, DERIVED, EDITOR, SYSTEM, USER } from './core/manager.js';
import { openTableRendererPopup, updateSystemMessageTableStatus } from "./scripts/renderer/tablePushToChat.js";
import { loadSettings } from "./scripts/settings/userExtensionSetting.js";
import { ext_getAllTables, ext_exportAllTablesAsJson } from './scripts/settings/standaloneAPI.js';
import { openTableDebugLogPopup } from "./scripts/settings/devConsole.js";
import { TableTwoStepSummary } from "./scripts/runtime/separateTableUpdate.js?v=memon89-sixfix7";
import { initTest } from "./components/_fotTest.js";
import { initAppHeaderTableDrawer, openAppHeaderTableDrawer } from "./scripts/renderer/appHeaderTableBaseDrawer.js";
import { initRefreshTypeSelector } from './scripts/runtime/absoluteRefresh.js?v=memon6';
import {refreshTempView, updateTableContainerPosition} from "./scripts/editor/tableTemplateEditView.js";
import { functionToBeRegistered } from "./services/debugs.js";
import { parseLooseDict, replaceUserTag } from "./utils/stringUtil.js";
import {executeTranslation} from "./services/translate.js";
import applicationFunctionManager from "./services/appFuncManager.js"
import {SheetBase} from "./core/table/base.js";
import { Cell } from "./core/table/cell.js";
import { executeMemoTableEdit, restoreMemoSnapshot } from './scripts/runtime/safeTableExecutor.js?v=memon89-sixfix7';
import { getMemoTableEditChannel } from './scripts/runtime/memoResponseChannels.js?v=memon6';
import { initExternalDataAdapter } from './external-data-adapter.js';


console.log("______________________记忆插件：开始加载______________________")

const VERSION = '0.1.0-memon.6'

const editErrorInfo = {
    forgotCommentTag: false,
    functionNameError: false,
}

/**
 * 修复值中不正确的转义单引号
 * @param {*} value
 * @returns
 */
function fixUnescapedSingleQuotes(value) {
    if (typeof value === 'string') {
        return value.replace(/\\'/g, "'");
    }
    if (typeof value === 'object' && value !== null) {
        for (const key in value) {
            if (Object.prototype.hasOwnProperty.call(value, key)) {
                value[key] = fixUnescapedSingleQuotes(value[key]);
            }
        }
    }
    return value;
}

/**
 * 通过表格索引查找表格结构
 * @param {number} index 表格索引
 * @returns 此索引的表格结构
 */
export function findTableStructureByIndex(index) {
    return USER.tableBaseSetting.tableStructure[index];
}

/**
 * 检查数据是否为Sheet实例，不是则转换为新的Sheet实例
 * @param {Object[]} dataTable 所有表格对象数组
 */
function checkPrototype(dataTable) {
    return dataTable;
}

export function buildSheetsByTemplates(targetPiece) {
    BASE.sheetsData.context = [];
    const templates = BASE.templates
    templates.forEach(template => {
        if(template.enable === false) return
        if (!template || !template.hashSheet || !Array.isArray(template.hashSheet) || template.hashSheet.length === 0 || !Array.isArray(template.hashSheet[0]) || !template.cellHistory || !Array.isArray(template.cellHistory)) {
            console.error(`[Memory Enhancement] 在 buildSheetsByTemplates 中遇到无效的模板结构 (缺少 hashSheet 或 cellHistory)。跳过模板:`, template);
            return;
        }
        const sheet = new SheetBase(template)
        sheet.uid = generateTableUid(sheet.name)
        sheet.enable = template.enable
        sheet.sendToContext = template.sendToContext
        BASE.sheetsData.context.push(sheet)
    })
    if(targetPiece) {
        BASE.sheetsData.context.forEach(sheet => sheet.save(targetPiece, true))
    }
}

function generateTableUid(tableName) {
    return `${tableName}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export function convertOldTablesToNewSheets(oldTables) {
    if (!Array.isArray(oldTables)) return [];
    return oldTables.map(table => {
        if (table instanceof SheetBase) return table;
        try {
            return new SheetBase(table);
        } catch (error) {
            console.error('[Memory Enhancement] 转换旧表格失败:', error, table);
            return null;
        }
    }).filter(Boolean);
}

export function getTableEditTag(text) {
    const matches = [];
    const regex = /<tableEdit>([\s\S]*?)<\/tableEdit>/gi;
    let match;
    while ((match = regex.exec(String(text ?? ''))) !== null) matches.push(match[1]);
    return { matches };
}

export function getTablePrompt(piece) {
    const sheets = BASE.getChatSheets?.() || [];
    return sheets.filter(sheet => sheet?.enable !== false).map((sheet, index) => {
        const headers = sheet.getHeader?.() || [];
        const rows = sheet.getContent?.(true) || [];
        return `#${index} ${sheet.name}\n表头：${headers.join(' | ')}\n${rows.map(row => row.join(' | ')).join('\n')}`;
    }).join('\n\n');
}

export function getTablePromptByPiece(piece) {
    if (!piece?.memo_n_hash_sheets) return getTablePrompt(piece);
    try {
        const sheets = BASE.hashSheetsToSheets(piece.memo_n_hash_sheets);
        return (sheets || []).filter(sheet => sheet?.enable !== false).map((sheet, index) => {
            const headers = sheet.getHeader?.() || [];
            const rows = sheet.getContent?.(true) || [];
            return `#${index} ${sheet.name}\n表头：${headers.join(' | ')}\n${rows.map(row => row.join(' | ')).join('\n')}`;
        }).join('\n\n');
    } catch (_) {
        return getTablePrompt(piece);
    }
}

export function getTableEditActionInfo() {
    return '';
}

export function getTableEditPrompt() {
    return USER.tableBaseSetting?.message_template || '';
}

export async function processTableEdit(text, piece = null) {
    const { matches } = getTableEditTag(text);
    if (!matches.length) return false;
    const result = executeMemoTableEdit(matches, piece || USER.getChatPiece?.()?.piece);
    if (!result.ok) {
        EDITOR.warning(`表格记录失败：${result.error}`);
        return false;
    }
    return true;
}

export async function updateTableData() {
    updateSystemMessageTableStatus();
}

export async function init() {
    try {
        await loadSettings();
        initAppHeaderTableDrawer();
        initRefreshTypeSelector();
        initExternalDataAdapter();
        initTest();
        functionToBeRegistered();
        updateSystemMessageTableStatus();
        refreshTempView();
        updateTableContainerPosition();
        console.log('[Memo-N] 初始化完成');
    } catch (error) {
        console.error('[Memo-N] 初始化失败', error);
        throw error;
    }
}

$(async () => {
    await init();
});

window.memoN = window.memoN || {};
window.memoN.VERSION = VERSION;
window.memoN.openTableRendererPopup = openTableRendererPopup;
window.memoN.openAppHeaderTableDrawer = openAppHeaderTableDrawer;
window.memoN.ext_getAllTables = ext_getAllTables;
window.memoN.ext_exportAllTablesAsJson = ext_exportAllTablesAsJson;
window.memoN.openTableDebugLogPopup = openTableDebugLogPopup;
window.memoN.TableTwoStepSummary = TableTwoStepSummary;
window.memoN.restoreMemoSnapshot = restoreMemoSnapshot;
