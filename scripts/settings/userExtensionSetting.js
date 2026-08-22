import { BASE, EDITOR, SYSTEM, USER } from '../../core/manager.js';
import { updateSystemMessageTableStatus, updateAlternateTable } from '../renderer/tablePushToChat.js';
import {
    rebuildSheets,
    modifyRebuildTemplate,
    newRebuildTemplate,
    deleteRebuildTemplate,
    exportRebuildTemplate,
    importRebuildTemplate,
    triggerStepByStepNow,
} from '../runtime/absoluteRefresh.js?v=memon5';
import { generateDeviceId } from '../../utils/utility.js';
import { updateModelList, handleApiTestRequest, processApiKey } from './standaloneAPI.js';
import { filterTableDataPopup } from '../../data/pluginSetting.js';
import { initRefreshTypeSelector } from '../runtime/absoluteRefresh.js?v=memon5';
import { customSheetsStylePopup } from '../editor/customSheetsStyle.js';
import { buildSheetsByTemplates } from '../../index.js';

function formatDeep() {
    USER.tableBaseSetting.deep = Math.abs(USER.tableBaseSetting.deep);
}

function updateSwitch(selector, switchValue) {
    $(selector).prop('checked', Boolean(switchValue));
}

function updateTableView() {
    const extensionsMenu = document.querySelector('#extensionsMenu');
    if (!extensionsMenu) return;

    if (USER.tableBaseSetting.show_drawer_in_extension_list === true) {
        if (document.querySelector('#drawer_in_extension_list_button')) return;
        $(extensionsMenu).append(`
<div id="drawer_in_extension_list_button" class="list-group-item flex-container flexGap5 interactable">
    <div class="fa-solid fa-table extensionsMenuExtensionButton"></div>
    <span>增强记忆表格</span>
</div>`);
        $('#drawer_in_extension_list_button').on('click', () => {
            $('#table_drawer_icon').click();
            $('#database_button').click();
        });
    } else {
        document.querySelector('#drawer_in_extension_list_button')?.remove();
    }
}

function getSheetsCellStyle() {
    let container = document.querySelector('#sheet_cell_style_container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'sheet_cell_style_container';
        document.body.appendChild(container);
    }
    container.innerHTML = '';

    const style = document.createElement('style');
    switch (USER.tableBaseSetting.table_cell_width_mode) {
        case 'wide1_cell':
            style.innerHTML = 'tr .sheet-cell { max-width: 800px !important; white-space: normal !important; }';
            break;
        case 'wide1_2_cell':
            style.innerHTML = 'tr .sheet-cell { max-width: 400px !important; white-space: normal !important; }';
            break;
        case 'wide1_4_cell':
            style.innerHTML = 'tr .sheet-cell { max-width: 200px !important; white-space: normal !important; }';
            break;
        default:
            style.innerHTML = '';
    }
    container.appendChild(style);
}

