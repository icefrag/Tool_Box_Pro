// URL 分类测试
import assert from 'node:assert/strict';
import {
  classifyMediaRequest,
  mediaExtensionFromUrl,
  isMediaContentType,
} from '../lib/url-classifier.js';

// 扩展名识别只看 pathname，容忍查询串签名
assert.equal(mediaExtensionFromUrl('https://x.com/v/a.mp4?e=1&sig=abc'), 'mp4');
assert.equal(mediaExtensionFromUrl('https://x.com/upgcxcode/video.m4s?upsig=x'), 'm4s');
assert.equal(mediaExtensionFromUrl('https://x.com/noext'), null);
assert.equal(mediaExtensionFromUrl('not a url'), null);

// Content-Type 判断
assert.equal(isMediaContentType('video/mp4'), true);
assert.equal(isMediaContentType('AUDIO/M4A'), true);
assert.equal(isMediaContentType('application/vnd.apple.mpegurl'), true);
assert.equal(isMediaContentType('text/html'), false);
assert.equal(isMediaContentType(''), false);

// 综合分类
// 直链 mp4（带签名参数）
assert.deepEqual(classifyMediaRequest('https://x.com/v/a.mp4?e=1'), { ext: 'mp4', streamKind: 'video' });
// m3u8 优先判为 playlist，即使 Content-Type 是 video/*
assert.deepEqual(classifyMediaRequest('https://x.com/hls/index.m3u8', 'video/mp4'), { ext: 'm3u8', streamKind: 'playlist' });
// B站式整文件 m4s：Content-Type 区分视频/音频
assert.deepEqual(classifyMediaRequest('https://x.com/video.m4s', 'video/mp4'), { ext: 'm4s', streamKind: 'video' });
assert.deepEqual(classifyMediaRequest('https://x.com/audio.m4s', 'audio/mp4'), { ext: 'm4s', streamKind: 'audio' });
// 无扩展名但 Content-Type 是媒体
assert.deepEqual(classifyMediaRequest('https://x.com/stream?id=9', 'video/webm'), { ext: null, streamKind: 'video' });
// ts 无类型上下文 → segment
assert.deepEqual(classifyMediaRequest('https://x.com/s/001.ts'), { ext: 'ts', streamKind: 'segment' });
// 非媒体
assert.equal(classifyMediaRequest('https://x.com/a.png'), null);
assert.equal(classifyMediaRequest('https://x.com/page', 'text/html'), null);
console.log('test-url-classifier ok');
