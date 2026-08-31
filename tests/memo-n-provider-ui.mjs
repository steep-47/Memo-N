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
assert.doesNotMatch(ui, /syncIndependentApiRoute/u, '记录接口选择器不得再通过旧 step_by_step_use_main_api 间接路由');
assert.doesNotMatch(ui, /step_by_step_use_main_api\s*=/u, '记录接口 UI 不得改写历史 step_by_step_use_main_api 配置');

const mountBody = ui.match(/function mount\(\) \{([\s\S]*?)\n\}\n\nlet mountQueued/u)?.[1] ?? '';
assert.ok(mountBody, '必须能定位 mount() 实现');
assert.doesNotMatch(mountBody, /applyMode\(/u, 'mount() 不得调用会改写独立记录/step_by_step 状态的 applyMode()');
assert.doesNotMatch(mountBody, /tableBaseSetting\.step_by_step\s*=/u, 'mount() 不得赋值旧 step_by_step 状态');
assert.doesNotMatch(mountBody, /tableBaseSetting\.step_by_step_use_main_api\s*=/u, 'mount() 不得赋值旧主/自定义 API 状态');
assert.match(mountBody, /syncModeUi\(\)/u, 'mount() 只同步独立记录开关 UI');
assert.match(mountBody, /getManualProviderRoute\(\)/u, 'mount() 应从统一手动 route 读取当前接口');

assert.match(loader, /RUNTIME_VERSION = 'memon74'/u, 'Loader 缓存版本必须为 memon74');
assert.match(loader, /PUBLIC_VERSION = '0\.1\.0-memon\.74'/u, 'Loader 必须同步公开版本号');
assert.match(loader, /window\.memoN\.VERSION = PUBLIC_VERSION/u, 'Loader 必须覆盖旧 index.js 暴露的版本号');
assert.equal(manifest.version, '0.1.0-memon.74', 'manifest 版本必须为 memon74');
console.log('memo-n-provider-ui: all assertions passed');
