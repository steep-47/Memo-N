import { APP, USER } from '../../core/manager.js';
import { defaultSettings } from '../../data/pluginSetting.js';

const MARK = '[Memo-N逐表连续性审计v1]';

const AUDIT_RULES = `
${MARK}
以下规则是Memo-N当前最终记录判断，优先级高于前文关于“重要变化”“重大事件”“避免流水账”等可能导致提前跳过记录的表述。

一、固定检查顺序
每轮必须按0→1→2→3→4→5→6逐表完成检查。
每张表只判断一件事：本轮最终正文是否出现该表负责的新事实，或最终事实是否与当前表已有记录不同。
有变化或新事实就insert/update/delete；没有就跳过该表并继续下一张。
不得因为前几张表没有变化、变化看起来很小、事情尚未结束、人物尚未建立关系，或认为“本轮没什么大事”而提前停止检查。
NO_CHANGE只能在0～6七张表全部检查完成、确认每一张都无需修改后使用。

二、七表职责
#0 当前状态表：日期、时间、地点、当前场景人物按正文最终落点维护。时间或地点只要实际不同就是变化，不另设重要性门槛；不要机械给时间+1分钟，按正文实际时间写。
#1 角色状态表：玩家本人已确认的新状态或变化。
#2 背包表：玩家当前实际持有物品。获得、消耗、交付、丢失、数量/品质/状态变化都按最终库存维护。
#3 当前任务与约定表：新任务、新约定、承诺、期限及其状态变化。
#4 人物主表：NPC稳定识别信息。新确认且值得后续识别的稳定事实可补充；同一人物优先更新，不重复建档。
#5 人物发展表：已追踪NPC本轮新确认或变化的发展锚点；必须写到正确姓名对应的行。
#6 历史事件表：既保存重大历史节点，也承接0～5没有合适字段但对后续剧情连续性有用的已发生事实。不要把纯氛围或无后续意义的琐碎动作单独写成历史；同一连续事件可更新已有事件记录，不必每轮机械新增。

三、对象与rowIndex核对
当前表格是rowIndex的唯一依据。每个操作在输出前重新核对目标行。
表2/4/5使用额外对象核对参数：
updateRow(tableIndex,rowIndex,{columnIndex:"value"},"当前行第一列原值")
deleteRow(tableIndex,rowIndex,"当前行第一列原值")
最后一个字符串必须原样抄写执行前当前表该row的第一列对象名；它是安全校验，不代表要修改该名字。
例如删除“蛐蛐罐”前，若当前背包row=2的第一列是“蛐蛐罐”，应写 deleteRow(2,2,"蛐蛐罐")；如果row=0是“夹袍”，就绝不能写deleteRow(2,0,"蛐蛐罐")。
人物改名时，核对参数仍写更新前当前行的旧名称，新名称放进data的姓名列。
表2/4/5新增对象必须在data第0列写对象名；执行层会拦截同名重复insert。

四、完整输出
同一轮影响几张表就同时写几张，不因为已经写了其中一张就停止。
正常剧情中NO_CHANGE应很少见；它表示七表真的全部没有新事实或变化，不表示“没有大事”。
`;

function appendRules(text) {
    const source = String(text ?? '');
    if (source.includes(MARK)) return source;
    return `${source.trimEnd()}\n\n${AUDIT_RULES.trim()}`.trim();
}

function patchSettings(settings) {
    if (!settings || typeof settings !== 'object') return;
    if ('message_template' in settings) settings.message_template = appendRules(settings.message_template);
    if ('refresh_system_message_template' in settings) settings.refresh_system_message_template = appendRules(settings.refresh_system_message_template);
    if ('refresh_user_message_template' in settings) settings.refresh_user_message_template = appendRules(settings.refresh_user_message_template);
}

function injectFinalAudit(data) {
    patchSettings(USER?.tableBaseSetting);
    if (!data || typeof data !== 'object' || !Array.isArray(data.messages)) return;
    data.messages = data.messages.filter(message => !String(message?.content ?? '').includes(MARK));
    data.messages.push({
        role: 'system',
        content: AUDIT_RULES.trim(),
    });
}

try { patchSettings(defaultSettings); } catch (error) {
    console.warn('[Memo-N] 默认逐表审计规则安装失败', error);
}

queueMicrotask(() => patchSettings(USER?.tableBaseSetting));
setTimeout(() => patchSettings(USER?.tableBaseSetting), 250);
setTimeout(() => patchSettings(USER?.tableBaseSetting), 1000);

const settingsReady = APP.event_types.CHAT_COMPLETION_SETTINGS_READY;
APP.eventSource.on(settingsReady, injectFinalAudit);
APP.eventSource.makeLast?.(settingsReady, injectFinalAudit);

console.log('[Memo-N] 逐表连续性审计已加载：0→6逐表检查，NO_CHANGE仅允许七表全部无变化');
