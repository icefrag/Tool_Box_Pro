// m3u8 解析测试
import assert from 'node:assert/strict';
import { parseM3u8, pickBestVariant } from '../lib/m3u8-parser.js';

const BASE = 'https://cdn.x.com/live/playlist.m3u8';

// 媒体播放列表：相对 URL 解析为绝对、AES key、fMP4 init 段
const media = parseM3u8([
  '#EXTM3U',
  '#EXT-X-VERSION:6',
  '#EXT-X-TARGETDURATION:6',
  '#EXT-X-MEDIA-SEQUENCE:10',
  '#EXT-X-KEY:METHOD=AES-128,URI="enc.key",IV=0x9c7db877f50769be',
  '#EXT-X-MAP:URI="init.mp4"',
  '#EXTINF:5.0,',
  'seg0.ts',
  '#EXTINF:5.0,',
  'seg1.ts',
  '#EXTINF:5.0,',
  'sub/seg2.ts',
].join('\n'), BASE);

assert.equal(media.isMaster, false);
assert.equal(media.mediaSequence, 10);
assert.equal(media.segments.length, 3);
assert.equal(media.segments[0].url, 'https://cdn.x.com/live/seg0.ts');
assert.equal(media.segments[2].url, 'https://cdn.x.com/live/sub/seg2.ts');
assert.equal(media.segments[1].key, media.keys[0], '分片共享同一个 key 对象');
assert.equal(media.keys[0].method, 'AES-128');
assert.equal(media.keys[0].uri, 'https://cdn.x.com/live/enc.key');
assert.equal(media.keys[0].iv, '0x9c7db877f50769be');
assert.equal(media.initSegment, 'https://cdn.x.com/live/init.mp4');

// master 播放列表：变体按码率选择
const master = parseM3u8([
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=640x360',
  'low/index.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=4128000,RESOLUTION=1920x1080',
  'high/index.m3u8',
].join('\n'), BASE);

assert.equal(master.isMaster, true);
assert.equal(master.variants.length, 2);
assert.equal(master.variants[0].url, 'https://cdn.x.com/live/low/index.m3u8');
assert.equal(master.variants[0].resolution, '640x360');
const best = pickBestVariant(master.variants);
assert.equal(best.url, 'https://cdn.x.com/live/high/index.m3u8');
assert.equal(best.bandwidth, 4128000);

// NONE key 不收录
const noKey = parseM3u8(['#EXTM3U', '#EXT-X-KEY:METHOD=NONE', '#EXTINF:5.0,', 'a.ts'].join('\n'), BASE);
assert.equal(noKey.keys.length, 0);
assert.equal(noKey.segments[0].key, null);

// 非法内容抛错
assert.throws(() => parseM3u8('hello world', BASE), /不是有效的m3u8/);
console.log('test-m3u8-parser ok');
