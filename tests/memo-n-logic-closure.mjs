import fs from 'node:fs/promises';

const semantics = await fs.readFile(new URL('../scripts/runtime/recordSemantics.js', import.meta.url), 'utf8');
const output = await fs.readFile(new URL('../scripts/runtime/recordOnlyOutputProtocolGuard.js', import.meta.url), 'utf8');
const oneCallGuard = await fs.readFile(new URL('../scripts/runtime/identityExpectedPromptGuard.js', import.meta.url), 'utf8');
const cleanup = await fs.readFile(new URL('../scripts/runtime/cleanupEvidenceWindow.js', import.meta.url), 'utf8');
const mode = await fs.readFile(new URL('../scripts/runtime/modeRuntimeControl.js', import.meta.url), 'utf8');
const manual = await fs.readFile(new URL('../scripts/runtime/manualRoundContextBridge.js', import.meta.url), 'utf8');
const loader = await fs.readFile(new URL('../loader.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await fs.readFile(new URL('../manifest.json', import.meta.url), 'utf8'));

for (const token of [
    '一次API与独立API只差请求所用provider',
    '不借记录请求做与本轮无关的全局清理',
    '表3除任务、承诺、交易、约定外，也记录有明确期限或结束条件、尚未结算的持续事项',
    '表6是高召回历史采集层',
    '跨轮完整事件识别与压缩统一交给“冗余整理”',
    'LEGACY_RECORD_CONFLICTS',
    'normalizeLegacyRecordSemantics',
]) {
    if (!semantics.includes(token)) throw new Error(`record semantics missing: ${token}`);
}

if (!output.includes('normalizeLegacyRecordSemantics')) throw new Error('independent/raw record path does not strip legacy conflicting semantics');
if (!oneCallGuard.includes('normalizeLegacyRecordSemantics')) throw new Error('one-call path does not strip legacy conflicting semantics');
if (!output.includes("const REDUNDANCY_MARKER = 'Memo冗余合并专用整理器'")) throw new Error('output guard cannot identify redundancy cleanup');
if (!output.includes('function shouldIncludeRecordSemantics')) throw new Error('output guard lacks cleanup-mode semantics isolation');
if (!output.includes('placeRecordSemanticsBeforeFinalUser')) throw new Error('record semantics are not made final system authority');
if (!cleanup.includes('普通“表格整理”只做七表正确性维护')) throw new Error('normal cleanup is not correctness-only');
if (!cleanup.includes('完整事件级跨行合并以及纯内容冗余压缩统一交给“冗余整理”')) throw new Error('normal cleanup still overlaps redundancy cleanup');
if (cleanup.includes('const EXPRESSION_RULE =')) throw new Error('normal cleanup still injects long-text compression');

for (const [label, source] of [['auto independent', mode], ['manual independent', manual]]) {
    if (!source.includes("./separateTableUpdate.js?v=memon82")) throw new Error(`${label} does not reuse canonical separateTableUpdate module URL`);
    if (source.includes("./separateTableUpdate.js?v=0.50")) throw new Error(`${label} still loads stale/duplicate v0.50 module URL`);
}

if (!loader.includes(`const DISPLAY_VERSION = '${manifest.version}'`)) throw new Error('loader display version does not match manifest');
if (!loader.includes(`const RUNTIME_VERSION = '${manifest.version}-`)) throw new Error('runtime cache version does not start with current release version');

console.log('memo-n logic closure PASS: conflicting legacy prompts are stripped; record, maintenance and redundancy remain separated across release bumps');
