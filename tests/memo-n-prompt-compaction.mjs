import fs from 'node:fs/promises';

const index = await fs.readFile(new URL('../index.js', import.meta.url), 'utf8');
const settings = await fs.readFile(new URL('../data/pluginSetting.js', import.meta.url), 'utf8');
const audit = await fs.readFile(new URL('../scripts/runtime/continuityAuditRules.js', import.meta.url), 'utf8');
const engine = await fs.readFile(new URL('../scripts/engine/recordEngine.js', import.meta.url), 'utf8');
const loader = await fs.readFile(new URL('../loader.js', import.meta.url), 'utf8');

if (!settings.includes('compact_story_context: true')) throw new Error('精简剧情表格上下文未默认开启');
if (!index.includes('COMPACT_STORY_CONTEXT_TEMPLATE')) throw new Error('缺少正常剧情精简表格上下文');
if (!index.includes('getTablePrompt(eventData, useCompactStoryContext)')) throw new Error('精简模式没有切换为纯表格事实');
if (!index.includes('它不是剧情提纲、任务清单或出场名单')) throw new Error('表格与剧情优先级边界缺失');
if (!index.includes('不为填表主动制造事件、关系、关注、机缘或主线')) throw new Error('缺少记录不得反向创造剧情的边界');

const patchSettings = audit.match(/function patchSettings\(settings\) \{[\s\S]*?\n\}/)?.[0] ?? '';
if (!patchSettings.includes('settings.message_template = stripOldAudit')) throw new Error('旧基础模板中的重复审计没有清理');
if (patchSettings.includes('settings.message_template = appendRules')) throw new Error('详细审计仍会追加到正常剧情基础模板');

const finalAudit = audit.match(/function injectFinalAudit\(data\) \{[\s\S]*?\n\}/)?.[0] ?? '';
if (finalAudit.includes('data.messages.push')) throw new Error('详细审计仍会在正常剧情请求末尾重复注入');
if (!engine.includes("const MARKER = '[Memo-N native tableEdit one-call v1]'")) throw new Error('唯一单次API记录协议被移除');
if (!loader.includes("DISPLAY_VERSION = '0.51'")) throw new Error('插件显示版本没有更新');

console.log('memo-n prompt compaction PASS: compact facts=1, duplicate base audit=0, duplicate final audit=0, single record contract=1');
