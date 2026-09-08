import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../scripts/runtime/stableTableCleanup.js', import.meta.url), 'utf8');
const loader = await fs.readFile(new URL('../loader.js', import.meta.url), 'utf8');

for (const token of [
    'generation_id: generationId',
    'should_stream: true',
    'js_stream_token_received_incrementally',
    'js_stream_token_received_fully',
    'stopGenerationById',
    'CLEANUP_STALL_MS = 180_000',
    '等待首个流式进展',
    '最近有进展',
]) {
    if (!source.includes(token)) throw new Error(`cleanup heartbeat missing: ${token}`);
}

const guardedStall = /if \(hasStreamProgress\) \{[\s\S]*?idleMs >= CLEANUP_STALL_MS[\s\S]*?abort\('stalled'\)/.test(source);
if (!guardedStall) throw new Error('断流停止必须只在已经收到流式进展后触发');

if (!source.includes("return settled.reason === 'stalled' ? CLEANUP_STALLED : 'suspended'")) {
    throw new Error('手动中止与断流停止必须返回不同结果');
}
if (!source.includes('原表未修改')) throw new Error('中止/断流路径必须明确保持原表不变');
if (!loader.includes("const DISPLAY_VERSION = '0.27'")) throw new Error('loader版本未升级到0.27');
if (!loader.includes("0.27-cleanup-stream-heartbeat")) throw new Error('loader缓存标识未更新');

console.log('memo-n cleanup heartbeat PASS: generation scoped streaming progress, guarded stall stop, immediate cancellation path, 0.27 cache marker');
