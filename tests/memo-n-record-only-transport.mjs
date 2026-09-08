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

const structuredInsertRaw = `<tableEdit><!--\n<tableIndex>1</tableIndex>\n<operation>\n<action>insert</action>\n<data><col0>陈尘</col0><col1>男</col1><col14>左眉梢淡旧疤</col14></data>\n</operation>\n--></tableEdit>`;
const structuredInsert = normalizeRecordOnlyResponse(structuredInsertRaw, 'test');
if (!structuredInsert.includes('insertRow(1,{"0":"陈尘","1":"男","14":"左眉梢淡旧疤"})')) {
    throw new Error('tableIndex/operation/colN insert XML没有规范化');
}

const structuredUpdateRaw = `<tableEdit><!--\n<tableIndex>1</tableIndex>\n<operation><action>update</action><rowIndex>0</rowIndex><data><col12>记账、炼丹</col12><col15>青云宗外门弟子</col15></data></operation>\n</tableEdit>`;
const structuredUpdate = normalizeRecordOnlyResponse(structuredUpdateRaw, 'test');
if (!structuredUpdate.includes('updateRow(1,0,{"12":"记账、炼丹","15":"青云宗外门弟子"})')) {
    throw new Error('tableIndex/operation/colN update XML没有规范化');
}

const structuredDeleteRaw = `<tableIndex>3</tableIndex>\n<operation><action>delete</action><rowIndex>0</rowIndex></operation>`;
const structuredDelete = normalizeRecordOnlyResponse(structuredDeleteRaw, 'test');
if (!structuredDelete.includes('deleteRow(3,0)')) {
    throw new Error('tableIndex/operation delete XML没有规范化');
}
if (!structuredDelete.startsWith('<tableEdit><!--')) {
    throw new Error('缺少tableEdit外壳的结构化XML未恢复传输外壳');
}

const structuredMultipleRaw = `<tableEdit><!--\n<tableIndex>4</tableIndex>\n<operation><action>insert</action><data><col0>甲</col0></data></operation>\n<operation><action>insertRow</action><data><col0>乙</col0></data></operation>\n--></tableEdit>`;
const structuredMultiple = normalizeRecordOnlyResponse(structuredMultipleRaw, 'test');
if (!structuredMultiple.includes('insertRow(4,{"0":"甲"})\ninsertRow(4,{"0":"乙"})')) {
    throw new Error('同一tableIndex下多个operation没有完整规范化');
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

const missingRowIndex = `<tableEdit><!--\n<tableIndex>1</tableIndex><operation><action>update</action><data><col12>炼丹</col12></data></operation>\n--></tableEdit>`;
if (normalizeRecordOnlyResponse(missingRowIndex, 'test') !== missingRowIndex) {
    throw new Error('update缺rowIndex时不应被兼容层猜测');
}

const duplicateColumn = `<tableEdit><!--\n<tableIndex>1</tableIndex><operation><action>insert</action><data><col0>甲</col0><col0>乙</col0></data></operation>\n--></tableEdit>`;
if (normalizeRecordOnlyResponse(duplicateColumn, 'test') !== duplicateColumn) {
    throw new Error('重复colN时不应被兼容层放宽');
}

const nestedUnknownXml = `<tableEdit><!--\n<tableIndex>1</tableIndex><operation><action>insert</action><data><col0><name>陈尘</name></col0></data></operation>\n--></tableEdit>`;
if (normalizeRecordOnlyResponse(nestedUnknownXml, 'test') !== nestedUnknownXml) {
    throw new Error('colN内嵌未知XML时不应被兼容层放宽');
}

console.log('memo-n-record-only-transport PASS: data-attribute and structured-operation XML normalized; unsafe variants remain strict');
