import { EDITOR } from '../../core/manager.js';

const PATCH_MARK = '__memoNCellEditorPopupSizeV2';

function install() {
    const original = EDITOR.callGenericPopup;
    if (typeof original !== 'function' || original[PATCH_MARK]) return;

    const wrapped = function (...args) {
        const [text, type] = args;
        if (String(text ?? '').trim() === '编辑单元格' && type === EDITOR.POPUP_TYPE.INPUT) {
            args[3] = {
                ...(args[3] && typeof args[3] === 'object' ? args[3] : {}),
                rows: 10,
            };
        }
        return original.apply(this, args);
    };

    Object.defineProperty(wrapped, PATCH_MARK, { value: true });
    EDITOR.callGenericPopup = wrapped;
    console.log('[Memo-N] 单元格编辑弹窗尺寸优化已加载：编辑单元格输入框固定为10行');
}

install();

export { install };
