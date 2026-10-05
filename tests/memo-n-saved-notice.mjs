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
let clearStatusOnSave = false;
let blockView = false;
let independent = false;
const notices = [];
const context = { get chat() { return session; }, updateMessageBlock() { throw Error('view failure'); } };
const envelope = await import('../scripts/engine/recordEnvelope.js');
const mocks = {
    APP: { event_types: { GENERATION_STARTED:'start', CHAT_COMPLETION_SETTINGS_READY:'settings', CHARACTER_MESSAGE_RENDERED:'rendered', GENERATION_ENDED:'ended' },
        eventSource: { on(event, fn) { handlers.set(event, fn); }, makeLast() {} } },
    BASE: { getChatSheets:()=>[], copyHashSheets:structuredClone, getLastSheetsPiece:()=>({piece:session[0]}), refreshContextView:async()=>{if(blockView)await new Promise(()=>{});}, },
    USER: { tableBaseSetting:{}, getSettings:()=>({memo_n_settings:{independent_record_api_enabled:independent}}), getContext:()=>context,
        saveChat:async()=>{ if(clearStatusOnSave) { delete session.at(-1).__memoStrictExecution; independent=true; } if(saveMode==='fail')throw Error('save failure'); if(saveMode==='delay')await new Promise(resolve=>{releaseSave=resolve;}); } },
    EDITOR: { info:message=>notices.push(['info',message]), success:message=>notices.push(['success',message]), warning(){},error(){} },
    restoreMemoSnapshot:()=>({ok:true}), saveMemoSnapshot(){},
    executeMemoTableEdit(raw) { return executionFails ? {ok:false,error:'invalid update'} : {ok:true, changed:!raw.includes('NO_CHANGE'), noChange:raw.includes('NO_CHANGE'),count:1}; },
    ...envelope,
};
globalThis.__noticeMocks = mocks;
// Exercise the real Memo toast boundary, not a mocked success helper.
globalThis.toastr = {
    success(message, detail, options) { notices.push(['success', message, options]); },
    info(message, detail, options) { notices.push(['info', message, options]); },
};
let toastSource = await fs.readFile(new URL('../scripts/settings/devConsole.js',import.meta.url),'utf8');
toastSource = toastSource.replace(/^import[^\n]+\n/gm,'');
toastSource = 'const {EDITOR,USER,BASE}=globalThis.__noticeMocks; const SYSTEM={};\n'+toastSource;
const {consoleMessageToEditor} = await import(`data:text/javascript;base64,${Buffer.from(toastSource).toString('base64')}`);
mocks.EDITOR.success = (message, detail='', timeout=500)=>consoleMessageToEditor.success(message,detail,timeout);
mocks.EDITOR.info = (message, detail='', timeout=500)=>consoleMessageToEditor.info(message,detail,timeout);
let source = await fs.readFile(new URL('../scripts/engine/recordEngine.js',import.meta.url),'utf8');
source = source.replace(/import[\s\S]*?from ['"][^'"]+['"];\s*/g, '');
source = 'const {APP,BASE,EDITOR,USER,executeMemoTableEdit,restoreMemoSnapshot,saveMemoSnapshot,changesToStrictCalls,parseRecordEnvelope,parseRelayTableEditEnvelope,parseRelayTaggedEnvelope}=globalThis.__noticeMocks;\n'+source;
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
assert.equal(notices[0][2].timeOut,5000,'实际浮窗应停留5秒');
handlers.get('ended')();
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

// Saving hooks can reconstruct a message and remove non-enumerable runtime fields.
session=[{is_user:false,mes:'旧轮',memo_n_hash_sheets:{state:'before'}}];
saveMode='ok'; clearStatusOnSave=true;
const withoutRuntimeStatus=complete('insertRow(0,{0:"时间"})');
assert.equal(await withoutRuntimeStatus.__memoStrictPersistence,true);
assert.equal(withoutRuntimeStatus.__memoStrictExecution,undefined);
assert.equal(notices.at(-1)[0],'success','临时状态消失不应吞掉已经确认的保存成功');
const beforeView=notices.length;
clearStatusOnSave=false; independent=false; blockView=true;
complete('insertRow(0,{0:"时间"})');
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(notices.length,beforeView+1,'视图刷新未完成时也应提示已保存的结果');
console.log('saved-result notice PASS: removed runtime status, stalled view');
