import { BASE, EDITOR, USER } from '../../core/manager.js';
import { newPopupConfirm } from '../../components/popupConfirm.js';
import { reloadCurrentChat } from '/script.js';
import { getTableEditTag, getTablePrompt, getTablePromptByPiece } from '../../index.js';
import { handleCustomAPIRequest, handleMainAPIRequest } from '../settings/standaloneAPI.js';
import { updateSystemMessageTableStatus } from '../renderer/tablePushToChat.js';
import { repairMissingColumnsBeforeCleanup } from './tableStructureRepair.js?v=memon82';
import { executeMemoTableEdit, restoreMemoSnapshot, saveMemoSnapshot } from './safeTableExecutor.js?v=memon82';
import JSON5 from '../../utils/json5.min.mjs';

const INDEPENDENT_OPERATION_RULES = `# Memo独立记录操作协议
固定标准表索引：0当前状态 / 1角色状态 / 2背包 / 3当前任务与约定 / 4人物主表 / 5人物发展表 / 6历史事件。
每轮必须按0→1→2→3→4→5→6逐表检查。每张表只判断“当前待处理回复是否产生该表负责的新事实，或最终事实是否与当前表已有记录不同”：有则修改，没有则跳过并继续下一张。不得因为前几张表无变化、变化很小或认为“没大事”而提前结束；只有七表全部检查完且均无需修改时才允许NO_CHANGE。
表6除重大历史节点外，也承接0～5没有合适字段、但对后续剧情连续性有用的已发生事实；同一连续事件可更新已有记录，不必每轮机械新增。
记录前先把正文拆成最小独立事实再逐项归位。“修炼体系/路径”只保存稳定的修行类别或专精路线标签，不写解释句。对人族先看灵根条件：无灵根并走一至九品等凡俗武道→“武夫”；有灵根、以灵气修行为根基并稳定专精体魄/肉身→“体修”；有灵根、走常规修仙且没有明确稳定专精→“练气士”。练气士是修仙统称，不随炼气/筑基/金丹等境界变化，会普通功法术法也仍只是练气士。若已经明确形成剑修、法修、魂修、丹师、器师、符师、阵师、御兽、旁门等稳定专精/职业，直接记录更具体标签并取代“练气士”，不得写“练气士／剑修”；多个具体专精只有在都明确时才用“／”连接。武夫≠体修；灵根未知时不得仅凭近战、肉身强或使用兵器强判武夫/体修。妖族实际修行记“妖修”，灵族达到自主修行并实际修炼记“灵修”。不得只凭种族、一次用剑、一次施法、一次炼丹等行为判定路线。“修为”只写当前境界/阶段；修炼经历、长期停滞、瓶颈、伤势或限制分别写人物主表重要信息或人物发展表当前重要状态，不塞进体系/路径或修为字段。
只能使用：
insertRow(tableIndex:number,data:{[colIndex:number]:string|number})
updateRow(tableIndex:number,rowIndex:number,data:{[colIndex:number]:string|number})
deleteRow(tableIndex:number,rowIndex:number)
表2/4/5的update/delete必须额外携带当前目标行第一列原值作为对象核对名：
updateRow(tableIndex,rowIndex,data,"当前行第一列原值")
deleteRow(tableIndex,rowIndex,"当前行第一列原值")
对象核对名必须原样抄当前表格执行前该row的第一列；人物改名时仍写旧姓名作核对，新姓名放data里。表2/4/5新增对象必须在data第0列写对象名；同名已存在时优先update，不重复insert。
data键优先使用数字列索引；也可使用当前表中完全一致的真实表头名，执行器会安全映射。禁止使用不存在、近似或自行编造的列名。
updateRow只能使用当前真实存在的rowIndex，越界不得自动新增；真正新增必须明确使用insertRow。当前表格是rowIndex和对象名的唯一依据，不按旧聊天猜行号。
人物主表与人物发展表通过姓名关联；年龄与最后确认时间必须分别维护，最后确认时间记录到世界日期即可。
最终只能输出一个完整<tableEdit>...</tableEdit>，不得输出剧情、JSON、解释或Markdown。`;

