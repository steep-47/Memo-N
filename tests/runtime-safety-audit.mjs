import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// 先动态审计严格 tableEdit 执行器：非法操作拒绝、数字0保留、保存失败完整回滚。
let source = await fs.readFile(new URL('../scripts/runtime/safeTableExecutor.js', import.meta.url), 'utf8');
const json5Url = pathToFileURL(new URL('../utils/json5.min.mjs', import.meta.url).pathname).href;
source = source
    .replace("import { BASE, USER } from '../../core/manager.js';", 'const { BASE, USER } = globalThis.__memoMocks;')
    .replace("import { Cell } from '../../core/table/cell.js';", 'const { Cell } = globalThis.__memoMocks;')
    .replace("import JSON5 from '../../utils/json5.min.mjs';", `import JSON5 from '${json5Url}';`);

class FakeSheet {
    constructor(name, rows = [['', 'h0', 'h1'], ['', 'a', 'b']]) {
        this.name = name;
        this.uid = name;
        this.enable = true;
        this.sendToContext = true;
        this.rows = structuredClone(rows);
        this.failSave = false;
    }
    getHeader() { return this.rows[0].slice(1); }
    getRowCount() { return this.rows.length; }
    getCellsByRowIndex(row) { return this.rows[row]?.map((_, column) => this.cell(row, column)); }
    findCellByPosition(row, column) { return this.rows[row] && column < this.rows[row].length ? this.cell(row, column) : null; }
    cell(row, column) {
        const sheet = this;
        return {
            data: {
                get value() { return sheet.rows[row][column]; },
                set value(value) { sheet.rows[row][column] = value; },
            },
            newAction(action, payload) {
                if (action === 'edit') sheet.rows[row][column] = payload.value;
                else if (action === 'insert') sheet.rows.splice(row + 1, 0, new Array(sheet.rows[0].length).fill(''));
                else if (action === 'delete') sheet.rows.splice(row, 1);
            },
        };
    }
    filterSavingData() { return { rows: structuredClone(this.rows), name: this.name }; }
    loadJson(data) { this.rows = structuredClone(data.rows); }
    save(piece) {
        if (this.failSave) return false;
        piece.memo_n_hash_sheets ??= {};
        piece.memo_n_hash_sheets[this.uid] = structuredClone(this.rows);
        return true;
    }
}

const names = ['当前状态表', '角色状态表', '背包表', '当前任务与约定表', '人物主表', '人物发展表', '历史事件表'];
const sheets = names.map(name => new FakeSheet(name));
const piece = { memo_n_hash_sheets: { old: 'sentinel' }, extra: { keep: 1 }, swipe_id: 0, swipe_info: [{ keep: 2 }] };
globalThis.__memoMocks = {
    BASE: {
        getChatSheets: () => sheets,
        copyHashSheets: structuredClone,
        hashSheetsToSheets() {
            sheets[0].rows[1][1] = 'partial-restore';
            throw new Error('injected restore failure');
        },
        sheetsData: { context: [{ old: true }] },
    },
    USER: { getChatPiece: () => ({ piece }) },
    Cell: { CellAction: { editCell: 'edit', insertDownRow: 'insert', deleteSelfRow: 'delete' } },
};

const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { parseMemoTableEdit, executeMemoTableEdit, restoreMemoSnapshot } = await import(moduleUrl);
const parserCases = [
    ['NO_CHANGE', true, true],
    ['<tableEdit><!-- NO_CHANGE --></tableEdit>', true, true],
    ['updateRow(0,0,{0:0})', true, false],
    ['updateRow(0,9,{0:"x"})', false, false],
    ['insertRow(0,{9:"x"})', false, false],
    ['NO_CHANGE;deleteRow(0,0)', false, false],
    ['updateRow(0,0,{0:"x"});deleteRow(0,0)', false, false],
    ['evil(0)', false, false],
    ['INSERT INTO 1 VALUES ({0:"x"})', false, false],
    ['insertRow(7,{0:"x"})', false, false],
];
for (const [input, ok, noChange] of parserCases) {
    const result = parseMemoTableEdit(input);
    if (result.ok !== ok || result.noChange !== noChange) throw new Error(`解析断言失败：${input} ${JSON.stringify(result)}`);
}

