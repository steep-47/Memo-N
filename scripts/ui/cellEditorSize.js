const STYLE_ID = 'memo-n-cell-editor-size-style';

function install() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        /* “编辑单元格”表单中，只有单元格内容使用 textarea#value；其他表格设置字段使用不同 id。 */
        textarea#value.wide100p {
            width: 100% !important;
            min-height: 28vh !important;
            height: 28vh;
            max-height: 52vh !important;
            box-sizing: border-box;
            resize: vertical;
            line-height: 1.5;
        }

        @media (min-width: 900px) {
            textarea#value.wide100p {
                min-height: 260px !important;
                height: 260px;
                max-height: 55vh !important;
            }
        }
    `;
    document.head.appendChild(style);
    console.log('[Memo-N] 单元格编辑输入框尺寸优化已加载');
}

install();

export { install };
