import assert from 'node:assert/strict';
import { parseJson } from '../json-parser.js';
import { buildTree } from '../tree-model.js';
import { layoutTree, LAYOUT } from '../tree-layout.js';

const T = (json) => buildTree(parseJson(json).ast);
const COL_PITCH = LAYOUT.TABLE_W + LAYOUT.TABLE_GAP;

// 标量根：根自身作为唯一一行，表格仅包住这一行
{
  const { rows, tables, visible } = layoutTree(T('42'));
  assert.ok(rows.has('$'));
  assert.ok(tables.has('$'));
  const t = tables.get('$');
  assert.equal(t.x, 0);
  assert.equal(t.y, 0);
  assert.equal(t.w, LAYOUT.TABLE_W);
  assert.equal(t.h, LAYOUT.ROW_H + LAYOUT.PAD_Y * 2);
  assert.deepEqual([...visible], ['$']);
}

// 用户示例数据：根表格 4 行，未折叠时复合子节点全部产生子表格
{
  const json = JSON.stringify({
    object: { int: 42, float: 0.125, bool: true, nil: null, arr0: [], obj0: {} },
    table_without_header: ['a', 'b', 'c'],
    table_with_header: [
      { h1: 11, h2: 12, h3: 13 },
      { h1: 21, h2: 22, h3: 23 },
    ],
    preview: { color: '#4f46e5', time: '2026-04-13T10:00:00Z', unicode: '你好' },
  });
  const { rows, tables } = layoutTree(T(json));
  // 根表格 + object + 标量数组 twh + preview + table_with_header 的 2 个对象（对象数组透明，无中转表格）
  assert.equal(tables.size, 6);
  assert.ok(tables.has('$'));
  assert.ok(tables.has('$.object'));
  assert.ok(!tables.has('$.table_with_header'));
  assert.ok(tables.has('$.table_with_header[0]'));
  assert.ok(tables.has('$.preview'));
  // 根表格的 4 行都在，标量行（int 等）在 $.object 的子表格里
  for (const p of ['$.object', '$.table_without_header', '$.table_with_header', '$.preview']) {
    assert.ok(rows.has(p), `行缺失: ${p}`);
  }
  assert.ok(rows.has('$.object.int'));
  // 第一层行 x = PAD_X，第二层行 x = COL_PITCH + PAD_X
  assert.equal(rows.get('$.object').x, LAYOUT.PAD_X);
  assert.equal(rows.get('$.object.int').x, COL_PITCH + LAYOUT.PAD_X);
  // 子表格在右一列
  assert.equal(tables.get('$.object').x, COL_PITCH);
  // 行宽 = 表格宽 - 两侧内边距
  assert.equal(rows.get('$.object').w, LAYOUT.TABLE_W - LAYOUT.PAD_X * 2);
}

// 表格高度：3 行 × 行高 + 上下内边距
{
  const { tables } = layoutTree(T('{"a": 1, "b": 2, "c": 3}'));
  assert.equal(tables.get('$').h, LAYOUT.ROW_H * 3 + LAYOUT.PAD_Y * 2);
}

// 折叠的复合行：不产生子表格，行只占一行高
{
  const tree = T('{"a": {"x": 1, "y": 2}}');
  const { rows, tables, edges } = layoutTree(tree, new Set(['$.a']));
  assert.ok(!tables.has('$.a'));
  assert.ok(rows.has('$.a'));
  assert.ok(!rows.has('$.a.x'));
  assert.equal(tables.size, 1);
  assert.deepEqual(edges, []);
}

// edges：每个非根表格一条「行 → 表格」连线（回归：行与子表格同 path，不可用节点引用判异）
{
  const { edges } = layoutTree(T('{"a": {"x": 1}, "b": 2}'));
  assert.deepEqual(edges, [{ from: '$.a', to: '$.a' }]);
}

// 透明数组：对象数组不建中转表格，元素表格直连数组行
{
  const { rows, tables, edges } = layoutTree(T('{"recordScoreR": [{"a": 1}, {"b": 2}]}'));
  assert.ok(!tables.has('$.recordScoreR'));
  assert.ok(tables.has('$.recordScoreR[0]'));
  assert.ok(tables.has('$.recordScoreR[1]'));
  assert.ok(rows.has('$.recordScoreR'));
  assert.deepEqual(edges, [
    { from: '$.recordScoreR', to: '$.recordScoreR[0]' },
    { from: '$.recordScoreR', to: '$.recordScoreR[1]' },
  ]);
}

// 透明数组折叠：无子表格无连线
{
  const { tables, edges } = layoutTree(T('{"recordScoreR": [{"a": 1}]}'), new Set(['$.recordScoreR']));
  assert.ok(!tables.has('$.recordScoreR'));
  assert.ok(!tables.has('$.recordScoreR[0]'));
  assert.deepEqual(edges, []);
}

