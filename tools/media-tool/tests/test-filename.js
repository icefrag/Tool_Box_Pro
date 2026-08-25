// 文件名生成与清洗测试
import assert from 'node:assert/strict';
import { filenameFromUrl, sanitizeFilename } from '../lib/filename.js';

// 正常：取 pathname 最后一段，忽略查询串
assert.equal(filenameFromUrl('https://x.com/v/video123.mp4?e=1&sig=x'), 'video123.mp4');
// URL 编码还原
assert.equal(filenameFromUrl('https://x.com/v/%E6%B5%8B%E8%AF%95.mp4'), '测试.mp4');
// 非法 URL → 兜底名
assert.equal(filenameFromUrl('::::'), 'media.mp4');
assert.equal(filenameFromUrl('https://x.com/', 'm4a'), 'media.m4a');
// 无扩展名 → 追加兜底扩展
assert.equal(filenameFromUrl('https://x.com/stream', 'm4a'), 'stream.m4a');
// 清洗 Windows 非法字符
assert.equal(sanitizeFilename('a:b*c?.mp4'), 'a_b_c_.mp4');
assert.equal(sanitizeFilename('   '), 'media');
console.log('test-filename ok');
