import fs from 'node:fs/promises';

const dense = await fs.readFile(new URL('../scripts/runtime/denseExpressionRule.js', import.meta.url), 'utf8');
const contentRules = await fs.readFile(new URL('../scripts/runtime/memoryContentRules.js', import.meta.url), 'utf8');
const loader = await fs.readFile(new URL('../loader.js', import.meta.url), 'utf8');

for (const token of ['可观察性→持续性→辨识度→信息压缩', '按事实性质判断主位置', '一段话中同时包含多类信息时应拆分判断']) {
    if (!dense.includes(token)) throw new Error(`字段判断方法缺少：${token}`);
}

if (!dense.includes("collectMissing(text, [RULE, APPEARANCE_RULE, ABILITY_RULE, TABLE_RULE, UPDATE_RULE])")) {
    throw new Error('手动更新默认提示未接入统一字段判断规则');
}
if (!dense.includes("collectMissing(text, [APPEARANCE_RULE, ABILITY_RULE, TABLE_RULE, UPDATE_RULE])")) {
    throw new Error('正常记录提示未接入统一字段判断规则');
}
if (!dense.includes("['外貌判断方法', APPEARANCE_RULE]")) {
    throw new Error('表格整理未接入统一外貌判断方法');
}

for (const token of ['七岁时与沈六', '爬城墙摔伤', '眉不浓不淡']) {
    if (dense.includes(token) || contentRules.includes(token)) {
        throw new Error(`规则不应硬编码单次案例：${token}`);
    }
}

if (!contentRules.includes('先抽取人物当前可直接观察到的视觉事实')) {
    throw new Error('七表通用规则未同步方法式外貌判断');
}
if (!loader.includes("const DISPLAY_VERSION = '0.24'")) {
    throw new Error('loader版本未升级到0.24');
}

console.log('memo-n field judgment PASS: method-based appearance extraction and table placement, shared by normal/manual/cleanup without case hardcoding');