function isAppendGeneration(type){const value=String(type??'').toLowerCase();return value==='continue'||value==='append'||value==='appendfinal';}
function stripMachine(text){return String(text??'').replace(/<tableEdit>[\s\S]*?<\/tableEdit>/gi,'').replace(/<(think|thinking)>[\s\S]*?<\/\1>/gi,'').trim();}
function stripTableEditOnly(text){return String(text??'').replace(/<tableEdit>[\s\S]*?<\/tableEdit>/gi,'').trim();}
function copyValue(value){if(value===undefined)return undefined;try{return structuredClone(value);}catch(_){return JSON.parse(JSON.stringify(value));}}
function copyHashSheets(value){if(!value||typeof value!=='object')return null;try{return BASE.copyHashSheets(value);}catch(_){return copyValue(value);}}
function attachValidatedRecord(piece,rawContent,matches){
    if(!piece)return;
    const blocks=String(rawContent??'').match(/<tableEdit>[\s\S]*?<\/tableEdit>/gi);
    const machineBlock=Array.isArray(blocks)&&blocks.length
        ?blocks[blocks.length-1]
        :`<tableEdit>${String(matches?.[matches.length-1]??'<!-- NO_CHANGE -->')}</tableEdit>`;
    const visible=stripTableEditOnly(piece.mes);
    piece.mes=visible;
    if(!piece.extra||typeof piece.extra!=='object')piece.extra={};
    piece.extra.memo_n_manual_table_edit=machineBlock;
    const id=Number(piece.swipe_id);
    if(Array.isArray(piece.swipes)&&Number.isInteger(id)&&id>=0&&id<piece.swipes.length){
        piece.swipes[id]=visible;
    }
    if(Number.isInteger(id)&&id>=0){
        if(!Array.isArray(piece.swipe_info))piece.swipe_info=[];
        if(!piece.swipe_info[id]||typeof piece.swipe_info[id]!=='object')piece.swipe_info[id]={};
        if(!piece.swipe_info[id].extra||typeof piece.swipe_info[id].extra!=='object')piece.swipe_info[id].extra={};
        piece.swipe_info[id].extra.memo_n_manual_table_edit=machineBlock;
    }
}
function normalizedContextRounds(value){
    if(value===undefined||value===null||String(value).trim()==='')return 1;
    const numeric=Number(value);
    if(!Number.isFinite(numeric))return 1;
    return Math.max(1,Math.floor(numeric));
}
function buildRecentContext(targetPiece){
    const chat=Array.isArray(USER.getContext?.()?.chat)?USER.getContext().chat:[];
    const rounds=normalizedContextRounds(USER.tableBaseSetting.separateReadContextLayers);
    const targetIndex=targetPiece?chat.indexOf(targetPiece):-1;
    const source=(targetIndex>=0?chat.slice(0,targetIndex):chat).filter(item=>item&&typeof item==='object');
    const selected=[];
    let current=[];
    let counted=0;
    for(let i=source.length-1;i>=0&&counted<rounds;i--){
        const item=source[i];
        current.unshift(item);
        if(item?.is_user===true){
            selected.unshift(...current);
            current=[];
            counted+=1;
        }
    }
    if(counted===0&&current.length)selected.unshift(...current);
    return selected.map(item=>`${item.name||(item?.is_user?'user':'assistant')}: ${stripMachine(item.mes)}`).join('\n');
}
async function readLorebook(){if(!USER.tableBaseSetting.separateReadLorebook||!window.TavernHelper)return'';try{const books=await window.TavernHelper.getCharLorebooks({type:'all'});const names=[books?.primary,...(Array.isArray(books?.additional)?books.additional:[])].filter(Boolean);const chunks=[];for(const name of names){const entries=await window.TavernHelper.getLorebookEntries(name);if(Array.isArray(entries))chunks.push(...entries.map(entry=>String(entry?.content??'')).filter(Boolean));}return chunks.join('\n');}catch(error){console.warn('[Memo][independent] 世界书读取失败，继续使用现有表格与聊天上下文',error);return'';}}
function parsePromptTemplate(){const raw=String(USER.tableBaseSetting.step_by_step_user_prompt||'').trim();try{const parsed=JSON5.parse(raw);if(!Array.isArray(parsed)||!parsed.length)throw new Error('提示词不是非空消息数组');return parsed;}catch(error){throw new Error(`独立填表提示词格式错误：${error?.message||error}`);}}
async function buildIndependentMessages(todoChats,originText,targetPiece){const contextChats=buildRecentContext(targetPiece);const lorebook=await readLorebook();const template=parsePromptTemplate();const replace=value=>String(value??'').replace(/(?<!\\)\$0/g,()=>originText).replace(/(?<!\\)\$1/g,()=>contextChats).replace(/(?<!\\)\$2/g,()=>stripMachine(todoChats)).replace(/(?<!\\)\$3/g,()=>INDEPENDENT_OPERATION_RULES).replace(/(?<!\\)\$4/g,()=>lorebook);return template.map(message=>({...message,content:replace(message?.content)}));}
function exactPromptForPiece(referencePiece){return referencePiece?.memo_n_hash_sheets?getTablePromptByPiece(referencePiece):getTablePrompt(referencePiece);}
function resolveRecordSlice(todoChats,referencePiece,options={}){const full=String(todoChats??'');const append=!options.forceFull&&isAppendGeneration(options.generationType)&&options.baseMes&&full.startsWith(String(options.baseMes));if(!append)return{recordText:full,originText:exactPromptForPiece(referencePiece),append:false};const recordText=full.slice(String(options.baseMes).length).trim();return{recordText,originText:exactPromptForPiece(referencePiece),append:true};}
async function runIndependentApi(todoChats,referencePiece,isSilentMode,options={}){const slice=resolveRecordSlice(todoChats,referencePiece,options);if(slice.append&&!stripMachine(slice.recordText)){console.log('[Memo][independent] Continue本次没有新增可记录正文');return true;}const messages=await buildIndependentMessages(slice.recordText,slice.originText,referencePiece);const useMain=USER.tableBaseSetting.step_by_step_use_main_api??true;let rawContent;try{rawContent=useMain?await handleMainAPIRequest(messages,null,isSilentMode):await handleCustomAPIRequest(messages,null,true,isSilentMode);}catch(error){console.error('[Memo][independent] API请求异常',error);EDITOR.warning(`独立记录API请求失败：${error?.message||error}`);return false;}if(rawContent==='suspended')return false;if(typeof rawContent!=='string'||!rawContent.trim()||/^错误[:：]/.test(rawContent.trim())){console.error('[Memo][independent] API返回无效:',rawContent);EDITOR.warning('独立记录失败：API返回为空或错误内容，原表未修改。');return false;}if(options.sessionChat&&USER.getContext?.()?.chat!==options.sessionChat){console.warn('[Memo][independent] API返回时已切换聊天，旧任务作废且不触碰新聊天表格');return'detached';}if(options.expectedVisible!==undefined&&stripMachine(referencePiece?.mes)!==String(options.expectedVisible)){console.warn('[Memo][independent] 独立API返回时正文已经变化，本次旧结果作废，等待最新版本重算');return 'stale';}const{matches}=getTableEditTag(rawContent);if(!Array.isArray(matches)||matches.length!==1){console.error('[Memo][independent] 模型tableEdit块数量异常:',matches?.length??0,rawContent);EDITOR.warning(`独立记录失败：模型必须且只能返回1个<tableEdit>，实际为${matches?.length??0}个。原表未修改。`);return false;}const result=executeMemoTableEdit(matches,referencePiece);if(!result.ok){console.error('[Memo][independent] tableEdit校验/执行失败:',result.error,matches);EDITOR.warning(`独立记录失败：${result.error}。原表未执行错误操作。`);return false;}attachValidatedRecord(referencePiece,rawContent,matches);await USER.saveChat();if(options.sessionChat&&USER.getContext?.()?.chat!==options.sessionChat){console.warn('[Memo][independent] 保存期间切换了聊天；旧任务不再刷新或恢复当前新聊天视图');return'detached';}console.log(`[Memo][independent] 严格记录完成并绑定当前swipe：${slice.append?'Continue增量｜':''}${result.noChange?'NO_CHANGE':`${result.count}项操作`}`);return true;}

