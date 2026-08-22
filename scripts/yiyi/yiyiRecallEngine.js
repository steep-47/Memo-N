import { USER } from '../../core/manager.js';
import { getYiYiVault } from './yiyiMemoryStore.js';

const RECALL_KEY = 'memo_n_yiyi_recall_state_v1';
const IMPORTANCE = Object.freeze({ core: 3, high: 2, normal: 1 });

function text(value) { return String(value ?? '').trim(); }
function grams(value) {
    const source = text(value).toLowerCase().replace(/\s+/g, '');
    const result = new Set();
    const words = source.match(/[a-z0-9_]{2,}|[\u3400-\u9fff]{2,}/g) || [];
    for (const word of words) {
        if (/^[a-z0-9_]+$/.test(word)) result.add(word);
        else for (let i = 0; i < word.length - 1; i++) result.add(word.slice(i, i + 2));
    }
    return result;
}
function state(create = true) {
    const settings = USER?.getSettings?.();
    if (!settings) return { version: 1, sequence: 0, memories: {} };
    if ((!settings[RECALL_KEY] || typeof settings[RECALL_KEY] !== 'object') && create) {
        settings[RECALL_KEY] = { version: 1, sequence: 0, memories: {} };
    }
    const value = settings[RECALL_KEY] || { version: 1, sequence: 0, memories: {} };
    if (!value.memories || typeof value.memories !== 'object') value.memories = {};
    return value;
}
function hitCount(item, query) {
    if (!query.size) return 0;
    const hay = grams(`${item.time} ${item.memory} ${item.thenFeeling} ${item.currentView}`);
    let hits = 0;
    for (const token of query) if (hay.has(token)) hits++;
    return hits;
}
function ageBoost(item) {
    const at = Date.parse(item.updatedAt || item.createdAt || '');
    if (!Number.isFinite(at)) return 0;
    const days = Math.max(0, (Date.now() - at) / 86400000);
    if (days < 1) return 1.5;
    if (days < 7) return 0.8;
    return 0;
}
function scored(item, query, recall, sequence) {
    const hits = hitCount(item, query);
    const importance = IMPORTANCE[item.importance] || 1;
    const meta = recall.memories?.[item.id] || {};
    const gap = Number.isFinite(meta.lastSequence) ? sequence - meta.lastSequence : 999;
    let cooldown = 0;
    if (gap <= 1) cooldown = hits >= 2 ? 0 : 8;
    else if (gap <= 3) cooldown = hits > 0 ? 1 : 4;
    const score = hits * 4 + importance * 2 + ageBoost(item) - cooldown;
    return { item, hits, score, gap, tier: hits > 0 ? 'direct' : 'background' };
}
function renderLength(item) {
    return `${item.time || ''}${item.memory || ''}${item.thenFeeling || ''}${item.currentView || ''}`.length;
}

export function selectYiYiRecall(vault, { query = '', maxMemories = 10, maxChars = 650 } = {}) {
    const source = Array.isArray(vault?.memories) ? vault.memories : [];
    const recall = state(true);
    const sequence = Number(recall.sequence || 0) + 1;
    recall.sequence = sequence;
    const q = grams(query);
    const ranked = source.map(item => scored(item, q, recall, sequence)).sort((a, b) => b.score - a.score || b.hits - a.hits || (IMPORTANCE[b.item.importance] - IMPORTANCE[a.item.importance]));

    const selected = [];
    let chars = 0;
    const direct = ranked.filter(row => row.hits > 0 && row.score > 0);
    const background = ranked.filter(row => row.hits === 0 && row.item.importance !== 'normal' && row.gap > 3 && row.score > 0);

    for (const row of [...direct.slice(0, 8), ...background.slice(0, 2)]) {
        if (selected.length >= Math.max(1, maxMemories)) break;
        if (selected.some(old => old.item.id === row.item.id)) continue;
        const size = renderLength(row.item);
        if (selected.length && chars + size > Math.max(180, maxChars)) continue;
        selected.push(row); chars += size;
    }

    for (const row of selected) {
        recall.memories[row.item.id] = {
            lastSequence: sequence,
            count: Number(recall.memories[row.item.id]?.count || 0) + 1,
        };
    }
    USER?.saveSettings?.();
    return selected;
}

