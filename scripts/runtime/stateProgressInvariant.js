import { APP, BASE, USER } from '../../core/manager.js';

const MARKER = '[Memo-N state progress invariant v1]';

function active() {
    const settings = USER?.tableBaseSetting;
    const independent = USER?.getSettings?.()?.memo_n_settings?.independent_record_api_enabled === true;
    return !independent && settings?.isExtensionAble !== false && settings?.isAiReadTable !== false
        && settings?.isAiWriteTable !== false && settings?.injection_mode !== 'injection_off';
}

function stateTable() {
    return (BASE.getChatSheets?.() ?? [])
        .filter(sheet => sheet?.enable !== false)
        .filter(sheet => sheet?.sendToContext !== false)[0] ?? null;
}

function injectInvariant(data) {
    if (!active() || !data || !Array.isArray(data.messages)) return;
    const sheet = stateTable();
    if (!sheet) return;
    const headers = (sheet.getHeader?.() ?? []).map(value => String(value ?? '').trim());
    const name = String(sheet.name ?? '表0');
    const timeColumn = headers.findIndex(value => value === '时间' || /时间/.test(value));
    const placeColumn = headers.findIndex(value => /地点|场景/.test(value));
    const peopleColumn = headers.findIndex(value => /此地角色|在场|角色/.test(value));
    const existing = (sheet.getSheetCSV?.(false) ?? '').trim();
    const reminder = `${MARKER}\n表0“${name}”是实时状态表，不使用“重大/长期价值”门槛。只要本轮正文发生了可感知的剧情推进（行动、交谈、移动、等待、做事、事件发展），现实时间就已经推进，必须维护表0，不能返回NO_CHANGE/空changes。只有正文完全没有推进，且日期、时间、地点、在场角色与上一状态逐项完全相同时，才允许NO_CHANGE。\n表0真实列：${headers.map((h,i)=>`${i}=${h}`).join('，')}。时间列=${timeColumn}，地点列=${placeColumn}，在场角色列=${peopleColumn}。已有表0内容：\n${existing || '（空表：本轮应insert）'}\n如果正文没有给出精确分钟，不要编造精确分钟；应按照正文已有时间表达或合理的叙事时间粒度维护时间状态。`;
    data.messages = data.messages.filter(message => !String(message?.content ?? '').includes(MARKER));
    data.messages.push({ role: 'system', content: reminder });
}

const event = APP.event_types.CHAT_COMPLETION_SETTINGS_READY;
APP.eventSource.on(event, injectInvariant);
APP.eventSource.makeLast?.(event, injectInvariant);

console.log('[Memo-N] 状态推进记录守卫已加载：剧情发生推进时表0必须更新');
