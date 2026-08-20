import assert from 'node:assert/strict';
import { parseJson } from '../json-parser.js';
import { buildTree } from '../tree-model.js';
import { findMatches } from '../search.js';

const json = '{"apple": 1, "banana": "apple", "cat": {"dog": 2}}';
const tree = buildTree(parseJson(json).ast);

// key 与标量值都参与匹配，大小写不敏感
{
  const matches = findMatches(tree, 'APP');
  assert.equal(matches.length, 2);
  assert.ok(matches.some((m) => m.path === '$.apple' && m.isKey));
  const valueMatch = matches.find((m) => !m.isKey);
  assert.equal(valueMatch.path, '$.banana');
  assert.equal(json.slice(valueMatch.start, valueMatch.end), '"apple"');
}

// 数字值匹配
{
  const matches = findMatches(tree, '2');
  assert.ok(matches.some((m) => m.path === '$.cat.dog' && !m.isKey));
}

// 空查询 / 空树
assert.deepEqual(findMatches(tree, '   '), []);
assert.deepEqual(findMatches(null, 'app'), []);
