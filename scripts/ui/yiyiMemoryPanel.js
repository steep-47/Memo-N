import { EDITOR } from '../../core/manager.js';
import { getYiYiVault, saveYiYiVault, replaceYiYiVault, clearYiYiVault, exportYiYiVaultText } from '../yiyi/yiyiMemoryStore.js';

const BUTTON_ID = 'memo-n-yiyi-memory-button';
const MODAL_ID = 'memo-n-yiyi-memory-modal';
const STYLE_ID = 'memo-n-yiyi-memory-style';

function el(tag, attrs = {}, text = '') {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (key === 'class') node.className = value;
        else if (key === 'type') node.type = value;
        else node.setAttribute(key, value);
    }
    if (text) node.textContent = text;
    return node;
}

function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = el('style', { id: STYLE_ID });
    style.textContent = `
#${BUTTON_ID}{margin:8px 0;width:100%;justify-content:center;gap:8px}
#${MODAL_ID}{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:18px}
#${MODAL_ID} .yiyi-shell{width:min(1120px,96vw);max-height:92vh;overflow:auto;background:var(--SmartThemeBlurTintColor,#202126);color:var(--SmartThemeBodyColor,#eee);border:1px solid rgba(255,255,255,.14);border-radius:18px;box-shadow:0 24px 80px rgba(0,0,0,.45);padding:18px}
#${MODAL_ID} .yiyi-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}
#${MODAL_ID} h2{margin:0;font-size:1.25rem} #${MODAL_ID} .yiyi-sub{opacity:.68;font-size:.82rem;margin-top:4px}
#${MODAL_ID} .yiyi-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:12px 0}
#${MODAL_ID} label{display:flex;flex-direction:column;gap:5px;font-size:.82rem;opacity:.92}
#${MODAL_ID} input,#${MODAL_ID} textarea,#${MODAL_ID} select{width:100%;box-sizing:border-box;background:rgba(0,0,0,.16);color:inherit;border:1px solid rgba(255,255,255,.14);border-radius:9px;padding:8px}
#${MODAL_ID} textarea{min-height:68px;resize:vertical}
#${MODAL_ID} .yiyi-section{margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,.12)}
#${MODAL_ID} .yiyi-section-title{font-weight:700;margin-bottom:8px}
#${MODAL_ID} .yiyi-table-wrap{overflow:auto;border:1px solid rgba(255,255,255,.1);border-radius:12px}
#${MODAL_ID} table{width:100%;min-width:880px;border-collapse:collapse;font-size:.82rem}
#${MODAL_ID} th,#${MODAL_ID} td{padding:8px;border-bottom:1px solid rgba(255,255,255,.09);vertical-align:top;text-align:left}
#${MODAL_ID} th{position:sticky;top:0;background:var(--SmartThemeBlurTintColor,#202126);z-index:1}
#${MODAL_ID} td textarea{min-height:64px}
#${MODAL_ID} .yiyi-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
#${MODAL_ID} button{min-height:36px}
#${MODAL_ID} .yiyi-danger{margin-left:auto}
#${MODAL_ID} .yiyi-empty{text-align:center;opacity:.6;padding:22px}
@media(max-width:720px){#${MODAL_ID}{padding:7px}#${MODAL_ID} .yiyi-shell{width:100%;max-height:96vh;border-radius:13px;padding:12px}#${MODAL_ID} .yiyi-grid{grid-template-columns:1fr}#${MODAL_ID} .yiyi-danger{margin-left:0}}
`;
    document.head.appendChild(style);
}

function field(labelText, value, key, multiline = true) {
    const label = el('label');
    label.appendChild(el('span', {}, labelText));
    const input = multiline ? el('textarea', { 'data-yiyi-field': key }) : el('input', { 'data-yiyi-field': key, type: 'text' });
    input.value = value || '';
    label.appendChild(input);
    return label;
}

function selectField(labelText, value, key, options) {
    const label = el('label');
    label.appendChild(el('span', {}, labelText));
    const select = el('select', { 'data-yiyi-field': key });
    for (const [optionValue, optionLabel] of options) {
        const option = el('option', { value: String(optionValue) }, optionLabel);
        if (String(value) === String(optionValue)) option.selected = true;
        select.appendChild(option);
    }
    label.appendChild(select);
    return label;
}

