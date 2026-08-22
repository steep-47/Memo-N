import { APP, USER } from '../../core/manager.js';
import { maintainYiYiMemoryVault } from './yiyiMemoryMaintenance.js';

function check(name, ok, detail = '') { return { name, ok: ok === true, detail: String(detail || '') }; }

function maintenanceProbe() {
    const sample = {
        memories: [
            { id: 'a', time: '第一次见面', memory: '玩家明确不喜欢被替他做决定', thenFeeling: '', currentView: '', importance: 'high', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
            { id: 'b', time: '第一次见面', memory: '玩家明确不喜欢被替他做决定', thenFeeling: '记住了', currentView: '仍然有效', importance: 'core', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z' },
            { id: 'c', time: '后来', memory: '另一件完全不同的共同经历', thenFeeling: '', currentView: '', importance: 'normal', createdAt: '2026-01-04T00:00:00.000Z', updatedAt: '2026-01-04T00:00:00.000Z' },
        ],
    };
    const result = maintainYiYiMemoryVault(sample, { persist: false });
    const kept = result.vault?.memories || [];
    return {
        ok: result.duplicatesMerged === 1 && kept.length === 2 && kept.some(item => item.id === 'b' && item.importance === 'core') && kept.some(item => item.id === 'c'),
        detail: `merged=${result.duplicatesMerged}, remaining=${kept.length}`,
    };
}

export function runYiYiDiagnostics() {
    const context = USER?.getContext?.();
    const probe = maintenanceProbe();
    const checks = [
        check('SillyTavern上下文可读', !!context),
        check('生成设置事件存在', !!APP?.event_types?.CHAT_COMPLETION_SETTINGS_READY),
        check('生成结束事件存在', !!APP?.event_types?.GENERATION_ENDED),
        check('Swipe事件存在', !!APP?.event_types?.MESSAGE_SWIPED),
        check('Swipe删除事件存在', !!APP?.event_types?.MESSAGE_SWIPE_DELETED),
        check('消息删除事件存在', !!APP?.event_types?.MESSAGE_DELETED),
        check('消息编辑事件存在', !!APP?.event_types?.MESSAGE_EDITED),
        check('世界七表一次API引擎存在', globalThis.__memoNRecordEngineActive === true),
        check('伊依记忆库已加载', !!globalThis.MemoNYiYiMemory),
        check('伊依召回引擎已加载', !!globalThis.MemoNYiYiRecall),
        check('伊依维护引擎已加载', !!globalThis.MemoNYiYiMaintenance),
        check('伊依事务运行时已加载', !!globalThis.MemoNYiYiRuntime),
        check('精确去重不误删不同记忆', probe.ok, probe.detail),
    ];
    const failed = checks.filter(item => !item.ok);
    const report = { ok: failed.length === 0, at: Date.now(), checks, failed };
    globalThis.__memoNYiYiSelfCheck = report;
    if (report.ok) console.log('[Memo-N][伊依] 启动自检通过：记忆模块、SillyTavern事件和精确去重探针正常');
    else console.error('[Memo-N][伊依] 启动自检发现问题', failed);
    return report;
}

export const YiYiDiagnostics = Object.freeze({ run: runYiYiDiagnostics });
globalThis.MemoNYiYiDiagnostics = YiYiDiagnostics;
runYiYiDiagnostics();
