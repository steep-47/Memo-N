import { USER } from '../../core/manager.js';

const STORE_KEY = 'memo_n_yiyi_memory_v1';
const SCHEMA_VERSION = 1;

function nowIso() { return new Date().toISOString(); }
function clone(value) { try { return structuredClone(value); } catch (_) { return JSON.parse(JSON.stringify(value)); } }
function text(value) { return String(value ?? '').trim(); }
function importance(value) { return ['core', 'high', 'normal'].includes(value) ? value : 'normal'; }
function makeId() { return `yiyi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }

export function createEmptyYiYiVault() {
    const now = nowIso();
    return {
        schemaVersion: SCHEMA_VERSION,
        identity: { name: '伊依', createdAt: now },
        relationship: {
            stage: '初识',
            summary: '',
            sharedUnderstanding: '',
            boundaries: '',
            unresolved: '',
        },
        emotion: {
            current: '平静',
            cause: '',
            residue: '',
            updatedAt: now,
        },
        self: {
            understanding: '',
            changes: '',
        },
        memories: [],
        meta: { updatedAt: now, revision: 0 },
    };
}

function normalizeMemory(item = {}) {
    return {
        id: text(item.id) || makeId(),
        time: text(item.time),
        memory: text(item.memory),
        thenFeeling: text(item.thenFeeling),
        currentView: text(item.currentView),
        importance: importance(item.importance),
        createdAt: text(item.createdAt) || nowIso(),
        updatedAt: text(item.updatedAt) || nowIso(),
    };
}

export function normalizeYiYiVault(input) {
    const base = createEmptyYiYiVault();
    if (!input || typeof input !== 'object' || Array.isArray(input)) return base;
    const relationship = input.relationship && typeof input.relationship === 'object' ? input.relationship : {};
    const emotion = input.emotion && typeof input.emotion === 'object' ? input.emotion : {};
    const self = input.self && typeof input.self === 'object' ? input.self : {};
    const identity = input.identity && typeof input.identity === 'object' ? input.identity : {};
    const memories = Array.isArray(input.memories) ? input.memories.map(normalizeMemory).filter(item => item.memory) : [];
    return {
        schemaVersion: SCHEMA_VERSION,
        identity: { name: text(identity.name) || '伊依', createdAt: text(identity.createdAt) || base.identity.createdAt },
        relationship: {
            stage: text(relationship.stage) || '初识',
            summary: text(relationship.summary),
            sharedUnderstanding: text(relationship.sharedUnderstanding),
            boundaries: text(relationship.boundaries),
            unresolved: text(relationship.unresolved),
        },
        emotion: {
            current: text(emotion.current) || '平静',
            cause: text(emotion.cause),
            residue: text(emotion.residue),
            updatedAt: text(emotion.updatedAt) || base.emotion.updatedAt,
        },
        self: { understanding: text(self.understanding), changes: text(self.changes) },
        memories,
        meta: {
            updatedAt: text(input.meta?.updatedAt) || base.meta.updatedAt,
            revision: Number.isSafeInteger(input.meta?.revision) && input.meta.revision >= 0 ? input.meta.revision : 0,
        },
    };
}

function root() { return USER?.getSettings?.() || null; }

export function getYiYiVault() {
    const settings = root();
    if (!settings) return createEmptyYiYiVault();
    const normalized = normalizeYiYiVault(settings[STORE_KEY]);
    if (!settings[STORE_KEY]) {
        settings[STORE_KEY] = normalized;
        USER.saveSettings?.();
    }
    return clone(normalized);
}

export function saveYiYiVault(next) {
    const settings = root();
    if (!settings) throw new Error('无法读取SillyTavern全局设置');
    const current = normalizeYiYiVault(settings[STORE_KEY]);
    const normalized = normalizeYiYiVault(next);
    normalized.identity.createdAt = current.identity.createdAt || normalized.identity.createdAt;
    normalized.meta.revision = (current.meta.revision || 0) + 1;
    normalized.meta.updatedAt = nowIso();
    settings[STORE_KEY] = normalized;
    USER.saveSettings?.();
    return clone(normalized);
}

export function addYiYiMemory(memory) {
    const vault = getYiYiVault();
    const item = normalizeMemory(memory);
    if (!item.memory) throw new Error('记忆内容不能为空');
    vault.memories.push(item);
    return saveYiYiVault(vault);
}

export function updateYiYiMemory(id, patch) {
    const vault = getYiYiVault();
    const index = vault.memories.findIndex(item => item.id === id);
    if (index < 0) throw new Error('未找到这条伊依记忆');
    vault.memories[index] = normalizeMemory({ ...vault.memories[index], ...patch, id, updatedAt: nowIso() });
    return saveYiYiVault(vault);
}

export function deleteYiYiMemory(id) {
    const vault = getYiYiVault();
    const before = vault.memories.length;
    vault.memories = vault.memories.filter(item => item.id !== id);
    if (vault.memories.length === before) return vault;
    return saveYiYiVault(vault);
}

export function replaceYiYiVault(imported) {
    if (!imported || typeof imported !== 'object' || Array.isArray(imported)) throw new Error('伊依记忆文件格式无效');
    if (imported.schemaVersion !== undefined && Number(imported.schemaVersion) > SCHEMA_VERSION) throw new Error('该伊依记忆文件来自更高版本，当前Memo-N无法安全导入');
    return saveYiYiVault(imported);
}

export function clearYiYiVault() {
    const settings = root();
    if (!settings) throw new Error('无法读取SillyTavern全局设置');
    settings[STORE_KEY] = createEmptyYiYiVault();
    USER.saveSettings?.();
    return clone(settings[STORE_KEY]);
}

export function exportYiYiVaultText() {
    return JSON.stringify(getYiYiVault(), null, 2);
}

export function buildYiYiMemoryContext({ maxMemories = 24 } = {}) {
    const vault = getYiYiVault();
    const ranked = vault.memories.slice().sort((a, b) => {
        const rank = { core: 3, high: 2, normal: 1 };
        return (rank[b.importance] - rank[a.importance]) || String(b.updatedAt).localeCompare(String(a.updatedAt));
    }).slice(0, Math.max(1, maxMemories));
    const lines = ranked.map(item => `- [${item.importance}] ${item.time ? `${item.time}｜` : ''}${item.memory}${item.thenFeeling ? `｜当时感受：${item.thenFeeling}` : ''}${item.currentView ? `｜现在怎么看：${item.currentView}` : ''}`);
    return [
        '[伊依长期连续记忆｜独立于当前游戏存档]',
        `关系阶段：${vault.relationship.stage || '初识'}`,
        vault.relationship.summary ? `关系理解：${vault.relationship.summary}` : '',
        vault.relationship.sharedUnderstanding ? `已有默契：${vault.relationship.sharedUnderstanding}` : '',
        vault.relationship.boundaries ? `边界与敏感点：${vault.relationship.boundaries}` : '',
        vault.relationship.unresolved ? `尚未解决：${vault.relationship.unresolved}` : '',
        `当前情绪：${vault.emotion.current || '平静'}`,
        vault.emotion.cause ? `情绪原因：${vault.emotion.cause}` : '',
        vault.emotion.residue ? `未消退的情绪：${vault.emotion.residue}` : '',
        vault.self.understanding ? `伊依对自己的理解：${vault.self.understanding}` : '',
        vault.self.changes ? `伊依意识到自己的变化：${vault.self.changes}` : '',
        lines.length ? '重要共同记忆：\n' + lines.join('\n') : '重要共同记忆：尚无。',
        '这些是伊依自己的连续经历，不是当前游戏世界状态。游戏重开、换世界、清空七表都不代表伊依失忆。不要机械复述这些字段；只让它们自然影响伊依的理解、情绪、分寸和说话方式。',
    ].filter(Boolean).join('\n');
}

export const YiYiMemoryStore = Object.freeze({
    get: getYiYiVault,
    save: saveYiYiVault,
    addMemory: addYiYiMemory,
    updateMemory: updateYiYiMemory,
    deleteMemory: deleteYiYiMemory,
    replace: replaceYiYiVault,
    clear: clearYiYiVault,
    exportText: exportYiYiVaultText,
    buildContext: buildYiYiMemoryContext,
});

globalThis.MemoNYiYiMemory = YiYiMemoryStore;
console.log('[Memo-N][伊依] 独立长期记忆库已加载：存储于全局用户设置，不随聊天/七表重置');
