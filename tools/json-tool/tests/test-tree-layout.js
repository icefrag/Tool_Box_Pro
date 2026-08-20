import assert from 'node:assert/strict';
import { parseJson } from '../json-parser.js';
import { buildTree } from '../tree-model.js';
import { layoutTree, LAYOUT } from '../tree-layout.js';

const T = (json) => buildTree(parseJson(json).ast);
const COL_PITCH = LAYOUT.CARD_W + LAYOUT.COL_GAP;

// 单叶：根在原点
{
  const { positions, visible, bounds } = layoutTree(T('42'));
  assert.deepEqual(positions.get('$'), { x: 0, y: 0 });
  assert.equal(visible.size, 1);
  assert.equal(bounds.width, LAYOUT.CARD_W);
  assert.equal(bounds.height, LAYOUT.CARD_H);
}

// 两叶 + 根垂直居中于两叶之间
{
  const { positions, bounds } = layoutTree(T('{"a": 1, "b": 2}'));
  const a = positions.get('$.a');
  const b = positions.get('$.b');
  const root = positions.get('$');
  assert.equal(a.x, COL_PITCH);
  assert.equal(b.x, COL_PITCH);
  assert.equal(b.y, a.y + LAYOUT.CARD_H + LAYOUT.ROW_GAP);
  assert.equal(root.y, (a.y + b.y) / 2);
  assert.equal(bounds.width, COL_PITCH + LAYOUT.CARD_W);
}

// 折叠节点视为叶：后代不进 visible
{
  const { positions, visible } = layoutTree(T('{"a": {"x": 1, "y": 2}}'), new Set(['$.a']));
  assert.equal(visible.has('$.a.x'), false);
  assert.equal(visible.size, 2);
  assert.ok(positions.has('$.a'));
}

// 空对象/空数组是叶
{
  const { visible } = layoutTree(T('{"e": {}, "arr": []}'));
  assert.equal(visible.size, 3);
}
