import fs from 'node:fs/promises';

let source = await fs.readFile(new URL('../scripts/runtime/independentApiDataAttributeSync.js', import.meta.url), 'utf8');
source = source
    .replace("import { EDITOR } from '../../core/manager.js';", 'const { EDITOR } = globalThis.__memoNIndependentDataAttrMocks;')
    .replace("import LLMApiService from '../../services/llmApi.js';", 'const { LLMApiService } = globalThis.__memoNIndependentDataAttrMocks;')
    .replace("import JSON5 from '../../utils/json5.min.mjs';", 'const { JSON5 } = globalThis.__memoNIndependentDataAttrMocks;');

class LLMApiService {
    constructor() { this.config = { system_prompt: '# Memo独立记录操作协议 <tableEdit>' }; }
    async callLLM() { return ''; }
}

globalThis.TavernHelper = { async generateRaw() { return ''; } };
globalThis.__memoNIndependentDataAttrMocks = {
    EDITOR: { async generateRaw() { return ''; } },
    LLMApiService,
    JSON5: { parse: JSON.parse },
};

const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#memo-n-independent-api-data-attr`);
const { normalizeIndependentApiDataAttributeResponse } = module;

const screenshotStyle = `<tableEdit><!--\n<updateRow tableIndex="2" rowIndex="8" data='{"2":0}' expected="三阶骨蟒核心逆鳞"/>\n--></tableEdit>`;
const screenshotNormalized = normalizeIndependentApiDataAttributeResponse(screenshotStyle, 'test');
if (!screenshotNormalized.includes('updateRow(2,8,{"2":0},"三阶骨蟒核心逆鳞")')) {
    throw new Error('标准空格形式的updateRow data属性没有规范化');
}

const anonymousExpected = `<tableEdit><!--\n<updateRow tableIndex="2" rowIndex="8" data='{"2":0}' "三阶骨蟒核心逆鳞"/>\n--></tableEdit>`;
const anonymousNormalized = normalizeIndependentApiDataAttributeResponse(anonymousExpected, 'test');
if (!anonymousNormalized.includes('updateRow(2,8,{"2":0},"三阶骨蟒核心逆鳞")')) {
    throw new Error('匿名expected尾值没有规范化');
}

const noSpaces = `<tableEdit><!--\n<updateRowtableIndex="2"rowIndex="8"data='{"2":0}'expected="三阶骨蟒核心逆鳞"/>\n--></tableEdit>`;
const noSpacesNormalized = normalizeIndependentApiDataAttributeResponse(noSpaces, 'test');
if (!noSpacesNormalized.includes('updateRow(2,8,{"2":0},"三阶骨蟒核心逆鳞")')) {
    throw new Error('无属性分隔空格形式没有规范化');
}

const insert = `<tableEdit><!--\n<insertRow tableIndex="6" data='{"0":"霜月二十三","1":"闭关炼甲"}'/>\n--></tableEdit>`;
const insertNormalized = normalizeIndependentApiDataAttributeResponse(insert, 'test');
if (!insertNormalized.includes('insertRow(6,{"0":"霜月二十三","1":"闭关炼甲"})')) {
    throw new Error('insertRow data属性没有规范化');
}

const deleteWithExpected = `<tableEdit><!--\n<deleteRow tableIndex="2" rowIndex="8" expected="三阶骨蟒核心逆鳞"/>\n--></tableEdit>`;
const deleteNormalized = normalizeIndependentApiDataAttributeResponse(deleteWithExpected, 'test');
if (!deleteNormalized.includes('deleteRow(2,8,"三阶骨蟒核心逆鳞")')) {
    throw new Error('deleteRow expected没有规范化');
}

const missingExpected = `<tableEdit><!--\n<updateRow tableIndex="2" rowIndex="8" data='{"2":0}'/>\n--></tableEdit>`;
if (normalizeIndependentApiDataAttributeResponse(missingExpected, 'test') !== missingExpected) {
    throw new Error('身份表缺expected时不应猜对象名');
}

const unknownAttr = `<tableEdit><!--\n<updateRow tableIndex="2" rowIndex="8" data='{"2":0}' expected="三阶骨蟒核心逆鳞" source="guess"/>\n--></tableEdit>`;
if (normalizeIndependentApiDataAttributeResponse(unknownAttr, 'test') !== unknownAttr) {
    throw new Error('未知row属性不应被静默删除');
}

const duplicateBlocks = `<tableEdit><!-- NO_CHANGE --></tableEdit>\n<tableEdit><!-- NO_CHANGE --></tableEdit>`;
if (normalizeIndependentApiDataAttributeResponse(duplicateBlocks, 'test') !== duplicateBlocks) {
    throw new Error('多个tableEdit块必须继续留给严格入口拒绝');
}

console.log('memo-n-independent-api-data-attr PASS: row-level data JSON attributes normalized; identity and unknown-attribute safety retained');