function previousBaselineForCurrentPiece(piece){const chat=USER.getContext?.()?.chat;if(!Array.isArray(chat))return null;const index=chat.indexOf(piece);if(index<0)return null;for(let i=index-1;i>=0;i--){const candidate=chat[i];if(candidate?.is_user===false&&candidate?.memo_n_hash_sheets&&typeof candidate.memo_n_hash_sheets==='object')return copyHashSheets(candidate.memo_n_hash_sheets);}return null;}
function restoreHashSheets(snapshot){const result=restoreMemoSnapshot(snapshot);if(!result.ok)console.error('[Memo][independent] 恢复表格基线失败',result.error);return result.ok;}
function captureLiveSheets(){const snapshots=new Map();for(const sheet of BASE.getChatSheets?.()??[]){const data=sheet?.filterSavingData?.();if(!data||typeof data!=='object')throw new Error(`无法备份表格 ${sheet?.name||'未知表'}`);snapshots.set(sheet,copyValue(data));}return snapshots;}
function restoreLiveSheets(snapshots){for(const[sheet,data]of snapshots??[]){sheet.loadJson(copyValue(data));}}
function capturePieceState(piece){const id=Number(piece?.swipe_id);return{hash:copyHashSheets(piece?.memo_n_hash_sheets),hadHash:!!piece&&Object.prototype.hasOwnProperty.call(piece,'memo_n_hash_sheets'),extra:copyValue(piece?.extra),mes:String(piece?.mes??''),swipeId:id,swipe:Array.isArray(piece?.swipes)&&Number.isInteger(id)&&id>=0&&id<piece.swipes.length?piece.swipes[id]:undefined,swipeInfo:Array.isArray(piece?.swipe_info)&&Number.isInteger(id)&&id>=0&&piece.swipe_info[id]?copyValue(piece.swipe_info[id]):undefined};}
function restorePieceState(piece,state){if(!piece||!state)return;if(state.hadHash)piece.memo_n_hash_sheets=copyHashSheets(state.hash);else delete piece.memo_n_hash_sheets;piece.extra=copyValue(state.extra)??{};piece.mes=state.mes;const id=state.swipeId;if(Array.isArray(piece.swipes)&&Number.isInteger(id)&&id>=0&&id<piece.swipes.length)piece.swipes[id]=state.swipe??state.mes;if(Array.isArray(piece.swipe_info)&&Number.isInteger(id)&&id>=0){if(state.swipeInfo!==undefined)piece.swipe_info[id]=copyValue(state.swipeInfo);else if(piece.swipe_info[id]){delete piece.swipe_info[id].memo_n_swipe_hash_sheets;if(piece.swipe_info[id].extra)delete piece.swipe_info[id].extra.memo_n_swipe_hash_sheets;}}}
function prepareAutoBaseline(piece,options){const append=!options.forceFull&&isAppendGeneration(options.generationType);const baseline=append&&piece?.memo_n_hash_sheets?copyHashSheets(piece.memo_n_hash_sheets):previousBaselineForCurrentPiece(piece);if(baseline)return restoreHashSheets(baseline);const empty=BASE.initHashSheet?.();return empty?.memo_n_hash_sheets?restoreHashSheets(empty.memo_n_hash_sheets):false;}
function refreshCommittedViews({reload=false}={}){try{BASE.refreshContextView();updateSystemMessageTableStatus();if(reload)reloadCurrentChat();}catch(error){console.warn('[Memo] 记录已经提交，但视图刷新失败',error);}}

