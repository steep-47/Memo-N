import { APP, USER } from '../../core/manager.js';
import { defaultSettings } from '../../data/pluginSetting.js';
import { repairMissingColumnsBeforeCleanup } from './tableStructureRepair.js';

const LEGACY_FIXED_PROTOCOL = /\n?\[一次API固定收尾协议\][\s\S]*?\[\/一次API固定收尾协议\]\n?/g;
const LEGACY_SEVEN_MARKERS = [
    '## 表格：0当前状态 / 1角色状态 / 2背包 / 3当前任务与约定 / 4人物主表 / 5人物发展表 / 6历史事件',
    '[Memo七表独立记录v4]',
    '[Memo七表独立记录v3]',
    '[Memo七表整理v3]',
    '[Memo七表整理v2]',
];

function stripLegacyFixedProtocol(text) {
    return String(text ?? '').replace(LEGACY_FIXED_PROTOCOL, '\n').trim();
}

function isKnownGeneratedSevenPrompt(text) {
    const value = String(text ?? '');
    return LEGACY_SEVEN_MARKERS.some(marker => value.includes(marker));
}

function patchKnownGeneratedPrompt(settings, key) {
    if (!settings || typeof settings !== 'object' || !(key in settings)) return false;
    const current = String(settings[key] ?? '');
    const cleaned = stripLegacyFixedProtocol(current);
    if (isKnownGeneratedSevenPrompt(cleaned)) {
        settings[key] = defaultSettings[key];
        return true;
    }
    if (cleaned !== current) {
        settings[key] = cleaned;
        return true;
    }
    return false;
}

function patchCurrentSettings() {
    const settings = USER?.tableBaseSetting;
    if (!settings || typeof settings !== 'object') return false;
    let changed = false;
    for (const key of [
        'message_template',
        'step_by_step_user_prompt',
        'refresh_system_message_template',
        'refresh_user_message_template',
        'rebuild_default_system_message_template',
        'rebuild_default_message_template',
    ]) changed = patchKnownGeneratedPrompt(settings, key) || changed;
    if (changed) USER.saveSettings?.();
    return changed;
}

function repairBeforePrompt() {
    try {
        patchCurrentSettings();
        repairMissingColumnsBeforeCleanup({ notify: false });
    } catch (error) {
        console.warn('[Memo-N] 请求前当前表格校验失败，降级继续生成，不阻断记录', error);
    }
}

try {
    for (const key of [
        'message_template',
        'step_by_step_user_prompt',
        'refresh_system_message_template',
        'refresh_user_message_template',
        'rebuild_default_system_message_template',
        'rebuild_default_message_template',
    ]) patchKnownGeneratedPrompt(defaultSettings, key);
} catch (error) {
    console.warn('[Memo-N] 默认提示清理失败，继续加载', error);
}

queueMicrotask(() => {
    try { patchCurrentSettings(); } catch (error) { console.warn('[Memo-N] 当前提示清理失败', error); }
});

const promptEvent = APP.event_types.CHAT_COMPLETION_PROMPT_READY;
if (promptEvent) {
    APP.eventSource.on(promptEvent, repairBeforePrompt);
    APP.eventSource.makeFirst?.(promptEvent, repairBeforePrompt);
}

console.log('[Memo-N] 当前表格规则已加载：不再执行七表迁移，只按现有模板校验表头与清理已知旧协议');
