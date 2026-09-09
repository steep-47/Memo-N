import { APP, USER } from '../../core/manager.js';
import { defaultSettings } from '../../data/pluginSetting.js';
import JSON5 from '../../utils/json5.min.mjs';

const MARK = '[Memo-N逐表连续性审计v4]';
const OLD_MARK_RE = /\[Memo-N逐表连续性审计v\d+\]/;

const AUDIT_RULES = `
${MARK}
以下规则是Memo-N当前最终记录判断，优先级高于前文关于“重要变化”“重大事件”“避免流水账”以及旧版逐表审计的表述。

一、固定检查顺序
每轮必须按0→1→2→3→4→5→6逐表完成检查。
每张表只判断一件事：本轮最终正文是否出现该表负责的新事实，或最终事实是否与当前表已有记录不同。
有变化或新事实就insert/update/delete；没有就跳过该表并继续下一张。
不得因为前几张表没有变化、变化看起来很小、事情尚未结束、人物尚未建立关系，或认为“本轮没什么大事”而提前停止检查。
NO_CHANGE只能在0～6七张表全部检查完成、确认每一张都无需修改后使用。

二、先拆事实，再决定字段
不要把一句话或一个短语整体塞进某个看起来最接近的字段。先把正文拆成最小、彼此独立的已确认事实，再分别判断每条事实属于哪张表、哪个字段。
同一句话同时包含身份、境界、经历、持续状态、外貌、地点等多个概念时，应拆开分别记录；某个字段只保存它本身负责的事实，不吸收相邻概念。
字段名回答什么，就只写什么：没有对应字段的事实再判断是否进入“重要信息”“当前重要状态”或表6，而不是改造其他字段去容纳它。

修炼相关事实严格按性质分开：
- “修炼体系/路径”是人物的修行类别/路线标签，只写简短、稳定、可复用的名称，不写解释句。基础类别按已确认修炼机制判断：已确认走人族灵根→法力→炼气等常规修仙机制者记“练气士”；已确认妖族开启灵智并实际修行、使用妖力或进入妖族1～10级等体系者记“妖修”；已确认灵族达到可自主修行阶段并按本源/灵体体系修炼者记“灵修”；已确认走一至九品等凡俗武道者记“武夫”。
- 具体主修/兼修路线在剧情或世界设定已经明确后追加，例如“法修”“体修”“剑修”“魂修”“旁门”“丹师”“器师”“符师”“阵师”“御兽”等；存在多个已确认标签时用“／”连接，例如“练气士／剑修”。只记录已经成为稳定修行路线、身份或职业的标签，不因拿剑战斗一次就判为剑修，也不因炼过一次丹就判为丹师。
- 基础类别不能只靠种族猜：人族可能仍是凡人、武夫或其他路径；普通野兽不等于妖修；仅有朦胧灵性、尚未达到自主修行阶段的灵物不等于灵修。必须结合人物已经确认的修行事实判断。
- “修为/境界”回答“这个角色当前处于什么境界/阶段”。只写当前境界或阶段本身，例如“炼气中段”；不把修炼体系、年龄、持续年限、瓶颈原因、经历等附在修为字段里。
- 修炼经历、长期停滞、瓶颈、受伤、特殊限制等，按事实性质写入表4“重要信息”或表5“当前重要状态”；例如“早年曾引气入体”属于经历，“多年未进”属于长期状态，而不是体系/路径标签或境界名称。

三、七表职责与字段归位
#0 当前状态表：日期、时间、地点、当前场景人物按正文最终落点维护。时间或地点只要实际不同就是变化，不另设重要性门槛；不要机械给时间+1分钟，按正文实际时间写。地点字段写最终地点/途中位置；“当前场景人物”只写当前实际在场人物，不把“正在回家、准备出发”等动作或目的地塞进人物字段。
#1 角色状态表：玩家本人已确认的新状态或变化。每项事实放入其对应字段：修为只写当前实际境界/阶段或“尚未修行”等修炼状态；灵根/体质写灵根/体质；身份写身份/所属；年龄、外貌、钱财等各归其位，不把多个概念混进一个字段。
#2 背包表：玩家当前实际持有物品。获得、消耗、交付、丢失、数量/品质/状态变化都按最终库存维护。
#3 当前任务与约定表：新任务、新约定、承诺、期限及其状态变化。
#4 人物主表：维护NPC稳定识别信息。只要某人物已经形成可持续识别的具体对象——例如已有明确姓名、稳定称呼、亲属/社会关系、身份或其他稳定识别事实——就应检查建档或补充，不再以“是否足够重要”为前置门槛。一次性路人、没有稳定身份且后续无法区分的人可不建档。同一人物优先update，不重复insert。“修炼体系/路径”按上面的规范化标签语义维护；人物过去的重要修炼经历可进入“重要信息”。
#5 人物发展表：对已追踪NPC维护本轮新确认或变化的发展锚点，必须写到正确姓名对应的行。“修为”只写当前境界/阶段；当前瓶颈、长期停滞、伤势或其他持续发展状态写“当前重要状态”。“最后确认时间”只记录世界日期，精确到日即可，不要求时、分。
#6 历史事件表：既保存重大历史节点，也承接0～5没有合适字段但对后续剧情连续性有用的已发生事实。遇到已经发生、以后继续剧情需要知道的发现、异常、关键交互、决定、线索、关系转折或连续事件，即使尚未造成重大结果，也应检查是否需要压缩记录。同一连续事件优先更新同一条事件记录，不必每轮机械新增；纯氛围或无后续意义的琐碎动作不单独记录。

四、人物事实归属校验
在写表4或表5之前，先把每一条人物事实绑定到正文中明确的主体，再写入对应人物。
同一段正文出现多个人物时，逐人分开核对姓名/称呼、年龄、外貌、衣着、能力、地点、关系、目标等事实；事实只属于其明确主语、指代对象或能够唯一确认的对象，不因句子相邻、人物同为老人/少年、称呼相似或前后段落接近而串到另一人物。
例如一句“约花甲年纪”明确描述灰袍老道时，该年龄只能属于灰袍老道，不能写入同场或前文另一个老人。
如果某条事实的主体无法唯一确认，就暂不写这条事实；保留已经确认的其他人物事实即可。
人物表输出前做一次最终核对：拟写入的姓名是否就是该事实在正文中的主体；表5的姓名必须与目标row第一列人物完全一致。

五、事实冲突处理
如果正文中同一事实存在互相冲突的数值或描述，且正文没有明确说明哪一个取代另一个，不自行补算或猜测答案。保持当前已明确记录的状态，等待后续正文给出可确认的新事实；其他没有冲突的字段仍正常维护。

六、对象与rowIndex核对
当前表格是rowIndex的唯一依据。每个操作在输出前重新核对目标行。
表2/4/5使用额外对象核对参数：
updateRow(tableIndex,rowIndex,{columnIndex:"value"},"当前行第一列原值")
deleteRow(tableIndex,rowIndex,"当前行第一列原值")
最后一个字符串必须原样抄写执行前当前表该row的第一列对象名；它是安全校验，不代表要修改该名字。
例如删除“蛐蛐罐”前，若当前背包row=2的第一列是“蛐蛐罐”，应写 deleteRow(2,2,"蛐蛐罐")；如果row=0是“夹袍”，就绝不能写deleteRow(2,0,"蛐蛐罐")。
人物改名时，核对参数仍写更新前当前行的旧名称，新名称放进data的姓名列。
表2/4/5新增对象必须在data第0列写对象名；执行层会拦截同名重复insert。

七、完整输出
同一轮影响几张表就同时写几张，不因为已经写了其中一张就停止。
正常剧情中NO_CHANGE应很少见；它表示七表真的全部没有新事实或变化，不表示“没有大事”。
`;

function stripOldAudit(text) {
    const source = String(text ?? '');
    const match = OLD_MARK_RE.exec(source);
    if (!match) return source;
    return source.slice(0, match.index).trimEnd();
}

function appendRules(text) {
    const source = stripOldAudit(text);
    return `${source.trimEnd()}\n\n${AUDIT_RULES.trim()}`.trim();
}

function patchManualPrompt(text) {
    const source = String(text ?? '').trim();
    if (!source) return source;
    try {
        const messages = JSON5.parse(source);
        if (!Array.isArray(messages) || !messages.length) return source;
        const cleaned = messages.filter(message => !OLD_MARK_RE.test(String(message?.content ?? '')));
        cleaned.push({ role: 'system', content: AUDIT_RULES.trim() });
        return JSON.stringify(cleaned);
    } catch (error) {
        console.warn('[Memo-N] 手动填表提示词无法更新逐表审计规则，保留原值', error);
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
    data.messages = data.messages.filter(message => !OLD_MARK_RE.test(String(message?.content ?? '')));
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

console.log('[Memo-N] 逐表连续性审计v4已加载：修炼体系/路径改为规范化修行类别与路线标签');
