import assert from 'node:assert/strict';
import { parseJson } from '../json-parser.js';
import { buildTree, findNodeAt, findNodeById, computeDefaultCollapsed } from '../tree-model.js';

const tree = buildTree(parseJson('{"a": 1, "b": {"c": [true, null]}}').ast);

// 结构与 path
assert.equal(tree.id, '$');
assert.equal(tree.type, 'object');
const b = tree.children[1];
assert.equal(b.id, '$.b');
assert.equal(b.childCount, 1);
const arr = b.children[0];
assert.equal(arr.id, '$.b.c');
assert.equal(arr.children[1].id, '$.b.c[1]');
assert.equal(arr.children[1].type, 'null');

// 标量 valueText
assert.equal(tree.children[0].valueText, '1');

// 长字符串截断（≤30 字符，带省略号）
{
  const t = buildTree(parseJson('{"s": "0123456789012345678901234567890123456789"}').ast);
  assert.ok(t.children[0].valueText.endsWith('…'));
  assert.ok(t.children[0].valueText.length <= 30);
}

// 特殊字符 key 用引号形式
{
  const t = buildTree(parseJson('{"a b": 1}').ast);
  assert.equal(t.children[0].id, '$["a b"]');
}

// findNodeAt：最深包含 offset 的节点
{
  const text = '{"a": {"b": 1}, "c": 2}';
  const t = buildTree(parseJson(text).ast);
  assert.equal(findNodeAt(t, text.indexOf('1')).id, '$.a.b');
  assert.equal(findNodeAt(t, text.indexOf('2')).id, '$.c');
  assert.equal(findNodeAt(t, 0).id, '$');
  assert.equal(findNodeAt(t, text.length + 5), null);
}

// findNodeById + parent 引用链
{
  const n = findNodeById(tree, '$.b.c[0]');
  assert.equal(n.type, 'boolean');
  assert.equal(n.parent.id, '$.b.c');
  assert.equal(n.parent.parent.id, '$.b');
  assert.equal(n.parent.parent.parent.id, '$');
  assert.equal(n.parent.parent.parent.parent, null);
  assert.equal(findNodeById(tree, '$.not-exist'), null);
}

// grid：元素全部为非空对象的数组 → grid = { cols, kinds, units }，不再透明直挂
// kinds：badge=整列复合值(徽标列) / scalar=含标量；units：该列最长内容单位数(含表头，CJK 记 2)
{
  const t = buildTree(parseJson(
    '{"objs":[{"a":1},{"b":2,"a":3}],"tags":["x"],"mix":[{"a":1},"s"],"empties":[{},{}],"nested":[[{"a":1}]]}'
  ).ast);
  const [objs, tags, mix, empties, nested] = t.children;
  assert.deepEqual(objs.grid.cols, ['a', 'b']);
  assert.deepEqual(objs.grid.kinds, ['scalar', 'scalar']);
  assert.deepEqual(objs.grid.units, [3, 3]);     // 表头 1 字符 + 2 余量
  assert.equal(objs.transparent, undefined);     // grid 与 transparent 互斥
  assert.equal(tags.grid, undefined);            // 标量数组不网格化
  assert.equal(mix.grid, undefined);             // 混合数组不网格化
  assert.equal(empties.grid, undefined);         // 空对象元素不网格化
  assert.equal(nested.grid, undefined);          // 嵌套数组（元素非对象）不网格化
  assert.equal(nested.transparent, true);        // 全复合但非全对象 → 仍透明直挂
  assert.equal(tags.transparent, false);
  assert.equal(mix.transparent, false);
  assert.equal(empties.transparent, false);
  assert.equal(t.transparent, undefined);        // 对象既无 grid 也不透明
  assert.equal(t.grid, undefined);
}

// grid 列画像：徽标列 / 标量列 / 混合列的 kinds 与 units
{
  const json = JSON.stringify({
    fields: [
      { basic: { a: 1, b: 2 }, code: 'X' },
      { basic: { c: 3 }, code: 'LONG_FIELD_NAME_40_CHARS_AAAAAAAA' },
    ],
  });
  const t = buildTree(parseJson(json).ast);
  const g = t.children[0].grid;
  assert.deepEqual(g.cols, ['basic', 'code']);
  assert.deepEqual(g.kinds, ['badge', 'scalar']);   // basic 整列复合 → 徽标列
  assert.equal(g.units[0], 5 + 2);                  // 徽标列只看表头宽
  assert.equal(g.units[1], 30);                     // valueText 截断上限 30，宽于表头 4+2
  // 混合列（同列既有标量又有复合）按标量列处理
  const m = buildTree(parseJson('{"m":[{"x":5},{"x":{"deep":1}}]}').ast);
  assert.deepEqual(m.children[0].grid.kinds, ['scalar']);
}

// computeDefaultCollapsed：>50 子节点默认折叠；网格行数>6 时其复合单元格默认折叠（递归孙网格）
{
  const big = JSON.stringify({ arr: Array.from({ length: 51 }, (_, i) => [i]) });
  const t1 = buildTree(parseJson(big).ast);
  assert.ok(computeDefaultCollapsed(t1).has('$.arr'));

  const rows = JSON.stringify({
    fields: [
      { basic: { a: 1 }, rules: { r: 1 }, code: 'A' },
      { basic: { b: 2 }, rules: { r: 2 }, code: 'B' },
      { basic: { c: 3 }, rules: { r: 3 }, code: 'C' },
      { basic: { d: 4 }, rules: { r: 4 }, code: 'D' },
      { basic: { e: 5 }, rules: { r: 5 }, code: 'E' },
      { basic: { f: 6 }, rules: { r: 6 }, code: 'F' },
      { basic: { g: 7 }, rules: { r: 7 }, code: 'G' },
    ],
    solo: [{ only: 1 }],
  });
  const t2 = buildTree(parseJson(rows).ast);
  const c2 = computeDefaultCollapsed(t2);
  assert.ok(c2.has('$.fields[0].basic'));   // 7 行 > 6 → 单元格默认折叠
  assert.ok(c2.has('$.fields[6].rules'));
  assert.ok(!c2.has('$.fields[0].code'));   // 标量单元格无折叠概念
  assert.equal(c2.has('$.solo[0].only'), false); // 1 行 ≤ 6 → 不折叠
  assert.equal(c2.has('$.fields'), false);  // 网格本身 7 行 < 50 不整体折叠
}

