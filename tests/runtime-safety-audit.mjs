import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

let source = await fs.readFile(new URL('../scripts/runtime/safeTableExecutor.js', import.meta.url), 'utf8');
const json5Url = pathToFileURL(new URL('../utils/json5.min.mjs', import.meta.url).pathname).href;
source = source
    .replace("import { BASE, USER } from '../../core/manager.js';", 'const { BASE, USER } = globalThis.__memoMocks;')
    .replace("import { Cell } from '../../core/table/cell.js';", 'const { Cell } = globalThis.__memoMocks;')
    .replace("import JSON5 from '../../utils/json5.min.mjs';", `import JSON5 from '${json5Url}';`);
class FakeSheet {
    constructor(name, rows = [['', 'h0', 'h1'], ['', 'a', 'b']]) { this.name=name; this.uid=name; this.enable=true; this.sendToContext=true; this.rows=structuredClone(rows); this.failSave=false; }
    getHeader(){return this.rows[0].slice(1);} getRowCount(){return this.rows.length;}
    getCellsByRowIndex(row){return this.rows[row]?.map((_,column)=>this.cell(row,column));}
    findCellByPosition(row,column){return this.rows[row]&&column<this.rows[row].length?this.cell(row,column):null;}
    cell(row,column){const sheet=this;return{data:{get value(){return sheet.rows[row][column];},set value(value){sheet.rows[row][column]=value;}},newAction(action,payload){if(action==='edit')sheet.rows[row][column]=payload.value;else if(action==='insert')sheet.rows.splice(row+1,0,new Array(sheet.rows[0].length).fill(''));else if(action==='delete')sheet.rows.splice(row,1);}};}
    filterSavingData(){return{rows:structuredClone(this.rows),name:this.name};} loadJson(data){this.rows=structuredClone(data.rows);} save(piece){if(this.failSave)return false;piece.memo_n_hash_sheets??={};piece.memo_n_hash_sheets[this.uid]=structuredClone(this.rows);return true;}
}
const names=['当前状态表','角色状态表','背包表','当前任务与约定表','人物主表','人物发展表','历史事件表'];
const sheets=names.map(name=>new FakeSheet(name));
const piece={memo_n_hash_sheets:{old:'sentinel'},extra:{keep:1},swipe_id:0,swipe_info:[{keep:2}]};
globalThis.__memoMocks={BASE:{getChatSheets:()=>sheets,copyHashSheets:structuredClone,hashSheetsToSheets(){sheets[0].rows[1][1]='partial-restore';throw new Error('injected restore failure');},sheetsData:{context:[{old:true}]}},USER:{getChatPiece:()=>({piece})},Cell:{CellAction:{editCell:'edit',insertDownRow:'insert',deleteSelfRow:'delete'}}};
const moduleUrl=`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const {parseMemoTableEdit,executeMemoTableEdit,restoreMemoSnapshot}=await import(moduleUrl);
for(const [input,ok,noChange] of [['NO_CHANGE',true,true],['<tableEdit><!-- NO_CHANGE --></tableEdit>',true,true],['updateRow(0,0,{0:0})',true,false],['updateRow(0,9,{0:"x"})',false,false],['insertRow(0,{9:"x"})',false,false],['NO_CHANGE;deleteRow(0,0)',false,false],['updateRow(0,0,{0:"x"});deleteRow(0,0)',false,false],['evil(0)',false,false],['INSERT INTO 1 VALUES ({0:"x"})',false,false],['insertRow(7,{0:"x"})',false,false]]){const r=parseMemoTableEdit(input);if(r.ok!==ok||r.noChange!==noChange)throw new Error(`解析断言失败：${input} ${JSON.stringify(r)}`);}
let result=executeMemoTableEdit('<tableEdit><!-- updateRow(0,0,{0:0}) --></tableEdit>',piece);if(!result.ok||sheets[0].rows[1][1]!==0)throw new Error('数字0在严格执行链中丢失');
const beforeRows=structuredClone(sheets.map(s=>s.rows));const beforePiece=structuredClone(piece);sheets[6].failSave=true;result=executeMemoTableEdit('<tableEdit><!-- updateRow(0,0,{0:"changed"}) --></tableEdit>',piece);sheets[6].failSave=false;if(result.ok)throw new Error('保存失败被误报成功');if(JSON.stringify(sheets.map(s=>s.rows))!==JSON.stringify(beforeRows))throw new Error('保存失败后Sheet未完整回滚');if(JSON.stringify(piece)!==JSON.stringify(beforePiece))throw new Error('保存失败后消息/Swipe快照未完整回滚');
const beforeRestoreRows=structuredClone(sheets.map(s=>s.rows));const restoreResult=restoreMemoSnapshot({injected:true});if(restoreResult.ok)throw new Error('中途失败的快照恢复被误报成功');if(JSON.stringify(sheets.map(s=>s.rows))!==JSON.stringify(beforeRestoreRows))throw new Error('中途失败的快照恢复未完整回滚');
console.log('runtime-safety-audit PASS: strict-tableedit parser/rollback');

const channels=await import('../scripts/runtime/memoResponseChannels.js');
const recovered=channels.getMemoTableEditChannel({mes:'正常正文',extra:{reasoning:'<tableEdit><!-- updateRow(0,0,{1:"08:40"}) --></tableEdit>'}});if(recovered.source!=='reasoning'||recovered.matches.length!==1)throw new Error('未从隐藏推理区恢复tableEdit');
const bareReasoning=channels.getMemoTableEditChannel({mes:'正文',extra:{reasoning:'考虑调用 updateRow(0,0,{1:"09:00"})'}});if(bareReasoning.source!=='none'||bareReasoning.matches.length)throw new Error('错误接受了推理区裸函数猜测');

const read=path=>fs.readFile(new URL(path,import.meta.url),'utf8');
const independentText=await read('../scripts/runtime/separateTableUpdate.js');const modeRuntimeText=await read('../scripts/runtime/modeRuntimeControl.js');const structureRepairText=await read('../scripts/runtime/tableStructureRepair.js');const finishText=await read('../scripts/runtime/singleApiFinish.js');const loaderText=await read('../loader.js');const indexText=await read('../index.js');const bootstrapText=await read('../scripts/runtime/settingsBootstrap.js');const engineText=await read('../scripts/engine/recordEngine.js');const envelopeText=await read('../scripts/engine/recordEnvelope.js');const providerText=await read('../scripts/runtime/providerRoute.js');const yiyiText=await read('../scripts/yiyi/yiyiMemoryRuntime.js');const uiText=await read('../scripts/ui/apiModeToggle.js');const templateText=await read('../assets/templates/index.html');const manifest=JSON.parse(await read('../manifest.json'));
if(!loaderText.includes("RUNTIME_VERSION = 'memon79'")||!loaderText.includes("PUBLIC_VERSION = '0.1.0-memon.79'")||manifest.version!=='0.1.0-memon.79')throw new Error('memon79版本未同步');
if(!loaderText.includes('window.memoN.VERSION = PUBLIC_VERSION')||!loaderText.includes('DOMContentLoaded'))throw new Error('公开版本同步保护缺失');
if(/\?v=memon\d+/.test(modeRuntimeText)||/\?v=memon\d+/.test(structureRepairText))throw new Error('关键runtime仍钉死旧子模块版本');
if(loaderText.includes('singleApiStructured')||loaderText.includes('singleApiPromptRestore'))throw new Error('loader仍加载冲突旧协议层');
if(!loaderText.includes('Memo-N一次API记录引擎')||!indexText.includes('__memoNRecordEngineActive'))throw new Error('recordEngine未成为普通一次API唯一执行入口');
if(!modeRuntimeText.includes('bridgePromptMode()')||!modeRuntimeText.includes('CHAT_COMPLETION_SETTINGS_READY')||!modeRuntimeText.includes('forceNormalMode'))throw new Error('独立模式generation生命周期桥接缺失');
if(modeRuntimeText.includes('makeFirst(promptEvent')||modeRuntimeText.includes('makeLast(promptEvent'))throw new Error('独立模式仍依赖未验证的PROMPT_READY监听器重排');

if(!providerText.includes("DEEPSEEK: 'deepseek'")||!providerText.includes("RELAY: 'relay'"))throw new Error('手动Provider路由缺少合法值');
for(const forbidden of ['chat_completion_source','custom_url','reverse_proxy','modelOf','sourceOf','isDirectDeepSeek'])if(providerText.includes(forbidden))throw new Error(`providerRoute仍包含自动识别残留：${forbidden}`);
if(!bootstrapText.includes('TRANSPORT_NEUTRAL_OUTPUT')||!bootstrapText.includes('最终传输格式只服从本轮请求末尾'))throw new Error('基础七表提示未保持协议中立');
if(!templateText.includes('id="fill_table_time"')||templateText.includes('id="memory-independent-record-api"')||templateText.includes('id="step_by_step_use_main_api"'))throw new Error('UI模式入口不唯一');
if(!uiText.includes('bindFillTime')||uiText.includes('syncIndependentApiRoute')||/step_by_step_use_main_api\s*=/.test(uiText))throw new Error('UI仍通过旧字段路由');

if(!engineText.includes("responseMode: relayMode ? 'relay_tableedit' : 'json'")||!engineText.includes('parseRelayTableEditEnvelope')||!engineText.includes('reinforceRelayLastUser'))throw new Error('普通中转前置tableEdit链缺失');
if(!engineText.includes("data.response_format = { type: 'json_object' }")||!engineText.includes('changesToStrictCalls(envelope.changes)'))throw new Error('普通DeepSeek JSON链缺失');
if(!engineText.includes('swipe_info?.[swipeId]?.extra?.reasoning')||!engineText.includes("source: 'relay-tableedit-reasoning'"))throw new Error('普通中转reasoning回退缺失');
if(!engineText.includes('preserveFailureBaseline')||!engineText.includes('restoreMemoSnapshot(copySnapshot(baselineSnapshot))'))throw new Error('普通记录回滚保护缺失');
if(!engineText.includes('__memoStrictPersistence')||!finishText.includes('await persistence'))throw new Error('成功提示未等待持久化');
if(!envelopeText.includes('parseRelayTableEditEnvelope')||!envelopeText.includes('parseRelayTaggedEnvelope'))throw new Error('relay解析兼容缺失');

if(!independentText.includes('const route = getManualProviderRoute()')||!independentText.includes('const useMain = route === ROUTE.DEEPSEEK'))throw new Error('独立Provider未由手动route决定');
if(!independentText.includes('DEEPSEEK_RECORD_CONTRACT')||!independentText.includes('parseRecordEnvelope(rawContent)')||!independentText.includes('changesToStrictCalls(envelope.changes)'))throw new Error('独立DeepSeek JSON链缺失');
if(!independentText.includes('RELAY_RECORD_CONTRACT')||!independentText.includes('getTableEditTag(rawContent)'))throw new Error('独立中转tableEdit链缺失');
if(!independentText.includes('executeMemoTableEdit(parsed.executionInput, referencePiece)')||!independentText.includes('prepareAutoBaseline')||!independentText.includes("return 'detached'")||!independentText.includes("return 'stale'"))throw new Error('独立严格执行/生命周期保护缺失');
if(!yiyiText.includes('先输出并闭合前置<tableEdit>机器块')||!yiyiText.includes('绝不能放到前置<tableEdit>之前'))throw new Error('伊依与前置tableEdit顺序未对齐');
console.log('memo-n engine audit PASS: version=79, generation-bridge=1, manual-route=1, normal-deepseek-json=1, normal-relay-tableedit=1, independent-deepseek-json=1, independent-relay-tableedit=1, strict-executor=1, rollback=1');
