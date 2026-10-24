import { runStableCleanup, stepCleanupHistory } from './stableTableCleanup.js?v=0.82-redundancy-event-scale-1';

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


    document.addEventListener('click', event => {
        const action = event.target?.closest?.('#memo_cleanup_undo, #memo_cleanup_redo');
        if (!action) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        stepCleanupHistory(action.id === 'memo_cleanup_undo' ? -1 : 1);
    }, true);

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
