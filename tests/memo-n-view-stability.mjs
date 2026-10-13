import fs from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const loader = await fs.readFile(new URL('loader.js', root), 'utf8');
const manager = await fs.readFile(new URL('core/manager.js', root), 'utf8');
const guard = await fs.readFile(new URL('scripts/runtime/tableViewStabilityGuard.js', root), 'utf8');
const manifest = JSON.parse(await fs.readFile(new URL('manifest.json', root), 'utf8'));

if (!loader.includes("await import('./index.js');")) {
    throw new Error('loader 未使用唯一标准 URL 加载 index.js');
}
if (/index\.js\?v=/.test(loader)) {
    throw new Error('loader 再次给 index.js 添加查询版本，会与 manager 的循环引用形成第二个模块实例');
}
if (!manager.includes('from "../index.js"') && !manager.includes("from '../index.js'")) {
    throw new Error('manager 的 index.js 循环引用结构发生变化，请重新检查主入口单例策略');
}

const stabilityIndex = loader.indexOf('./scripts/runtime/tableViewStabilityGuard.js');
const profileIndex = loader.indexOf('./scripts/runtime/playerProfileSchema.js');
if (stabilityIndex < 0 || profileIndex < 0 || stabilityIndex > profileIndex) {
    throw new Error('表格视图稳定守卫必须先于玩家资料结构升级加载');
}

for (const required of [
    'refreshQueue',
    'dedupeDrawerRoots',
    'dedupeTableGroups',
    'data-table-directory-sheet-title',
    'waitForStableView',
]) {
    if (!guard.includes(required)) throw new Error(`视图稳定守卫缺少关键机制：${required}`);
}

// Compare release identifiers instead of pinning an obsolete release number.
const index = await fs.readFile(new URL('index.js', root), 'utf8');
const readme = await fs.readFile(new URL('README.md', root), 'utf8');
const displayVersion = loader.match(/const DISPLAY_VERSION = '([^']+)'/)?.[1];
const entryVersion = index.match(/const VERSION = '([^']+)'/)?.[1];
if (!manifest.version || displayVersion !== manifest.version || entryVersion !== manifest.version) {
    throw new Error(`版本不一致：manifest=${manifest.version}, loader=${displayVersion}, index=${entryVersion}`);
}
if (!readme.includes('当前版本：`' + manifest.version + '`')) throw new Error('README 当前版本与 manifest 不一致');

console.log('memo-n view stability PASS: canonical-index=1, runtime-order=1, refresh-queue=1, drawer-dedupe=1, sheet-uid-dedupe=1, version-consistency=1');