let result = executeMemoTableEdit('<tableEdit><!-- updateRow(0,0,{0:0}) --></tableEdit>', piece);
if (!result.ok || sheets[0].rows[1][1] !== 0) throw new Error('数字0在严格执行链中丢失');
const beforeRows = structuredClone(sheets.map(sheet => sheet.rows));
const beforePiece = structuredClone(piece);
sheets[6].failSave = true;
result = executeMemoTableEdit('<tableEdit><!-- updateRow(0,0,{0:"changed"}) --></tableEdit>', piece);
sheets[6].failSave = false;
if (result.ok) throw new Error('保存失败被误报成功');
if (JSON.stringify(sheets.map(sheet => sheet.rows)) !== JSON.stringify(beforeRows)) throw new Error('保存失败后Sheet未完整回滚');
if (JSON.stringify(piece) !== JSON.stringify(beforePiece)) throw new Error('保存失败后消息/Swipe快照未完整回滚');
const beforeRestoreRows = structuredClone(sheets.map(sheet => sheet.rows));
const restoreResult = restoreMemoSnapshot({ injected: true });
if (restoreResult.ok) throw new Error('中途失败的快照恢复被误报成功');
if (JSON.stringify(sheets.map(sheet => sheet.rows)) !== JSON.stringify(beforeRestoreRows)) throw new Error('中途失败的快照恢复未完整回滚');
console.log('runtime-safety-audit PASS: strict-tableedit parser/rollback');

// 原插件 reasoning tableEdit 通道仍保持严格，不从裸函数文字猜测。
const channels = await import('../scripts/runtime/memoResponseChannels.js');
const reasoningOnly = { mes: '正常正文', extra: { reasoning: '<tableEdit><!-- updateRow(0,0,{1:"08:40"}) --></tableEdit>' } };
const recovered = channels.getMemoTableEditChannel(reasoningOnly);
if (recovered.source !== 'reasoning' || recovered.matches.length !== 1) throw new Error('未从隐藏推理区恢复tableEdit');
const bareReasoning = channels.getMemoTableEditChannel({ mes: '正文', extra: { reasoning: '考虑调用 updateRow(0,0,{1:"09:00"})' } });
if (bareReasoning.source !== 'none' || bareReasoning.matches.length) throw new Error('错误接受了推理区裸函数猜测');

