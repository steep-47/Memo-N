import fs from 'node:fs/promises';

const cleanup = await fs.readFile(new URL('../scripts/runtime/stableTableCleanup.js', import.meta.url), 'utf8');
const bridge = await fs.readFile(new URL('../scripts/runtime/cleanupButtonBridge.js', import.meta.url), 'utf8');
const loader = await fs.readFile(new URL('../loader.js', import.meta.url), 'utf8');

if (!cleanup.includes('getTablePromptByPiece(piece, redundancyOnly)')) {
    throw new Error('redundancy cleanup must request pure table data');
}
if (!cleanup.includes("const redundancyOnly = mode === 'redundancy'")) {
    throw new Error('redundancy mode detection missing');
}
if (!bridge.includes("stableTableCleanup.js?v=0.79-redundancy-pure-data-1")) {
    throw new Error('cleanup button bridge still points to a stale cleanup runtime');
}
if (!loader.includes("RUNTIME_VERSION = '0.79-redundancy-pure-data-1'")) {
    throw new Error('loader runtime version does not match cleanup button bridge');
}

console.log('memo-n redundancy pure-data PASS: redundancy cleanup excludes record rules and button bridge uses the current cleanup runtime');
