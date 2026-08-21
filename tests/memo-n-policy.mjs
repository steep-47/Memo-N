import { buildPresetCharacterRule, normalizeRecordPolicy, PRESET_CHARACTER_POLICIES } from '../scripts/engine/recordPolicy.js';

if (normalizeRecordPolicy({}).presetCharacterPolicy !== PRESET_CHARACTER_POLICIES.CHANGES_ONLY) throw new Error('预设人物策略默认值错误');
if (!buildPresetCharacterRule({ preset_character_policy: 'full' }).includes('允许完整记录')) throw new Error('完整记录策略未生效');
if (!buildPresetCharacterRule({ preset_character_policy: 'changes_only' }).includes('只记录剧情变化')) throw new Error('只记变化策略未生效');
if (!buildPresetCharacterRule({ preset_character_policy: 'skip' }).includes('禁止写入')) throw new Error('不记录策略未生效');
if (normalizeRecordPolicy({ preset_character_policy: 'invalid' }).presetCharacterPolicy !== PRESET_CHARACTER_POLICIES.CHANGES_ONLY) throw new Error('非法策略未安全回落');

console.log('memo-n-policy PASS: full=1, changes-only=1, skip=1, invalid-fallback=1');
