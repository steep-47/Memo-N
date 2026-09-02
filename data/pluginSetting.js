import { EDITOR } from '../core/manager.js';
import { switchLanguage } from '../services/translate.js';

export async function filterTableDataPopup(originalData, title, warning) {
    const confirmation = new EDITOR.Popup(
        $('<div></div>')
            .append($(`<span>${title}</span>`))
            .append('<br>')
            .append($(`<span style="color: rgb(211, 39, 39)">${warning}</span>`)),
        EDITOR.POPUP_TYPE.CONFIRM,
        '',
        { okButton: '继续', cancelButton: '取消' },
    );
    await confirmation.show();
    return { filterData: confirmation.result ? originalData : null, confirmation: !!confirmation.result };
}

export const defaultSettings = await switchLanguage('__defaultSettings__', {
    isExtensionAble: true,
    tableDebugModeAble: false,
    isAiReadTable: true,
    isAiWriteTable: true,
    updateIndex: 6,
    injection_mode: 'deep_system',
    deep: 1,
    message_template: `# dataTable 世界状态记忆
## 当前六表：0时空 / 1角色特征 / 2角色与社交 / 3任务命令约定 / 4重要事件历史 / 5重要物品
{{tableData}}
# 记录动作语义
- insert：当前表中没有该对象/事实且本轮首次明确确认时新增。
- update：只更新当前表中真实存在的rowIndex；不得把不存在的row当成新增。
- delete：只删除当前表中真实存在且已明确失效/消失的rowIndex。
- 这里只定义记录语义，不锁死机器传输格式；最终格式只服从本轮Memo-N记录接口注入的协议。
# 总原则
- 六张表维护当前成立、对后续有用的世界状态与重要记忆，不是只记录“发生变化”的日志。
- 每轮先检查本轮最终正文明确给出的当前事实，再与现有表逐项比较：表中缺少但已经明确成立、且属于该表职责的事实，也属于应记录内容；已有事实改变才update；明确失效按对应表规则delete；纯复述且表中已经完整存在才不操作。
- 开局、首次建表或相关表为空时，要从本轮最终正文主动建立当前状态基线。角色姓名、年龄、种族、修为、身份、稳定能力/功法等明确角色资料应进入角色特征表；当前日期/时间/地点/在场人物应进入时空表；值得持续追踪的任务、关系、重要事件和重要物品按各表职责记录。
- update/delete只能使用当前表第一列真实存在的rowIndex；空表首次记录只能insert。
- 不猜测未知，不把模型内部reasoning、草稿、候选方案或最终正文未采用的内容写入表格。
- 伊依是后台陪伴者，不是剧情世界实体；伊依自身关系、情绪与共同经历只进入伊依独立长期记忆，不写入世界六表。
# 六表职责
- 表0“时空表格”：保留当前日期、时间、地点（当前描写）、此地角色；开局或本表为空时根据正文建立一行，之后时空或在场人物变化时更新，原则上保持一行。
- 表1“角色特征表格”：记录角色已经明确的稳定或持续资料，包括姓名对应的年龄、种族、身体特征、性格、职业/身份、修为/能力、功法术法、爱好喜恶和其他重要信息；首次出现这些明确资料时即应建行，不要求它们必须相对上一轮发生变化。
- 表2“角色与社交表格”：记录角色与<user>的关系、态度、好感度及重要社交关系；本轮首次明确关系信息时建行，同一角色后续优先更新已有行。
- 表3“任务、命令或者约定表格”：记录仍需执行或遵守的任务、命令、约定及其完成条件、状态和负责人；已明确完成、取消或失效时按表规则删除。
- 表4“重要事件历史表格”：记录以后仍值得记住的重要既成事件及其影响，不把普通日常写成流水账。
- 表5“重要物品表格”：记录对某人贵重、具有特殊意义或以后仍值得追踪的物品及其当前状态；普通库存不因此全部写入，但正文明确其特殊意义、关键用途或持续追踪价值时应记录。
# 输出
- 本段只规定“应记录哪些事实”，不规定最终机器格式。
- 最终JSON变化块或<tableEdit>格式只服从本轮Memo-N按“记录接口”注入的唯一协议，不得自行混用。
- 只有逐表比较后，当前应保存的事实都已完整存在且没有新增、变化或失效时，才按最终协议表示无变化。`,
    isTableToChat: false,
    show_settings_in_extension_menu: true,
    alternate_switch: true,
    show_drawer_in_extension_list: true,
    table_to_chat_can_edit: false,
    table_to_chat_mode: 'context_bottom',
    to_chat_container: `<div class="table-preview-bar"><details><summary style="display:flex;justify-content:space-between"><span>记忆增强表格</span></summary>$0</details></div>`,
    confirm_before_execution: true,
    custom_temperature: 1.0,
    custom_max_tokens: 2048,
    custom_top_p: 1,
    bool_ignore_del: true,
    ignore_user_sent: false,
    clear_up_stairs: 9,
    use_token_limit: true,
    rebuild_token_limit_value: 10000,
    refresh_system_message_template: `你是Memo-N世界状态表格整理助手。根据已确认事实整理当前实际启用的六张标准表；当前已明确成立但表中缺失的事实需要补齐，已有对象优先update，真正新增才insert，明确失效才delete。开局或空表应建立当前状态基线。不写剧情、不猜测未知、不把普通日常改成流水账。表头和表序由当前实际表格决定。最终机器格式只服从Memo-N当前“记录接口”注入的唯一协议。`,
    refresh_user_message_template: `<聊天记录>\n$1\n</聊天记录>\n<当前表格>\n$0\n</当前表格>\n<表头信息>\n$2\n</表头信息>\n逐表比较聊天中已经明确成立的当前事实与实际表格：补齐缺失基线，合并重复，更新变化，处理过期和错位；保持事实最小化，不创造未知信息。不要自行指定JSON、tableEdit或函数文本；最终机器格式只服从Memo-N当前记录接口协议。`,
    rebuild_default_system_message_template: `你是Memo-N世界状态表格整理器。根据已确认事实维护当前实际启用的表格；当前已明确成立但表中缺失的事实需要补齐，开局或空表要建立当前状态基线。表头和表序以本轮提供的真实表格为准，不创建、删除、改名或重排标准列。已有对象优先update，真正新增才insert，明确失效才delete。不写剧情、不猜测未知。最终机器格式只服从Memo-N当前“记录接口”注入的唯一协议。`,
    rebuild_default_message_template: `<当前表格>\n$0\n</当前表格>\n<最近聊天>\n$1\n</最近聊天>\n<当前真实表头>\n$2\n</当前真实表头>\n<附加要求>\n$3\n</附加要求>\n按当前实际表序逐表比较已确认事实与表格：补齐当前缺失基线、合并重复、更新变化并处理过期错位；不要为了“更完整”编造未知信息。`,
    lastSelectedTemplate: 'rebuild_base',
    rebuild_message_template_list: {},
    additionalPrompt: '',
    step_by_step: false,
    step_by_step_user_prompt: `[
  {"role":"system","content":"[Memo当前表格独立记录v5] 你是Memo-N独立表格记录器。根据已确认事实维护当前实际启用的表格：本轮最终正文中已经明确成立、属于表格职责但当前表中缺失的事实也必须补齐；开局或空表要建立当前状态基线。不写剧情，不猜测未知。表号、列号和rowIndex只以本轮提供的真实表格为准；最终机器格式只服从本轮请求末尾由Memo-N按‘记录接口’注入的唯一协议。\\n<当前表格>\\n$0\\n</当前表格>\\n<操作规则>\\n$3\\n</操作规则>"},
  {"role":"user","content":"<参考上下文>\\n$1\\n</参考上下文>\\n<本轮待记录正文>\\n$2\\n</本轮待记录正文>\\n<世界书参考>\\n$4\\n</世界书参考>\\n逐表比较本轮最终正文已经明确成立的事实与当前表格：缺失则insert，已有且变化则update，明确失效则delete；只有应保存事实已经完整存在且没有任何变化时才返回无变化。不要自行指定JSON、tableEdit、函数文本或其他输出协议。"}
]`,
    bool_silent_refresh: false,
    separateReadContextLayers: 1,
    separateReadLorebook: false,
    tableStructure: [
        {tableName:'时空表格',tableIndex:0,columns:['日期','时间','地点（当前描写）','此地角色'],enable:true,Required:true,asStatus:true,toChat:true,note:'用于记录时空信息的表格，应保持只有一行',initNode:'开局、本表为空或首次获得当前场景信息时，根据正文插入当前日期、时间、地点和在场角色；已明确的字段应记录，未知字段留空。',updateNode:'当描写场景、时间或角色发生变化时',deleteNode:'如果本表超过一行，应删除多余行'},
        {tableName:'角色特征表格',tableIndex:1,columns:['角色名','身体特征','性格','职业','爱好','喜欢的事物','讨厌的事物','备注'],enable:true,Required:true,asStatus:true,toChat:true,note:'记录角色已经明确的稳定或持续个人资料；年龄、种族、修为、身份、功法、术法等没有独立列时写入备注。',initNode:'本轮从最终正文中找出已明确的角色资料并建立基线；角色名不能为空。',insertNode:'本轮出现表中没有的新角色，并明确给出任一值得持续记忆的资料时插入；包括年龄、种族、修为、身份、功法、术法等。',updateNode:'角色稳定资料发生明确变化，或获得当前行尚未记录的新长期信息时。',deleteNode:''},
        {tableName:'角色与社交表格',tableIndex:2,columns:['角色名','对<user>关系','对<user>态度','对<user>好感度','社交圈','与其他角色关系','备注'],enable:true,Required:true,asStatus:true,toChat:true,note:'记录角色与<user>及其他角色之间的重要社交状态。',initNode:'本轮从最终正文中找出已明确的社交关系并建立基线，角色名不能为空。',insertNode:'本轮出现表中没有的新角色且已经明确关系、态度、好感或重要社交信息时插入。',updateNode:'角色关系、态度、好感或重要社交关系发生明确变化，或当前行缺少本轮新确认的重要社交信息时。',deleteNode:''},
        {tableName:'任务、命令或者约定表格',tableIndex:3,columns:['角色','任务','地点','持续时间','完成条件','状态','负责人','备注'],enable:true,Required:false,asStatus:true,toChat:true,note:'记录仍需执行或遵守的任务、命令和约定。',insertNode:'出现新的任务、命令或约定时。',updateNode:'执行状态、负责人、地点、期限或完成条件发生明确变化时。',deleteNode:'任务、命令或约定明确完成、取消或失效且无需继续追踪时。'},
        {tableName:'重要事件历史表格',tableIndex:4,columns:['角色','事件简述','日期','地点','情绪','影响','相关人物','备注'],enable:true,Required:true,asStatus:true,toChat:true,note:'记录以后仍值得记住的重要既成事件。',initNode:'本轮从上下文中找出值得长期保留的重要事件并插入。',insertNode:'发生对人物、关系、目标或后续剧情有持续影响的重要事件时。',updateNode:'已有事件的影响或关联信息获得明确补充时。',deleteNode:''},
        {tableName:'重要物品表格',tableIndex:5,columns:['拥有人','物品描述','物品名','重要原因','当前状态','地点','备注'],enable:true,Required:false,asStatus:true,toChat:true,note:'记录贵重、具有特殊意义或以后仍值得追踪的物品。',insertNode:'某人获得贵重、关键、具有特殊意义或以后需要持续追踪的物品，或已有物品获得特殊意义时。',updateNode:'物品所有权、状态、地点或重要意义发生明确变化时。',deleteNode:'物品明确永久失去、销毁且无需继续追踪时。'},
    ],
});