function memoryRow(item = {}) {
    const tr = el('tr');
    tr.dataset.id = item.id || '';
    const values = [item.time || '', item.memory || '', item.thenFeeling || '', item.currentView || ''];
    values.forEach((value, index) => {
        const td = el('td');
        const input = index === 0 ? el('input', { type: 'text' }) : el('textarea');
        input.value = value;
        input.dataset.col = ['time', 'memory', 'thenFeeling', 'currentView'][index];
        td.appendChild(input);
        tr.appendChild(td);
    });
    const importanceTd = el('td');
    const select = el('select');
    [['normal','普通'],['high','重要'],['core','核心']].forEach(([value,label]) => {
        const option = el('option', { value }, label);
        if ((item.importance || 'normal') === value) option.selected = true;
        select.appendChild(option);
    });
    select.dataset.col = 'importance';
    importanceTd.appendChild(select);
    tr.appendChild(importanceTd);
    const actionTd = el('td');
    const remove = el('button', { type: 'button', class: 'menu_button' }, '删除');
    remove.addEventListener('click', () => tr.remove());
    actionTd.appendChild(remove);
    tr.appendChild(actionTd);
    return tr;
}

function readPanel(shell, original) {
    const get = key => shell.querySelector(`[data-yiyi-field="${key}"]`)?.value?.trim() || '';
    const memories = [...shell.querySelectorAll('tbody tr')].map(row => ({
        id: row.dataset.id || undefined,
        time: row.querySelector('[data-col="time"]')?.value?.trim() || '',
        memory: row.querySelector('[data-col="memory"]')?.value?.trim() || '',
        thenFeeling: row.querySelector('[data-col="thenFeeling"]')?.value?.trim() || '',
        currentView: row.querySelector('[data-col="currentView"]')?.value?.trim() || '',
        importance: row.querySelector('[data-col="importance"]')?.value || 'normal',
    })).filter(item => item.memory);
    return {
        ...original,
        relationship: {
            stage: get('relationship.stage') || '初识',
            summary: get('relationship.summary'),
            sharedUnderstanding: get('relationship.sharedUnderstanding'),
            boundaries: get('relationship.boundaries'),
            unresolved: get('relationship.unresolved'),
        },
        emotion: {
            ...original.emotion,
            current: get('emotion.current') || '平静',
            cause: get('emotion.cause'),
            residue: get('emotion.residue'),
            intensity: Number(get('emotion.intensity') || 0),
            trajectory: get('emotion.trajectory') || 'steady',
            updatedAt: new Date().toISOString(),
        },
        self: { understanding: get('self.understanding'), changes: get('self.changes') },
        memories,
    };
}