function trajectoryLabel(value) { return value === 'rising' ? '增强' : value === 'easing' ? '缓和' : '稳定'; }
function elapsedLabel(iso) {
    const then = Date.parse(iso); if (!Number.isFinite(then)) return '未知';
    const minutes = Math.floor(Math.max(0, Date.now() - then) / 60000);
    if (minutes < 2) return '刚刚';
    if (minutes < 60) return `${minutes}分钟`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}小时`;
    return `${Math.floor(hours / 24)}天`;
}

export function buildYiYiRecallContext({ query = '', maxMemories = 10, maxChars = 650 } = {}) {
    const vault = getYiYiVault();
    const selected = selectYiYiRecall(vault, { query, maxMemories, maxChars });
    const lines = selected.map(row => {
        const item = row.item;
        const tier = row.tier === 'direct' ? '当前相关' : '背景锚点';
        return `- #${item.id} [${tier}/${item.importance}] ${item.time ? `${item.time}｜` : ''}${item.memory}${item.thenFeeling ? `｜当时感受：${item.thenFeeling}` : ''}${item.currentView ? `｜现在怎么看：${item.currentView}` : ''}`;
    });
    return [
        '[Memo-N｜伊依独立长期记忆数据]',
        `关系阶段：${vault.relationship.stage || '初识'}`,
        vault.relationship.summary ? `关系当前理解：${vault.relationship.summary}` : '',
        vault.relationship.sharedUnderstanding ? `已有默契：${vault.relationship.sharedUnderstanding}` : '',
        vault.relationship.expectations ? `现实预期：${vault.relationship.expectations}` : '',
        vault.relationship.trustBasis ? `信任依据与保留：${vault.relationship.trustBasis}` : '',
        vault.relationship.interactionPattern ? `已形成的相处模式：${vault.relationship.interactionPattern}` : '',
        vault.relationship.initiative ? `当前主动边界：${vault.relationship.initiative}` : '',
        vault.relationship.comfort ? `舒适/谨慎区域：${vault.relationship.comfort}` : '',
        vault.relationship.boundaries ? `明确边界：${vault.relationship.boundaries}` : '',
        vault.relationship.unresolved ? `未解决事项：${vault.relationship.unresolved}` : '',
        `情绪状态：${vault.emotion.current || '平静'}｜强度${vault.emotion.intensity}/3｜走势${trajectoryLabel(vault.emotion.trajectory)}｜更新于${elapsedLabel(vault.emotion.updatedAt)}前`,
        vault.emotion.cause ? `情绪原因：${vault.emotion.cause}` : '',
        vault.emotion.residue ? `情绪余波：${vault.emotion.residue}` : '',
        vault.self.understanding ? `自我理解：${vault.self.understanding}` : '',
        vault.self.changes ? `自我变化：${vault.self.changes}` : '',
        lines.length ? `本轮召回记忆：\n${lines.join('\n')}` : '本轮没有达到召回阈值的旧记忆。',
        '召回说明：当前相关=与本轮内容有直接词义关联；背景锚点=重要但仅作低优先级上下文。召回表示“可供模型参考”，不等于必须在正文中主动提及。连续几轮重复出现的同一记忆会被插件降权，除非本轮再次强相关。',
        '数据边界：这套记忆只属于伊依自身连续记忆，不得据此改写剧情世界事实、NPC认知、人物好感、背包、能力或世界历史。',
    ].filter(Boolean).join('\n');
}

export const YiYiRecallEngine = Object.freeze({ select: selectYiYiRecall, buildContext: buildYiYiRecallContext });
globalThis.MemoNYiYiRecall = YiYiRecallEngine;
console.log('[Memo-N][伊依] 独立召回引擎已加载：相关性排序 + 重复召回冷却 + 背景锚点预算');
