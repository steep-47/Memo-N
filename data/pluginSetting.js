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
    independent_record_api_enabled: false,
    compact_story_context: true,
    updateIndex: 6,
    injection_mode: 'deep_system',
    deep: 1,
    message_template: `# dataTable 世界状态记忆
## 表格：0当前状态 / 1角色状态 / 2背包 / 3当前任务与约定 / 4人物主表 / 5人物发展表 / 6历史事件
{{tableData}}
# 操作
insertRow(tableIndex:number,data:{[colIndex:number]:string|number})
updateRow(tableIndex:number,rowIndex:number,data:{[colIndex:number]:string|number})
deleteRow(tableIndex:number,rowIndex:number)
# 总原则
- 七张表维护当前事实状态，不是关键词出现日志。先在内部确定完整本轮回复和玩家下次输入前的最终落点，再按0→1→2→3→4→5→6逐表检查应记录的明确事实。
- 写入前必须先检查现有行：首次确认/真正新增用insert；已有事实变化用update；明确消失/结束用delete；只是查看、复述、再次提及且事实未变则不操作。
- updateRow只能使用当前表中真实存在的rowIndex；行不存在时不得把update当成insert，真正新增必须明确使用insertRow。
- 表格内容第一列才是可用的rowIndex。看到“（此表格当前为空）”时，该表没有任何可更新/删除的行，禁止updateRow/deleteRow；首次记录必须使用insertRow。绝不能把表号、列号或预计新增后的行号当作rowIndex。
- 当前表格内容是本轮判断行是否存在及rowIndex的唯一依据。旧聊天、导入记录和历史tableEdit只可用于确认剧情事实，不能证明某行现在存在；两者冲突时服从当前表格，缺失事实重新insert，不按历史插入顺序猜行号。
- 同一对象已有记录时优先update，禁止因再次提及而重复insert。名称或称呼略有变化但上下文明显是同一对象时仍视为同一条记录。
- NPC不区分“世界书人物”和“自动生成角色”的记录策略。只要是值得长期追踪的NPC，就按同一套人物主表/人物发展表规则维护；已有事实不重复抄写，只有首次确认或实际变化才写入。
- 不猜测未知；未知信息留空。
- 表中字段空缺不代表事实未知；当前上下文或本轮状态栏已有明确现值时按漏记修复补齐。数字0是有效值，不按空白处理。
# 种族与修炼体系
- 不把任何角色默认按人族修炼体系解释。表1与表5的“修为”保存该角色自身体系的原生境界/阶段文本，不自动换算成人族炼气/筑基/金丹等境界。
- 表1“外貌特征”保存玩家本人已明确确认的稳定外观和持久变化；未知留空，不根据姓名、性别、种族或年龄推断。
- 表1“身份/所属”保存玩家已确认的当前稳定身份、组织或势力归属；“别名/称号”保存已确认的别名、化名、道号、称号等持续可识别称谓。两者都不是临时状态，不应塞进“其他状态”。
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
- 钱、金银铜钱、灵石等作为通用余额结算的货币写入角色状态表的钱财/灵石字段，不进入背包；仅有价格、可以出售或可兑换的普通物品仍是物品，不算货币。
- 表中没有，而本轮首次明确确认玩家已经持有的物品，必须补录；即使剧情没有发生“获得”动作，也属于首次确认。
- 已有物品只是被查看、盘点、拿出、描述或再次提及时，数量/品质/状态/备注没有变化则完全不操作，绝不能再次insert。
- 真正再次获得同类物品时更新原行数量；获得此前未记录的新种类物品才insert。
- 一次性物品使用、消耗、出售、交付、丢失或被夺走后按实际剩余数量update；数量归零或明确完全不再持有时delete。
- 可重复使用的武器、装备、工具、容器使用后仍归玩家所有，不因“使用”删除；装备/卸下/损坏/装满/清空等只更新状态。
# 钱财戳、状态戳与背包边界
- 钱财戳只表示玩家当前实际持有的货币余额。钱、金银铜钱、灵石等明确通货分别写入表1的“钱财”或“灵石”；数字0仍是有效余额。
- 状态戳表示玩家当前持续资源和生效状态。灵力、神识写同名字段；体力、伤势等写“身体状态”；其他明确资源、增益、异常或限制写“其他状态”。
- 普通装备、工具、文书、材料、丹药、符箓和生活物资只写背包。明确作为通用货币余额使用的灵石即使能够消耗修炼，也不重复写背包；特殊封存、镶嵌或任务指定的灵石物件按物品处理。
- 交易或兑换后，货币余额与获得/失去的普通物品按实际结果分别更新；同一对象不在钱财字段、状态字段和背包之间重复记录。
# 输出
- Memo-N会在最终请求阶段提供唯一的一次API记录协议。changes记录块虽然先输出，但其内容必须以内部已经确定的完整正文和最终落点为准，再正常输出该正文。
- changes只使用结构化insert/update/delete对象；机器记录会在生成结束后从正常正文中移除。
- 表0记录玩家下次输入前的最终日期、时间、地点和场景人物；正文经过多个时段或地点时记录最后落点，不照抄开头状态栏。只有七表当前事实全部一致且没有待补漏项时changes才为空数组。`,
    isTableToChat: false,
    show_settings_in_extension_menu: true,
    alternate_switch: true,
    show_drawer_in_extension_list: true,
    table_to_chat_can_edit: false,
    table_to_chat_mode: 'context_bottom',
    to_chat_container: `<div class="table-preview-bar"><details><summary style="display:flex;justify-content:space-between"><span>记忆增强表格</span></summary>$0</details></div>`,
    confirm_before_execution: true,
    use_main_api: true,
    custom_temperature: 1.0,
    custom_max_tokens: 2048,
    custom_top_p: 1,
    bool_ignore_del: true,
    ignore_user_sent: false,
    clear_up_stairs: 9,
    use_token_limit: true,
    rebuild_token_limit_value: 10000,
    refresh_system_message_template: `你是世界状态表格整理助手。只根据已确认事实维护现有七张表。当前表格是行存在与rowIndex的唯一依据；旧聊天、导入记录和历史tableEdit不证明当前行存在。优先更新当前已有行，空表只插入，不按历史推算行号，不写流水账，不猜测未知。玩家角色状态表除当前资源与状态外，也维护已确认的身份/所属、别名/称号、稳定能力与外貌；玩家货币余额写角色状态表的钱财/灵石，持续资源与生效状态写角色状态表相应字段，普通物品只写背包且不与货币重复。人物主表保存NPC识别信息以及已确认的种族/血脉、修炼体系/路径；人物发展表保存最新发展锚点，其中“修为”必须保留角色自身体系的原生境界文本，禁止换算成人族境界；年龄与最后确认时间分开维护；历史表只保存影响未来推演的重要节点。只输出<tableEdit>。`,
    refresh_user_message_template: `<聊天记录>\n$1\n</聊天记录>\n<当前表格>\n$0\n</当前表格>\n<表头信息>\n$2\n</表头信息>\n当前表格优先于旧聊天和历史tableEdit；rowIndex只抄当前表格第一列并核对对象，当前空表不得update/delete，历史中存在而当前缺失的事实按需重新insert。按0当前状态→1角色状态→2背包→3任务约定→4人物主表→5人物发展表→6历史事件检查。表1中身份/所属、别名/称号、稳定能力和外貌按各自字段职责维护；钱、金银铜钱、通用灵石等货币余额只进角色状态表；灵力、神识、体力等持续状态进角色状态表相应字段；普通物品只进背包，不跨表重复。同一对象已有行优先update；人物主表保存NPC种族/血脉与修炼体系/路径等稳定事实；人物发展表“修为”只记录其原生体系境界，不把战力对应换算成人族境界；重要节点才写历史；不猜测未知。函数放在<tableEdit><!-- ... --></tableEdit>中。`,
    rebuild_default_system_message_template: '',
    rebuild_default_message_template: '',
    lastSelectedTemplate: 'rebuild_base',
    rebuild_message_template_list: {},
    additionalPrompt: '',
    step_by_step: false,
    step_by_step_use_main_api: true,
    step_by_step_user_prompt: `[
  {"role":"system","content":"你是Memo独立表格记录器。只根据已确认事实维护当前七张表，不写剧情，不猜测未知。严格遵守以下当前表格与操作规则。最终只输出一个完整<tableEdit>...</tableEdit>；无变化输出<tableEdit><!-- NO_CHANGE --></tableEdit>。\\n<当前表格>\\n$0\\n</当前表格>\\n<操作规则>\\n$3\\n</操作规则>"},
  {"role":"user","content":"<参考上下文>\\n$1\\n</参考上下文>\\n<本轮待记录正文>\\n$2\\n</本轮待记录正文>\\n<世界书参考>\\n$4\\n</世界书参考>\\n只记录本轮已经明确发生或确认的变化；当前表格是行存在与rowIndex的唯一依据，旧聊天和历史操作不得用来猜行号，空表只insert；表1的身份/所属、别名/称号、技能/术法、擅长、外貌和状态按字段职责分别维护；钱财/灵石保存货币余额，持续资源与生效状态保存到角色状态相应字段，普通物品只进背包且不重复；已有对象优先update，禁止重复insert；不同种族/体系的修为保留原生境界文本，不自动换算成人族境界。"}
]`,
    bool_silent_refresh: false,
    separateReadContextLayers: 1,
    separateReadLorebook: false,
    tableStructure: [
        {tableName:'当前状态表',tableIndex:0,columns:['日期','时间','地点','当前场景人物'],enable:true,Required:true,asStatus:true,toChat:true,note:'玩家下次输入前的最终世界场景快照，只保留最新一行',initNode:'没有记录时插入当前最终落点',insertNode:'仅当表为空时插入',updateNode:'最终日期/时间/地点/当前场景人物变化时直接覆盖；多段推进取正文最后落点',deleteNode:'出现多行时只保留最新有效一行'},
        {tableName:'角色状态表',tableIndex:1,columns:['姓名','性别','种族','年龄','修为','灵根/体质','灵力','神识','身体状态','灵石','钱财','技能/术法','擅长','其他状态','外貌特征','身份/所属','别名/称号'],enable:true,Required:true,asStatus:true,toChat:true,note:'<user>/玩家本人专属实时状态表，只允许一行；钱财/灵石保存货币余额，灵力/神识/身体状态/其他状态保存持续资源与生效状态；技能/术法与擅长按能力层级区分；身份/所属保存已确认的当前稳定身份、组织或势力归属；别名/称号保存已确认的别名、化名、道号、称号等持续可识别称谓；外貌特征保存已确认的稳定外观和持久变化；数字0也是有效值；“修为”保留玩家原生体系表达',initNode:'首次得到玩家明确状态时插入；已有玩家行存在空字段且当前上下文能确认现值时补齐；钱财、状态、能力、身份/所属、别名/称号和外貌等已确认信息都应按字段职责核对',insertNode:'仅当表为空且对象明确为<user>/玩家本人时插入',updateNode:'仅更新<user>/玩家本人；当前余额、持续资源与生效状态按最新值维护；技能/术法、擅长、身份/所属、别名/称号和外貌等持续信息按事实合并、细化或纠正；空字段按已确认现值补齐；普通物品不写入本表',deleteNode:'重复玩家状态行只保留最新有效一行'},
        {tableName:'背包表',tableIndex:2,columns:['物品名','类型','数量','状态/品质','备注'],enable:true,Required:false,asStatus:true,toChat:true,note:'<user>当前实际持有普通物品的最新库存；钱、金银铜钱、通用灵石等货币余额不进背包；不是物品提及日志；同一物品只保留一条有效记录',initNode:'表为空或发现当前已持有但尚未记录的普通物品时补录；首次确认原本就持有也必须补录',insertNode:'仅在当前确认持有且表中没有同一普通物品时插入；货币和角色状态不得插入；再次查看/盘点/描述已有物品禁止重复插入',updateNode:'已有同一物品只在数量/品质/状态/备注确有变化时更新；获得同类增加，消耗/出售/交付/丢失减少；交易中的货币变化留在角色状态表',deleteNode:'数量归零或明确完全不再持有时删除；可重复使用装备/工具/容器仅因使用不得删除'},
        {tableName:'当前任务与约定表',tableIndex:3,columns:['事项','相关人物','内容','地点/期限','当前状态'],enable:true,Required:false,asStatus:true,toChat:true,note:'只保存尚未结束的任务/承诺/交易/约定',initNode:'存在尚未完成的重要事项时记录',insertNode:'出现新的未结束事项时插入',updateNode:'进度/地点/期限/状态变化时更新同一行',deleteNode:'完成/失败/取消/失效后删除；重大结果可写入历史'},
        {tableName:'人物主表',tableIndex:4,columns:['姓名','性别','种族/血脉','修炼体系/路径','别名/称呼','身份/所属','外貌特征','性格','与玩家关系','重要信息'],enable:true,Required:true,asStatus:true,toChat:true,note:'NPC专属身份与关系主表；负责识别人物是谁，并保存种族/血脉与修炼体系/路径；同一NPC一行；禁止记录<user>/玩家本人',initNode:'记录后续值得继续引用的NPC，包括已死亡或暂不在场但仍持续影响当前剧情者；各字段只填已明确确认的信息，未知留空',insertNode:'出现新的重要NPC或发现重要NPC漏记且表中没有时插入；不得为了补齐字段编造未知信息',updateNode:'正式姓名、种族/血脉、修炼体系/路径、身份/所属、外貌、性格、关系或长期重要信息发生明确变化时更新同一NPC行；称呼变化不重复建人',deleteNode:'重复NPC行删除并合并；若误写<user>/玩家本人则删除；NPC死亡通常保留人物主记录'},
        {tableName:'人物发展表',tableIndex:5,columns:['姓名','修为','主要能力','当前地点','年龄','最后确认时间','当前状态','主要目标/重要事项'],enable:true,Required:true,asStatus:true,toChat:true,note:'NPC专属最新发展锚点表；“修为”保存该NPC自身修炼体系的原生境界/阶段，禁止自动换算成人族境界；同一NPC一行；只保存最后有效状态，不记录离线流水账',initNode:'值得长期追踪的NPC出现已确认发展信息时记录；姓名用于与人物主表关联，其余未知留空',insertNode:'人物发展表中尚无该NPC且已确认至少一项发展状态时插入；不得为了成长而编造信息',updateNode:'新确认的原生修为/能力/地点/年龄/最后确认时间/重要状态/目标覆盖对应旧锚点字段；战力对应不是修为，不得换算后写入；年龄与确认时间不得互相代替',deleteNode:'重复发展行合并；人物彻底确认不再需要追踪时才删除；死亡通常更新当前状态并在历史记录死亡节点'},
        {tableName:'历史事件表',tableIndex:6,columns:['时间','地点','涉及人物','事件','结果'],enable:true,Required:true,asStatus:true,toChat:true,note:'有限追加的重要历史；用于补充NPC发展锚点，只记录会影响未来推演的既成节点',initNode:'记录真正重要且已确认发生的节点；当前上下文已有但表中漏记的重要节点也补录',insertNode:'突破/突破失败、势力加入退出、婚姻或重要亲属变化、重伤残疾/寿元重大损耗、重大机缘、战争或宗门覆灭导致处境改变、死亡等重要节点才插入',updateNode:'仅纠正明确错误或补最终结果；人物发展表最新状态与历史冲突时以时间更晚的明确事实为准',deleteNode:'重复或明确错误的历史行可删除'},
    ],
});
