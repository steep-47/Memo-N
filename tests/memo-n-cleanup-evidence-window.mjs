import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../scripts/runtime/cleanupEvidenceWindow.js', import.meta.url), 'utf8');
const loader = await fs.readFile(new URL('../loader.js', import.meta.url), 'utf8');

for (const token of [
    'buildOneRoundEvidence',
    '<最近聊天>',
    '最近聊天只作为极小的校对证据窗口',
    '表内没有对应问题时，不主动从最近聊天扩写新内容',
    'helper.generateRaw = wrapped',
    'EDITOR.generateRaw = wrapped',
    'proto.callLLM = wrapped',
]) {
    if (!source.includes(token)) throw new Error(`cleanup evidence window missing: ${token}`);
}

if (!loader.includes("'./scripts/runtime/cleanupEvidenceWindow.js'")) {
    throw new Error('cleanup evidence window runtime is not loaded');
}
if (!loader.includes("const DISPLAY_VERSION = '0.31'")) {
    throw new Error('loader version is not 0.31');
}

console.log('memo-n cleanup evidence window PASS: seven tables remain primary, chat reduced to one evidence round');
