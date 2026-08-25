// 流拼接测试
import assert from 'node:assert/strict';
import { concatChunks, mergeFmp4Segments } from '../lib/stream-merger.js';

const a = new Uint8Array([1, 2, 3]);
const b = new Uint8Array([4, 5]);
const c = new Uint8Array([6]);

assert.deepEqual([...concatChunks([a, b, c])], [1, 2, 3, 4, 5, 6]);
assert.deepEqual([...concatChunks([])], []);

// fMP4：init 段打头
const merged = mergeFmp4Segments(new Uint8Array([9, 9]), [a, b]);
assert.deepEqual([...merged], [9, 9, 1, 2, 3, 4, 5]);
console.log('test-stream-merger ok');
