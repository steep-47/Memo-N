import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

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
    ['updateRow(0,0,{0:0})', true, false],
    ['updateRow(0,9,{0:"x"})', false, false],
    ['insertRow(0,{9:"x"})', false, false],
    ['NO_CHANGE;deleteRow(0,0)', false, false],
    ['updateRow(0,0,{0:"x"});deleteRow(0,0)', false, false],
    ['evil(0)', false, false],
    ['INSERTINTO1VALUES({0:"x"})', false, false],
    ['INSERT INTO 1 VALUES ({0:"x"})', false, false],
    ['insertRow(7,{0:"x"})', false, false],
];
for (const [input, ok, noChange] of parserCases) {
    const result = parseMemoTableEdit(input);
    if (result.ok !== ok || result.noChange !== noChange) throw new Error(`解析断言失败：${input} ${JSON.stringify(result)}`);
}

let result = executeMemoTableEdit('updateRow(0,0,{0:0})', piece);
if (!result.ok || sheets[0].rows[1][1] !== 0) throw new Error('数字0在严格执行链中丢失');
const beforeRows = structuredClone(sheets.map(sheet => sheet.rows));
const beforePiece = structuredClone(piece);
sheets[6].failSave = true;
result = executeMemoTableEdit('updateRow(0,0,{0:"changed"})', piece);
sheets[6].failSave = false;
if (result.ok) throw new Error('保存失败被误报成功');
if (JSON.stringify(sheets.map(sheet => sheet.rows)) !== JSON.stringify(beforeRows)) throw new Error('保存失败后Sheet未完整回滚');
if (JSON.stringify(piece) !== JSON.stringify(beforePiece)) throw new Error('保存失败后消息/Swipe快照未完整回滚');
const beforeRestoreRows = structuredClone(sheets.map(sheet => sheet.rows));
const restoreResult = restoreMemoSnapshot({ injected: true });
if (restoreResult.ok) throw new Error('中途失败的快照恢复被误报成功');
if (JSON.stringify(sheets.map(sheet => sheet.rows)) !== JSON.stringify(beforeRestoreRows)) throw new Error('中途失败的快照恢复未完整回滚');

console.log('runtime-safety-audit PASS: parser=10, numeric-zero=1, save-failure-full-rollback=1, restore-failure-full-rollback=1');

// 原插件/直接记录入口仍允许从当前 Swipe reasoning 恢复明确的 tableEdit；绝不从裸函数文本猜操作。
const channels = await import('../scripts/runtime/memoResponseChannels.js');
const reasoningOnly = { mes: '正常正文', extra: { reasoning: '<tableEdit><!-- updateRow(0,0,{1:"08:40"}) --></tableEdit>' } };
const recovered = channels.getMemoTableEditChannel(reasoningOnly);
if (recovered.source !== 'reasoning' || recovered.matches.length !== 1) throw new Error('未从隐藏推理区恢复tableEdit');
const contentWins = channels.getMemoTableEditChannel({ mes: '<tableEdit><!-- NO_CHANGE --></tableEdit>', extra: reasoningOnly.extra });
if (contentWins.source !== 'content' || contentWins.matches.length !== 1 || !contentWins.matches[0].includes('NO_CHANGE')) throw new Error('正文/推理同时存在时未保证正文优先和单次执行');
const swipeWins = channels.getMemoTableEditChannel({ mes: '正文', swipe_id: 1, extra: reasoningOnly.extra, swipe_info: [{}, { extra: { reasoning: '<tableEdit><!-- insertRow(2,{0:"黄芪"}) --></tableEdit>' } }] });
if (swipeWins.source !== 'reasoning' || !swipeWins.matches[0].includes('insertRow')) throw new Error('未读取当前Swipe独立推理区');
const bareReasoning = channels.getMemoTableEditChannel({ mes: '正文', extra: { reasoning: '考虑调用 updateRow(0,0,{1:"09:00"})' } });
if (bareReasoning.source !== 'none' || bareReasoning.matches.length) throw new Error('错误接受了推理区裸函数猜测');
const tolerantTag = channels.getMemoTableEditChannel({ mes: '正文', extra: { reasoning: '<TABLEEDIT data-hidden="1"><!-- NO_CHANGE --></TABLEEDIT>' } });
if (tolerantTag.source !== 'reasoning' || tolerantTag.matches.length !== 1) throw new Error('未兼容推理区标签大小写/属性');
console.log('response-channel audit PASS: reasoning-recovery=1, content-priority=1, swipe-reasoning=1, bare-text-rejected=1, tolerant-tag=1');

// 当前 memon72 架构静态边界审计。
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

if (loaderText.includes('singleApiStructured') || loaderText.includes('singleApiPromptRestore')) throw new Error('loader仍加载冲突的结构化/提示改写层');
if (!loaderText.includes("RUNTIME_VERSION = 'memon72'") || manifest.version !== '0.1.0-memon.72') throw new Error('memon72 Loader/manifest版本未同步');

if (!indexText.includes('CHAT_COMPLETION_PROMPT_READY, onChatCompletionPromptReady') || !indexText.includes('CHARACTER_MESSAGE_RENDERED, onMessageReceived')) throw new Error('原作者直接注入/直接解析事件链缺失');
if (!indexText.includes('executeMemoTableEdit(matches, piece)')) throw new Error('原作者直接记录入口未接严格事务执行器');
if (!loaderText.includes('Memo-N一次API记录引擎') || !indexText.includes('__memoNRecordEngineActive')) throw new Error('Memo-N记录引擎未成为普通一次API唯一执行入口');