async function importTableSet() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';

    input.addEventListener('change', async event => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async e => {
            try {
                const importedData = JSON.parse(e.target.result);
                const keyListHTML = `<ul>${Object.keys(importedData).map(key => `<li>${key}</li>`).join('')}</ul>`;
                const popup = $(`<div><p>即将导入的设置项 (第一级):</p>${keyListHTML}<p>是否继续导入并重置这些设置？</p></div>`);
                const confirmed = await EDITOR.callGenericPopup(
                    popup,
                    EDITOR.POPUP_TYPE.CONFIRM,
                    '导入设置确认',
                    { okButton: '继续导入', cancelButton: '取消' },
                );
                if (!confirmed) return;

                for (const [key, value] of Object.entries(importedData)) {
                    // 已废弃的人物来源策略不再导入，世界书NPC与自动NPC统一处理。
                    if (key === 'preset_character_policy' || key === 'pinned_character_names') continue;
                    USER.tableBaseSetting[key] = value;
                }

                renderSetting();
                initTableStructureToTemplate();
                BASE.refreshTempView(true);
                EDITOR.success('导入成功并已重置所选设置');

                try {
                    const { piece } = USER.getChatPiece() || {};
                    if (!piece) {
                        EDITOR.warning('因为当前聊天没有聊天载体所以跳过预设表格模板替换');
                        return;
                    }

                    const chatArr = USER.getContext()?.chat || [];
                    let isSheetEmpty = true;
                    for (let i = chatArr.length - 1; i >= 0; i--) {
                        const snapshot = chatArr[i]?.memo_n_hash_sheets;
                        if (!snapshot) continue;
                        isSheetEmpty = !Object.values(snapshot).some(sheet => Array.isArray(sheet) && sheet.length > 1);
                        break;
                    }

                    const replace = isSheetEmpty || await EDITOR.callGenericPopup(
                        '是否清空旧表格数据（无法找回），并替换为新表格预设的模板（包括表格结构）<br>仅限新旧表格预设模板一致时可不替换<br>若新旧模板不一致，例如更换为不同表格预设时，应选择替换，否则将不能正常使用新预设<br>若同一表格预设更新版本，应参见预设发布说明，模板一致时可不替换',
                        EDITOR.POPUP_TYPE.CONFIRM,
                        '替换模板确认',
                        { okButton: '替换', cancelButton: '不替换' },
                    );
                    if (!replace) {
                        EDITOR.success?.('已取消模板替换');
                        return;
                    }

                    BASE.sheetsData.context = {};
                    for (const msg of chatArr) {
                        if (msg && Object.prototype.hasOwnProperty.call(msg, 'memo_n_hash_sheets')) delete msg.memo_n_hash_sheets;
                    }
                    buildSheetsByTemplates(piece);
                    BASE.refreshContextView();
                    BASE.refreshTempView(true);
                    updateSystemMessageTableStatus(true);
                    EDITOR.success('已用全局模板覆盖到 chat 域');
                } catch (error) {
                    console.warn('[Preset Import] 覆盖 chat 域模板时发生非致命错误：', error);
                }
            } catch (error) {
                EDITOR.error('JSON 文件解析失败，请检查文件格式是否正确。', error.message, error);
                console.error('文件读取或解析错误:', error);
            }
        };
        reader.onerror = error => EDITOR.error('文件读取失败', error?.message, error);
        reader.readAsText(file);
    });

    input.click();
}

