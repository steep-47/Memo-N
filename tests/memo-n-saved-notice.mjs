import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const handlers = new Map();
// Expected injected failures should not print data-URL module stack traces.
console.warn = () => {};
console.error = () => {};
let session = [{ is_user: false, mes: '上一轮', memo_n_hash_sheets: { state: 'before' } }];
let saveMode = 'delay';
let releaseSave;
let executionFails = false;
const notices = [];
const context = { get chat() { return session; }, updateMessageBlock() { throw Error('view failure'); } };
const envelope = await import('../scripts/engine/recordEnvelope.js');
const mocks = {
    APP: { event_types: { GENERATION_STARTED:'start', CHAT_COMPLETION_SETTINGS_READY:'settings', CHARACTER_MESSAGE_RENDERED:'rendered', GENERATION_ENDED:'ended' },
        eventSource: { on(event, fn) { handlers.set(event, fn); }, makeLast() {} } },
    BASE: { getChatSheets:()=>[], copyHashSheets:structuredClone, getLastSheetsPiece:()=>({piece:session[0]}), refreshContextView:async()=>{}, },
    USER: { tableBaseSetting:{}, getSettings:()=>({}), getContext:()=>context,
        saveChat:async()=>{ if(saveMode==='fail')throw Error('save failure'); if(saveMode==='delay')await new Promise(resolve=>{releaseSave=resolve;}); } },
    EDITOR: { info:message=>notices.push(['info',message]), success:message=>notices.push(['success',message]), warning(){},error(){} },
    restoreMemoSnapshot:()=>({ok:true}), saveMemoSnapshot(){},
    executeMemoTableEdit(raw) { return executionFails ? {ok:false,error:'invalid update'} : {ok:true, changed:!raw.includes('NO_CHANGE'), noChange:raw.includes('NO_CHANGE'),count:1}; },
    ...envelope,
};
globalThis.__noticeMocks = mocks;
let notifierSource = await fs.readFile(new URL('../scripts/runtime/singleApiFinish.js',import.meta.url),'utf8');
notifierSource = notifierSource.replace(/import .*?from '..\/..\/core\/manager.js';/, 'const {EDITOR,USER}=globalThis.__noticeMocks;');
const notifier = await import(`data:text/javascript;base64,${Buffer.from(notifierSource).toString('base64')}`);
mocks.notifyMemoRecordSaved = notifier.notifyMemoRecordSaved;
let source = await fs.readFile(new URL('../scripts/engine/recordEngine.js',import.meta.url),'utf8');
source = source.replace(/import[\s\S]*?from ['"][^'"]+['"];\s*/g, '');
source = 'const {APP,BASE,EDITOR,USER,executeMemoTableEdit,restoreMemoSnapshot,saveMemoSnapshot,changesToStrictCalls,parseRecordEnvelope,parseRelayTableEditEnvelope,parseRelayTaggedEnvelope,notifyMemoRecordSaved}=globalThis.__noticeMocks;\n'+source;
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
function complete(calls) {
    handlers.get('start')('normal',{},false);
    const request = {messages:[{role:'user',content:'行动'}]};
    handlers.get('settings')(request);
    const token = /memo-round="([^"]+)"/.exec(request.messages.at(-1).content)[1];
    const chat={is_user:false,mes:`正文<tableEdit memo-round="${token}"><!-- ${calls} --></tableEdit>`,swipe_id:0};
    session.push(chat);
    handlers.get('rendered')(session.length-1);
    handlers.get('ended')();
    return chat;
}
const chat=complete('insertRow(0,{0:"时间"})');
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(notices.length,0,'保存完成前不得提示成功');
releaseSave();
assert.equal(await chat.__memoStrictPersistence,true);
assert.equal(notices.length,1);
assert.equal(notices[0][0],'success','视图失败不能吞掉保存成功提示');
notifier.notifyMemoRecordSaved(chat,session);
assert.equal(notices.length,1,'同一次保存不能重复提示');
saveMode='fail';
await complete('insertRow(0,{0:"时间"})').__memoStrictPersistence;
assert.equal(notices.length,1,'保存失败不得显示成功');
saveMode='ok'; executionFails=true;
await complete('updateRow(4,99,{0:"错误"})').__memoStrictPersistence;
assert.equal(notices.length,1,'执行失败不得显示成功');
executionFails=false;
await complete('NO_CHANGE').__memoStrictPersistence;
assert.equal(notices.at(-1)[0],'info','无变化应显示检查完成而非写入成功');
saveMode='delay';
const detached=complete('insertRow(0,{0:"时间"})');
await new Promise(resolve=>setTimeout(resolve,0));
session=[];
releaseSave();
await detached.__memoStrictPersistence;
assert.equal(notices.length,2,'切换聊天后不得在新聊天显示旧记录成功');
console.log('memo-n-saved-notice PASS: delayed save, dedupe, save failure, execution failure, no-change, view failure, switched chat');
