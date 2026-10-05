import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.dataset = {}; this.classes = new Set(); this.classList = { add: (...names) => names.forEach(name => this.classes.add(name)) }; }
    appendChild(child) { this.children.push(child); }
}
globalThis.document = { createElement: tag => new Element(tag) };
globalThis.__renderMocks = { BASE: {}, DERIVED: { any: {} }, EDITOR: {}, SYSTEM: {}, USER: {}, SheetBase: class {}, Cell: class {}, cellStyle: '', filterSavingData() {} };
const source = (await fs.readFile(new URL('../core/table/sheet.js', import.meta.url), 'utf8')).replace(/^import[^\n]+\n/gm, '');
const { Sheet } = await import(`data:text/javascript;base64,${Buffer.from('const { BASE, DERIVED, EDITOR, SYSTEM, USER, SheetBase, Cell, cellStyle, filterSavingData } = globalThis.__renderMocks;\n' + source).toString('base64')}`);
const sheet = Object.create(Sheet.prototype);
sheet.name = '背包表'; sheet.uid = 'inventory'; sheet.cells = new Map();
const current = [['head', 'name', 'quantity'], ['kept', 'rice', 'one']];
const previous = [['head', 'name', 'quantity'], ['removed', 'herb', 'zero'], ['kept', 'rice', 'one']];
sheet.hashSheet = structuredClone(current);
for (const hash of previous.flat()) {
 const cell = { data: { value: hash }, initCellRender() { this.element = new Element('td'); this.element.textContent = hash; return this.element; } };
 sheet.cells.set(hash, cell);
}
const snapshot = { inventory: previous };
const rowsOf = element => element.children.find(child => child.tag === 'tbody').children;
const active = sheet.renderSheet(null, current, snapshot, { showDeletedRows: false });
assert.equal(rowsOf(active).length, 2, '当前目录只渲染当前有效行');
assert.equal(rowsOf(active).some(row => row.children.some(cell => cell.textContent === 'herb')), false, '删除行不得重新出现在当前表格');
const diff = sheet.renderSheet(null, current, snapshot);
assert.equal(rowsOf(diff).length, 3, '变化对比保留删除行展示');
assert.ok(sheet.cells.get('herb').element.classes.has('delete-item'), '对比仍标识删除变化');
assert.deepEqual(sheet.hashSheet, current, '显示操作不修改当前数据');
assert.deepEqual(snapshot.inventory, previous, '历史快照完整保留');
console.log('current table renderer PASS: current inventory excludes deleted rows, comparison retains deletion highlights, snapshots unchanged');
