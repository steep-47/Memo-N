import fs from 'node:fs/promises';

const cleanup = await fs.readFile(new URL('../scripts/runtime/stableTableCleanup.js', import.meta.url), 'utf8');
const settings = await fs.readFile(new URL('../data/pluginSetting.js', import.meta.url), 'utf8');

for (const token of [
    '只做去冗余与合并，不做正确性维护',
    '表6以完整事件而非文字相似度为单位',
    '事件尚未闭合或边界不清时保持原样',
    '禁止只剩最终结果',
    '不清理完成或过期状态',
]) {
    if (!cleanup.includes(token)) throw new Error(`redundancy cleanup contract missing: ${token}`);
}

if (!cleanup.includes('期限已到且无明确延期/续期的事项应删除')) {
    throw new Error('table repair must own explicit timed-expiry cleanup');
}
if (!settings.includes('有明确期限或结束条件、尚未结算的持续事项')) {
    throw new Error('table 3 must track unresolved timed matters');
}
if (!settings.includes('延期或续期只依据新的明确事实，不因重复提及自动续期')) {
    throw new Error('table 3 must not auto-extend timed matters');
}

console.log('memo-n redundancy event-level PASS: redundancy merges only; repair owns correctness and expiry');
