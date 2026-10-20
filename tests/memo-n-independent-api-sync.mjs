import fs from 'node:fs/promises';

let source = await fs.readFile(new URL('../scripts/runtime/independentApiTransportSync.js', import.meta.url), 'utf8');
source = source
    .replace("import { EDITOR } from '../../core/manager.js';", 'const { EDITOR } = globalThis.__memoNIndependentSyncMocks;')
    .replace("import LLMApiService from '../../services/llmApi.js';", 'const { LLMApiService } = globalThis.__memoNIndependentSyncMocks;');

class LLMApiService {
    constructor() { this.config = { system_prompt: '# Memo独立记录操作协议 <tableEdit>' }; }
    async callLLM() { return ''; }
}

globalThis.TavernHelper = { async generateRaw() { return ''; } };
globalThis.__memoNIndependentSyncMocks = {
    EDITOR: { async generateRaw() { return ''; } },
    LLMApiService,
};

const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#memo-n-independent-api-sync`);
const { isMemoIndependentRecordRequest, normalizeIndependentApiResponse } = module;

if (!isMemoIndependentRecordRequest({ ordered_prompts:[
    { role:'system', content:'# Memo独立记录操作协议' },
    { role:'user', content:'只输出 <tableEdit><!-- ... --></tableEdit>' },
] })) throw new Error('没有识别独立记录请求');

const textBody = `<tableEdit><!--\n<updateRow tableIndex="1" rowIndex="0"><data columnIndex="12">炼丹</data></updateRow>\n--></tableEdit>`;
const textNormalized = normalizeIndependentApiResponse(textBody, 'test');
if (!textNormalized.includes('<data columnIndex="12" value="炼丹"/>')) {
    throw new Error('data正文值没有同步为严格columnIndex/value属性');
}

const aliasRaw = `<tableEdit><!--\n<updateRow tableIndex="1" rowIndex="0"><data colIndex="15" value="青云宗" type="string"/></updateRow>\n--></tableEdit>`;
const aliasNormalized = normalizeIndependentApiResponse(aliasRaw, 'test');
if (!aliasNormalized.includes('<data columnIndex="15" value="青云宗"/>')) {
    throw new Error('colIndex/type兼容方言没有规范化');
}

const childRaw = `<tableEdit><!--\n<insertRow tableIndex="1"><data><columnIndex>0</columnIndex><value>陈尘</value></data></insertRow>\n--></tableEdit>`;
const childNormalized = normalizeIndependentApiResponse(childRaw, 'test');
if (!childNormalized.includes('<data columnIndex="0" value="陈尘"/>')) {
    throw new Error('columnIndex/value子标签方言没有规范化');
}

const childAliasRaw = `<tableEdit><!--\n<insertRow tableIndex="1"><data><colIndex>0</colIndex><value>陈尘&amp;同伴</value></data></insertRow>\n--></tableEdit>`;
const childAliasNormalized = normalizeIndependentApiResponse(childAliasRaw, 'test');
if (!childAliasNormalized.includes('<data columnIndex="0" value="陈尘&amp;同伴"/>')) {
    throw new Error('colIndex子标签或XML实体没有安全规范化');
}

const unknownAttr = `<tableEdit><!--\n<insertRow tableIndex="1"><data columnIndex="0" value="陈尘" source="guess"/></insertRow>\n--></tableEdit>`;
if (normalizeIndependentApiResponse(unknownAttr, 'test') !== unknownAttr) {
    throw new Error('未知data属性不应被同步层静默删除');
}

const nestedValue = `<tableEdit><!--\n<insertRow tableIndex="1"><data><columnIndex>0</columnIndex><value><name>陈尘</name></value></data></insertRow>\n--></tableEdit>`;
if (normalizeIndependentApiResponse(nestedValue, 'test') !== nestedValue) {
    throw new Error('嵌套未知XML不应被同步层放宽');
}

const duplicateBlocks = `<tableEdit><!-- NO_CHANGE --></tableEdit>\n<tableEdit><!-- NO_CHANGE --></tableEdit>`;
if (normalizeIndependentApiResponse(duplicateBlocks, 'test') !== duplicateBlocks) {
    throw new Error('多个tableEdit块必须留给严格入口拒绝');
}

console.log('memo-n-independent-api-sync PASS: independent API data XML drift normalized narrowly; unsafe variants remain strict');
