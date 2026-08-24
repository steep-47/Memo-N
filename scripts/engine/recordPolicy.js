// 世界七表只记录剧情世界内的实体与事实。
// 世界书人物与剧情自动生成NPC没有来源差别：都只记录已经在剧情中确认的新事实或变化。
// 伊依属于独立后台陪伴者，使用自己的长期记忆库，永远不是世界七表人物。
export function normalizeRecordPolicy() {
    return { npcPolicy: 'confirmed_changes_only', yiyiExcluded: true };
}

export function buildPresetCharacterRule() {
    return '人物记录不区分世界书人物与自动生成NPC：只记录剧情中已经确认的新事实或变化，不复制未发生作用的静态设定。伊依是后台陪伴者，不是剧情世界实体：禁止把“伊依”写入#0当前场景人物、#3任务相关人物、#4人物主表、#5人物发展表、#6历史事件涉及人物，也不得用世界七表保存伊依的关系、情绪或经历；这些只进入Memo-N的伊依独立长期记忆库。';
}
