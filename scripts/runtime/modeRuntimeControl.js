import { APP, BASE, EDITOR, USER } from '../../core/manager.js';
import { TableTwoStepSummary } from './separateTableUpdate.js';
import { restoreMemoSnapshot } from './safeTableExecutor.js';

const PREF_KEY='independent_record_api_enabled';
const attempted=new WeakMap();
const queuedJobs=new Map();
let independentRunActive=false;
let activeJob=null;
let pendingRoleGeneration={generationType:'normal',baseMes:''};

function readEnabled(){return USER?.getSettings?.()?.memo_n_settings?.[PREF_KEY]===true;}
function copyHashSheets(value){try{return BASE.copyHashSheets(value);}catch(_){try{return structuredClone(value);}catch(error){console.error('[Memo] 无法复制Swipe表格快照',error);return null;}}}
function forceNormalMode(){if(USER?.tableBaseSetting)USER.tableBaseSetting.step_by_step=false;}
// index.js 是先加载的旧主体，它在 CHAT_COMPLETION_PROMPT_READY 里直接读取 step_by_step。
// 只在真正一轮主生成的 prompt 构建窗口临时桥接；任何停止/结束路径都强制归零，
// 防止 SillyTavern 在 slash command、取消或请求失败时没有进入 SETTINGS_READY 而留下旧标志。
function bridgePromptMode(){if(USER?.tableBaseSetting)USER.tableBaseSetting.step_by_step=readEnabled();}
function tableEditMatches(text){const regex=/<tableEdit>(.*?)<\/tableEdit>/gs;const matches=[];let match;while((match=regex.exec(String(text??'')))!==null)matches.push(match[1]);return matches;}
function snapshotFor(chat,id){return chat?.swipe_info?.[id]?.extra?.memo_n_swipe_hash_sheets||chat?.swipe_info?.[id]?.memo_n_swipe_hash_sheets||null;}
function restoreCurrentStrictSnapshot(chatId){if(!readEnabled())return;const chat=USER?.getContext?.()?.chat?.[chatId];if(!chat||chat.is_user===true)return;const id=Number(chat?.swipe_id);const snapshot=Number.isInteger(id)&&id>=0?snapshotFor(chat,id):null;if(!snapshot)return;const chatSnapshot=copyHashSheets(snapshot);const extraSnapshot=copyHashSheets(snapshot);if(!chatSnapshot||!extraSnapshot)return;const result=restoreMemoSnapshot(chatSnapshot);if(!result.ok){console.warn('[Memo] 独立模式恢复严格Swipe快照失败，已回滚恢复动作',result.error);return;}chat.memo_n_hash_sheets=chatSnapshot;if(!chat.extra||typeof chat.extra!=='object')chat.extra={};chat.extra.memo_n_swipe_hash_sheets=extraSnapshot;chat.tableEditMatches=tableEditMatches(chat.mes);console.log(`[Memo] 独立模式渲染前恢复严格Swipe快照：message=${chatId} swipe=${id}`);}
function beforeRendered(chatId){forceNormalMode();restoreCurrentStrictSnapshot(chatId);}
function isAppendGeneration(type){const value=String(type??'').toLowerCase();return value==='continue'||value==='append'||value==='appendfinal';}
function captureGeneration(type,_params,dryRun){
    // GENERATION_STARTED 在 SillyTavern 中即使后续被命令/取消中断也会触发，因此先清掉上轮兼容值。
    forceNormalMode();
    if(dryRun)return;
    const value=String(type??'normal').toLowerCase();
    if(value==='quiet'||value==='impersonate')return;
    const chat=USER?.getContext?.()?.chat;
    const last=Array.isArray(chat)&&chat.length?chat[chat.length-1]:null;
    pendingRoleGeneration={generationType:value,baseMes:isAppendGeneration(value)&&last?.is_user!==true?String(last?.mes??''):''};
    bridgePromptMode();
}
function visibleMes(chat){return String(chat?.mes??'').replace(/<tableEdit>[\s\S]*?<\/tableEdit>/gi,'').trim();}
function tokenFor(chat){return`${Number(chat?.swipe_id??0)}\u241f${visibleMes(chat)}`;}
function hasAttempted(chat,token){return attempted.get(chat)?.has(token)===true;}
function markAttempted(chat,token){let set=attempted.get(chat);if(!set){set=new Set();attempted.set(chat,set);}set.add(token);}
function currentChatId(chat){const list=USER?.getContext?.()?.chat;return Array.isArray(list)?list.indexOf(chat):-1;}
function makeJob(chatId,chat,generationInfo,{forceFull=false}={}){const visible=visibleMes(chat);return{chatId:Number(chatId),chat,generationInfo:{...(generationInfo||{})},visible,todoChats:String(chat?.mes??''),token:tokenFor(chat),forceFull:forceFull===true,createdAt:Date.now()};}
function queueLatest(job){if(!job?.chat)return;const previous=queuedJobs.get(job.chat);const next={...job,forceFull:job.forceFull||!!previous};queuedJobs.set(job.chat,next);console.log(`[Memo] 独立记录已排队：message=${job.chatId} swipe=${Number(job.chat?.swipe_id??0)}${next.forceFull?'｜完整记录':''}`);}
function drainQueue(){if(independentRunActive||!queuedJobs.size||!readEnabled())return;const first=queuedJobs.entries().next().value;if(!first)return;const[chat,job]=first;queuedJobs.delete(chat);queueMicrotask(()=>startIndependentJob(job));}