export async function TableTwoStepSummary(mode='manual',options={}){if(USER.tableBaseSetting.isExtensionAble===false)return false;if(!['auto','manual'].includes(mode)){console.warn(`[Memo][independent] 已拒绝旧模式 ${mode}；一次API不允许fallback补记。`);return false;}if(mode==='auto'&&USER.tableBaseSetting.step_by_step===false)return false;const currentPiece=USER.getChatPiece?.()?.piece;const todoPiece=options.targetPiece||currentPiece;if(!todoPiece){if(mode==='manual')EDITOR.error('未找到待填表的对话片段，请至少生成一条角色回复。');return false;}const todoChats=options.todoChats??String(todoPiece.mes??'');if(mode==='manual'){const popupContentHtml=`<p>累计 ${String(todoChats).length} 长度的文本，是否开始独立填表？</p>`;const confirmResult=await newPopupConfirm(popupContentHtml,'取消','执行填表','stepwiseSummaryConfirm','不再提示','一直选是');if(confirmResult===false)return false;return await manualSummaryChat(todoChats,confirmResult,{...options,targetPiece:todoPiece});}return await manualSummaryChat(todoChats,'dont_remind_active',{...options,targetPiece:todoPiece});}

export async function manualSummaryChat(todoChats,confirmResult,options={}){const sessionChat=USER.getContext?.()?.chat;const sessionActive=()=>USER.getContext?.()?.chat===sessionChat;const currentPiece=USER.getChatPiece?.()?.piece;const initialPiece=options.targetPiece||currentPiece;if(!initialPiece)return false;if(!Array.isArray(sessionChat)||!sessionChat.includes(initialPiece)){console.warn('[Memo][independent] 目标消息已不属于当前聊天，取消旧的填表任务');return false;}if(initialPiece===currentPiece){try{repairMissingColumnsBeforeCleanup({notify:false});}catch(error){console.error('[Memo][independent] 执行前结构修复失败',error);if(confirmResult!=='dont_remind_active')EDITOR.warning(`手动填表未启动：当前表格结构修复失败｜${error?.message||error}`);return false;}}const isAutoMode=confirmResult==='dont_remind_active';if(isAutoMode){const targetBackup=capturePieceState(initialPiece);const sheetBackup=captureLiveSheets();const liveHash=currentPiece&&currentPiece!==initialPiece?copyHashSheets(currentPiece.memo_n_hash_sheets):null;try{if(!prepareAutoBaseline(initialPiece,options))throw new Error('无法恢复独立记录前的明确表格基线');if(initialPiece===currentPiece)repairMissingColumnsBeforeCleanup({notify:false});saveMemoSnapshot(initialPiece);const effectiveOptions={...(options.forceFull?{...options,generationType:'normal',baseMes:''}:options),sessionChat};const latestTodo=options.forceFull?String(initialPiece.mes??''):String(todoChats??'');const ok=await runIndependentApi(latestTodo,initialPiece,true,effectiveOptions);if(ok==='detached')return'detached';if(ok==='stale'||!ok){restorePieceState(initialPiece,targetBackup);if(sessionActive()){restoreLiveSheets(sheetBackup);if(targetBackup.hash)restoreHashSheets(targetBackup.hash);}return ok==='stale'?'stale':false;}return true;}catch(error){console.error('[Memo][independent] 自动记录失败，恢复执行前状态',error);restorePieceState(initialPiece,targetBackup);if(sessionActive()){restoreLiveSheets(sheetBackup);if(targetBackup.hash)restoreHashSheets(targetBackup.hash);}return false;}finally{if(sessionActive()){if(currentPiece&&currentPiece!==initialPiece&&liveHash)restoreHashSheets(liveHash);refreshCommittedViews();}}}

    const backup=capturePieceState(initialPiece);const sheetBackup=captureLiveSheets();const baseline=previousBaselineForCurrentPiece(initialPiece);try{const baselineReady=baseline?restoreHashSheets(baseline):(()=>{const empty=BASE.initHashSheet?.();return empty?.memo_n_hash_sheets?restoreHashSheets(empty.memo_n_hash_sheets):false;})();if(!baselineReady)throw new Error('无法恢复手动填表前的明确表格基线');repairMissingColumnsBeforeCleanup({notify:false});saveMemoSnapshot(initialPiece);const ok=await runIndependentApi(todoChats,initialPiece,false,{generationType:'manual',sessionChat});if(ok==='detached')return'detached';if(!ok)throw new Error('手动填表未成功完成');refreshCommittedViews({reload:true});return true;}catch(error){console.error('[Memo][manual-refill] 手动填表失败，恢复原状态',error);restorePieceState(initialPiece,backup);if(sessionActive()){restoreLiveSheets(sheetBackup);if(backup.hash)restoreHashSheets(backup.hash);await USER.saveChat();refreshCommittedViews();EDITOR.warning('手动填表失败：已恢复执行前的原表格、正文和Swipe快照，不会留下半成品。');}return false;}}
