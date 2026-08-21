import { normalizePinnedCharacters, pinRank, stablePinnedSort, toggleCharacterPin } from '../scripts/engine/characterPins.js';

const normalized = normalizePinnedCharacters(['伊依', ' 周婶 ', '伊依', '', null]);
if (normalized.length !== 2 || normalized[0] !== '伊依' || normalized[1] !== '周婶') throw new Error('置顶名单归一失败');
const added = toggleCharacterPin('陈尘', normalized);
if (added.at(-1) !== '陈尘') throw new Error('新增置顶失败');
const removed = toggleCharacterPin('伊依', added);
if (removed.includes('伊依')) throw new Error('取消置顶失败');
if (pinRank('周婶', normalized) !== 1 || Number.isFinite(pinRank('陌生人', normalized))) throw new Error('置顶排名错误');
const rows = [{ name: '甲' }, { name: '周婶' }, { name: '乙' }, { name: '伊依' }];
const sorted = stablePinnedSort(rows, row => row.name, normalized);
if (sorted.map(row => row.name).join(',') !== '伊依,周婶,甲,乙') throw new Error('置顶稳定排序错误');

console.log('memo-n-pins PASS: normalize=1, toggle=2, rank=2, stable-sort=1');