function downloadBackup() {
    const blob = new Blob([exportYiYiVaultText()], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = el('a');
    a.href = url;
    a.download = `yiyi_memory_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importBackup(onDone) {
    const input = el('input', { type: 'file', accept: 'application/json,.json' });
    input.style.display = 'none';
    input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return input.remove();
        try {
            const parsed = JSON.parse(await file.text());
            replaceYiYiVault(parsed);
            EDITOR.success('伊依记忆已导入');
            onDone?.();
        } catch (error) { EDITOR.error(`伊依记忆导入失败：${error?.message || error}`); }
        input.remove();
    });
    document.body.appendChild(input); input.click();
}

function openPanel() {
    document.getElementById(MODAL_ID)?.remove();
    ensureStyle();
    const vault = getYiYiVault();
    const modal = el('div', { id: MODAL_ID });
    const shell = el('div', { class: 'yiyi-shell' });
    modal.appendChild(shell);
    modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });

    const head = el('div', { class: 'yiyi-head' });
    const titleBox = el('div');
    titleBox.append(el('h2', {}, '伊依 · 长期记忆'), el('div', { class: 'yiyi-sub' }, `独立于游戏存档 · ${vault.memories.length} 条共同记忆 · 修订 ${vault.meta.revision}`));
    const close = el('button', { type: 'button', class: 'menu_button' }, '关闭');
    close.addEventListener('click', () => modal.remove());
    head.append(titleBox, close); shell.appendChild(head);

    const grid = el('div', { class: 'yiyi-grid' });
    grid.append(
        field('关系阶段', vault.relationship.stage, 'relationship.stage', false),
        field('当前情绪', vault.emotion.current, 'emotion.current', false),
        selectField('情绪强度', vault.emotion.intensity, 'emotion.intensity', [[0,'0 · 平稳/几乎没有'],[1,'1 · 轻微'],[2,'2 · 明显'],[3,'3 · 强烈']]),
        selectField('情绪走势', vault.emotion.trajectory, 'emotion.trajectory', [['rising','正在增强'],['steady','相对稳定'],['easing','正在缓和']]),
        field('她现在怎样理解你们的关系', vault.relationship.summary, 'relationship.summary'),
        field('已经形成的默契', vault.relationship.sharedUnderstanding, 'relationship.sharedUnderstanding'),
        field('边界、敏感点与不喜欢的事', vault.relationship.boundaries, 'relationship.boundaries'),
        field('尚未解决的事', vault.relationship.unresolved, 'relationship.unresolved'),
        field('这份情绪为什么存在', vault.emotion.cause, 'emotion.cause'),
        field('情绪余波（已经不占主导，但还在意）', vault.emotion.residue, 'emotion.residue'),
        field('伊依现在怎样理解自己', vault.self.understanding, 'self.understanding'),
        field('她意识到自己发生过什么变化', vault.self.changes, 'self.changes'),
    );
    shell.appendChild(grid);

    const section = el('div', { class: 'yiyi-section' });
    section.appendChild(el('div', { class: 'yiyi-section-title' }, '共同经历 · 不是好感度流水账'));
    const wrap = el('div', { class: 'yiyi-table-wrap' });
    const table = el('table');
    const thead = el('thead'); const hr = el('tr');
    ['时间/阶段','发生过什么','当时感受','现在怎么看','重要性',''].forEach(name => hr.appendChild(el('th', {}, name)));
    thead.appendChild(hr); table.appendChild(thead);
    const tbody = el('tbody');
    vault.memories.forEach(item => tbody.appendChild(memoryRow(item)));
    table.appendChild(tbody); wrap.appendChild(table); section.appendChild(wrap); shell.appendChild(section);

    const actions = el('div', { class: 'yiyi-actions' });
    const add = el('button', { type: 'button', class: 'menu_button' }, '＋ 添加一段记忆');
    add.addEventListener('click', () => { tbody.appendChild(memoryRow()); wrap.scrollTop = wrap.scrollHeight; });
    const save = el('button', { type: 'button', class: 'menu_button' }, '保存伊依记忆');
    save.addEventListener('click', () => { saveYiYiVault(readPanel(shell, vault)); EDITOR.success('伊依记忆已保存'); openPanel(); });
    const backup = el('button', { type: 'button', class: 'menu_button' }, '导出备份');
    backup.addEventListener('click', downloadBackup);
    const restore = el('button', { type: 'button', class: 'menu_button' }, '导入备份');
    restore.addEventListener('click', () => importBackup(openPanel));
    const clear = el('button', { type: 'button', class: 'menu_button yiyi-danger' }, '清空伊依记忆');
    clear.addEventListener('click', () => {
        if (!confirm('这会清空伊依独立长期记忆。游戏表格不会受影响。确定继续吗？')) return;
        if (!confirm('再次确认：这不是“新游戏”，而是让伊依失去自己的长期记忆。仍然清空吗？')) return;
        clearYiYiVault(); EDITOR.warning('伊依长期记忆已清空'); openPanel();
    });
    actions.append(add, save, backup, restore, clear); shell.appendChild(actions);
    document.body.appendChild(modal);
}

function createButton() {
    const button = el('button', { id: BUTTON_ID, type: 'button', class: 'menu_button' }, '伊依 · 长期记忆库');
    button.addEventListener('click', openPanel);
    return button;
}

function mount() {
    if (document.getElementById(BUTTON_ID)) return true;
    const anchor = document.getElementById('memory-independent-record-api') || document.getElementById('fill_table_time');
    if (!anchor?.parentElement) return false;
    anchor.parentElement.insertBefore(createButton(), anchor.nextSibling);
    return true;
}

if (!mount()) {
    const observer = new MutationObserver(() => { if (mount()) observer.disconnect(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 15000);
}

console.log('[Memo-N][伊依] 长期记忆库UI已加载：可查看/编辑当前情绪、强度、走势与余波');
