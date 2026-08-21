import fs from 'node:fs/promises';
import path from 'node:path';

const root = new URL('..', import.meta.url);
const files = [];
async function walk(relative = '.') {
    for (const entry of await fs.readdir(new URL(`${relative}/`, root), { withFileTypes: true })) {
        const next = path.posix.join(relative, entry.name);
        if (next.startsWith('.git') || next.startsWith('tests')) continue;
        if (entry.isDirectory()) await walk(next);
        else if (/\.(?:js|mjs)$/.test(entry.name)) files.push(next);
    }
}
await walk();

const forbidden = [
    /\bmuyoo_dataTable\b/,
    /(?<!memo_n_)\bhash_sheets\b/,
    /(?<!memo_n_)\bmemo_hash_sheets\b/,
    /(?<!memo_n_)\btable_database_templates\b/,
    /(?<!memo_n_)\btable_selected_sheets\b/,
    /chatMetadata\.selected_sheets\b/,
    /chatMetadata\.sheets\b/,
];
const violations = [];
for (const file of files) {
    const text = await fs.readFile(new URL(file, root), 'utf8');
    for (const pattern of forbidden) if (pattern.test(text)) violations.push(`${file}: ${pattern}`);
}
if (violations.length) throw new Error(`Memo-N仍会触碰原Memo存储键：\n${violations.join('\n')}`);

const manager = await fs.readFile(new URL('../core/manager.js', import.meta.url), 'utf8');
for (const key of ['memo_n_settings', 'memo_n_private_data', 'memo_n_table_database_templates', 'memo_n_hash_sheets', 'memo_n_swipe_hash_sheets', 'memo_n_sheets']) {
    if (!manager.includes(key)) throw new Error(`Memo-N核心缺少独立存储键：${key}`);
}
const appManager = await fs.readFile(new URL('../services/appFuncManager.js', import.meta.url), 'utf8');
const translation = await fs.readFile(new URL('../services/translate.js', import.meta.url), 'utf8');
const index = await fs.readFile(new URL('../index.js', import.meta.url), 'utf8');
if (!appManager.includes('third-party/Memo-N') || !translation.includes('third-party/Memo-N')) throw new Error('Memo-N仍从原Memo安装目录读取资源');
if (index.includes('window.stMemoryEnhancement =') || !index.includes('window.memoN =')) throw new Error('Memo-N仍覆盖原插件的全局API对象');
console.log('memo-n-storage-isolation PASS: settings=1, templates=1, chat-snapshots=1, swipe-snapshots=1, old-keys-untouched=1');
