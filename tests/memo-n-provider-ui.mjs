import fs from 'node:fs';
import assert from 'node:assert/strict';

const ui = fs.readFileSync(new URL('../scripts/ui/apiModeToggle.js', import.meta.url), 'utf8');
const template = fs.readFileSync(new URL('../assets/templates/index.html', import.meta.url), 'utf8');
const loader = fs.readFileSync(new URL('../loader.js', import.meta.url), 'utf8');
const modeRuntime = fs.readFileSync(new URL('../scripts/runtime/modeRuntimeControl.js', import.meta.url), 'utf8');
const structureRepair = fs.readFileSync(new URL('../scripts/runtime/tableStructureRepair.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

assert.match(template, /id="memo-record-provider-route"/u, 'Memo-N 设置模板必须直接包含记录接口选择器');
assert.match(template, /<option value="deepseek">DeepSeek<\/option>/u, '记录接口必须提供 DeepSeek');
assert.match(template, /<option value="relay">中转站<\/option>/u, '记录接口必须提供中转站');

// 模式选择只保留原插件的“填表行为发生在”，不再并列第二个独立记录开关。
assert.match(template, /id="fill_table_time"/u, '必须保留原生填表时机选择器');
assert.match(template, /<option value="chat">聊天的同时填表<\/option>/u);
assert.match(template, /<option value="after">收到消息后再单独填表<\/option>/u);
assert.doesNotMatch(template, /id="memory-independent-record-api"/u, '不得再显示重复的独立记录 API 开关');
assert.doesNotMatch(template, /id="step_by_step_use_main_api"/u, '独立记录区不得再显示旧主/自定义 API 路由开关');
assert.match(template, /自定义独立API（中转站）/u, '中转站独立 API 配置仍需保留');

assert.match(ui, /new MutationObserver\(scheduleMount\)/u, '移动端晚加载/重渲染必须持续可恢复挂载');
assert.doesNotMatch(ui, /setTimeout\(\(\) => observer\.disconnect\(\),\s*10000\)/u, '不能恢复只观察 10 秒的挂载窗口');
assert.match(ui, /function syncModeSections\(fillTime\)/u, '必须按唯一模式值同步区域显隐');
assert.match(ui, /function bindFillTime\(fillTime\)/u, '必须把原生填表时机选择器绑定到 Memo-N 独立模式设置');
assert.match(ui, /fillTime\.value === 'after'/u, 'after 必须映射为独立记录模式');
assert.doesNotMatch(ui, /syncIndependentApiRoute/u, '记录接口选择器不得再通过旧 step_by_step_use_main_api 间接路由');
assert.doesNotMatch(ui, /step_by_step_use_main_api\s*=/u, '记录接口 UI 不得改写历史 step_by_step_use_main_api 配置');

const mountBody = ui.match(/function mount\(\) \{([\s\S]*?)\n\}\n\nlet mountQueued/u)?.[1] ?? '';
assert.ok(mountBody, '必须能定位 mount() 实现');
assert.doesNotMatch(mountBody, /tableBaseSetting\.step_by_step\s*=/u, 'mount() 不得赋值旧 step_by_step 状态');
assert.doesNotMatch(mountBody, /tableBaseSetting\.step_by_step_use_main_api\s*=/u, 'mount() 不得赋值旧主/自定义 API 状态');
assert.match(mountBody, /getManualProviderRoute\(\)/u, 'mount() 应从统一手动 route 读取当前接口');
assert.match(mountBody, /syncModeSections\(fillTime\)/u, 'mount() 必须根据持久化模式恢复正确区域显隐');

// memon77：内部静态模块不得再自行钉死旧 memon6/memon52 query；缓存失效由 loader 唯一控制。
assert.doesNotMatch(modeRuntime, /\?v=memon\d+/u, 'modeRuntimeControl 不得钉死旧子模块版本');
assert.doesNotMatch(structureRepair, /\?v=memon\d+/u, 'tableStructureRepair 不得钉死旧迁移模块版本');
assert.match(loader, /RUNTIME_VERSION = 'memon77'/u, 'Loader 缓存版本必须为 memon77');
assert.match(loader, /PUBLIC_VERSION = '0\.1\.0-memon\.77'/u, 'Loader 必须同步公开版本号');
assert.match(loader, /内部模块使用无版本query的静态import/u, 'Loader 必须声明唯一缓存版本所有权');
assert.match(loader, /window\.memoN\.VERSION = PUBLIC_VERSION/u, 'Loader 必须覆盖旧 index.js 暴露的版本号');
assert.match(loader, /DOMContentLoaded/u, '公开版本同步必须覆盖晚初始化时序');
assert.equal(manifest.version, '0.1.0-memon.77', 'manifest 版本必须为 memon77');
console.log('memo-n-provider-ui: all assertions passed');
