import { APP, EDITOR, USER } from '../../core/manager.js';

const EXPECT_MARKER = 'memo_n_output_structure_expectation_v1';
let expectation = null;

function contentOf(message) {
    if (typeof message?.content === 'string') return message.content;
    if (Array.isArray(message?.content)) return message.content.map(part => typeof part?.text === 'string' ? part.text : '').join('\n');
    return '';
}

function detectExpectation(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.messages)) return null;
    const joined = data.messages.map(contentOf).join('\n');

    // 首选最终收尾里已经解析后的变量值。
    const resolved = joined.match(/当前输出模式\s*[：:]\s*([^；;\n]+)\s*[；;]\s*行动选项\s*[：:]\s*([^\n]+)/);
    if (resolved) {
        return {
            normalStory: String(resolved[1]).trim() === '正常剧情',
            choicesRequired: String(resolved[2]).trim().startsWith('开启'),
            source: 'resolved-preset-vars',
        };
    }

    // 某些前端在这个事件阶段仍保留宏。只在“没有任何工具模式覆盖”时使用明确默认值兜底。
    const hasChoiceOn = joined.includes('{{setvar::tx_choices::开启}}') || /正常剧情正文后给出三个带序号的参考行动/.test(joined);
    const toolOverrides = [...joined.matchAll(/\{\{setvar::tx_tool::([^}]+)\}\}/g)].map(match => String(match[1]).trim());
    const hasNonNormalTool = toolOverrides.some(value => value && value !== '正常剧情');
    return {
        normalStory: !hasNonNormalTool,
        choicesRequired: hasChoiceOn && !hasNonNormalTool,
        source: 'macro-fallback',
    };
}

function hasThreeNumberedChoices(reply) {
    const text = String(reply ?? '').replace(/\r\n/g, '\n');
    const one = /(?:^|\n)\s*1\s*[\.．、]\s*\S/.test(text);
    const two = /(?:^|\n)\s*2\s*[\.．、]\s*\S/.test(text);
    const three = /(?:^|\n)\s*3\s*[\.．、]\s*\S/.test(text);
    return one && two && three;
}

function capture(data) {
    const detected = detectExpectation(data);
    expectation = detected ? { ...detected, at: Date.now(), token: EXPECT_MARKER } : null;
}

function latestAssistant() {
    const chat = USER?.getContext?.()?.chat;
    if (!Array.isArray(chat)) return null;
    for (let i = chat.length - 1; i >= 0; i--) if (chat[i]?.is_user === false) return { id: i, chat: chat[i] };
    return null;
}

async function validateAfterGeneration() {
    const expected = expectation;
    expectation = null;
    if (!expected || Date.now() - expected.at > 300000 || !expected.normalStory || !expected.choicesRequired) return;

    // 等待Memo-N一次API拆包/保存完成；不改变其成功/失败结果。
    await new Promise(resolve => queueMicrotask(resolve));
    const current = latestAssistant();
    if (!current) return;
    const persistence = current.chat?.__memoStrictPersistence;
    if (persistence && typeof persistence.then === 'function') {
        try { await persistence; } catch (_) { /* 记录失败由主链自己提示；结构仍可独立检查。 */ }
    }

    const reply = String(current.chat?.mes ?? '');
    if (hasThreeNumberedChoices(reply)) return;

    Object.defineProperty(current.chat, '__memoOutputStructureWarning', {
        configurable: true,
        writable: true,
        value: {
            missingChoices: true,
            source: expected.source,
            at: Date.now(),
        },
    });

    EDITOR.warning('Memo-N：表格记录已按实际结果处理，但本轮正文结构不完整——预设要求3条行动选项，模型未输出。不会自动补写或重试。', '', 4200);
    console.warn('[Memo-N] 输出结构验收：预设要求3条行动选项，但最终reply缺失；未修改正文，未重试API');
}

APP.eventSource.on(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, capture);
APP.eventSource.makeFirst?.(APP.event_types.CHAT_COMPLETION_SETTINGS_READY, capture);
APP.eventSource.on(APP.event_types.GENERATION_ENDED, validateAfterGeneration);
APP.eventSource.makeLast?.(APP.event_types.GENERATION_ENDED, validateAfterGeneration);

globalThis.MemoNOutputStructureGuard = Object.freeze({ detectExpectation, hasThreeNumberedChoices, validateAfterGeneration });
console.log('[Memo-N] 输出结构验收已加载：只检查预设明确要求的3条行动选项；缺失时仅警告，不补写、不重试');
