import { EDITOR, USER } from '../../core/manager.js';

const PREF_KEY = 'independent_record_api_enabled';
const handled = new WeakMap();

function independentEnabled(){return USER?.getSettings?.()?.memo_n_settings?.[PREF_KEY]===true;}
function tokenFor(chat,status){return`${Number(chat?.swipe_id??0)}\u241f${String(status?.mes??'')}\u241f${String(status?.tableEdit??'')}`;}
function wasHandled(chat,token){return handled.get(chat)?.has(token)===true;}
function markHandled(chat,token){let set=handled.get(chat);if(!set){set=new Set();handled.set(chat,set);}set.add(token);}

// Called by the record engine only after its save promise has succeeded.
// No GENERATION_ENDED listener: notification must not depend on listener order.
export function notifyMemoRecordSaved(chat, session){
    if(independentEnabled() || !chat || USER?.getContext?.()?.chat !== session)return;
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

console.log('[Memo-N] 写入提示已加载：由保存完成直接触发');
