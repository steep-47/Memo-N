import { EDITOR } from '../../core/manager.js';
import { TableTwoStepSummary } from './separateTableUpdate.js?v=memon85';

const INSTALL_FLAG = '__memoNManualRoundContextBridgeV1';

function install() {
    if (globalThis[INSTALL_FLAG]) return;
    globalThis[INSTALL_FLAG] = true;

    // 手动更新使用新版“按对话轮”上下文算法。
    // 捕获阶段接管按钮，避免旧 absoluteRefresh 模块仍引用缓存中的按AI条数实现。
    document.addEventListener('click', event => {
        const target = event.target?.closest?.('#trigger_step_by_step_button');
        if (!target) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        Promise.resolve(TableTwoStepSummary('manual')).catch(error => {
            console.error('[Memo-N][manual-round-context] 手动更新启动失败', error);
            EDITOR.error(`手动更新启动失败：${error?.message || error}`);
        });
    }, true);

    jQuery(() => {
        const input = $('#separateReadContextLayers');
        const label = $('label[for="separateReadContextLayers"]');
        label.text('上下文轮数');
        label.attr('title', '1轮 = 当前待记录AI回复之前的用户消息 + 当前待记录AI回复；AI回复本身作为本轮待记录内容单独发送');
        input.attr('title', '按对话轮读取。1轮会带上触发当前AI回复的用户消息，当前AI回复本身不重复放入上下文。');
    });

    console.log('[Memo-N] 手动更新已切换为按完整对话轮读取上下文');
}

install();
