import { EDITOR, USER } from '../../core/manager.js';

const INSTALL_FLAG = '__memoNTemplateEditorInstalled';
const ROOT_ID = 'memo-n-template-editor';

function settings() { return USER?.tableBaseSetting; }
function selectedCleanupKey() { return String(settings()?.lastSelectedTemplate || 'rebuild_base'); }
function cleanupTemplate() {
    const s = settings();
    const key = selectedCleanupKey();
    if (!s) return { key, system: '', user: '' };
    if (key === 'rebuild_base') return {
        key,
        system: String(s.rebuild_default_system_message_template || ''),
        user: String(s.rebuild_default_message_template || ''),
    };
    const item = s.rebuild_message_template_list?.[key] || {};
    return { key, system: String(item.system_prompt || ''), user: String(item.user_prompt_begin || '') };
}
function save() { try { USER.saveSettings?.(); } catch (error) { console.warn('[Memo-N] 模板设置保存失败', error); } }

function syncFromSettings() {
    const root = document.getElementById(ROOT_ID);
    const s = settings();
    if (!root || !s) return;
    const normal = root.querySelector('#memo-template-normal');
    const independent = root.querySelector('#memo-template-independent');
    const cleanupSystem = root.querySelector('#memo-template-cleanup-system');
    const cleanupUser = root.querySelector('#memo-template-cleanup-user');
    const cleanupLabel = root.querySelector('#memo-template-cleanup-label');
    if (normal && document.activeElement !== normal) normal.value = String(s.message_template || '');
    if (independent && document.activeElement !== independent) independent.value = String(s.step_by_step_user_prompt || '');
    const cleanup = cleanupTemplate();
    if (cleanupSystem && document.activeElement !== cleanupSystem) cleanupSystem.value = cleanup.system;
    if (cleanupUser && document.activeElement !== cleanupUser) cleanupUser.value = cleanup.user;
    if (cleanupLabel) cleanupLabel.textContent = cleanup.key === 'rebuild_base' ? '当前：默认整理模板' : `当前：${cleanup.key}`;
}

function writeCleanup(field, value) {
    const s = settings();
    if (!s) return;
    const key = selectedCleanupKey();
    if (key === 'rebuild_base') {
        if (field === 'system') s.rebuild_default_system_message_template = value;
        else s.rebuild_default_message_template = value;
    } else {
        s.rebuild_message_template_list ||= {};
        s.rebuild_message_template_list[key] ||= {};
        if (field === 'system') s.rebuild_message_template_list[key].system_prompt = value;
        else s.rebuild_message_template_list[key].user_prompt_begin = value;
    }
    save();
}

function bind(root) {
    root.querySelector('#memo-template-normal')?.addEventListener('input', event => {
        const s = settings(); if (!s) return; s.message_template = event.target.value; save();
        const old = document.querySelector('#dataTable_message_template'); if (old) old.value = event.target.value;
    });
    root.querySelector('#memo-template-independent')?.addEventListener('input', event => {
        const s = settings(); if (!s) return; s.step_by_step_user_prompt = event.target.value; save();
        const old = document.querySelector('#step_by_step_user_prompt'); if (old) old.value = event.target.value;
    });
    root.querySelector('#memo-template-cleanup-system')?.addEventListener('input', event => writeCleanup('system', event.target.value));
    root.querySelector('#memo-template-cleanup-user')?.addEventListener('input', event => writeCleanup('user', event.target.value));
    root.querySelector('#memo-template-normal-reset')?.addEventListener('click', () => {
        const s = settings(); if (!s) return; s.message_template = USER.tableBaseDefaultSettings.message_template; save(); syncFromSettings(); EDITOR.success('普通记录模板已重置');
    });
    root.querySelector('#memo-template-independent-reset')?.addEventListener('click', () => {
        const s = settings(); if (!s) return; s.step_by_step_user_prompt = USER.tableBaseDefaultSettings.step_by_step_user_prompt; save(); syncFromSettings(); EDITOR.success('独立记录模板已重置');
    });
    document.querySelector('#rebuild--select')?.addEventListener('change', () => queueMicrotask(syncFromSettings));
}

function mount() {
    if (document.getElementById(ROOT_ID)) { syncFromSettings(); return true; }
    const anchor = document.querySelector('#memo-record-provider-route')?.parentElement;
    if (!anchor) return false;
    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.className = 'inline-drawer wide100p';
    root.style.marginTop = '10px';
    root.innerHTML = `
<div class="inline-drawer-toggle inline-drawer-header"><b>记录模板（可直接查看/编辑）</b><div class="fa-solid fa-circle-chevron-down inline-drawer-icon down"></div></div>
<div class="inline-drawer-content" style="display:none;padding:8px 5px">
  <small class="toggle-description justifyLeft">模板只定义记录语义；DeepSeek JSON / 中转站 tableEdit 仍只由上方“记录接口”决定。</small>
  <div style="margin-top:10px"><div class="flex-container" style="justify-content:space-between"><b>普通一次API记录模板</b><div id="memo-template-normal-reset" class="menu_button button-square-icon fa-solid fa-undo" title="重置默认"></div></div><textarea id="memo-template-normal" class="text_pole settings_textarea wide100p" rows="8"></textarea></div>
  <div style="margin-top:10px"><div class="flex-container" style="justify-content:space-between"><b>独立/立即填表模板</b><div id="memo-template-independent-reset" class="menu_button button-square-icon fa-solid fa-undo" title="重置默认"></div></div><textarea id="memo-template-independent" class="text_pole settings_textarea wide100p" rows="8"></textarea></div>
  <div style="margin-top:10px"><b>表格整理模板</b><small id="memo-template-cleanup-label" class="toggle-description justifyLeft"></small><label>System</label><textarea id="memo-template-cleanup-system" class="text_pole settings_textarea wide100p" rows="6"></textarea><label>User</label><textarea id="memo-template-cleanup-user" class="text_pole settings_textarea wide100p" rows="6"></textarea><small class="toggle-description justifyLeft">整理模板跟随下方“总结模板”当前选择。默认两框留空时使用Memo-N内置安全整理模板；输入内容后立即作为当前模板保存。</small></div>
</div>`;
    anchor.appendChild(root);
    bind(root);
    syncFromSettings();
    return true;
}

if (!globalThis[INSTALL_FLAG]) {
    globalThis[INSTALL_FLAG] = true;
    if (!mount()) {
        const observer = new MutationObserver(() => { if (mount()) observer.disconnect(); });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(() => { mount(); observer.disconnect(); }, 5000);
    }
}

console.log('[Memo-N] 可见记录模板编辑器已加载');
