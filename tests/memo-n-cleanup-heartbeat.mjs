import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../scripts/runtime/stableTableCleanup.js', import.meta.url), 'utf8');
const evidence = await fs.readFile(new URL('../scripts/runtime/cleanupEvidenceWindow.js', import.meta.url), 'utf8');
const loader = await fs.readFile(new URL('../loader.js', import.meta.url), 'utf8');

for (const token of [
    'handleMainAPIRequest',
    'await handleMainAPIRequest(SYSTEM_PROMPT,userPrompt)',
    'handleCustomAPIRequest',
    'executeMemoTableEdit',
    'parseMemoTableEdit',
]) {
    if (!source.includes(token)) throw new Error(`stable cleanup path missing: ${token}`);
}

for (const forbidden of [
    'requestMainApiWithHeartbeat',
    'generation_id',
    'should_stream',
    'stopGenerationById',
    'js_stream_token_received_incrementally',
    'js_stream_token_received_fully',
    'CLEANUP_STALL_MS',
    'TavernHelper.generateRaw',
]) {
    if (source.includes(forbidden)) throw new Error(`stable cleanup must not use heartbeat/direct TavernHelper path: ${forbidden}`);
}

if (!evidence.includes('buildOneRoundEvidence')) throw new Error('cleanup one-round evidence window missing');
if (!evidence.includes('最近聊天只作为极小的校对证据窗口')) throw new Error('cleanup evidence scope marker missing');
if (evidence.includes('patchTavernHelper') || evidence.includes('helper.generateRaw') || evidence.includes('globalThis.TavernHelper')) {
    throw new Error('cleanup evidence window must not modify TavernHelper');
}

if (loader.includes("'./scripts/runtime/tavernHelperHeartbeatCompat.js'")) {
    throw new Error('heartbeat bridge must stay unloaded after restoring stable cleanup API path');
}
if (!loader.includes("'./scripts/runtime/stableTableCleanup.js'")) throw new Error('stable cleanup runtime missing from loader');
if (!loader.includes("'./scripts/runtime/cleanupEvidenceWindow.js'")) throw new Error('cleanup evidence runtime missing from loader');
if (!loader.includes("const DISPLAY_VERSION = '0.51'")) throw new Error('loader version must be 0.51');
if (!loader.includes('0.51-story-prompt-compaction-1')) throw new Error('loader cache marker must use current prompt compaction path');

console.log('memo-n cleanup stable path PASS: original handleMainAPIRequest restored, no direct TavernHelper streaming, one-round evidence preserved, 0.51 cache marker');