async function exportTableSet() {
    templateToTableStructure();
    const { filterData, confirmation } = await filterTableDataPopup(USER.tableBaseSetting, '请选择需要导出的数据', '');
    if (!confirmation) return;

    const cleaned = { ...filterData };
    delete cleaned.preset_character_policy;
    delete cleaned.pinned_character_names;

    try {
        const blob = new Blob([JSON.stringify(cleaned)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tableCustomConfig-${SYSTEM.generateRandomString(8)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        EDITOR.success('导出成功');
    } catch (error) {
        EDITOR.error('导出失败', error.message, error);
    }
}

async function resetSettings() {
    const { filterData, confirmation } = await filterTableDataPopup(USER.tableBaseDefaultSettings, '请选择需要重置的数据', '建议重置前先备份数据');
    if (!confirmation) return;

    try {
        for (const [key, value] of Object.entries(filterData)) USER.tableBaseSetting[key] = value;
        delete USER.tableBaseSetting.preset_character_policy;
        delete USER.tableBaseSetting.pinned_character_names;
        renderSetting();
        if ('tableStructure' in filterData) {
            initTableStructureToTemplate();
            BASE.refreshTempView(true);
        }
        EDITOR.success('已重置所选设置');
    } catch (error) {
        EDITOR.error('重置设置失败', error.message, error);
    }
}

function initBindings() {
    $('#table-set-import').on('click', importTableSet);
    $('#table-set-export').on('click', exportTableSet);
    $('#table-reset').on('click', resetSettings);

    $('#table_switch').change(function () {
        USER.tableBaseSetting.isExtensionAble = this.checked;
        EDITOR.success(this.checked ? '插件已开启' : '插件已关闭，可以打开和手动编辑表格但AI不会读表和生成');
        updateSystemMessageTableStatus();
    });
    $('#table_switch_debug_mode').change(function () {
        USER.tableBaseSetting.tableDebugModeAble = this.checked;
        EDITOR.success(this.checked ? '调试模式已开启' : '调试模式已关闭');
    });
    $('#table_read_switch').change(function () {
        USER.tableBaseSetting.isAiReadTable = this.checked;
        EDITOR.success(this.checked ? 'AI现在会读取表格' : 'AI现在将不会读表');
    });
    $('#table_edit_switch').change(function () {
        USER.tableBaseSetting.isAiWriteTable = this.checked;
        EDITOR.success(this.checked ? 'AI的更改现在会被写入表格' : 'AI的更改现在不会被写入表格');
    });

    $('#dataTable_injection_mode').change(function () {
        USER.tableBaseSetting.injection_mode = this.value;
    });
    $('#fill_table_time').change(function () {
        const stepByStep = $(this).val() === 'after';
        $('#reply_options').toggle(!stepByStep);
        $('#step_by_step_options').toggle(stepByStep);
        USER.tableBaseSetting.step_by_step = stepByStep;
    });
    $('#confirm_before_execution').change(function () {
        USER.tableBaseSetting.confirm_before_execution = this.checked;
    });
    $('#ignore_user_sent').change(function () {
        USER.tableBaseSetting.ignore_user_sent = this.checked;
    });
    $('#bool_silent_refresh').change(function () {
        USER.tableBaseSetting.bool_silent_refresh = this.checked;
    });
    $('#use_main_api').change(function () {
        USER.tableBaseSetting.use_main_api = this.checked;
    });
    $('#step_by_step_use_main_api').change(function () {
        USER.tableBaseSetting.step_by_step_use_main_api = this.checked;
    });

    $('#model_selector').change(function () {
        $('#custom_model_name').val(this.value);
        USER.IMPORTANT_USER_PRIVACY_DATA.custom_model_name = this.value;
        USER.saveSettings?.();
    });
    $('#table_to_chat').change(function () {
        USER.tableBaseSetting.isTableToChat = this.checked;
        EDITOR.success(this.checked ? '表格会被推送至对话中' : '关闭表格推送至对话');
        $('#table_to_chat_options').toggle(this.checked);
        updateSystemMessageTableStatus();
    });
    $('#show_settings_in_extension_menu').change(function () {
        USER.tableBaseSetting.show_settings_in_extension_menu = this.checked;
        updateTableView();
    });
    $('#alternate_switch').change(function () {
        USER.tableBaseSetting.alternate_switch = this.checked;
        EDITOR.success(this.checked ? '开启表格渲染穿插模式' : '关闭表格渲染穿插模式');
        updateTableView();
        updateAlternateTable();
    });
    $('#table_to_chat_mode').change(function () {
        USER.tableBaseSetting.table_to_chat_mode = this.value;
        $('#table_to_chat_is_micro_d').toggle(this.value === 'macro');
        updateSystemMessageTableStatus();
    });
    $('#table_cell_width_mode').change(function () {
        USER.tableBaseSetting.table_cell_width_mode = this.value;
        getSheetsCellStyle();
    });

    $('#custom_api_url').on('input', function () {
        USER.IMPORTANT_USER_PRIVACY_DATA.custom_api_url = $(this).val();
        USER.saveSettings?.();
    });

    let apiKeyDebounceTimer;
    $('#custom_api_key').on('input', function () {
        clearTimeout(apiKeyDebounceTimer);
        apiKeyDebounceTimer = setTimeout(async () => {
            try {
                const result = processApiKey($(this).val(), generateDeviceId());
                USER.IMPORTANT_USER_PRIVACY_DATA.custom_api_key = result.encryptedResult.encrypted || result.encryptedResult;
                USER.saveSettings?.();
                EDITOR.success(result.message);
            } catch (error) {
                console.error('API Key 处理失败:', error);
                EDITOR.error('未能获取到API KEY，请重新输入~', error.message, error);
            }
        }, 500);
    });

    $('#custom_model_name').on('input', function () {
        USER.IMPORTANT_USER_PRIVACY_DATA.custom_model_name = $(this).val();
        USER.saveSettings?.();
    });
    $('#dataTable_message_template').on('input', function () {
        USER.tableBaseSetting.message_template = $(this).val();
    });
    $('#dataTable_deep').on('input', function () {
        USER.tableBaseSetting.deep = Math.abs($(this).val());
    });
    $('#step_by_step_user_prompt').on('input', function () {
        USER.tableBaseSetting.step_by_step_user_prompt = $(this).val();
    });
    $('#separateReadContextLayers').on('input', function () {
        USER.tableBaseSetting.separateReadContextLayers = Number($(this).val());
    });
    $('#separateReadLorebook').change(function () {
        USER.tableBaseSetting.separateReadLorebook = this.checked;
        USER.saveSettings?.();
    });
    $('#reset_step_by_step_user_prompt').on('click', function () {
        const value = USER.tableBaseDefaultSettings.step_by_step_user_prompt;
        $('#step_by_step_user_prompt').val(value);
        USER.tableBaseSetting.step_by_step_user_prompt = value;
        EDITOR.success('分步填表提示词已重置为默认值。');
    });
    $('#rebuild_token_limit').on('input', function () {
        const value = $(this).val();
        $('#rebuild_token_limit_value').text(value);
        USER.tableBaseSetting.rebuild_token_limit_value = Number(value);
    });
    $('#custom_temperature').on('input', function () {
        const value = $(this).val();
        $('#custom_temperature_value').text(value);
        USER.tableBaseSetting.custom_temperature = Number(value);
    });
    $('#table_proxy_address').on('input', function () {
        USER.IMPORTANT_USER_PRIVACY_DATA.table_proxy_address = $(this).val();
        USER.saveSettings?.();
    });
    $('#table_proxy_key').on('input', function () {
        USER.IMPORTANT_USER_PRIVACY_DATA.table_proxy_key = $(this).val();
        USER.saveSettings?.();
    });

    $('#fetch_models_button').on('click', updateModelList);
    $(document).on('click', '#table_test_api_button', async () => {
        await handleApiTestRequest(
            $('#custom_api_url').val(),
            USER.IMPORTANT_USER_PRIVACY_DATA.custom_api_key,
            $('#custom_model_name').val(),
        );
    });
    $('#table_clear_up').on('click', rebuildSheets);
    $('#dataTable_to_chat_button').on('click', customSheetsStylePopup);
    $('#rebuild--set-rename').on('click', modifyRebuildTemplate);
    $('#rebuild--set-new').on('click', newRebuildTemplate);
    $('#rebuild--set-delete').on('click', deleteRebuildTemplate);
    $('#rebuild--set-export').on('click', exportRebuildTemplate);
    $('#rebuild--set-import').on('click', importRebuildTemplate);
    $('#rebuild--select').on('change', function () {
        USER.tableBaseSetting.lastSelectedTemplate = $(this).val();
        USER.saveSettings?.();
    });
    $(document).on('click', '#trigger_step_by_step_button', triggerStepByStepNow);
}

export function renderSetting() {
    $(`#dataTable_injection_mode option[value="${USER.tableBaseSetting.injection_mode}"]`).prop('selected', true);
    $(`#table_to_chat_mode option[value="${USER.tableBaseSetting.table_to_chat_mode}"]`).prop('selected', true);
    $(`#table_cell_width_mode option[value="${USER.tableBaseSetting.table_cell_width_mode}"]`).prop('selected', true);
    $('#dataTable_message_template').val(USER.tableBaseSetting.message_template);
    $('#dataTable_deep').val(USER.tableBaseSetting.deep);
    $('#rebuild_token_limit').val(USER.tableBaseSetting.rebuild_token_limit_value);
    $('#rebuild_token_limit_value').text(USER.tableBaseSetting.rebuild_token_limit_value);
    $('#custom_temperature').val(USER.tableBaseSetting.custom_temperature);
    $('#custom_temperature_value').text(USER.tableBaseSetting.custom_temperature);
    $('#step_by_step_user_prompt').val(USER.tableBaseSetting.step_by_step_user_prompt || '');
    $('#separateReadContextLayers').val(USER.tableBaseSetting.separateReadContextLayers);
    updateSwitch('#separateReadLorebook', USER.tableBaseSetting.separateReadLorebook);
    $('#fill_table_time').val(USER.tableBaseSetting.step_by_step ? 'after' : 'chat');
    refreshRebuildTemplate();

    $('#custom_api_url').val(USER.IMPORTANT_USER_PRIVACY_DATA.custom_api_url || '');
    $('#custom_api_key').val(USER.IMPORTANT_USER_PRIVACY_DATA.custom_api_key || '');
    $('#custom_model_name').val(USER.IMPORTANT_USER_PRIVACY_DATA.custom_model_name || '');
    $('#table_proxy_address').val(USER.IMPORTANT_USER_PRIVACY_DATA.table_proxy_address || '');
    $('#table_proxy_key').val(USER.IMPORTANT_USER_PRIVACY_DATA.table_proxy_key || '');

    updateSwitch('#table_switch', USER.tableBaseSetting.isExtensionAble);
    updateSwitch('#table_switch_debug_mode', USER.tableBaseSetting.tableDebugModeAble);
    updateSwitch('#table_read_switch', USER.tableBaseSetting.isAiReadTable);
    updateSwitch('#table_edit_switch', USER.tableBaseSetting.isAiWriteTable);
    updateSwitch('#table_to_chat', USER.tableBaseSetting.isTableToChat);
    updateSwitch('#confirm_before_execution', USER.tableBaseSetting.confirm_before_execution);
    updateSwitch('#use_main_api', USER.tableBaseSetting.use_main_api);
    updateSwitch('#step_by_step_use_main_api', USER.tableBaseSetting.step_by_step_use_main_api);
    updateSwitch('#bool_silent_refresh', USER.tableBaseSetting.bool_silent_refresh);
    updateSwitch('#ignore_user_sent', USER.tableBaseSetting.ignore_user_sent);
    updateSwitch('#show_settings_in_extension_menu', USER.tableBaseSetting.show_settings_in_extension_menu);
    updateSwitch('#alternate_switch', USER.tableBaseSetting.alternate_switch);

    $('#reply_options').toggle(!USER.tableBaseSetting.step_by_step);
    $('#step_by_step_options').toggle(USER.tableBaseSetting.step_by_step);
    $('#table_to_chat_options').toggle(USER.tableBaseSetting.isTableToChat);
    $('#table_to_chat_is_micro_d').toggle(USER.tableBaseSetting.table_to_chat_mode === 'macro');
}

export function loadSettings() {
    USER.IMPORTANT_USER_PRIVACY_DATA = USER.IMPORTANT_USER_PRIVACY_DATA || {};

    // 清除旧版本遗留的“人物来源策略”设置；所有NPC现在统一使用同一套人物表规则。
    delete USER.tableBaseSetting.preset_character_policy;
    delete USER.tableBaseSetting.pinned_character_names;

    if (USER.tableBaseSetting.updateIndex < 3) {
        USER.tableBaseSetting.message_template = USER.tableBaseDefaultSettings.message_template;
        USER.tableBaseSetting.to_chat_container = USER.tableBaseDefaultSettings.to_chat_container;
        USER.tableBaseSetting.updateIndex = 3;
    }
    if (USER.tableBaseSetting.updateIndex < 4) {
        initTableStructureToTemplate();
        USER.tableBaseSetting.updateIndex = 4;
    }
    if (USER.tableBaseSetting.updateIndex < 5) {
        USER.tableBaseSetting.tableStructure = JSON.parse(JSON.stringify(USER.tableBaseDefaultSettings.tableStructure));
        initTableStructureToTemplate();
        USER.tableBaseSetting.updateIndex = 5;
    }
    if (USER.tableBaseSetting.updateIndex < 6) {
        USER.tableBaseSetting.message_template = USER.tableBaseDefaultSettings.message_template;
        USER.tableBaseSetting.refresh_system_message_template = USER.tableBaseDefaultSettings.refresh_system_message_template;
        USER.tableBaseSetting.refresh_user_message_template = USER.tableBaseDefaultSettings.refresh_user_message_template;
        USER.tableBaseSetting.tableStructure = JSON.parse(JSON.stringify(USER.tableBaseDefaultSettings.tableStructure));
        initTableStructureToTemplate();
        USER.tableBaseSetting.updateIndex = 6;
        USER.saveSettings();
    }
    if (USER.tableBaseSetting.deep < 0) formatDeep();

    renderSetting();
    initBindings();
    initRefreshTypeSelector();
    updateTableView();
    getSheetsCellStyle();
}

export function initTableStructureToTemplate() {
    const sheetDefaultTemplates = USER.tableBaseSetting.tableStructure;
    USER.getSettings().memo_n_table_selected_sheets = [];
    USER.getSettings().memo_n_table_database_templates = [];

    for (const defaultTemplate of sheetDefaultTemplates) {
        const newTemplate = new BASE.SheetTemplate();
        newTemplate.domain = 'global';
        newTemplate.createNewTemplate(defaultTemplate.columns.length + 1, 1, false);
        newTemplate.name = defaultTemplate.tableName;
        defaultTemplate.columns.forEach((column, index) => {
            newTemplate.findCellByPosition(0, index + 1).data.value = column;
        });
        newTemplate.enable = defaultTemplate.enable;
        newTemplate.tochat = defaultTemplate.tochat;
        newTemplate.required = defaultTemplate.Required;
        newTemplate.triggerSend = defaultTemplate.triggerSend;
        newTemplate.triggerSendDeep = defaultTemplate.triggerSendDeep;
        if (defaultTemplate.config) newTemplate.config = JSON.parse(JSON.stringify(defaultTemplate.config));
        newTemplate.source.data.note = defaultTemplate.note;
        newTemplate.source.data.initNode = defaultTemplate.initNode;
        newTemplate.source.data.deleteNode = defaultTemplate.deleteNode;
        newTemplate.source.data.updateNode = defaultTemplate.updateNode;
        newTemplate.source.data.insertNode = defaultTemplate.insertNode;
        USER.getSettings().memo_n_table_selected_sheets.push(newTemplate.uid);
        newTemplate.save();
    }
    USER.saveSettings();
}

function templateToTableStructure() {
    USER.tableBaseSetting.tableStructure = BASE.templates.map((templateData, index) => {
        const template = new BASE.SheetTemplate(templateData.uid);
        return {
            tableIndex: index,
            tableName: template.name,
            columns: template.hashSheet[0].slice(1).map(cellUid => template.cells.get(cellUid).data.value),
            note: template.data.note,
            initNode: template.data.initNode,
            deleteNode: template.data.deleteNode,
            updateNode: template.data.updateNode,
            insertNode: template.data.insertNode,
            config: JSON.parse(JSON.stringify(template.config)),
            Required: template.required,
            tochat: template.tochat,
            enable: template.enable,
            triggerSend: template.triggerSend,
            triggerSendDeep: template.triggerSendDeep,
        };
    });
    USER.saveSettings();
}

export function refreshRebuildTemplate() {
    const templateSelect = $('#rebuild--select');
    templateSelect.empty();
    templateSelect.append($('<option>', { value: 'rebuild_base', text: '默认' }));
    for (const key of Object.keys(USER.tableBaseSetting.rebuild_message_template_list || {})) {
        templateSelect.append($('<option>', { value: key, text: key }));
    }
    if (USER.tableBaseSetting.lastSelectedTemplate) {
        templateSelect.val(USER.tableBaseSetting.lastSelectedTemplate);
    }
}
