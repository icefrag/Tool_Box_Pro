import assert from 'node:assert/strict';
import { ellipsize } from '../tree-graph.js';

// 不超宽：原样返回
assert.equal(ellipsize('abc', 10), 'abc');
assert.equal(ellipsize('', 10), '');

// 半角截断：内容填满上限后附加省略号
assert.equal(ellipsize('abcdefghijklmnop', 10), 'abcdefghij…');

// 中文按 2 单位加权：22 单位容纳 11 个汉字（张三同学计算进步明显继 = 11 字），其后以 … 结尾
assert.equal(ellipsize('张三同学计算进步明显继续保持好好学习', 22), '张三同学计算进步明显继…');

// 中英混排按视觉宽度累计
assert.equal(ellipsize('abc张三', 6), 'abc张…');
assert.equal(ellipsize('abc张三', 7), 'abc张三');

// 全角标点也按 2 单位
assert.equal(ellipsize('你好，世界', 9), '你好，世…');

// 恰好等于宽度上限：不截断
assert.equal(ellipsize('张三同学', 8), '张三同学');
