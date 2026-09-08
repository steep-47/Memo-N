// 数据页：单指横向滚动使用浏览器原生 overflow-x；仅保留双指缩放。
// #1 角色状态表只在展示层重排成两个信息密度更均衡的短表；底层真实列顺序与列索引保持不变。

const MIN_SCALE = 0.6;
const MAX_SCALE = 2.0;
const MIN_VALID_WIDTH = 80;

let activeArea = null;
let startDistance = 0;
let startScale = 1;
let currentScale = 1;
let observedArea = null;
let refreshQueued = false;

function distance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
}

function findArea(target) {
    return target?.closest?.('#contentContainer.memory-table-pinch-area') || null;
}

function hasUsableWidth(area) {
    return !!area && area.clientWidth >= MIN_VALID_WIDTH && area.getClientRects().length > 0;
}

function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
        refreshQueued = false;
        refreshVisibleArea();
    });
}

const areaResizeObserver = new ResizeObserver(queueRefresh);

function getVisibleArea() {
    const area = document.querySelector('#contentContainer.memory-table-pinch-area');
    if (!area) return null;
    if (observedArea !== area) {
        if (observedArea) areaResizeObserver.unobserve(observedArea);
        observedArea = area;
        areaResizeObserver.observe(area);
    }
    return area;
}

function normalizeHeader(text) {
    return String(text || '').replace(/\s+/g, '').trim();
}

function cleanEmptyCell(cell) {
    if (!cell) return;
    const text = String(cell.textContent || '').trim();
    if (/^(无|暂无|没有|未知|未记录|未提及|无数据|N\/A|NA|null|undefined|-|—|--|空)$/i.test(text)) cell.textContent = '';
}

function cloneColumns(source, indices, indexColumn = -1) {
    const clone = source.cloneNode(false);
    clone.removeAttribute('id');
    clone.classList.remove('memory-role-status-source');
    clone.classList.add('memory-role-status-half-table');

    for (const section of Array.from(source.children)) {
        if (!['THEAD', 'TBODY', 'TFOOT'].includes(section.tagName)) continue;
        const sectionClone = section.cloneNode(false);
        for (const row of Array.from(section.rows || [])) {
            const rowClone = row.cloneNode(false);
            const cells = Array.from(row.cells || []);
            if (indexColumn >= 0 && cells[indexColumn]) rowClone.appendChild(cells[indexColumn].cloneNode(true));
            for (const index of indices) {
                if (index === indexColumn || !cells[index]) continue;
                const cell = cells[index].cloneNode(true);
                if (section.tagName !== 'THEAD') cleanEmptyCell(cell);
                rowClone.appendChild(cell);
            }
            sectionClone.appendChild(rowClone);
        }
        if (sectionClone.children.length) clone.appendChild(sectionClone);
    }
    return clone;
}

