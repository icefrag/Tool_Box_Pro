import assert from 'node:assert/strict';
import { parseJson, childPath, itemPath } from '../json-parser.js';

// 基础解析 + 区间
{
  const text = '{"a": 1}';
  const r = parseJson(text);
  assert.equal(r.ok, true);
  assert.equal(r.ast.type, 'object');
  const prop = r.ast.properties[0];
  assert.equal(prop.key, 'a');
  assert.equal(prop.value.type, 'number');
  assert.equal(prop.value.value, 1);
  assert.equal(text.slice(prop.value.start, prop.value.end), '1');
  assert.equal(text.slice(prop.keyStart, prop.keyEnd), '"a"');
}

// 嵌套区间
{
  const text = '{"a": {"b": [1, "x"]}}';
  const r = parseJson(text);
  const inner = r.ast.properties[0].value.properties[0].value.items[1];
  assert.equal(text.slice(inner.start, inner.end), '"x"');
  assert.equal(inner.value, 'x');
}

// 字符串转义
{
  const r = parseJson('{"k": "a\\"b\\u0041"}');
  assert.equal(r.ast.properties[0].value.value, 'a"bA');
}

// 顶层标量
{
  const r = parseJson('42');
  assert.equal(r.ok, true);
  assert.equal(r.ast.value, 42);
}

// 错误：行列号
{
  const r = parseJson('{abc}');
  assert.equal(r.ok, false);
  assert.equal(r.error.line, 1);
  assert.equal(r.error.column, 2);
}

// 错误：跨行定位
{
  const r = parseJson('{\n  "a": ,\n}');
  assert.equal(r.ok, false);
  assert.equal(r.error.line, 2);
}

// 尾随垃圾 / 空输入
{
  assert.equal(parseJson('{} x').ok, false);
  assert.equal(parseJson('').ok, false);
  assert.equal(parseJson('   ').ok, false);
}

// 深度限制：500 层通过，501 层报错
{
  assert.equal(parseJson('['.repeat(500) + ']'.repeat(500)).ok, true);
  const r = parseJson('['.repeat(501) + ']'.repeat(501));
  assert.equal(r.ok, false);
  assert.match(r.error.message, /500/);
}

// 数字格式
{
  assert.equal(parseJson('{"n": -1.5e3}').ast.properties[0].value.value, -1500);
  assert.equal(parseJson('01').ok, false);
  assert.equal(parseJson('1.').ok, false);
}

// path 构造工具
{
  assert.equal(childPath('$', 'a'), '$.a');
  assert.equal(childPath('$', 'a b'), '$["a b"]');
  assert.equal(itemPath('$.a', 0), '$.a[0]');
}