// 标量数组保留表格（无表头表格）
{
  const { tables, edges } = layoutTree(T('{"tags": ["a", "b"]}'));
  assert.ok(tables.has('$.tags'));
  assert.deepEqual(edges, [{ from: '$.tags', to: '$.tags' }]);
}

// 空对象元素数组 / 根数组不透明
{
  const { tables } = layoutTree(T('{"l": [{}, {}]}'));
  assert.ok(tables.has('$.l'));
  const rootArr = layoutTree(T('[{"a": 1}]'));
  assert.ok(rootArr.tables.has('$'));
  assert.ok(rootArr.tables.has('$[0]'));
  assert.deepEqual(rootArr.edges, [{ from: '$[0]', to: '$[0]' }]);
}

// 嵌套透明：数组套数组套对象，最内层表格直连最外层数组行
{
  const { tables, edges } = layoutTree(T('{"groups": [[{"a": 1}]]}'));
  assert.ok(!tables.has('$.groups'));
  assert.ok(!tables.has('$.groups[0]'));
  assert.ok(tables.has('$.groups[0][0]'));
  assert.deepEqual(edges, [{ from: '$.groups', to: '$.groups[0][0]' }]);
}

// 紧凑表格：高度只由自身行数决定，不被展开的子表格撑大（用户反馈核心）
{
  const { rows, tables } = layoutTree(T('{"a": {"x": 1, "y": 2, "z": 3}, "b": 1}'));
  assert.equal(tables.get('$').h, LAYOUT.ROW_H * 2 + LAYOUT.PAD_Y * 2);
  assert.equal(tables.get('$.a').h, LAYOUT.ROW_H * 3 + LAYOUT.PAD_Y * 2);
}

// 行距固定：无展开子表格时行按行高均匀堆叠
{
  const { rows } = layoutTree(T('{"a": 1, "b": 2}'));
  assert.equal(rows.get('$.a').y, LAYOUT.PAD_Y);
  assert.equal(rows.get('$.b').y, LAYOUT.PAD_Y + LAYOUT.ROW_H);
}

// 子表格垂直居中于父行中心（空间充足时）
{
  const { rows, tables } = layoutTree(T('{"a": {"x": 1, "y": 2}}'));
  const row = rows.get('$.a');
  const t = tables.get('$.a');
  assert.equal(row.y + LAYOUT.ROW_H / 2, t.y + t.h / 2);
}

// 同层大子表格互不重叠（推挤错开）
{
  const json = '{"a": {"a1":1,"a2":2,"a3":3,"a4":4,"a5":5}, "b": {"b1":1,"b2":2,"b3":3,"b4":4,"b5":5}}';
  const { tables } = layoutTree(T(json));
  const ta = tables.get('$.a');
  const tb = tables.get('$.b');
  const overlap = ta.y < tb.y + tb.h && tb.y < ta.y + ta.h;
  assert.equal(overlap, false);
  assert.ok(tb.y >= ta.y + ta.h + LAYOUT.SUBTREE_GAP - 0.001);
}

// 空对象/空数组行：不产生子表格（不可展开）
{
  const { rows, tables } = layoutTree(T('{"e": {}, "arr": []}'));
  assert.ok(rows.has('$.e'));
  assert.ok(rows.has('$.arr'));
  assert.ok(!tables.has('$.e'));
  assert.ok(!tables.has('$.arr'));
  assert.equal(tables.size, 1);
}

// 空对象根：表格有最小高度（一行高的空表）
{
  const { tables } = layoutTree(T('{}'));
  assert.equal(tables.get('$').h, LAYOUT.ROW_H + LAYOUT.PAD_Y * 2);
}

// bounds 覆盖全部表格
{
  const { bounds } = layoutTree(T('{"a": {"x": 1}}'));
  assert.equal(bounds.width, COL_PITCH + LAYOUT.TABLE_W);
  assert.ok(bounds.height >= LAYOUT.ROW_H + LAYOUT.PAD_Y * 2);
}

// 展开行的「子树盒」垂直居中于该行（嵌套两层）
{
  const json = JSON.stringify({ a: { b: { c: 1, d: 2, e: 3, f: 4, g: 5 } } });
  const { rows, tables } = layoutTree(T(json));
  const rowA = rows.get('$.a');
  const tableA = tables.get('$.a');
  const tableB = tables.get('$.a.b');
  // $.a 的子树盒由孙表格撑起，其中心对齐 $.a 行中心
  assert.equal(rowA.y + LAYOUT.ROW_H / 2, tableB.y + tableB.h / 2);
  // 父表格保持紧凑（自身 1 行），孙表格 5 行
  assert.equal(tableA.h, LAYOUT.ROW_H + LAYOUT.PAD_Y * 2);
  assert.equal(tableB.h, LAYOUT.ROW_H * 5 + LAYOUT.PAD_Y * 2);
}
