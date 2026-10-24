import { BASE } from '../../core/manager.js';

const TIME_BLOCK_GAP_MINUTES = 60;
const LONG_EVENT_ROW_MINUTES = 120;
const FORMAL_STAGE_RE = /(四强(?:首战|次战|次阵|战)?|八强(?:首战|次战|战)?|半决赛?|总决赛|总决战|终选决战|决赛|首轮|次轮|第[一二三四五六七八九十百0-9]+轮|淘汰赛|晋级赛|排位赛|擂台赛)/;

function parsePoint(fragment, base = null) {
    const text = String(fragment ?? '');
    const read = (regex, fallback) => {
        const match = text.match(regex);
        return match ? Number(match[1]) : fallback;
    };
    const year = read(/(\d+)年/, base?.year ?? null);
    const month = read(/(\d+)月/, base?.month ?? null);
    const day = read(/(\d+)日/, base?.day ?? null);
    if (![year, month, day].every(Number.isFinite)) return null;
    return {
        year,
        month,
        day,
        hour: read(/(\d+)点/, 0),
        minute: read(/(\d+)分/, 0),
    };
}

function parseTimeRange(value) {
    const text = String(value ?? '');
    const splitAt = text.indexOf('至');
    const left = splitAt >= 0 ? text.slice(0, splitAt) : text;
    const right = splitAt >= 0 ? text.slice(splitAt + 1) : '';
    const start = parsePoint(left);
    const end = right ? parsePoint(right, start) : start;
    return { start, end: end ?? start };
}

function pointMinutes(point) {
    if (!point) return null;
    return (((((point.year * 12) + (point.month - 1)) * 31 + (point.day - 1)) * 24 + point.hour) * 60) + point.minute;
}

function sameDay(a, b) {
    return !!a && !!b && a.year === b.year && a.month === b.month && a.day === b.day;
}

function gapMinutes(previous, current) {
    const prev = parseTimeRange(previous.time);
    const next = parseTimeRange(current.time);
    if (!prev.end || !next.start || !sameDay(prev.end, next.start)) return null;
    return Math.max(0, pointMinutes(next.start) - pointMinutes(prev.end));
}

function rowDurationMinutes(row) {
    const range = parseTimeRange(row.time);
    if (!range.start || !range.end) return 0;
    return Math.max(0, pointMinutes(range.end) - pointMinutes(range.start));
}

function rowCrossesDay(row) {
    const range = parseTimeRange(row.time);
    return !!range.start && !!range.end && !sameDay(range.start, range.end);
}

function explicitEventAnchor(row) {
    const text = String(row.event ?? '').slice(0, 48);
    const stage = text.match(FORMAL_STAGE_RE)?.[1] ?? '';
    return stage ? `阶段:${stage}` : '';
}

function jaccard(left, right) {
    if (!left.size || !right.size) return 0;
    let common = 0;
    for (const value of left) if (right.has(value)) common++;
    return common / (left.size + right.size - common);
}

function locationParts(value) {
    return new Set(String(value ?? '').split(/[·/至（）()，,\s]+/).map(x => x.trim()).filter(x => x.length >= 2));
}

function peopleParts(value) {
    const text = String(value ?? '').replace(/（[^）]*）|\([^)]*\)/g, '');
    return new Set(text.split(/[、,，及与]+/).map(x => x.trim()).filter(Boolean));
}

function shouldStartNewTimeBlock(previous, current) {
    const prev = parseTimeRange(previous.time);
    const next = parseTimeRange(current.time);
    if (!prev.end || !next.start || !sameDay(prev.end, next.start)) return true;
    return Math.max(0, pointMinutes(next.start) - pointMinutes(prev.end)) > TIME_BLOCK_GAP_MINUTES;
}

function shouldStartNewEventGroup(group, previous, current) {
    if (rowCrossesDay(current) || rowDurationMinutes(current) > LONG_EVENT_ROW_MINUTES
        || rowCrossesDay(previous) || rowDurationMinutes(previous) > LONG_EVENT_ROW_MINUTES) return true;
    const currentAnchor = explicitEventAnchor(current);
    if (currentAnchor && group.anchor && currentAnchor !== group.anchor) return true;
    if (currentAnchor && !group.anchor && group.rows.length) return true;
    if (currentAnchor && group.anchor === currentAnchor
        && jaccard(peopleParts(previous.people), peopleParts(current.people)) < 0.5) return true;

    const gap = gapMinutes(previous, current);
    if (group.anchor && !currentAnchor && gap !== null && gap >= 30) return true;
    if (gap !== null && gap >= 10) {
        const placeSimilarity = jaccard(locationParts(previous.location), locationParts(current.location));
        const peopleSimilarity = jaccard(peopleParts(previous.people), peopleParts(current.people));
        if (placeSimilarity < 0.35 && peopleSimilarity < 0.5) return true;
    }
    return false;
}