function startIndependentJob(job){
    if(!job?.chat||!readEnabled()||!USER?.tableBaseSetting){drainQueue();return;}
    const chat=job.chat;
    const liveId=currentChatId(chat);
    if(liveId<0||chat.is_user===true){drainQueue();return;}
    const liveToken=tokenFor(chat);
    if(liveToken!==job.token){console.log('[Memo] 独立记录排队任务已过期；为避免额外API调用直接作废，不自动重算');drainQueue();return;}
    if(hasAttempted(chat,job.token)){drainQueue();return;}

    markAttempted(chat,job.token);
    independentRunActive=true;
    activeJob=job;
    const options={...job.generationInfo,targetPiece:chat,todoChats:job.todoChats,expectedVisible:job.visible,forceFull:job.forceFull};
    let task;
    try{USER.tableBaseSetting.step_by_step=true;task=TableTwoStepSummary('auto',options);}catch(error){independentRunActive=false;activeJob=null;forceNormalMode();console.error('[Memo] 独立记录 API 启动失败:',error);EDITOR.warning(`独立记录未启动：${error?.message||error}`);drainQueue();return;}finally{forceNormalMode();}

    Promise.resolve(task)
        .then(result=>{
            if(result===true){EDITOR.success('独立填表完成！');console.log(`[Memo] 独立记录 API：message=${liveId} swipe=${Number(chat?.swipe_id??0)} ${options.forceFull?'完整记录':options.generationType||'normal'}完成`);return;}
            if(result==='detached'){console.log('[Memo] 独立记录任务因聊天切换安全作废；不写入、不恢复、不自动重试');return;}
            if(result==='stale'){console.log('[Memo] 独立记录旧结果已作废：正文在API期间变化；不自动重算或重试');EDITOR.warning('独立记录结果已过期：正文在API期间发生变化，因此未写入。不会自动重试；如需记录请手动立即填表。');return;}
            console.warn('[Memo] 独立记录 API：本版本未完成写入；为避免重复扣费不会自动重试同一版本');EDITOR.warning('独立记录未完成：本轮未成功写入。不会自动重试；可手动立即填表或重新生成。');
        })
        .catch(error=>{console.error('[Memo] 独立记录 API 执行异常:',error);EDITOR.warning(`独立记录执行异常：${error?.message||error}。不会自动重试。`);})
        .finally(()=>{independentRunActive=false;activeJob=null;forceNormalMode();drainQueue();});
}

function triggerIndependentRecord(chatId,forcedInfo=null){
    if(!readEnabled()||!USER?.tableBaseSetting)return;
    const chat=USER?.getContext?.()?.chat?.[chatId];if(!chat||chat.is_user===true)return;
    const token=tokenFor(chat);if(hasAttempted(chat,token)&&!queuedJobs.has(chat))return;
    const generationInfo=forcedInfo||{...pendingRoleGeneration};
    const job=makeJob(chatId,chat,generationInfo);
    if(independentRunActive){
        // 同一条消息在API等待期间发生 Continue/编辑/Swipe 变化时，不排队第二次API。
        // 当前请求返回后会因 expectedVisible 不一致而 stale 作废，用户可手动立即填表；这保证“不会自动重算/重试”。
        if(activeJob?.chat===chat){
            console.log('[Memo] 同一消息在独立记录进行中又发生变化：不排队第二次API，当前结果若过期将安全作废');
            return;
        }
        queueLatest(job);
        return;
    }
    startIndependentJob(job);
}

const startedEvent=APP.event_types.GENERATION_STARTED;if(startedEvent)APP.eventSource.on(startedEvent,captureGeneration);
const settingsReadyEvent=APP.event_types.CHAT_COMPLETION_SETTINGS_READY;if(settingsReadyEvent)APP.eventSource.on(settingsReadyEvent,forceNormalMode);
const stoppedEvent=APP.event_types.GENERATION_STOPPED;if(stoppedEvent)APP.eventSource.on(stoppedEvent,forceNormalMode);
const endedEvent=APP.event_types.GENERATION_ENDED;if(endedEvent)APP.eventSource.on(endedEvent,forceNormalMode);
const renderedEvent=APP.event_types.CHARACTER_MESSAGE_RENDERED;
APP.eventSource.on(renderedEvent,beforeRendered);APP.eventSource.on(renderedEvent,triggerIndependentRecord);
if(typeof APP.eventSource.makeFirst==='function')APP.eventSource.makeFirst(renderedEvent,beforeRendered);
if(typeof APP.eventSource.makeLast==='function')APP.eventSource.makeLast(renderedEvent,triggerIndependentRecord);
forceNormalMode();
console.log('[Memo] 独立记录 API：持久模式独立存储 + generation全结束路径旧step清零 + 同消息stale不自动重算 + Swipe快照');