function getRoleStatusSource(container) {
    const headings = Array.from(container.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    const heading = headings.find(el => {
        const text = normalizeHeader(el.textContent);
        return /#?1角色状态表/.test(text) || text === '角色状态表';
    });
    if (!heading) return null;

    let node = heading.nextElementSibling;
    while (node) {
        if (/^H[1-6]$/.test(node.tagName)) break;
        if (node.tagName === 'TABLE') return node;
        const nested = node.querySelector?.('table');
        if (nested) return nested;
        node = node.nextElementSibling;
    }
    return null;
}

function roleTableSignature(source) {
    return Array.from(source.rows || [])
        .map(row => Array.from(row.cells || []).map(cell => cell.textContent || '').join('\u001f'))
        .join('\u001e');
}

function findHeaderIndex(headers, aliases) {
    const names = Array.isArray(aliases) ? aliases : [aliases];
    for (const name of names) {
        const index = headers.findIndex(header => header === normalizeHeader(name));
        if (index >= 0) return index;
    }
    return -1;
}

function collectRoleColumns(headers, groups) {
    const indices = [];
    for (const group of groups) {
        const index = findHeaderIndex(headers, group);
        if (index >= 0 && !indices.includes(index)) indices.push(index);
    }
    return indices;
}

function splitRoleStatusTable() {
    const container = document.querySelector('#tableContainer');
    if (!container) return;
    const source = getRoleStatusSource(container);
    if (!source) return;
    const headerRow = source.querySelector('thead tr') || source.querySelector('tr');
    if (!headerRow) return;

    const headers = Array.from(headerRow.cells).map(cell => normalizeHeader(cell.textContent));
    const indexColumn = headers[0] === '' ? 0 : -1;

    // 上半表：人物识别 + 基础修炼。两列长文本（外貌、身份）由多个短字段平衡。
    const firstGroups = [
        ['姓名'], ['性别'], ['种族'], ['年龄'],
        ['外貌特征','外貌','容貌'],
        ['身份/所属','身份','所属','所属势力'],
        ['别名/称号','别名','称号','别名/称呼'],
        ['修为'], ['灵根/体质'],
    ];
    // 下半表：资源 + 能力 + 当前状态。技能、擅长、其他状态等长字段由数值字段平衡。
    const secondGroups = [
        ['姓名'], ['灵力'], ['神识'], ['技能/术法'], ['擅长'],
        ['身体状态'], ['其他状态'], ['灵石'], ['钱财'],
    ];

    const first = collectRoleColumns(headers, firstGroups);
    const second = collectRoleColumns(headers, secondGroups);
    const name = findHeaderIndex(headers, ['姓名']);

    if (name < 0 || first.length < 2 || second.length < 2) {
        source.classList.remove('memory-role-status-source');
        container.querySelectorAll('.memory-role-status-two-tables').forEach(el => el.remove());
        return;
    }

    // 自定义附加列不能在拆分视图里凭空消失；统一追加到下半表末尾。
    const assigned = new Set([indexColumn, ...first, ...second]);
    headers.forEach((header, index) => {
        if (index < 0 || assigned.has(index) || !header) return;
        second.push(index);
        assigned.add(index);
    });

    source.classList.add('memory-role-status-source');
    const signature = `memon20-profile-density:${roleTableSignature(source)}`;
    let view = container.querySelector('.memory-role-status-two-tables');
    if (view?.dataset?.sourceSignature === signature) return;

    const nextView = document.createElement('div');
    nextView.className = 'memory-role-status-two-tables';
    nextView.dataset.sourceSignature = signature;
    nextView.appendChild(cloneColumns(source, first, indexColumn));
    nextView.appendChild(cloneColumns(source, second, indexColumn));

    if (view) view.replaceWith(nextView);
    else {
        const host = source.parentElement;
        if (host && host !== container && host.children.length === 1) host.after(nextView);
        else source.after(nextView);
    }
    container.querySelectorAll('.memory-role-status-two-tables').forEach(el => {
        if (el !== nextView) el.remove();
    });
}

function keepDrawerFilled(area) {
    if (!hasUsableWidth(area)) return;
    const drawer = area.closest('#table_drawer_content');
    if (!drawer) return;
    const areaRect = area.getBoundingClientRect();
    const drawerRect = drawer.getBoundingClientRect();
    area.style.minHeight = `${Math.max(0, drawerRect.bottom - areaRect.top)}px`;
    area.style.boxSizing = 'border-box';
}

function measureTrueContentWidth(area) {
    const tableContainer = area?.querySelector?.('#tableContainer');
    if (!tableContainer || !hasUsableWidth(area)) return 0;
    let widest = Math.max(area.clientWidth / currentScale, 0);
    const nodes = tableContainer.querySelectorAll('*:not(.memory-role-status-source):not(.memory-role-status-source *)');
    for (const node of nodes) {
        const sw = Number(node.scrollWidth) || 0;
        const rectWidth = node.getBoundingClientRect?.().width || 0;
        const logicalRectWidth = currentScale > 0 ? rectWidth / currentScale : rectWidth;
        widest = Math.max(widest, sw, logicalRectWidth);
    }
    return Math.ceil(widest);
}

function syncWholeCanvasWidth(area) {
    const tableContainer = area?.querySelector?.('#tableContainer');
    if (!tableContainer || !hasUsableWidth(area)) return;
    const trueWidth = measureTrueContentWidth(area);
    const viewportLogicalWidth = currentScale > 0 ? area.clientWidth / currentScale : area.clientWidth;
    const canvasWidth = Math.max(trueWidth, viewportLogicalWidth);
    if (!Number.isFinite(canvasWidth) || canvasWidth < MIN_VALID_WIDTH) return;
    tableContainer.style.width = `${canvasWidth}px`;
    tableContainer.style.maxWidth = 'none';
    tableContainer.style.transform = 'none';
    delete tableContainer.dataset.memoryPanX;
}

function applyScale(area, scale) {
    const tableContainer = area?.querySelector?.('#tableContainer');
    if (!tableContainer || !hasUsableWidth(area)) return;
    currentScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    tableContainer.style.zoom = String(currentScale);
    tableContainer.dataset.memoryPinchScale = String(currentScale);
    syncWholeCanvasWidth(area);
    keepDrawerFilled(area);
}

function onTouchStart(event) {
    if (event.touches.length !== 2) return;
    const area = findArea(event.target);
    if (!area || !hasUsableWidth(area)) return;
    activeArea = area;
    startDistance = distance(event.touches);
    const tableContainer = area.querySelector('#tableContainer');
    const savedScale = Number(tableContainer?.dataset?.memoryPinchScale || currentScale || 1);
    startScale = Number.isFinite(savedScale) ? savedScale : 1;
    syncWholeCanvasWidth(area);
    keepDrawerFilled(area);
}

function onTouchMove(event) {
    if (event.touches.length !== 2 || !activeArea || startDistance <= 0) return;
    applyScale(activeArea, startScale * distance(event.touches) / startDistance);
    event.preventDefault();
    event.stopPropagation();
}

function finishTouch(event) {
    if (!event || event.touches.length < 2) {
        if (activeArea) keepDrawerFilled(activeArea);
        activeArea = null;
        startDistance = 0;
    }
}

function refreshVisibleArea() {
    splitRoleStatusTable();
    const area = getVisibleArea();
    if (!hasUsableWidth(area)) return;
    keepDrawerFilled(area);
    syncWholeCanvasWidth(area);
}

function mutationIsOnlyRoleView(mutation) {
    const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
    return nodes.length > 0 && nodes.every(node => node.nodeType === 1 && node.matches?.('.memory-role-status-two-tables'));
}

const mutationObserver = new MutationObserver(mutations => {
    if (mutations.every(mutationIsOnlyRoleView)) return;
    queueRefresh();
});
mutationObserver.observe(document.documentElement, { childList: true, subtree: true });

queueRefresh();
setTimeout(queueRefresh, 250);
setTimeout(queueRefresh, 600);

document.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
document.addEventListener('touchend', finishTouch, { passive: true, capture: true });
document.addEventListener('touchcancel', finishTouch, { passive: true, capture: true });
window.addEventListener('resize', queueRefresh, { passive: true });

console.log('[世界状态记忆表格] 原生横向惯性滚动 + 双指缩放 + 玩家表信息密度分组已加载');
