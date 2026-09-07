import fs from 'node:fs/promises';

let source = await fs.readFile(new URL('../scripts/runtime/recordOnlyTransportGuard.js', import.meta.url), 'utf8');
source = source
    .replace("import { EDITOR } from '../../core/manager.js';", 'const { EDITOR } = globalThis.__memoNTransportMocks;')
    .replace("import LLMApiService from '../../services/llmApi.js';", 'const { LLMApiService } = globalThis.__memoNTransportMocks;')
    .replace("import JSON5 from '../../utils/json5.min.mjs';", 'const { JSON5 } = globalThis.__memoNTransportMocks;');

class LLMApiService {
    async callLLM() { return ''; }
}

globalThis.TavernHelper = { async generateRaw() { return ''; } };
globalThis.__memoNTransportMocks = {
    EDITOR: { async generateRaw() { return ''; } },
    LLMApiService,
    JSON5: { parse: JSON.parse },
};

const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#memo-n-record-only-transport`);
const { normalizeRecordOnlyResponse } = module;

const insertRaw = `<tableEdit><!--\n<insertRow tableIndex="1" data='{"0":"陈尘","11":"青木诀"}'/>\n--></tableEdit>`;
const insertNormalized = normalizeRecordOnlyResponse(insertRaw, 'test');
if (!insertNormalized.includes('insertRow(1,{"0":"陈尘","11":"青木诀"})')) {
    throw new Error('insertRow data属性没有规范化为严格函数调用');
}

const updateRaw = `<tableEdit><!--\n<updateRow tableIndex="1" rowIndex="0" data='{"12":"炼丹"}'></updateRow>\n--></tableEdit>`;
const updateNormalized = normalizeRecordOnlyResponse(updateRaw, 'test');
if (!updateNormalized.includes('updateRow(1,0,{"12":"炼丹"})')) {
    throw new Error('updateRow data属性没有规范化为严格函数调用');
}

const unsafeRaw = `<tableEdit><!--\n<insertRow tableIndex="1" data='{"0":"陈尘"}' extra="x"/>\n--></tableEdit>`;
const unsafeNormalized = normalizeRecordOnlyResponse(unsafeRaw, 'test');
if (unsafeNormalized !== unsafeRaw) {
    throw new Error('带未知属性的XML不应被兼容层放宽');
}

const invalidDataRaw = `<tableEdit><!--\n<insertRow tableIndex="1" data='["不是对象"]'/>\n--></tableEdit>`;
const invalidDataNormalized = normalizeRecordOnlyResponse(invalidDataRaw, 'test');
if (invalidDataNormalized !== invalidDataRaw) {
    throw new Error('非对象data不应被兼容层转换');
}

const strictNestedXml = `<tableEdit><!--\n<insertRow tableIndex="1"><data columnIndex="0" value="陈尘"/></insertRow>\n--></tableEdit>`;
if (normalizeRecordOnlyResponse(strictNestedXml, 'test') !== strictNestedXml) {
    throw new Error('原有严格XML格式不应被改写');
}

console.log('memo-n-record-only-transport PASS: data-attribute insert/update normalized; unsafe variants remain strict');
