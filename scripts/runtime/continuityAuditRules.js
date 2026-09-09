import { APP, USER } from '../../core/manager.js';
import { defaultSettings } from '../../data/pluginSetting.js';
import JSON5 from '../../utils/json5.min.mjs';

const MARK = '[Memo-N逐表连续性审计v2]';

const AUDIT_RULES = `
${MARK}
以下规则是Memo-N当前最终记录判断，优先级高于前文关于“重要变化”“重大事件”“避免流水账”等可能导致提前跳过记录的表述。

一、固定检查顺序
每轮必须按0→1→2→3→4→5→6逐表完成检查。
每张表只判断一件事：本轮最终正文是否出现该表负责的新事实，或最终事实是否与当前表已有记录不同。
有变化或新事实就insert/update/delete；没有就跳过该表并继续下一张。
不得因为前几张表没有变化、变化看起来很小、事情尚未结束、人物尚未建立关系，或认为“本轮没什么大事”而提前停止检查。
NO_CHANGE只能在0～6七张表全部检查完成、确认每一张都无需修改后使用。

二、字段归位
#0 当前状态表：日期、时间、地点、当前场景人物按正文最终落点维护。时间或地点只要实际不同就是变化，不另设重要性门槛；不要机械给时间+1分钟，按正文实际时间写。地点字段写最终地点/途中位置；“当前场景人物”只写当前实际在场人物，不把“正在回家、准备出发”等动作或目的地塞进人物字段。
#1 角色状态表：玩家本人已确认的新状态或变化。每项事实放入其对应字段：修为只写当前实际修炼体系/境界或“尚未修行”等修炼状态；灵根/体质写灵根/体质；身份写身份/所属；年龄、外貌、钱财等各归其位，不把多个概念混进一个字段。
#2 背包表：玩家当前实际持有物品。获得、消耗、交付、丢失、数量/品质/状态变化都按最终库存维护。
#3 当前任务与约定表：新任务、新约定、承诺、期限及其状态变化。
#4 人物主表：维护NPC稳定识别信息。只要某人物已经形成可持续识别的具体对象——例如已有明确姓名、稳定称呼、亲属/社会关系、身份或其他稳定识别事实——就应检查建档或补充，不再以“是否足够重要”为前置门槛。一次性路人、没有稳定身份且后续无法区分的人可不建档。同一人物优先update，不重复insert。
#5 人物发展表：对已追踪NPC维护本轮新确认或变化的发展锚点，必须写到正确姓名对应的行。“最后确认时间”只记录世界日期，精确到日即可，不要求时、分。
#6 历史事件表：既保存重大历史节点，也承接0～5没有合适字段但对后续剧情连续性有用的已发生事实。遇到已经发生、以后继续剧情需要知道的发现、异常、关键交互、决定、线索、关系转折或连续事件，即使尚未造成重大结果，也应检查是否需要压缩记录。同一连续事件优先更新同一条事件记录，不必每轮机械新增；纯氛围或无后续意义的琐碎动作不单独记录。

三、人物事实归属校验
在写表4或表5之前，先把每一条人物事实绑定到正文中明确的主体，再写入对应人物。
同一段正文出现多个人物时，逐人分开核对姓名/称呼、年龄、外貌、衣着、能力、地点、关系、目标等事实；事实只属于其明确主语、指代对象或能够唯一确认的对象，不因句子相邻、人物同为老人/少年、称呼相似或前后段落接近而串到另一人物。
例如一句“约花甲年纪”明确描述灰袍老道时，该年龄只能属于灰袍老道，不能写入同场或前文另一个老人。
如果某条事实的主体无法唯一确认，就暂不写这条事实；保留已经确认的其他人物事实即可。
人物表输出前做一次最终核对：拟写入的姓名是否就是该事实在正文中的主体；表5的姓名必须与目标row第一列人物完全一致。

四、事实冲突处理
如果正文中同一事实存在互相冲突的数值或描述，且正文没有明确说明哪一个取代另一个，不自行补算或猜测答案。保持当前已明确记录的状态，等待后续正文给出可确认的新事实；其他没有冲突的字段仍正常维护。

五、对象与rowIndex核对
当前表格是rowIndex的唯一依据。每个操作在输出前重新核对目标行。
表2/4/5使用额外对象核对参数：
updateRow(tableIndex,rowIndex,{columnIndex:"value"},"当前行第一列原值")
deleteRow(tableIndex,rowIndex,"当前行第一列原值")
最后一个字符串必须原样抄写执行前当前表该row的第一列对象名；它是安全校验，不代表要修改该名字。
例如删除“蛐蛐罐”前，若当前背包row=2的第一列是“蛐蛐罐”，应写 deleteRow(2,2,"蛐蛐罐")；如果row=0是“夹袍”，就绝不能写deleteRow(2,0,"蛐蛐罐")。
人物改名时，核对参数仍写更新前当前行的旧名称，新名称放进data的姓名列。
表2/4/5新增对象必须在data第0列写对象名；执行层会拦截同名重复insert。

六、完整输出
同一轮影响几张表就同时写几张，不因为已经写了其中一张就停止。
正常剧情中NO_CHANGE应很少见；它表示七表真的全部没有新事实或变化，不表示“没有大事”。
`;

function appendRules(text) {
    const source = String(text ?? '');
    if (source.includes(MARK)) return source;
    return `${source.trimEnd()}\n\n${AUDIT_RULES.trim()}`.trim();
}

function patchManualPrompt(text) {
    const source = String(text ?? '').trim();
    if (!source || source.includes(MARK)) return source;
    try {
        const messages = JSON5.parse(source);
        if (!Array.isArray(messages) || !messages.length) return source;
        messages.push({ role: 'system', content: AUDIT_RULES.trim() });
        return JSON.stringify(messages);
    } catch (error) {
        console.warn('[Memo-N] 手动填表提示词无法追加逐表审计规则，保留原值', error);
        return source;
    }
}

function patchSettings(settings) {
    if (!settings || typeof settings !== 'object') return;
    if ('message_template' in settings) settings.message_template = appendRules(settings.message_template);
    if ('refresh_system_message_template' in settings) settings.refresh_system_message_template = appendRules(settings.refresh_system_message_template);
    if ('refresh_user_message_template' in settings) settings.refresh_user_message_template = appendRules(settings.refresh_user_message_template);
    if ('step_by_step_user_prompt' in settings) settings.step_by_step_user_prompt = patchManualPrompt(settings.step_by_step_user_prompt);
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

console.log('[Memo-N] 逐表连续性审计v2已加载：字段归位、人物归属、表4建档与表6连续性检查已加强');
