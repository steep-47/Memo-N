import { APP, EDITOR, USER } from '../../core/manager.js';

const PREF_KEY = 'independent_record_api_enabled';
const handled = new WeakMap();

function independentEnabled(){return USER?.getSettings?.()?.memo_n_settings?.[PREF_KEY]===true;}
function tokenFor(chat,status){return`${Number(chat?.swipe_id??0)}\u241f${String(status?.mes??'')}\u241f${String(status?.tableEdit??'')}`;}
function wasHandled(chat,token){return handled.get(chat)?.has(token)===true;}
function markHandled(chat,token){let set=handled.get(chat);if(!set){set=new Set();handled.set(chat,set);}set.add(token);}

function latestAssistant(){
    const chat=USER?.getContext?.()?.chat;
    if(!Array.isArray(chat))return null;
    for(let i=chat.length-1;i>=0;i--)if(chat[i]?.is_user===false)return chat[i];
    return null;
}

async function finishLatest(){
    if(independentEnabled())return;
    const chat=latestAssistant();
    if(!chat)return;

    // recordEngine在GENERATION_ENDED时同步挂上这个Promise，真正的严格执行与saveChat在Promise内部完成。
    // 成功提示必须等持久化完成后再读__memoStrictExecution，否则会在渲染阶段过早返回。
    const persistence=chat.__memoStrictPersistence;
    if(persistence&&typeof persistence.then==='function'){
        try{if(await persistence!==true)return;}catch(_){return;}
    }

    const status=chat.__memoStrictExecution;
    if(!status||status.ok!==true)return;
    if(Number(status.swipeId)!==Number(chat?.swipe_id??0))return;
    if(String(status.mes??'')!==String(chat.mes??''))return;

    const token=tokenFor(chat,status);
    if(wasHandled(chat,token))return;
    markHandled(chat,token);

    if(status.noChange===true){
        EDITOR.info('Memo-N：本轮无需更新表格','',1500);
        return;
    }
    if(status.changed!==true)return;
    EDITOR.success(`Memo-N：已记录${status.count||''}${status.count?'项变化':''}`,'',2500);
}

function scheduleFinish(){
    void finishLatest().catch(error=>console.error('[Memo-N] 写入提示任务异常',error));
}

// 统一记录链在GENERATION_ENDED才开始严格执行和持久化；提示也必须绑定同一生命周期尾端。
const endEvent=APP.event_types.GENERATION_ENDED;
APP.eventSource.on(endEvent,scheduleFinish);
APP.eventSource.makeLast?.(endEvent,scheduleFinish);

console.log('[Memo-N] 写入提示已加载：等待严格事务与聊天保存完成后再提示');