export function segmentHistoryRows(rows) {
    const timeBlocks = [];
    let timeBlock = null;
    let eventGroup = null;

    for (const row of rows) {
        const previous = timeBlock?.rows?.at(-1) ?? null;
        if (!timeBlock || (previous && shouldStartNewTimeBlock(previous, row))) {
            timeBlock = { rows: [], groups: [] };
            timeBlocks.push(timeBlock);
            eventGroup = null;
        }

        if (!eventGroup || (previous && shouldStartNewEventGroup(eventGroup, previous, row))) {
            eventGroup = { rows: [], anchor: explicitEventAnchor(row) };
            timeBlock.groups.push(eventGroup);
        }

        eventGroup.rows.push(row);
        if (!eventGroup.anchor) eventGroup.anchor = explicitEventAnchor(row);
        timeBlock.rows.push(row);
    }

    return timeBlocks;
}

export function formatSegmentedHistoryTable(sheet, tableIndex) {
    const headers = sheet.getHeader().map(value => String(value ?? '').trim());
    const rows = [];
    for (let row = 1; row < sheet.getRowCount(); row++) {
        const values = sheet.getCellsByRowIndex(row).slice(1).map(cell => cell?.data?.value ?? '');
        rows.push({
            rowIndex: row - 1,
            time: String(values[0] ?? ''),
            location: String(values[1] ?? ''),
            people: String(values[2] ?? ''),
            event: String(values[3] ?? ''),
            result: String(values[4] ?? ''),
        });
    }

    const blocks = segmentHistoryRows(rows);
    const lines = [
        `# 表${tableIndex} ${sheet.name}`,
        `列：${headers.join('｜')}`,
        '以下分组只是阅读辅助：时间块依据明确时间连续性粗分，候选事件组只在强事件锚点或明显场景切换时再拆。组内仍由你判断真实事件边界；不同候选事件组不得因为相邻而自动合并。rowIndex始终是原表真实行号。',
    ];

    blocks.forEach((block, blockIndex) => {
        const first = block.rows[0];
        const last = block.rows.at(-1);
        lines.push(`\n【时间块${blockIndex + 1}｜${first?.time ?? ''}${last && last !== first ? ` → ${last.time}` : ''}】`);
        block.groups.forEach((group, groupIndex) => {
            lines.push(`【候选事件组${blockIndex + 1}.${groupIndex + 1}${group.anchor ? `｜${group.anchor}` : ''}】`);
            for (const row of group.rows) {
                lines.push(`rowIndex=${row.rowIndex} ${JSON.stringify({ 时间: row.time, 地点: row.location, 涉及人物: row.people, 事件: row.event, 结果: row.result })}`);
            }
        });
    });

    return lines.join('\n');
}

function armSegmentedHistoryView() {
    const historySheets = (BASE.getChatSheets?.() ?? []).filter(sheet => sheet?.name === '历史事件表');
    if (historySheets.length !== 1) return () => {};
    const sheet = historySheets[0];
    const original = sheet.getTableText;
    if (typeof original !== 'function') return () => {};
    const hadOwnMethod = Object.prototype.hasOwnProperty.call(sheet, 'getTableText');
    let armed = true;

    const restore = () => {
        if (!armed) return;
        armed = false;
        if (hadOwnMethod) sheet.getTableText = original;
        else delete sheet.getTableText;
    };

    sheet.getTableText = function segmentedHistoryGetTableText(tableIndex, customParts, piece) {
        restore();
        const pureDataView = Array.isArray(customParts)
            && customParts.includes('title')
            && customParts.includes('headers')
            && customParts.includes('rows')
            && !customParts.includes('node')
            && !customParts.includes('editRules');
        if (!pureDataView) return original.call(this, tableIndex, customParts, piece);
        return formatSegmentedHistoryTable(this, tableIndex);
    };

    return restore;
}

export async function runWithSegmentedHistoryView(callback) {
    const restore = armSegmentedHistoryView();
    try {
        return await callback();
    } finally {
        restore();
    }
}