if (!providerText.includes("DEEPSEEK: 'deepseek'") || !providerText.includes("RELAY: 'relay'")) throw new Error('手动Provider路由缺少两个合法值');
if (!providerText.includes('resolveManualProviderRoute') || !providerText.includes('memo_n_record_provider')) throw new Error('手动Provider优先级实现缺失');
for (const forbidden of ['chat_completion_source', 'custom_url', 'reverse_proxy', 'modelOf', 'sourceOf', 'isDirectDeepSeek']) {
    if (providerText.includes(forbidden)) throw new Error(`providerRoute仍包含自动识别残留：${forbidden}`);
}

if (!bootstrapText.includes('TRANSPORT_NEUTRAL_OUTPUT') || !bootstrapText.includes('最终传输格式只服从本轮请求末尾')) throw new Error('基础七表提示未保持传输协议中立');
if (!bootstrapText.includes('STEP_BY_STEP_PROMPT') || !bootstrapText.includes('最终只输出一个完整<tableEdit>')) throw new Error('独立记录默认提示未保留纯tableEdit职责');

if (!engineText.includes("responseMode: relayMode ? 'relay_tagged' : 'json'")) throw new Error('普通中转一次API未切到relay_tagged');
if (!engineText.includes('parseRelayTaggedEnvelope') || !engineText.includes('RELAY_TAG_START') || !engineText.includes('RELAY_TAG_END')) throw new Error('普通中转一次API缺少tagged JSON记录协议');
if (!engineText.includes('第一段必须先输出且只输出一个Memo-N记录块') || !engineText.includes('reinforceRelayLastUser')) throw new Error('memon72缺少中转前置记录块或最终user强化');
if (!engineText.includes('__memoNLastRequestProbe') || !engineText.includes('lastUserReinforced')) throw new Error('memon72缺少无敏感信息请求注入探针');
if (engineText.includes('relay_tableedit') || engineText.includes('parseTableEditEnvelope') || engineText.includes('未找到中转站tableEdit记录块')) throw new Error('普通中转一次API仍残留旧tableEdit协议');
if (!engineText.includes("data.response_format = { type: 'json_object' }") || !engineText.includes('changesToStrictCalls(envelope.changes)')) throw new Error('DeepSeek JSON或统一严格事务编译缺失');
if (!engineText.includes('job.session') || !engineText.includes('preserveFailureBaseline')) throw new Error('Memo-N缺少会话隔离或失败基线保护');
if (!engineText.includes('swipe_info?.[swipeId]?.extra?.reasoning') || !engineText.includes("source: 'relay-tagged-reasoning'")) throw new Error('中转站缺少当前Swipe reasoning记录块回退');
if (!engineText.includes('聊天保存失败') || !engineText.includes('restoreMemoSnapshot(copySnapshot(baselineSnapshot))')) throw new Error('Memo-N缺少聊天保存失败后的表格回滚');
if (!engineText.includes('__memoStrictPersistence') || !finishText.includes('await persistence')) throw new Error('Memo-N写入提示未等待真实保存结果');
if (!engineText.includes('void persistence.catch') || !engineText.includes('CHARACTER_MESSAGE_RENDERED, handleRendered') || !engineText.includes('GENERATION_ENDED, handleGenerationEnded')) throw new Error('普通一次API持久化生命周期未保持后台执行/渲染释放');
if (!engineText.includes('await BASE.refreshContextView?.()')) throw new Error('Memo-N成功写表后未刷新活动表格视图');

if (!envelopeText.includes('parseRelayTaggedEnvelope') || !envelopeText.includes('escapeControlCharsInsideJsonStrings')) throw new Error('记录信封层缺少中转tagged JSON或控制字符规范化');
if (!envelopeText.includes('joinVisibleRelayText')) throw new Error('memon72中转解析器未支持前置/中间/尾部机器块剥离');
if (!envelopeText.includes("return ['NO_CHANGE']")) throw new Error('空changes未编译成严格NO_CHANGE');

if (!independentText.includes('getTableEditTag(rawContent)') || !independentText.includes('模型必须且只能返回1个<tableEdit>')) throw new Error('独立/手动记录不再保持纯tableEdit协议');
if (!independentText.includes('if(!prepareAutoBaseline')) throw new Error('自动独立记录缺少基线成功门控');
if (!independentText.includes('if(!baselineReady)throw new Error')) throw new Error('手动独立记录缺少基线成功门控');
if (!independentText.includes('!sessionChat.includes(initialPiece)')) throw new Error('手动独立记录缺少目标消息当前聊天归属校验');
const detachedGate = independentText.indexOf("return'detached'");
const independentExecute = independentText.indexOf('const result=executeMemoTableEdit');
if (detachedGate < 0 || independentExecute < 0 || detachedGate > independentExecute) throw new Error('独立记录缺少执行前聊天会话身份门控');

if (!finishText.includes("if(status.noChange===true){") || !finishText.includes('await persistence')) throw new Error('NO_CHANGE提示或真实持久化等待缺失');
if (!yiyiText.includes('中转站前置记录块') || !yiyiText.includes('先输出并闭合该记录块') || !yiyiText.includes('属于正常正文的一部分')) throw new Error('伊依与memon72前置中转记录块输出顺序未对齐');

console.log('memo-n engine audit PASS: manual-route=1, deepseek-json=1, relay-leading-tagged=1, relay-user-reinforce=1, request-probe=1, strict-executor=1, session-gate=1, persistence-rollback=1, independent-tableedit=1, yiyi-order=1');
