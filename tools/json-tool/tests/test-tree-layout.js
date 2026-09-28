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
  // 根表格 + object + 标量数组 twh + preview + table_with_header 网格（对象数组合并为一张网格表格）
  assert.equal(tables.size, 5);
  assert.ok(tables.has('$'));
  assert.ok(tables.has('$.object'));
  assert.equal(tables.get('$.table_with_header').kind, 'grid');
  assert.ok(!tables.has('$.table_with_header[0]'));
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

// 网格数组：对象数组合并为一张网格表格（表头=字段并集），直连数组行
{
  const { rows, tables, edges } = layoutTree(T('{"recordScoreR": [{"a": 1}, {"b": 2}]}'));
  assert.ok(tables.has('$.recordScoreR'));
  assert.equal(tables.get('$.recordScoreR').kind, 'grid');
  assert.ok(!tables.has('$.recordScoreR[0]'));
  assert.ok(rows.has('$.recordScoreR'));
  assert.deepEqual(edges, [{ from: '$.recordScoreR', to: '$.recordScoreR' }]);
}

// 网格数组折叠：整张网格收起，无子表格无连线
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

// 空对象元素数组不透明（普通行表格）；根对象数组即网格
{
  const { tables } = layoutTree(T('{"l": [{}, {}]}'));
  assert.ok(tables.has('$.l'));
  assert.equal(tables.get('$.l').kind, undefined);
  const rootArr = layoutTree(T('[{"a": 1}]'));
  assert.ok(rootArr.tables.has('$'));
  assert.equal(rootArr.tables.get('$').kind, 'grid');
  assert.ok(!rootArr.tables.has('$[0]'));
  assert.deepEqual(rootArr.edges, []);
}

// 数组套对象数组：外层混合数组透明下钻，内层对象数组渲染为网格，直连外层数组行
{
  const { tables, edges } = layoutTree(T('{"groups": [[{"a": 1}]]}'));
  assert.ok(!tables.has('$.groups'));
  assert.equal(tables.get('$.groups[0]').kind, 'grid');
  assert.deepEqual(edges, [{ from: '$.groups', to: '$.groups[0]' }]);
}

