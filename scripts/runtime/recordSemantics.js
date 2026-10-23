const RECORD_SEMANTICS_MARK = '[Memo-N记录职责收口v2]';

const HISTORY_TABLE_RULES = Object.freeze({
    note: '高召回历史采集层；每个有实际剧情推进的回复都记录本轮已发生且对后续连续性有价值的事实，跨轮完整事件合并交给冗余整理',
    initNode: '每个有实际剧情推进的回复都检查本轮已发生事实并记录；纯无事实变化或纯界面操作可不写，不预判完整事件边界',
    insertNode: '本轮形成新的已发生连续性事实时追加；同一轮可按事实链写一条或多条，禁止因为旧事件相似而跨轮覆盖旧行',
    updateNode: '仅纠正本行明确错误或补充本行同一事实的确定结果；记录阶段不把多轮事件压成一条',
    deleteNode: '记录阶段不因可合并而删除历史；重复或错误由表格整理处理，完整事件压缩由冗余整理处理',
});

const RECORD_SEMANTICS_RULE = `${RECORD_SEMANTICS_MARK}
以下为记录阶段最终职责边界，优先于前文相冲突的旧规则：
- 一次API与独立API只差请求所用provider；记录判断、七表职责与执行语义完全一致。
- 记录阶段只维护本轮正文已经明确发生或确认的事实，以及本轮直接造成的增删改；不借记录请求做与本轮无关的全局清理。重复实体、历史遗留错位、过期/失效旧项等全局正确性维护交给“表格整理”。
- 表3除任务、承诺、交易、约定外，也记录有明确期限或结束条件、尚未结算的持续事项；已知起点和期限时写清可核对信息，延期/续期只依据新的明确事实。
- 表6是高召回历史采集层：每个有实际剧情推进的回复都记录本轮已发生且对后续连续性有价值的事实；纯无事实变化或纯界面操作可以不写。记录阶段不为预判“完整事件”而跨轮合并、覆盖或删除旧事件链，跨轮完整事件识别与压缩统一交给“冗余整理”。
- 未知、不确定或仅推测的内容不记录，不为了填表制造事实。`;

const LEGACY_RECORD_CONFLICTS = [
    ['同一连续事件可更新已有记录，不必每轮机械新增。', ''],
    ['同一连续事件优先更新同一条事件记录，不必每轮机械新增；', ''],
    ['连续事件优先合并更新同一条，不按每轮机械新增；', ''],
    ['历史事件按事件连续性维护，新独立事件新增，同一连续事件优先更新已有记录，重复或明确错误时合并、纠正或删除。', '历史事件在记录阶段按本轮已确认事实新增或维护；跨轮事件压缩不在记录阶段执行。'],
    ['表6只记录会改变未来推演的重要节点，如突破/失败、势力加入退出、婚姻或重要亲属变化、重伤残疾/寿元重大损耗、重大机缘、战争/宗门覆灭导致处境改变、死亡。普通修炼、日常生活、微小财富变化不写历史。', '表6按高召回原则记录每个实际剧情推进回复中对后续连续性有价值的已发生事实；跨轮压缩交给冗余整理。'],
    ['这个功能的第一目标是把本轮内容中新增、变化或已明确但表中漏记的事实准确写入当前七表；第二目标是在记录过程中顺手修复与本轮涉及对象直接相关、且现有表格或上下文能够明确证明的问题。允许修复同一对象重复行、明显错表、相关字段漏记、已经明确失效的相关记录等；不要借手动更新对与本轮无关的旧数据做全局清理，那属于“表格整理”。', '这个功能只记录本轮已明确发生或确认的事实。'],
    ['先以本轮待记录内容为中心，按0→1→2→3→4→5→6检查所有应新增、更新、删除或补齐的明确事实；然后只对本轮涉及的表和对象做一次关联修理检查。若当前表格或上下文能够明确证明存在重复、错位、漏记或已失效记录，可在同一批tableEdit中一起修复；证据不足或与本轮无关的旧问题不要动，留给“表格整理”。', '先以本轮待记录内容为中心，按0→1→2→3→4→5→6检查本轮应新增、更新或删除的明确事实。'],
];

const LEGACY_HISTORY_CONTRACT = /#6 历史事件表：[^\n]*(?:\n(?!\n\[完整性判断\])[\s\S]*?)?(?=\n\n\[完整性判断\])/g;
const LEGACY_HISTORY_RULE_LINE = /^- 表6“历史事件表”[^\n]*$/gm;

function currentHistoryContract() {
    return `#6 历史事件表：${HISTORY_TABLE_RULES.note}。${HISTORY_TABLE_RULES.insertNode}；${HISTORY_TABLE_RULES.updateNode}；${HISTORY_TABLE_RULES.deleteNode}。`;
}

function currentHistoryRuleLine() {
    return `- 表6“历史事件表”：${HISTORY_TABLE_RULES.note}；${HISTORY_TABLE_RULES.insertNode}；${HISTORY_TABLE_RULES.updateNode}。`;
}

function normalizeLegacyRecordSemantics(value) {
    let text = String(value ?? '');
    for (const [legacy, replacement] of LEGACY_RECORD_CONFLICTS) {
        if (text.includes(legacy)) text = text.replaceAll(legacy, replacement);
    }
    text = text.replace(LEGACY_HISTORY_RULE_LINE, currentHistoryRuleLine());
    if (text.includes('#6 历史事件表：') && text.includes('[完整性判断]')) {
        text = text.replace(LEGACY_HISTORY_CONTRACT, currentHistoryContract());
    }
    return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}

export {
    HISTORY_TABLE_RULES,
    LEGACY_RECORD_CONFLICTS,
    RECORD_SEMANTICS_MARK,
    RECORD_SEMANTICS_RULE,
    normalizeLegacyRecordSemantics,
};
