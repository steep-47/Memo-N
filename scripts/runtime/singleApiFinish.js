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

    // NO_CHANGE不显示为绿色“写入成功”；绿色只表示七表事务成功且确有实际写入。
    if(status.noChange===true){
        EDITOR.info('Memo-N：七表检查完成，本轮无可写变化','',1800);
        return;
    }
    if(status.changed!==true)return;
    EDITOR.success(`Memo-N：七表检查完成，已记录${status.count||''}${status.count?'项变化':''}`,'',2500);
}

function scheduleFinish(){
    void finishLatest().catch(error=>console.error('[Memo-N] 写入提示任务异常',error));
}

const endEvent=APP.event_types.GENERATION_ENDED;
APP.eventSource.on(endEvent,scheduleFinish);
APP.eventSource.makeLast?.(endEvent,scheduleFinish);

console.log('[Memo-N] 写入提示已加载：绿色仅用于七表事务成功且实际发生写入');
