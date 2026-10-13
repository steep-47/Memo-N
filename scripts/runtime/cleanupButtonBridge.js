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
        if (!anchor || document.getElementById('memo_redundancy_cleanup')) return !!anchor;
        const button = document.createElement('button');
        button.id = 'memo_redundancy_cleanup';
        button.type = 'button';
        button.className = anchor.className;
        button.style.cssText = 'display:inline-flex!important;align-items:center;justify-content:center;width:auto!important;min-width:0!important;height:36px!important;min-height:0!important;padding:0 10px!important;margin:0!important;white-space:nowrap;flex:0 0 auto!important;vertical-align:middle;';
        button.textContent = '冗余整理';
        button.title = '仅合并重复记录和明确连续的历史事件，保留关键细节';
        anchor.insertAdjacentElement('afterend', button);
        let previous = button;
        for (const [id, glyph, direction, title] of [['memo_cleanup_undo', '↶', -1, '撤回整理'], ['memo_cleanup_redo', '↷', 1, '前进整理']]) {
            const control = document.createElement('button');
            control.id = id;
            control.type = 'button';
            control.className = anchor.className;
            control.style.cssText = 'display:inline-flex!important;align-items:center;justify-content:center;width:36px!important;min-width:36px!important;height:36px!important;min-height:0!important;padding:0!important;margin:0!important;flex:0 0 36px!important;vertical-align:middle;';
            control.textContent = glyph;
            control.title = title;
            previous.insertAdjacentElement('afterend', control);
            previous = control;
            control.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); stepCleanupHistory(direction); });
        }
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
