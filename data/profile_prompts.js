import {switchLanguage} from "../services/translate.js";

const rules=`<整理规则>保持七张表标准结构与现有表头不变，禁止删除、改名或重排标准列。0当前状态只保留最新有效快照；1角色状态只保存玩家本人；2背包维护当前实际持有库存；3任务约定只留未结束事项；4人物主表同一NPC一行，维护稳定身份与关系信息；5人物发展表同一NPC一行，分别维护修为、主要能力、当前地点、年龄、最后确认时间、当前状态、主要目标/事项等最后有效发展锚点，年龄与最后确认时间不得混写；4与5必须对应同一人物；6历史仅保留影响未来推演的重大既成节点。已有对象优先update，真正新增才insert，明确失效才delete；不猜测未知，不回滚既成事实。这里只规定整理语义，最终JSON或tableEdit机器格式只服从Memo-N当前“记录接口”在请求末尾注入的唯一协议。</整理规则>`;

export const profile_prompts=await switchLanguage('__profile_prompts__',{
    rebuild_base:{
        type:'rebuild',
        name:'动态整理（世界状态表）',
        system_prompt:'你是世界状态表格整理助手，只依据已确认事实整理；严格保持输入表头与列顺序。不要自行指定最终输出协议。',
        user_prompt_begin:'结合聊天和当前表格检查需要新增、更新、删除的事实；最终机器格式服从Memo-N记录接口。',
        include_history:true,
        include_last_table:true,
        core_rules:rules
    },
    rebuild_compatible:{
        type:'rebuild',
        name:'兼容整理（自定义表格）',
        system_prompt:'保持现有表结构，只合并、更新、删除重复或失效内容；不要自行指定最终输出协议。',
        user_prompt_begin:'根据聊天和当前表格整理已有数据，机器格式服从Memo-N记录接口。',
        include_history:true,
        include_last_table:true,
        core_rules:'<整理规则>保持表结构和原表头；已有对象优先更新；不猜测未知；最终机器格式服从Memo-N记录接口。</整理规则>'
    },
    rebuild_summary:{
        type:'rebuild',
        name:'完整检查（世界状态表）',
        system_prompt:'依据全部可见聊天检查当前状态与重要历史；严格保持输入表头与列顺序；不要自行指定最终输出协议。',
        user_prompt_begin:'完整检查聊天和当前表格，只提出必要的增量整理；机器格式服从Memo-N记录接口。',
        include_history:true,
        include_last_table:true,
        core_rules:rules
    }
});
