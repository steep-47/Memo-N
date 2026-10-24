import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../scripts/runtime/cleanupEvidenceWindow.js', import.meta.url), 'utf8');
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
    "const REDUNDANCY_MARKER = 'Memo冗余合并专用整理器'",
    '按0→1→2→3→4→5→6完整扫描当前七表',
    '每个候选独立判断',
    '表0～5：只允许压缩同一现有行内部',
    '同一次具体行动、会面、战斗、调查或同一任务阶段',
    '不同场次、轮次或独立对局',
    '已经完整、紧凑且无明显冗余的行保持原样',
    '不是判断整张表是否“整理过”',
    '只有完整扫描七表后没有任何高置信冗余操作时',
    'rewriteRedundancySystemPrompt',
    'rewriteRedundancyUserPrompt',
    'prompt: rewriteRedundancyUserPrompt(request.prompt)',
    'config.system_prompt = normalCleanup',
    'EDITOR.generateRaw = wrapped',
    'proto.callLLM = wrapped',
]) {
    if (!source.includes(token)) throw new Error(`cleanup evidence window missing: ${token}`);
}

for (const forbidden of [
    'REDUNDANCY_IDEMPOTENCE_RULE',
    '冗余整理应近似幂等',
    '应优先输出NO_CHANGE',
    '只要仍存在明确可合并的逐轮事件链，就应继续整理',
]) {
    if (source.includes(forbidden)) throw new Error(`redundancy cleanup still contains global bias: ${forbidden}`);
}

if (source.includes('const EXPRESSION_RULE =')) {
    throw new Error('普通表格整理不应继续注入长文本压缩职责');
}
if (!source.includes("const CLEANUP_MARKER = 'Memo世界状态表格整理器'")) {
    throw new Error('settlement/maintenance rules must remain scoped to normal table cleanup');
}
if (!loader.includes("'./scripts/runtime/cleanupEvidenceWindow.js'")) {
    throw new Error('cleanup evidence window runtime is not loaded');
}
if (!loader.includes("const RUNTIME_VERSION = '0.80-redundancy-boundaries-1'")) {
    throw new Error('cleanup runtime cache version is not aligned with candidate-boundary rewrite');
}
const manifest = JSON.parse(await fs.readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
if (!loader.includes(`const DISPLAY_VERSION = '${manifest.version}'`)) throw new Error('loader/manifest version mismatch');

console.log('memo-n cleanup evidence window PASS: normal correctness maintenance stays isolated; redundancy scans all seven tables with per-candidate event boundaries');
