export const PRESET_CHARACTER_POLICIES = Object.freeze({
    FULL: 'full',
    CHANGES_ONLY: 'changes_only',
    SKIP: 'skip',
});

export function normalizeRecordPolicy(settings = {}) {
    const requested = settings.preset_character_policy;
    const presetCharacterPolicy = Object.values(PRESET_CHARACTER_POLICIES).includes(requested)
        ? requested
        : PRESET_CHARACTER_POLICIES.CHANGES_ONLY;
    return { presetCharacterPolicy };
}

export function buildPresetCharacterRule(settings = {}) {
    const { presetCharacterPolicy } = normalizeRecordPolicy(settings);
    if (presetCharacterPolicy === PRESET_CHARACTER_POLICIES.FULL) {
        return '预设人物允许完整记录：首次在剧情中实际出现或被明确引用时，可写入人物主表；后续状态写入人物发展表。不得只因世界书中存在就批量预填。';
    }
    if (presetCharacterPolicy === PRESET_CHARACTER_POLICIES.SKIP) {
        return '预设人物禁止写入人物主表和人物发展表；只记录非预设NPC。与预设人物有关的任务或重大历史仍可写入对应任务表/历史表。';
    }
    return '预设人物只记录剧情变化：不得复制角色卡或世界书中的静态设定；仅在剧情明确改变其关系、地点、修为、状态、目标或重要事项时更新人物相关表。';
}
