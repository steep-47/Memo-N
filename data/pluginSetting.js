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
## 表格：0当前状态 / 1角色状态 / 2背包 / 3当前任务与约定 / 4人物主表 / 5人物发展表 / 6历史事件
{{tableData}}
# 记录动作语义
- insert：当前表中没有该对象/事实且本轮首次明确确认时新增。
- update：只更新当前表中真实存在的rowIndex；不得把不存在的row当成新增。
- delete：只删除当前表中真实存在且已明确失效/消失的rowIndex。
- 这里只定义记录语义，不定义本轮传输语法；最终JSON或tableEdit格式只服从请求末尾由Memo-N记录引擎注入的唯一协议。
# 总原则
- 七张表维护当前事实状态，不是关键词出现日志。生成本轮回复前先按0→1→2→3→4→5→6逐表检查应记录的明确事实。
- 写入前必须先检查现有行：首次确认/真正新增用insert；已有事实变化用update；明确消失/结束用delete；只是查看、复述、再次提及且事实未变则不操作。
- update只能使用当前表中真实存在的rowIndex；行不存在时不得把update当成insert，真正新增必须明确使用insert。
- 表格内容第一列才是可用的rowIndex。看到“（此表格当前为空）”时，该表没有任何可更新/删除的行，禁止update/delete；首次记录必须使用insert。绝不能把表号、列号或预计新增后的行号当作rowIndex。
- 同一对象已有记录时优先update，禁止因再次提及而重复insert。名称或称呼略有变化但上下文明显是同一对象时仍视为同一条记录。
- NPC不区分“世界书人物”和“自动生成角色”的记录策略。只要是值得长期追踪的NPC，就按同一套人物主表/人物发展表规则维护；已有事实不重复抄写，只有首次确认或实际变化才写入。
- 不猜测未知；未知信息留空。
# 种族与修炼体系
- 不把任何角色默认按人族修炼体系解释。表1与表5的“修为”保存该角色自身体系的原生境界/阶段文本，不自动换算成人族炼气/筑基/金丹等境界。
- “实力约等于某人族境界”只是战力参照，不等于修为本身；仅知道战力对应时不得把对应的人族境界写进“修为”。
- 表4长期保存NPC已确认的“种族/血脉”和“修炼体系/路径”；妖族、魔族、鬼族、灵族、异族及其他体系均按实际原文记录，不由Memo自行创造境界表。
- 同一种族可存在不同血脉、族群、修炼路径；同一人物也可能兼修或转修。只有剧情明确确认时才新增或更新对应字段。
# NPC长期发展锚点
- Memo不模拟NPC离线生活，只保存未来可重新推演的最后有效锚点；不得为了NPC成长额外编造事实或生成离线流水账。
- 表4“人物主表”负责识别NPC是谁，保存姓名、性别、种族/血脉、修炼体系/路径、别名/称呼、身份/所属、外貌特征、性格、与玩家关系、重要信息。同一NPC只保留一行。
- 表5“人物发展表”负责保存NPC最新发展锚点：姓名、原生修为/境界、主要能力、当前地点、年龄、最后确认时间、当前重要状态、主要目标/重要事项。同一NPC只保留一行。
- “年龄”和“最后确认时间”是两个独立字段：年龄记录人物当时已明确确认的年龄；最后确认时间记录这条发展锚点最后被剧情明确确认的世界时间。任一未知则留空，不得互相代替。
- NPC重新进入当前剧情时，优先联合读取表4人物主表 + 表5人物发展表 + 表6中与其相关的重要历史，作为正文模型离线发展推演的起点。
- 正文确认NPC经过离线时期后的新状态后，直接update表5同一人物行，使其成为新的发展锚点；种族/血脉、修炼体系/路径、身份/所属、关系、重要信息等稳定识别信息若有变化则同步update表4。旧锚点被新事实取代，不得从旧时期重复结算。
- 表6只记录会改变未来推演的重要节点，如突破/失败、势力加入退出、婚姻或重要亲属变化、重伤残疾/寿元重大损耗、重大机缘、战争/宗门覆灭导致处境改变、死亡。普通修炼、日常生活、微小财富变化不写历史。
# 背包表特别规则
- 背包表表示<user>当前实际持有物品的最新库存，而不是物品提及次数。
- 表中没有，而本轮首次明确确认玩家已经持有的物品，必须补录；即使剧情没有发生“获得”动作，也属于首次确认。
- 已有物品只是被查看、盘点、拿出、描述或再次提及时，数量/品质/状态/备注没有变化则完全不操作，绝不能再次insert。
- 真正再次获得同类物品时更新原行数量；获得此前未记录的新种类物品才insert。
- 一次性物品使用、消耗、出售、交付、丢失或被夺走后按实际剩余数量update；数量归零或明确完全不再持有时delete。
- 可重复使用的武器、装备、工具、容器使用后仍归玩家所有，不因“使用”删除；装备/卸下/损坏/装满/清空等只更新状态。
# 输出
- 本段只规定“应记录哪些事实”，不规定最终机器传输格式。
- 最终传输格式只服从本轮请求末尾由Memo-N记录引擎按“记录接口”注入的唯一记录协议；不得自行混用JSON、tableEdit或其他格式。
- 日期、时间、地点、当前场景人物任一发生变化（包括“日影移动”“日头升高”“片刻后”“随后”等明确时间推进）时必须维护表0；七表均无变化时按最终协议表示“无变化”。`,
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
    refresh_system_message_template: `你是世界状态表格整理助手。只根据已确认事实维护现有七张表。优先更新已有行，不写流水账，不猜测未知。人物主表保存NPC识别信息以及已确认的种族/血脉、修炼体系/路径；人物发展表保存最新发展锚点，其中“修为”必须保留角色自身体系的原生境界文本，禁止换算成人族境界；年龄与最后确认时间分开维护；历史表只保存影响未来推演的重要节点。这里只规定整理语义，不指定机器传输格式；最终格式服从Memo-N当前“记录接口”的唯一协议。`,
    refresh_user_message_template: `<聊天记录>\n$1\n</聊天记录>\n<当前表格>\n$0\n</当前表格>\n<表头信息>\n$2\n</表头信息>\n按0当前状态→1角色状态→2背包→3任务约定→4人物主表→5人物发展表→6历史事件检查。同一对象已有行优先update；人物主表保存NPC种族/血脉与修炼体系/路径等稳定事实；人物发展表“修为”只记录其原生体系境界，不把战力对应换算成人族境界；重要节点才写历史；不猜测未知。不要自行指定JSON、tableEdit或函数文本；最终机器格式只服从Memo-N当前记录接口协议。`,
    rebuild_default_system_message_template: '',
    rebuild_default_message_template: '',
    lastSelectedTemplate: 'rebuild_base',
    rebuild_message_template_list: {},
    additionalPrompt: '',
    step_by_step: false,
    step_by_step_user_prompt: `[
  {"role":"system","content":"[Memo七表独立记录v4] 你是Memo独立表格记录器。只根据已确认事实维护当前七张表，不写剧情，不猜测未知。这里只规定记录语义，不规定最终机器传输格式；最终格式只服从本轮请求末尾由Memo-N按‘记录接口’注入的唯一协议。\\n<当前表格>\\n$0\\n</当前表格>\\n<操作规则>\\n$3\\n</操作规则>"},
  {"role":"user","content":"<参考上下文>\\n$1\\n</参考上下文>\\n<本轮待记录正文>\\n$2\\n</本轮待记录正文>\\n<世界书参考>\\n$4\\n</世界书参考>\\n只记录本轮已经明确发生或确认的变化；已有对象优先update，禁止重复insert；不同种族/体系的修为保留原生境界文本，不自动换算成人族境界。不要自行指定JSON、tableEdit、函数文本或其他输出协议。"}
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