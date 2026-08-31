import fs from 'node:fs';
import assert from 'node:assert/strict';

const ui = fs.readFileSync(new URL('../scripts/ui/apiModeToggle.js', import.meta.url), 'utf8');
const template = fs.readFileSync(new URL('../assets/templates/index.html', import.meta.url), 'utf8');
const loader = fs.readFileSync(new URL('../loader.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

assert.match(template, /id="memo-record-provider-route"/u, 'Memo-N 设置模板必须直接包含记录接口选择器');
assert.match(template, /<option value="deepseek">DeepSeek<\/option>/u, '记录接口必须提供 DeepSeek');
assert.match(template, /<option value="relay">中转站<\/option>/u, '记录接口必须提供中转站');
assert.match(template, /id="memory-independent-record-api"/u, 'Memo-N 设置模板必须直接包含独立记录 API 开关');

assert.match(ui, /new MutationObserver\(scheduleMount\)/u, '移动端晚加载/重渲染必须持续可恢复挂载');
assert.doesNotMatch(ui, /setTimeout\(\(\) => observer\.disconnect\(\),\s*10000\)/u, '不能恢复只观察 10 秒的挂载窗口');
assert.match(ui, /function syncModeUi\(\)/u, '重挂载必须使用只同步 UI 的函数');

const mountBody = ui.match(/function mount\(\) \{([\s\S]*?)\n\}\n\nlet mountQueued/u)?.[1] ?? '';
assert.ok(mountBody, '必须能定位 mount() 实现');
assert.doesNotMatch(mountBody, /applyMode\(/u, 'mount() 不得调用会改写独立记录/step_by_step 状态的 applyMode()');
assert.match(mountBody, /syncModeUi\(\)/u, 'mount() 只同步独立记录开关 UI');
assert.match(mountBody, /getManualProviderRoute\(\)/u, 'mount() 应从统一手动 route 读取当前接口');

assert.match(loader, /RUNTIME_VERSION = 'memon73'/u, 'Loader 缓存版本必须为 memon73');
assert.equal(manifest.version, '0.1.0-memon.73', 'manifest 版本必须为 memon73');

console.log('memo-n-provider-ui: all assertions passed');
