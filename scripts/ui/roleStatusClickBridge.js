// #1 角色状态表在 pinchZoom.js 中仅做展示层拆分；cloneNode 不会复制原 Cell 的 DOM 事件。
// 本桥把拆分视图中的点击精确转发给同一底层 Cell 的原始 DOM，继续复用原编辑/历史/列操作菜单。

const INSTALL_FLAG = '__memoNRoleStatusClickBridgeV1';

function sourceCellFor(cloneCell) {
    const uid = String(cloneCell?.dataset?.cellUid || '').trim();
    const sheetUid = String(cloneCell?.dataset?.sheetUid || '').trim();
    if (!uid || !sheetUid) return null;

    const sourceTable = document.querySelector(`.memory-role-status-source[data-sheet-uid="${CSS.escape(sheetUid)}"]`)
        || document.querySelector('.memory-role-status-source');
    if (!sourceTable) return null;
    return Array.from(sourceTable.querySelectorAll('.sheet-cell[data-cell-uid]'))
        .find(cell => cell.dataset.cellUid === uid) || null;
}

function proxyGeometry(sourceCell, cloneCell) {
    // 原表被 display:none，仅用于保存真实 Cell 与原点击监听器。
    // 原菜单会读取 event.currentTarget.getBoundingClientRect() 定位；把几何位置代理到用户实际点击的展示单元格。
    const fallback = cloneCell.getBoundingClientRect();
    sourceCell.getBoundingClientRect = () => cloneCell.isConnected
        ? cloneCell.getBoundingClientRect()
        : fallback;
}

function forwardClick(event) {
    const cloneCell = event.target?.closest?.('.memory-role-status-two-tables .sheet-cell');
    if (!cloneCell) return;

    const sourceCell = sourceCellFor(cloneCell);
    if (!sourceCell) {
        console.warn('[Memo-N][role-status-click] 未找到拆分单元格对应的原始 Cell', cloneCell.dataset);
        return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    proxyGeometry(sourceCell, cloneCell);

    sourceCell.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        button: event.button,
        buttons: event.buttons,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
    }));
}

function install() {
    if (globalThis[INSTALL_FLAG]) return;
    globalThis[INSTALL_FLAG] = true;
    document.addEventListener('click', forwardClick, true);
    console.log('[Memo-N] #1角色状态表拆分视图点击桥已加载：复用原Cell编辑菜单');
}

install();

export { sourceCellFor };
