import fs from 'node:fs/promises';

const guard = await fs.readFile(new URL('../scripts/runtime/cleanupEvidenceWindow.js', import.meta.url), 'utf8');
const cleanup = await fs.readFile(new URL('../scripts/runtime/stableTableCleanup.js', import.meta.url), 'utf8');
const segmented = await fs.readFile(new URL('../scripts/runtime/redundancySegmentedView.js', import.meta.url), 'utf8');
const bridge = await fs.readFile(new URL('../scripts/runtime/cleanupButtonBridge.js', import.meta.url), 'utf8');
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
    '先完整检查当前七表，再一次性生成最终tableEdit',
    '表0～5按表序检查',
    '表6必须从当前最早的数据行开始',
    '严格按rowIndex递增顺序连续扫描到最后一行',
    '完整扫描不等于必须修改',
    '表6原始行是高召回的逐轮记录',
    '每一行中的“结果”只表示该轮或该阶段产生的局部结果',
    '不能仅因为某一行写有结果就把它视为独立完整事件',
    '不同独立事件不得仅因时间相邻',
    '只允许updateRow和deleteRow',
    '不得补漏、纠错、迁移字段、编造事实',
    '无需改动时输出<tableEdit><!-- NO_CHANGE --></tableEdit>',
]) {
    if (!cleanup.includes(token)) throw new Error(`single redundancy prompt missing: ${token}`);
}

for (const token of [
    'TIME_BLOCK_GAP_MINUTES = 60',
    'LONG_EVENT_ROW_MINUTES = 120',
    'FORMAL_STAGE_RE',
    '四强(?:首战|次战|次阵|战)?',
    '总决战',
    'segmentHistoryRows',
    'formatSegmentedHistoryTable',
    '候选事件组',
    'rowIndex始终是原表真实行号',
    'runWithSegmentedHistoryView',
]) {
    if (!segmented.includes(token)) throw new Error(`segmented redundancy view missing: ${token}`);
}
if (!bridge.includes("runWithSegmentedHistoryView(() => runStableCleanup('redundancy'))")) {
    throw new Error('redundancy button does not use segmented history view');
}
if (bridge.includes('runWithSegmentedHistoryView(() => runStableCleanup())')) {
    throw new Error('normal cleanup must not use segmented history view');
}

for (const forbidden of [
    'REDUNDANCY_IDEMPOTENCE_RULE',
    '冗余整理应近似幂等',
    '重复执行只保护',
    '优先输出NO_CHANGE',
    '尽可能多整理',
    '必须处理所有可合并项',
]) {
    if (cleanup.includes(forbidden)) throw new Error(`redundancy prompt still contains layered control rule: ${forbidden}`);
}

if (!loader.includes("'./scripts/runtime/cleanupEvidenceWindow.js'")) {
    throw new Error('normal cleanup evidence guard is not loaded');
}
if (!loader.includes("const RUNTIME_VERSION = '0.84-redundancy-segmented-history-1'")) {
    throw new Error('runtime cache version is not aligned with segmented redundancy semantics');
}
const manifest = JSON.parse(await fs.readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
if (manifest.version !== '0.84') throw new Error('manifest version mismatch');
if (!loader.includes(`const DISPLAY_VERSION = '${manifest.version}'`)) throw new Error('loader/manifest version mismatch');

console.log('memo-n cleanup evidence window PASS: normal cleanup stays isolated and redundancy uses segmented history input');
