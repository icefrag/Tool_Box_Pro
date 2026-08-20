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
  // 根表格 + 4 个直接复合子 + table_with_header 的 2 个对象
  assert.equal(tables.size, 7);
  assert.ok(tables.has('$'));
  assert.ok(tables.has('$.object'));
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
  const { rows, tables } = layoutTree(tree, new Set(['$.a']));
  assert.ok(!tables.has('$.a'));
  assert.ok(rows.has('$.a'));
  assert.ok(!rows.has('$.a.x'));
  assert.equal(tables.size, 1);
}

// 展开行高度撑起子表格：行 y 在其占用空间内居中
{
  const { rows, tables } = layoutTree(T('{"a": {"x": 1, "y": 2, "z": 3}, "b": 1}'));
  const sub = tables.get('$.a');
  assert.equal(sub.h, LAYOUT.ROW_H * 3 + LAYOUT.PAD_Y * 2);
  const rowA = rows.get('$.a');
  assert.equal(rowA.y + LAYOUT.ROW_H / 2, LAYOUT.PAD_Y + sub.h / 2);
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

// 展开行垂直空间 >= 其子表格高度（嵌套两层）
{
  const json = JSON.stringify({ a: { b: { c: 1, d: 2, e: 3, f: 4, g: 5 } } });
  const { rows, tables } = layoutTree(T(json));
  const rowA = rows.get('$.a');
  const tableA = tables.get('$.a');
  const tableB = tables.get('$.a.b');
  // $.a 行垂直居中于其子表格；孙表格亦居中于同一中轴
  assert.equal(rowA.y + LAYOUT.ROW_H / 2, tableA.y + tableA.h / 2);
  assert.equal(tableB.y + tableB.h / 2, tableA.y + tableA.h / 2);
  assert.ok(tableA.h >= LAYOUT.ROW_H * 5);
}