// 透明数组（元素全为标量数组）：跳过中转表格，标量数组表格直连外层数组行
{
  const { tables, edges } = layoutTree(T('{"pairs": [[1, 2]]}'));
  assert.ok(!tables.has('$.pairs'));
  assert.ok(tables.has('$.pairs[0]'));
  assert.equal(tables.get('$.pairs[0]').kind, undefined);
  assert.deepEqual(edges, [{ from: '$.pairs', to: '$.pairs[0]' }]);
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

// ── 网格表格 ──────────────────────────

// 用户示例数据：features 3 元素 → 一张网格表格（表头+3 行），单元格进 rows，缺失字段无单元格
{
  const json = JSON.stringify({ features: [
    { id: 1, title: 'Cookie 获取', enabled: true },
    { id: 2, title: 'XPath Helper', enabled: true },
    { id: 3, title: 'JSON 树图', enabled: true, tags: ['json', 'tree', 'graph'] },
  ] });
  const { rows, tables, edges } = layoutTree(T(json));
  const g = tables.get('$.features');
  assert.equal(g.kind, 'grid');
  assert.ok(!tables.has('$.features[0]'));
  assert.equal(g.w, LAYOUT.GRID_COL_W * 4); // cols = id/title/enabled/tags
  assert.equal(g.h, LAYOUT.ROW_H * (1 + 3) + LAYOUT.PAD_Y * 2);
  assert.ok(rows.has('$.features[0].id'));
  assert.ok(rows.has('$.features[2].tags'));
  assert.ok(!rows.has('$.features[0].tags')); // 元素 0 无 tags 字段 → 无单元格
  assert.ok(edges.some((e) => e.from === '$.features' && e.to === '$.features'));
  assert.ok(edges.some((e) => e.from === '$.features[2].tags' && e.to === '$.features[2].tags'));
}

// 单元格按列对齐：同字段跨行同 x，单元格宽 = 表宽 / 列数
{
  const { rows, tables } = layoutTree(T(JSON.stringify({ f: [{ a: 1, b: 2 }, { b: 3 }] })));
  const g = tables.get('$.f');
  const colW = g.w / 2;
  assert.equal(rows.get('$.f[0].a').x, g.x);
  assert.equal(rows.get('$.f[0].b').x, g.x + colW);
  assert.equal(rows.get('$.f[1].b').x, g.x + colW);
  assert.equal(rows.get('$.f[0].a').w, colW);
  assert.equal(rows.get('$.f[0].a').y, LAYOUT.PAD_Y + (1 + 0) * LAYOUT.ROW_H); // 数据行跳过表头
}

// 网格单元格复合值：子表格挂在单元格右缘（递归：孙网格同规则）
{
  const json = JSON.stringify({ rows: [{ items: [{ a: 1 }, { b: 2 }] }] });
  const { tables, edges } = layoutTree(T(json));
  assert.equal(tables.get('$.rows').kind, 'grid');
  assert.equal(tables.get('$.rows[0].items').kind, 'grid'); // 网格单元格里的对象数组 → 孙网格
  assert.ok(edges.some((e) => e.from === '$.rows[0].items' && e.to === '$.rows[0].items'));
}

// 网格宽度：按列数加宽、封顶 GRID_MAX_W；列宽影响下一层子表 x
{
  const wide = layoutTree(T(JSON.stringify({ a: [{ c1: 1, c2: 2, c3: 3, c4: 4, c5: 5, c6: 6, c7: 7, c8: 8 }] })));
  assert.equal(wide.tables.get('$.a').w, LAYOUT.GRID_MAX_W);

  const json = JSON.stringify({ g: [{ a: 1, b: 2, c: 3, e: { x: 1 } }], p: { y: 1 } });
  const { tables } = layoutTree(T(json));
  assert.equal(tables.get('$.g').w, LAYOUT.GRID_COL_W * 4);
  // 同层普通表列起点不变；下一列起点因本层最大表宽（网格 480 > 普通 300）右移
  assert.equal(tables.get('$.p').x, COL_PITCH);
  assert.equal(tables.get('$.g[0].e').x, COL_PITCH + LAYOUT.GRID_COL_W * 4 + LAYOUT.TABLE_GAP);

  // 纯普通表格场景回归：列起点仍为 COL_PITCH
  const plain = layoutTree(T('{"a": {"x": 1}, "b": {"y": 1}}'));
  assert.equal(plain.tables.get('$.a').x, COL_PITCH);
}

// 网格高度只由表头+行数决定，不被单元格挂出的子表撑大
{
  const { tables } = layoutTree(T('{"g":[{"n":{"x":1,"y":2,"z":3}}]}'));
  assert.equal(tables.get('$.g').h, LAYOUT.ROW_H * 2 + LAYOUT.PAD_Y * 2);
}

// 折叠网格内的复合单元格：对应子表格与连线消失
{
  const json = JSON.stringify({ g: [{ t: ['a'] }] });
  const { tables, edges } = layoutTree(T(json), new Set(['$.g[0].t']));
  assert.ok(tables.has('$.g'));
  assert.ok(!tables.has('$.g[0].t'));
  assert.deepEqual(edges.filter((e) => e.to === '$.g[0].t'), []);
}

// 网格单元格是透明数组（元素为数组）时：测宽与布局深度一致，深层网格不与父网格叠压
{
  const json = JSON.stringify({ g: [{ pairs: [[{ a: 1, b: 2, c: 3, d: 4, items: [{ x: 1, y: 2 }] }]] }] });
  const { tables } = layoutTree(T(json));
  assert.ok(!tables.has('$.g[0].pairs')); // 透明数组无中转表
  const mid = tables.get('$.g[0].pairs[0]');            // 孙网格（5 列）
  const leaf = tables.get('$.g[0].pairs[0][0].items');  // 曾孙网格
  assert.ok(mid.x >= tables.get('$.g').x + tables.get('$.g').w, '孙网格须在网格右缘之外');
  assert.ok(leaf.x >= mid.x + mid.w, `曾孙网格须在孙网格右缘之外: ${leaf.x} < ${mid.x + mid.w}`);
}
