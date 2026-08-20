import assert from 'node:assert/strict';
import { parseJson } from '../json-parser.js';
import { buildTree, findNodeAt, findNodeById } from '../tree-model.js';

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
