import fs from 'node:fs/promises';

const guard = await fs.readFile(new URL('../scripts/runtime/cleanupEvidenceWindow.js', import.meta.url), 'utf8');
const cleanup = await fs.readFile(new URL('../scripts/runtime/stableTableCleanup.js', import.meta.url), 'utf8');
const loader = await fs.readFile(new URL('../loader.js', import.meta.url), 'utf8');

for (const token of [
    'buildOneRoundEvidence',
    '<最近聊天>',
    '最近聊天只作为极小的校对证据窗口',
    '表内没有对应问题时，不主动从最近聊天扩写新内容',
    '普通“表格整理”只做七表正确性维护',
    '不做长文本润色或内容压缩',
    '完整事件级跨行合并',
    '删除表3中已完成、失败、取消、失效或明确到期的事项前',
    '普通完成项不为留痕而新增表6',
    '期限结束只证明原状态终止',
    '结算完成后再删除表3',
    "const CLEANUP_MARKER = 'Memo世界状态表格整理器'",
    'EDITOR.generateRaw = wrapped',
    'proto.callLLM = wrapped',
]) {
    if (!guard.includes(token)) throw new Error(`normal cleanup guard missing: ${token}`);
}

for (const forbidden of [
    'REDUNDANCY_MARKER',
    'REDUNDANCY_SYSTEM_RULE',
    'REDUNDANCY_USER_RULE',
    'rewriteRedundancySystemPrompt',
    'rewriteRedundancyUserPrompt',
    '冗余整理应近似幂等',
    '应优先输出NO_CHANGE',
    '每个候选独立判断',
]) {
    if (guard.includes(forbidden)) throw new Error(`normal cleanup guard still rewrites redundancy cleanup: ${forbidden}`);
}

for (const token of [
    'Memo冗余合并专用整理器',
    '表0～5仅可压缩同一现有行内部明确重复、同义堆叠且不承载额外事实的文字',
    '表6负责事件级冗余整理',
    '同一目标、冲突或连续行动链的多行',
    '复杂事件中具有独立回溯价值的子事件可分开保留',
    '只允许updateRow和deleteRow',
    '不得补漏、纠错、迁移字段、编造事实',
    '无需改动时输出<tableEdit><!-- NO_CHANGE --></tableEdit>',
]) {
    if (!cleanup.includes(token)) throw new Error(`single redundancy prompt missing: ${token}`);
}

for (const forbidden of [
    'REDUNDANCY_IDEMPOTENCE_RULE',
    '冗余整理应近似幂等',
    '重复执行只保护',
    '优先输出NO_CHANGE',
    '只有完整扫描七表后没有任何高置信冗余操作时',
]) {
    if (cleanup.includes(forbidden)) throw new Error(`redundancy prompt still contains layered control rule: ${forbidden}`);
}

if (!loader.includes("'./scripts/runtime/cleanupEvidenceWindow.js'")) {
    throw new Error('normal cleanup evidence guard is not loaded');
}
if (!loader.includes("const RUNTIME_VERSION = '0.81-redundancy-single-responsibility-1'")) {
    throw new Error('runtime cache version is not aligned with redundancy simplification');
}
const manifest = JSON.parse(await fs.readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
if (manifest.version !== '0.81') throw new Error('manifest version mismatch');
if (!loader.includes(`const DISPLAY_VERSION = '${manifest.version}'`)) throw new Error('loader/manifest version mismatch');

console.log('memo-n cleanup evidence window PASS: normal cleanup guard is isolated and redundancy cleanup has one prompt path');
