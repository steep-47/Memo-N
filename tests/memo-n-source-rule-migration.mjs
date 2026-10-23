import fs from 'node:fs/promises';

const semantics = await fs.readFile(new URL('../scripts/runtime/recordSemantics.js', import.meta.url), 'utf8');
const preflight = await fs.readFile(new URL('../scripts/runtime/worldTableStructurePreflight.js', import.meta.url), 'utf8');

for (const token of [
    'HISTORY_TABLE_RULES',
    '每个有实际剧情推进的回复都记录本轮已发生且对后续连续性有价值的事实',
    '跨轮完整事件合并交给冗余整理',
    '记录阶段不把多轮事件压成一条',
    '完整事件压缩由冗余整理处理',
    'LEGACY_HISTORY_CONTRACT',
]) {
    if (!semantics.includes(token)) throw new Error(`history high-recall rule missing: ${token}`);
}

for (const token of [
    'primeCanonicalRuleSource',
    'syncCurrentChatRuleMetadata',
    'scheduleRuleMetadataSync',
    'APP.event_types?.CHAT_CHANGED',
    'APP.event_types?.CHAT_LOADED',
    '数据行与历史快照未改动',
]) {
    if (!preflight.includes(token)) throw new Error(`old-chat rule migration missing: ${token}`);
}

const syncStart = preflight.indexOf('function syncCurrentChatRuleMetadata');
const syncEnd = preflight.indexOf('function scheduleRuleMetadataSync');
if (syncStart < 0 || syncEnd <= syncStart) throw new Error('cannot isolate metadata-only sync function');
const syncBody = preflight.slice(syncStart, syncEnd);
for (const forbidden of [
    'rebuildHashSheetByValueSheet',
    'repairMissingColumnsBeforeCleanup',
    'ensureSevenTableWorld',
    'memo_n_hash_sheets',
    'swipe_info',
]) {
    if (syncBody.includes(forbidden)) throw new Error(`metadata-only migration must not mutate table structure/content/snapshots: ${forbidden}`);
}
if (!syncBody.includes('syncRuleData') || !syncBody.includes('sheet.save?.(null, true)')) {
    throw new Error('metadata-only migration does not persist standard rule fields without touching message snapshots');
}

const scheduleStart = preflight.indexOf('function scheduleRuleMetadataSync');
const verifyStart = preflight.indexOf('function verifySevenTableStructure');
const scheduleBody = preflight.slice(scheduleStart, verifyStart);
if (scheduleBody.includes('ensureSevenTableWorld') || scheduleBody.includes('repairMissingColumnsBeforeCleanup')) {
    throw new Error('chat-load rule migration must not trigger structural migration');
}

console.log('memo-n source rule migration PASS: high-recall history rules auto-sync to old chats without touching data rows or message/swipe snapshots');
