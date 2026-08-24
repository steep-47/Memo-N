import { APP } from '../../core/manager.js';
import { installCurrentWorldMemoryGuards, repairMissingColumnsBeforeCleanup } from './tableStructureRepair.js?v=memon58';

let running = false;
let timer = null;

async function repairNow(reason = 'unknown') {
    if (running) return;
    running = true;
    try {
        installCurrentWorldMemoryGuards();
        const repaired = repairMissingColumnsBeforeCleanup({ notify: false });
        installCurrentWorldMemoryGuards();
        if (repaired?.length) console.log(`[Memo-N] 七表结构自动迁移完成｜reason=${reason}｜tables=${repaired.length}`);
    } catch (error) {
        console.warn(`[Memo-N] 七表结构自动迁移失败｜reason=${reason}`, error);
    } finally {
        running = false;
    }
}

function schedule(reason, delay = 80) {
    clearTimeout(timer);
    timer = setTimeout(() => void repairNow(reason), delay);
}

// 插件加载后立即把旧存档升级到当前标准表头。
schedule('startup', 300);

// 在模型真正看到表格结构之前再校验一次，防止刚切换聊天/旧Swipe时结构落后。
const requestEvent = APP.event_types.CHAT_COMPLETION_SETTINGS_READY;
if (requestEvent) {
    APP.eventSource.on(requestEvent, () => void repairNow('before-generation'));
    APP.eventSource.makeFirst?.(requestEvent, () => void repairNow('before-generation'));
}

// 不同SillyTavern版本事件名可能不同；存在才挂载。
for (const name of ['CHAT_CHANGED', 'CHAT_LOADED', 'MESSAGE_RECEIVED']) {
    const event = APP.event_types?.[name];
    if (!event) continue;
    APP.eventSource.on(event, () => schedule(name.toLowerCase(), 120));
}

console.log('[Memo-N] 七表结构自动迁移守卫已加载');
