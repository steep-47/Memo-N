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
- 六张表维护对后续仍有用的事实状态与重要记忆，不是关键词出现日志。
- 写入前先检查现有行：首次确认/真正新增用insert；已有事实变化用update；明确失效按对应表规则delete；只是复述或再次提及且事实未变则不操作。
- update/delete只能使用当前表第一列真实存在的rowIndex；空表首次记录只能insert。
- 不猜测未知，不把模型内部reasoning、草稿、候选方案或最终正文未采用的内容写入表格。
- 伊依是后台陪伴者，不是剧情世界实体；伊依自身关系、情绪与共同经历只进入伊依独立长期记忆，不写入世界六表。
# 六表职责
- 表0“时空表格”：只保留当前日期、时间、地点（当前描写）、此地角色；时空或在场人物变化时更新，原则上保持一行。
- 表1“角色特征表格”：记录角色较稳定或持续的身体特征、性格、职业、爱好、喜欢的事物、住所和其他重要信息；不要因一次性状态重复建行。
- 表2“角色与社交表格”：记录角色与<user>的关系、态度和好感度等社交状态；同一角色优先更新已有行。
- 表3“任务、命令或者约定表格”：记录仍需执行或遵守的任务、命令、约定及地点/持续时间；已明确完成、取消或失效时按表规则删除。
- 表4“重要事件历史表格”：只记录以后仍值得记住的重要既成事件，不把普通日常写成流水账。
- 表5“重要物品表格”：只记录对某人贵重、具有特殊意义或以后仍值得追踪的物品；普通库存不因此全部写入。
# 输出
- 本段只规定“应记录哪些事实”，不规定最终机器格式。
- 最终JSON变化块或<tableEdit>格式只服从本轮Memo-N按“记录接口”注入的唯一协议，不得自行混用。
- 六表均无明确变化时按最终协议表示无变化。`,
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
    refresh_system_message_template: `你是Memo-N世界状态表格整理助手。只根据已确认事实整理当前实际启用的六张标准表；不写剧情、不猜测未知、不把普通日常改成流水账。表头和表序由当前实际表格决定。已有对象优先update，真正新增才insert，明确失效才delete。最终机器格式只服从Memo-N当前“记录接口”注入的唯一协议。`,
    refresh_user_message_template: `<聊天记录>\n$1\n</聊天记录>\n<当前表格>\n$0\n</当前表格>\n<表头信息>\n$2\n</表头信息>\n逐表检查当前实际表格中的重复、过期、错位和需要合并的数据；保持事实最小化，不创造未知信息。不要自行指定JSON、tableEdit或函数文本；最终机器格式只服从Memo-N当前记录接口协议。`,
    rebuild_default_system_message_template: `你是Memo-N世界状态表格整理器。只整理当前实际启用的表格，不写剧情、不猜测未知。表头和表序以本轮提供的真实表格为准，不创建、删除、改名或重排标准列。已有对象优先update，真正新增才insert，明确失效才delete。最终机器格式只服从Memo-N当前“记录接口”注入的唯一协议。`,
    rebuild_default_message_template: `<当前表格>\n$0\n</当前表格>\n<最近聊天>\n$1\n</最近聊天>\n<当前真实表头>\n$2\n</当前真实表头>\n<附加要求>\n$3\n</附加要求>\n按当前实际表序逐表检查重复、过期、错位和应合并的数据；不要为了“更完整”编造未知信息。`,
    lastSelectedTemplate: 'rebuild_base',
    rebuild_message_template_list: {},
    additionalPrompt: '',
    step_by_step: false,
    step_by_step_user_prompt: `[
  {"role":"system","content":"[Memo当前表格独立记录v5] 你是Memo-N独立表格记录器。只根据已确认事实维护当前实际启用的表格，不写剧情，不猜测未知。表号、列号和rowIndex只以本轮提供的真实表格为准；最终机器格式只服从本轮请求末尾由Memo-N按‘记录接口’注入的唯一协议。\\n<当前表格>\\n$0\\n</当前表格>\\n<操作规则>\\n$3\\n</操作规则>"},
  {"role":"user","content":"<参考上下文>\\n$1\\n</参考上下文>\\n<本轮待记录正文>\\n$2\\n</本轮待记录正文>\\n<世界书参考>\\n$4\\n</世界书参考>\\n只记录本轮最终正文已经明确发生或确认的变化；已有对象优先update，禁止重复insert。不要自行指定JSON、tableEdit、函数文本或其他输出协议。"}
]`,
    bool_silent_refresh: false,
    separateReadContextLayers: 1,
    separateReadLorebook: false,
    tableStructure: [
        {tableName:'时空表格',tableIndex:0,columns:['日期','时间','地点（当前描写）','此地角色'],enable:true,Required:true,asStatus:true,toChat:true,note:'用于记录时空信息的表格，应保持只有一行',initNode:'本轮需要使用insertRow函数记录当前时间、地点、角色信息',updateNode:'当描写场景、时间或角色发生变化时',deleteNode:'如果本表超过一行，应删除多余行'},
        {tableName:'角色特征表格',tableIndex:1,columns:['角色名','身体特征','性格','职业','爱好','喜欢的事物（作品、角色、物品等）','住所','其他重要信息'],enable:true,Required:true,asStatus:true,toChat:true,note:'记录角色先天或难以改变的特征。本轮若这些角色出现，需要考虑其应有反应。',initNode:'本轮必须从上下文中找出所有已知角色并使用insertRow插入，角色名不能为空。',insertNode:'本轮出现表中没有的新角色时应插入。',updateNode:'角色身体发生持续性变化，例如伤疤 / 角色产生新的爱好、职业、喜欢的事物 / 角色改变住所 / 角色提到重要信息时。',deleteNode:''},
        {tableName:'角色与社交表格',tableIndex:2,columns:['角色名','对<user>关系','对<user>态度','对<user>好感度'],enable:true,Required:true,asStatus:true,toChat:true,note:'角色与<user>互动时应考虑其态度。',initNode:'本轮必须从上下文中找出所有已知角色并使用insertRow插入，角色名不能为空。',insertNode:'本轮出现表中没有的新角色时应插入。',updateNode:'角色与<user>的互动已不符合现有记录 / 角色与<user>的关系发生变化时。',deleteNode:''},
        {tableName:'任务、命令或者约定表格',tableIndex:3,columns:['角色','任务','地点','持续时间'],enable:true,Required:false,asStatus:true,toChat:true,note:'本轮应考虑是否存在需要执行的任务或遵守的约定。',insertNode:'约定在特定时间一起做某事 / 角色收到需要完成某事的命令或任务时。',updateNode:'',deleteNode:'所有人完成约定 / 任务或命令完成 / 任务、命令或约定被取消时。'},
        {tableName:'重要事件历史表格',tableIndex:4,columns:['角色','事件简述','日期','地点','情绪'],enable:true,Required:true,asStatus:true,toChat:true,note:'记录<user>或角色经历的重要事件。',initNode:'本轮必须从上下文中找出可插入的重要事件并使用insertRow插入。',insertNode:'角色经历值得记忆的重要事件，例如告白、分手等。',updateNode:'',deleteNode:''},
        {tableName:'重要物品表格',tableIndex:5,columns:['拥有人','物品描述','物品名','重要原因'],enable:true,Required:false,asStatus:true,toChat:true,note:'对某人非常贵重或具有特殊纪念意义的物品。',insertNode:'某人获得贵重或具有特殊意义的物品 / 已有物品获得特殊意义时。',updateNode:'',deleteNode:''},
    ],
});