// memon74 架构静态边界审计。
const independentText = await fs.readFile(new URL('../scripts/runtime/separateTableUpdate.js', import.meta.url), 'utf8');
const finishText = await fs.readFile(new URL('../scripts/runtime/singleApiFinish.js', import.meta.url), 'utf8');
const loaderText = await fs.readFile(new URL('../loader.js', import.meta.url), 'utf8');
const indexText = await fs.readFile(new URL('../index.js', import.meta.url), 'utf8');
const bootstrapText = await fs.readFile(new URL('../scripts/runtime/settingsBootstrap.js', import.meta.url), 'utf8');
const engineText = await fs.readFile(new URL('../scripts/engine/recordEngine.js', import.meta.url), 'utf8');
const envelopeText = await fs.readFile(new URL('../scripts/engine/recordEnvelope.js', import.meta.url), 'utf8');
const providerText = await fs.readFile(new URL('../scripts/runtime/providerRoute.js', import.meta.url), 'utf8');
const yiyiText = await fs.readFile(new URL('../scripts/yiyi/yiyiMemoryRuntime.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await fs.readFile(new URL('../manifest.json', import.meta.url), 'utf8'));

if (!loaderText.includes("RUNTIME_VERSION = 'memon74'") || manifest.version !== '0.1.0-memon.74') throw new Error('memon74 Loader/manifest版本未同步');
if (loaderText.includes('singleApiStructured') || loaderText.includes('singleApiPromptRestore')) throw new Error('loader仍加载冲突的旧协议层');
if (!loaderText.includes('Memo-N一次API记录引擎') || !indexText.includes('__memoNRecordEngineActive')) throw new Error('recordEngine未成为普通一次API唯一执行入口');

if (!providerText.includes("DEEPSEEK: 'deepseek'") || !providerText.includes("RELAY: 'relay'")) throw new Error('手动Provider路由缺少合法值');
if (!providerText.includes('resolveManualProviderRoute') || !providerText.includes('memo_n_record_provider')) throw new Error('手动Provider优先级实现缺失');
for (const forbidden of ['chat_completion_source', 'custom_url', 'reverse_proxy', 'modelOf', 'sourceOf', 'isDirectDeepSeek']) {
    if (providerText.includes(forbidden)) throw new Error(`providerRoute仍包含自动识别残留：${forbidden}`);
}

if (!bootstrapText.includes('TRANSPORT_NEUTRAL_OUTPUT') || !bootstrapText.includes('最终传输格式只服从本轮请求末尾')) throw new Error('基础七表提示未保持传输协议中立');

// 普通一次 API：DeepSeek JSON / 中转前置 tableEdit。
if (!engineText.includes("responseMode: relayMode ? 'relay_tableedit' : 'json'")) throw new Error('普通中转一次API未统一为relay_tableedit');
if (!engineText.includes('parseRelayTableEditEnvelope')) throw new Error('普通中转一次API缺少tableEdit解析器');
if (!engineText.includes('第一段必须先输出且只输出一个完整<tableEdit>机器块') || !engineText.includes('reinforceRelayLastUser')) throw new Error('普通中转缺少前置tableEdit或最终user强化');
if (!engineText.includes('__memoNLastRequestProbe') || !engineText.includes('relayTableEditPresent') || !engineText.includes("responseMode: relayMode ? 'relay_tableedit_leading' : 'json'")) throw new Error('普通请求探针未反映前置tableEdit协议');
if (!engineText.includes('envelope.tableEdit ? envelope.tableEdit : changesToStrictCalls(envelope.changes)')) throw new Error('普通 relay/DeepSeek 未汇入统一严格执行器入口');
if (!engineText.includes("data.response_format = { type: 'json_object' }")) throw new Error('普通 DeepSeek JSON object约束缺失');
if (!engineText.includes('parseRelayTaggedEnvelope') || !engineText.includes('仅兼容 memon70-72')) throw new Error('memon70-72旧tagged回复兼容缺失');
if (!engineText.includes('swipe_info?.[swipeId]?.extra?.reasoning') || !engineText.includes("source: 'relay-tableedit-reasoning'")) throw new Error('普通中转当前Swipe reasoning回退缺失');
if (!engineText.includes('preserveFailureBaseline') || !engineText.includes('聊天保存失败') || !engineText.includes('restoreMemoSnapshot(copySnapshot(baselineSnapshot))')) throw new Error('普通一次API失败基线/保存失败回滚缺失');
if (!engineText.includes('__memoStrictPersistence') || !finishText.includes('await persistence')) throw new Error('成功提示未等待真实持久化');

if (!envelopeText.includes('parseRelayTableEditEnvelope') || !envelopeText.includes('joinVisibleRelayText')) throw new Error('前置/尾部tableEdit剥离解析能力缺失');
if (!envelopeText.includes('parseRelayTaggedEnvelope') || !envelopeText.includes('旧回复兼容')) throw new Error('旧tagged兼容解析缺失');

// 独立/手动 API：同一手动 route 真正同时决定 Provider 与协议。
if (!independentText.includes("import { getManualProviderRoute, ROUTE } from './providerRoute.js'")) throw new Error('独立记录未直接读取统一手动route');
if (!independentText.includes("route===ROUTE.DEEPSEEK")) throw new Error('独立记录缺少DeepSeek分支');
if (!independentText.includes('buildDeepSeekIndependentMessages')) throw new Error('独立DeepSeek缺少JSON记录prompt');
if (!independentText.includes("reply必须固定为\"RECORD_ONLY\"")) throw new Error('独立DeepSeek缺少RECORD_ONLY JSON契约');
if (!independentText.includes('parseRecordEnvelope(rawContent)')) throw new Error('独立DeepSeek未使用统一JSON容错解析器');
if (!independentText.includes('changesToStrictCalls(envelope.changes)')) throw new Error('独立DeepSeek changes 未编译为严格调用');
if (!independentText.includes('getTableEditTag(rawContent)') || !independentText.includes('模型必须且只能返回1个<tableEdit>')) throw new Error('独立中转未保持tableEdit协议');
if (!independentText.includes('executeMemoTableEdit(machine,referencePiece)')) throw new Error('独立两种协议未汇入同一个严格执行器');
if (!independentText.includes('const useMain=route===ROUTE.DEEPSEEK')) throw new Error('独立Provider未由手动route直接决定');
if (!independentText.includes('if(!prepareAutoBaseline') || !independentText.includes('if(!baselineReady)throw new Error')) throw new Error('独立记录基线门控缺失');
if (!independentText.includes('!sessionChat.includes(initialPiece)')) throw new Error('手动记录聊天归属校验缺失');

if (!yiyiText.includes('先输出并闭合前置<tableEdit>机器块') || !yiyiText.includes('绝不能放到前置<tableEdit>之前')) throw new Error('伊依与前置tableEdit输出顺序未对齐');

console.log('memo-n engine audit PASS: manual-route=1, normal-deepseek-json=1, normal-relay-leading-tableedit=1, independent-deepseek-json=1, independent-relay-tableedit=1, strict-executor=1, rollback=1, legacy-tagged-compat=1, yiyi-order=1');
