import { runStableCleanup, stepCleanupHistory } from './stableTableCleanup.js?v=0.75-body-whitespace-1';

const INSTALL_FLAG = '__memoCleanupButtonBridgeInstalled';

if (!window[INSTALL_FLAG]) {
    window[INSTALL_FLAG] = true;

    document.addEventListener('click', async (event) => {
        const target = event.target?.closest?.('#table_rebuild_button, #table_clear_up');
        if (!target) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        try {
            await runStableCleanup();
        } catch (error) {
            console.error('[Memo][table-cleanup] cleanup bridge failed:', error);
            const editor = globalThis?.toastr;
            if (editor?.error) editor.error(`表格整理入口加载失败：${error?.message || error}`);
        }
    }, true);


    function mountRedundancyButton() {
        const anchor = document.querySelector('#table_rebuild_button, #table_clear_up');
        if (!anchor) return false;
        if (document.getElementById('memo_redundancy_cleanup')) return true;
        const host = anchor.parentElement;
        if (!host) return false;

        // Insert a dedicated second row without changing any native toolbar styles.
        const group = document.createElement('div');
        group.id = 'memo_cleanup_actions';
        group.style.cssText = 'display:flex;align-items:center;justify-content:flex-end;gap:6px;width:100%;box-sizing:border-box;margin:6px 0 0;clear:both;';
        const button = document.createElement('button');
        button.id = 'memo_redundancy_cleanup';
        button.type = 'button';
        button.className = 'menu_button';
        button.textContent = '冗余整理';
        button.title = '合并重复记录与连续事件，保留细节';
        button.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;flex:none;white-space:nowrap;width:auto;min-width:0;padding:4px 10px;';
        group.appendChild(button);

        for (const [id, icon, direction, title] of [
            ['memo_cleanup_undo', 'fa-rotate-left', -1, '撤回整理'],
            ['memo_cleanup_redo', 'fa-rotate-right', 1, '前进整理']
        ]) {
            const control = document.createElement('button');
            control.id = id;
            control.type = 'button';
            control.className = 'menu_button';
            control.title = title;
            control.setAttribute('aria-label', title);
            control.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;flex:none;width:34px;min-width:34px;padding:4px 0;';
            const glyph = document.createElement('i');
            glyph.className = 'fa-solid ' + icon;
            control.appendChild(glyph);
            group.appendChild(control);
            control.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                stepCleanupHistory(direction);
            });
        }

        // The group is a sibling of the original toolbar, not one of its flex items.
        host.insertAdjacentElement('afterend', group);
        return true;
    }
    if (!mountRedundancyButton()) {
        const observer = new MutationObserver(() => { if (mountRedundancyButton()) observer.disconnect(); });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }
    document.addEventListener('click', async event => {
        const button = event.target?.closest?.('#memo_redundancy_cleanup');
        if (!button) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        try { await runStableCleanup('redundancy'); }
        catch (error) { console.error('[Memo][redundancy-cleanup]', error); globalThis.toastr?.error?.('冗余整理失败：' + (error?.message || error)); }
    }, true);

    console.log('[Memo] 七表整理按钮桥接已加载：#table_rebuild_button / #table_clear_up');
}
