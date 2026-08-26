# 媒体嗅探下载工具（media-sniffer）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use nbl.subagent-driven-development (recommended) or nbl.executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 ToolBox Pro 新增通用媒体嗅探工具：webRequest 嗅探页面加载的视频/音频/HLS 流并下载落盘。

**Architecture:** 纯函数库（`tools/media-tool/lib/`，node 可测）+ 后台双引擎（Sniffer 识别归档 / Downloader 拉取组装）+ offscreen 文档持有 blob + popup 内 BaseTool UI，全部通过 `MessageHandler` 与 `storage.session` 通信。

**Tech Stack:** Chrome Extension MV3 原生 ES Modules（无构建、无第三方依赖）；WebCrypto（AES-128 HLS 解密）；node ≥ 19 跑纯函数测试（本机 v24）。

**规格来源:** `docs/nbl/specs/2026-08-25-media-sniffer-design.md`

## Global Constraints

- MV3，无构建步骤：所有代码原生 ES modules，禁止引入第三方依赖（不打包 ffmpeg/mux.js）
- `tools/media-tool/lib/` 纯函数禁止 import `chrome.*` API，必须能在 node 直接运行测试
- 测试风格沿用 json-tool：`node:assert/strict` 顶层断言 + `run-tests.js` 聚合入口
- UI 文案全部中文；提交消息遵循约定式提交（feat/fix/docs/chore）
- v1 明确不支持并如实标注：DRM、音视频合并、分片级独立签名流、mpd/DASH、非 16 字节对齐的 AES 加密分片
- manifest 权限只新增：`webRequest`、`downloads`、`declarativeNetRequest`、`offscreen`；host_permissions 保持 `<all_urls>` 不变

---

### Task 1: URL 分类纯函数库

**状态**
- [ ] 任务完成

**Dependencies:** None
**Parallelizable:** Yes（与 Task 2/3/4 并行）

**Files:**
- Create: `tools/media-tool/lib/url-classifier.js`
- Test: `tools/media-tool/tests/test-url-classifier.js`
- Test: `tools/media-tool/tests/run-tests.js`

- [ ] **Step 1: 创建测试 runner（照抄 json-tool 模式）**

```js
// 纯函数模块测试入口：node tools/media-tool/tests/run-tests.js
import { readdirSync } from 'node:fs';

const dir = new URL('.', import.meta.url);
const files = readdirSync(dir).filter((f) => f.startsWith('test-') && f.endsWith('.js')).sort();

let failed = 0;
for (const f of files) {
  try {
    await import(new URL(f, dir).href);
    console.log(`PASS ${f}`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${f}\n${e && e.stack || e}`);
  }
}
console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
if (failed) process.exit(1);
```

- [ ] **Step 2: 写失败测试**

```js
// tools/media-tool/tests/test-url-classifier.js
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
```

- [ ] **Step 3: 运行确认失败**

Run: `node tools/media-tool/tests/test-url-classifier.js`
Expected: FAIL（Cannot find module .../url-classifier.js）

- [ ] **Step 4: 最小实现**

```js
// 媒体 URL 分类（纯函数，禁止 import chrome API）
const MEDIA_EXTENSIONS = new Set(['mp4', 'webm', 'm3u8', 'ts', 'm4s', 'flv', 'mov']);

const MEDIA_CONTENT_TYPE_PREFIXES = [
  'video/',
  'audio/',
  'application/x-mpegurl',
  'application/vnd.apple.mpegurl',
];

// 从 URL 提取媒体扩展名；仅看 pathname，容忍查询串与签名
export function mediaExtensionFromUrl(url) {
  try {
    const m = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

export function isMediaContentType(contentType) {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  return MEDIA_CONTENT_TYPE_PREFIXES.some((p) => ct.startsWith(p));
}

// 返回 null 表示非媒体；否则 { ext, streamKind }
// streamKind: 'playlist' | 'segment' | 'video' | 'audio'
export function classifyMediaRequest(url, contentType = '') {
  const ext = mediaExtensionFromUrl(url);
  const typeMatch = isMediaContentType(contentType);
  const extMatch = ext && MEDIA_EXTENSIONS.has(ext);
  if (!extMatch && !typeMatch) return null;

  if (ext === 'm3u8') return { ext, streamKind: 'playlist' };
  if (typeMatch) {
    return { ext, streamKind: contentType.toLowerCase().startsWith('audio/') ? 'audio' : 'video' };
  }
  return { ext, streamKind: ext === 'ts' || ext === 'm4s' ? 'segment' : 'video' };
}
```

- [ ] **Step 5: 运行确认通过**

Run: `node tools/media-tool/tests/test-url-classifier.js`
Expected: `test-url-classifier ok`

- [ ] **Step 6: Commit**

```bash
git add tools/media-tool/lib/url-classifier.js tools/media-tool/tests/
git commit -m "feat(media-sniffer): add media URL classifier with tests"
```

---

### Task 2: 文件名生成与清洗纯函数库

**状态**
- [ ] 任务完成

**Dependencies:** None
**Parallelizable:** Yes（与 Task 1/3/4 并行）

**Files:**
- Create: `tools/media-tool/lib/filename.js`
- Test: `tools/media-tool/tests/test-filename.js`

- [ ] **Step 1: 写失败测试**

```js
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
```

- [ ] **Step 2: 运行确认失败**

Run: `node tools/media-tool/tests/test-filename.js`
Expected: FAIL（Cannot find module）

- [ ] **Step 3: 最小实现**

```js
// 文件名生成与清洗（纯函数，禁止 import chrome API）
export function sanitizeFilename(name) {
  const cleaned = String(name).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 150) || 'media';
}

export function filenameFromUrl(url, fallbackExt = 'mp4') {
  let base = '';
  try {
    base = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
  } catch {
    base = '';
  }
  let decoded = base;
  try {
    decoded = decodeURIComponent(base);
  } catch {
    // 非法百分号序列，保留原样
  }
  let name = sanitizeFilename(decoded);
  if (!name) {
    name = `media.${fallbackExt}`;
  }
  if (!/\.[a-z0-9]{2,5}$/i.test(name)) {
    name += `.${fallbackExt}`;
  }
  return name;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node tools/media-tool/tests/test-filename.js`
Expected: `test-filename ok`

- [ ] **Step 5: Commit**

```bash
git add tools/media-tool/lib/filename.js tools/media-tool/tests/test-filename.js
git commit -m "feat(media-sniffer): add filename sanitizer with tests"
```

---

### Task 3: m3u8 解析纯函数库

**状态**
- [ ] 任务完成

**Dependencies:** None
**Parallelizable:** Yes（与 Task 1/2/4 并行）

**Files:**
- Create: `tools/media-tool/lib/m3u8-parser.js`
- Test: `tools/media-tool/tests/test-m3u8-parser.js`

- [ ] **Step 1: 写失败测试**

```js
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
```

- [ ] **Step 2: 运行确认失败**

Run: `node tools/media-tool/tests/test-m3u8-parser.js`
Expected: FAIL（Cannot find module）

- [ ] **Step 3: 最小实现**

```js
// HLS m3u8 解析（纯函数，禁止 import chrome API）
// master: { isMaster: true, variants: [{ url, bandwidth, resolution }] }
// media:  { isMaster: false, mediaSequence, segments: [{ url, key }], initSegment, keys }
export function parseM3u8(text, baseUrl) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (!lines.length || !lines[0].startsWith('#EXTM3U')) {
    throw new Error('不是有效的m3u8播放列表');
  }
  const resolve = (u) => new URL(u, baseUrl).href;

  const variants = [];
  const segments = [];
  const keys = [];
  let initSegment = null;
  let mediaSequence = 0;
  let pendingKey = null;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      const attrs = parseAttributes(line.slice('#EXT-X-STREAM-INF:'.length));
      const next = lines[i + 1];
      if (next && !next.startsWith('#')) {
        variants.push({
          url: resolve(next),
          bandwidth: Number(attrs.BANDWIDTH || attrs['AVERAGE-BANDWIDTH'] || 0),
          resolution: attrs.RESOLUTION || null,
        });
        i++;
      }
    } else if (line.startsWith('#EXT-X-MAP')) {
      const attrs = parseAttributes(line.slice('#EXT-X-MAP:'.length));
      if (attrs.URI) initSegment = resolve(attrs.URI);
    } else if (line.startsWith('#EXT-X-KEY')) {
      const attrs = parseAttributes(line.slice('#EXT-X-KEY:'.length));
      if (attrs.METHOD && attrs.METHOD !== 'NONE') {
        pendingKey = {
          method: attrs.METHOD,
          uri: attrs.URI ? resolve(attrs.URI) : null,
          iv: attrs.IV || null,
        };
        keys.push(pendingKey);
      } else {
        pendingKey = null;
      }
    } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE')) {
      mediaSequence = Number(line.split(':')[1] || 0);
    } else if (!line.startsWith('#')) {
      segments.push({ url: resolve(line), key: pendingKey });
    }
  }

  return { isMaster: variants.length > 0 && segments.length === 0, variants, segments, initSegment, keys, mediaSequence };
}

// 选最高码率变体
export function pickBestVariant(variants) {
  return variants.slice().sort((a, b) => b.bandwidth - a.bandwidth)[0] || null;
}

// 解析标签属性 ATTR=value 或 ATTR="quoted value"
function parseAttributes(s) {
  const attrs = {};
  const re = /([A-Z0-9-]+)=("([^"]*)"|[^,]*)/g;
  let m;
  while ((m = re.exec(s))) {
    attrs[m[1]] = m[2].startsWith('"') ? m[3] : m[2];
  }
  return attrs;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node tools/media-tool/tests/test-m3u8-parser.js`
Expected: `test-m3u8-parser ok`

- [ ] **Step 5: Commit**

```bash
git add tools/media-tool/lib/m3u8-parser.js tools/media-tool/tests/test-m3u8-parser.js
git commit -m "feat(media-sniffer): add m3u8 playlist parser with tests"
```

---

### Task 4: AES 解密与流拼接纯函数库

**状态**
- [ ] 任务完成

**Dependencies:** None
**Parallelizable:** Yes（与 Task 1/2/3 并行）

**Files:**
- Create: `tools/media-tool/lib/hls-decrypt.js`
- Create: `tools/media-tool/lib/stream-merger.js`
- Test: `tools/media-tool/tests/test-hls-decrypt.js`
- Test: `tools/media-tool/tests/test-stream-merger.js`

- [ ] **Step 1: 写失败测试（解密）**

```js
import assert from 'node:assert/strict';
import { decryptAes128, ivFromMediaSequence, ivFromHexString } from '../lib/hls-decrypt.js';

// 序号 IV：128 位大端，低 32 位为媒体序号
const seqIv = ivFromMediaSequence(10);
assert.equal(seqIv.length, 16);
assert.equal(seqIv[15], 10);
assert.equal(seqIv[12], 0);

// 显式 IV 十六进制还原
const hexIv = ivFromHexString('0x9c7db877f50769be');
assert.equal(hexIv.length, 8);
assert.deepEqual([...hexIv], [0x9c, 0x7d, 0xb8, 0x77, 0xf5, 0x07, 0x69, 0xbe]);

// 加解密往返：WebCrypto AES-CBC（PKCS7 填充，即 HLS 规范行为）
const keyBytes = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(16));
const plain = crypto.getRandomValues(new Uint8Array(333));
const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt']);
const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, cryptoKey, plain));
const decrypted = await decryptAes128(cipher, keyBytes, iv);
assert.equal(decrypted.byteLength, plain.byteLength);
assert.deepEqual([...decrypted], [...plain]);

// 非 16 字节对齐的密文：明确抛错（v1 不支持不规范流）
await assert.rejects(() => decryptAes128(new Uint8Array(10), keyBytes, iv), /不符合 AES-128 规范/);
console.log('test-hls-decrypt ok');
```

- [ ] **Step 2: 写失败测试（拼接）**

```js
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
```

- [ ] **Step 3: 运行确认失败**

Run: `node tools/media-tool/tests/test-hls-decrypt.js && node tools/media-tool/tests/test-stream-merger.js`
Expected: FAIL（Cannot find module）

- [ ] **Step 4: 最小实现**

```js
// HLS AES-128 解密（WebCrypto，浏览器与 node ≥19 通用）
// 仅支持 HLS 规范要求的 PKCS7 填充（分片长度 16 字节对齐）
export function ivFromMediaSequence(seq) {
  const iv = new Uint8Array(16);
  new DataView(iv.buffer).setUint32(12, seq >>> 0);
  return iv;
}

export function ivFromHexString(hex) {
  const h = String(hex).replace(/^0x/i, '');
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.substr(i * 2, 2), 16);
  }
  return bytes;
}

export async function decryptAes128(encrypted, keyBytes, iv) {
  if (encrypted.byteLength % 16 !== 0) {
    throw new Error('加密分片长度不符合 AES-128 规范（非 16 字节对齐），暂不支持');
  }
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, encrypted);
  return new Uint8Array(plain);
}
```

```js
// TS / fMP4 分片拼接（纯函数，禁止 import chrome API）
export function concatChunks(chunks) {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

// fMP4：init 段（ftyp+moov）打头，媒体段顺序拼接
export function mergeFmp4Segments(initChunk, chunks) {
  return concatChunks([initChunk, ...chunks]);
}
```

- [ ] **Step 5: 运行确认通过**

Run: `node tools/media-tool/tests/run-tests.js`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add tools/media-tool/lib/hls-decrypt.js tools/media-tool/lib/stream-merger.js tools/media-tool/tests/
git commit -m "feat(media-sniffer): add AES-128 decryptor and stream merger with tests"
```

---

### Task 5: MediaSniffer 嗅探引擎（background）

**状态**
- [ ] 任务完成

**Dependencies:** Task 1, Task 2
**Parallelizable:** Yes（Task 1/2 完成后可与 Task 6 并行）

**Files:**
- Create: `background/media-sniffer.js`
- Modify: `background/service-worker.js`

说明：chrome.* 环境无法用 node 测试，本任务验证方式为「加载扩展后用真实页面触发 + storage 检查」，纯逻辑已由 Task 1/2 覆盖。

- [ ] **Step 1: 实现 MediaSniffer**

```js
// 媒体嗅探引擎：webRequest 监听 → 识别 → storage.session 按 tab 归档
import { classifyMediaRequest } from '../tools/media-tool/lib/url-classifier.js';
import { filenameFromUrl } from '../tools/media-tool/lib/filename.js';

const MIN_BYTES = 100 * 1024; // 小于 100KB 视为噪声
const MAX_PER_TAB = 50;
const storageKey = (tabId) => `media:${tabId}`;

export class MediaSniffer {
  constructor() {
    this.pending = new Map();   // requestId -> { url, tabId, documentUrl }
    this.playlists = new Map(); // tabId -> Set<m3u8 url>，分片归并上下文（SW 重启失效，可接受）
  }

  start() {
    chrome.webRequest.onBeforeRequest.addListener((d) => this.onRequest(d), { urls: ['<all_urls>'] });
    chrome.webRequest.onHeadersReceived.addListener((d) => this.onHeaders(d), { urls: ['<all_urls>'] });
    chrome.tabs.onRemoved.addListener((tabId) => this.cleanup(tabId));
  }

  onRequest(details) {
    if (details.tabId < 0) return;
    const url = details.url;
    if (url.startsWith('chrome-extension://') || url.startsWith('blob:') || url.startsWith('data:')) return;
    const cls = classifyMediaRequest(url);
    if (!cls) return;
    this.pending.set(details.requestId, {
      url,
      tabId: details.tabId,
      documentUrl: details.documentUrl || details.initiator || '',
    });
  }

  async onHeaders(details) {
    const info = this.pending.get(details.requestId);
    if (!info || details.tabId < 0 || details.tabId !== info.tabId) return;
    this.pending.delete(details.requestId);

    const headers = details.responseHeaders || [];
    const pick = (name) => (headers.find((h) => h.name.toLowerCase() === name) || {}).value || '';
    const contentType = pick('content-type');
    const contentLength = Number(pick('content-length') || 0);

    const cls = classifyMediaRequest(details.url, contentType);
    if (!cls) return;

    // m3u8：单列一条 HLS 条目，并登记分片归并上下文
    if (cls.streamKind === 'playlist') {
      await this.upsert(details.tabId, {
        id: `hls-${details.requestId}`,
        kind: 'hls',
        url: details.url,
        documentUrl: info.documentUrl,
        contentType,
        contentLength,
        filename: filenameFromUrl(details.url, 'm3u8'),
        firstSeenAt: Date.now(),
        status: 'idle',
        segmentCount: 0,
      });
      if (!this.playlists.has(details.tabId)) this.playlists.set(details.tabId, new Set());
      this.playlists.get(details.tabId).add(details.url);
      return;
    }

    // 分片：本 tab 出现过 m3u8 则归并到最后一条 HLS 条目名下，不单列
    if (cls.streamKind === 'segment' && this.playlists.has(details.tabId)) {
      const records = await this.read(details.tabId);
      const hlsEntries = Object.values(records).filter((r) => r.kind === 'hls');
      const target = hlsEntries[hlsEntries.length - 1];
      if (target) {
        target.segmentCount = (target.segmentCount || 0) + 1;
        await this.write(details.tabId, records);
      }
      return;
    }

    // 独立流/直链：小体积噪声过滤
    if (contentLength && contentLength < MIN_BYTES) return;
    const isAudio = cls.streamKind === 'audio';
    await this.upsert(details.tabId, {
      id: `rec-${details.requestId}`,
      kind: isAudio ? 'audio-stream' : cls.ext === 'm4s' || cls.ext === 'ts' ? 'video-stream' : 'direct',
      url: details.url,
      documentUrl: info.documentUrl,
      contentType,
      contentLength,
      filename: filenameFromUrl(details.url, isAudio ? 'm4a' : 'mp4'),
      firstSeenAt: Date.now(),
      status: 'idle',
    });
  }

  async upsert(tabId, record) {
    const records = await this.read(tabId);
    if (records[record.id]) {
      Object.assign(records[record.id], record);
    } else {
      if (Object.values(records).some((r) => r.url === record.url)) return; // 同 URL 去重
      records[record.id] = record;
      // 容量上限：挤出最旧的
      const all = Object.values(records).sort((a, b) => a.firstSeenAt - b.firstSeenAt);
      while (all.length > MAX_PER_TAB) {
        delete records[all.shift().id];
      }
    }
    await this.write(tabId, records);
  }

  async read(tabId) {
    const obj = await chrome.storage.session.get(storageKey(tabId));
    return obj[storageKey(tabId)] || {};
  }

  async write(tabId, records) {
    await chrome.storage.session.set({ [storageKey(tabId)]: records });
    const count = Object.keys(records).length;
    await chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count) : '' });
  }

  async clear(tabId) {
    await chrome.storage.session.remove(storageKey(tabId));
    await chrome.action.setBadgeText({ tabId, text: '' });
  }

  async getRecord(tabId, id) {
    return (await this.read(tabId))[id] || null;
  }

  async cleanup(tabId) {
    this.playlists.delete(tabId);
    await chrome.storage.session.remove(storageKey(tabId));
  }

  registerHandlers(messageHandler) {
    messageHandler.register('media-sniffer', async (request) => {
      const { action, tabId, id } = request;
      if (action === 'getList') {
        const records = await this.read(tabId);
        return Object.values(records).sort((a, b) => b.firstSeenAt - a.firstSeenAt);
      }
      if (action === 'clear') {
        await this.clear(tabId);
        return { cleared: true };
      }
      if (action === 'getRecord') {
        return this.getRecord(tabId, id);
      }
      throw new Error(`未知的 media-sniffer action: ${action}`);
    });
  }
}
```

- [ ] **Step 2: 接入 service-worker（含 offscreen 通道前置过滤）**

`background/service-worker.js` 全量替换为：

```js
// Service Worker - 处理后台任务和消息路由
import { MessageHandler } from '../utils/messaging.js';
import { MediaSniffer } from './media-sniffer.js';

// 初始化消息处理器
const messageHandler = new MessageHandler();

// 媒体嗅探引擎
const sniffer = new MediaSniffer();
sniffer.start();
sniffer.registerHandlers(messageHandler);

// 监听来自content scripts和popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // offscreen 专用通道：不进入 MessageHandler 路由
  if (request && request.target === 'offscreen') return false;
  messageHandler.handle(request, sender, sendResponse);
  return true; // 保持消息通道开启
});

// 监听插件安装事件
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('小工具箱已安装');
  }
});
```

（Task 6 会在此文件继续追加 MediaDownloader 的两行接线。）

- [ ] **Step 3: 手工验证**

1. `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序（选择项目根目录，先完成 Task 8 的 manifest 修改或临时手动在 manifest 加 `webRequest` 权限后重载）
2. 打开任一含直链视频的页面（如 `https://www.w3schools.com/html/html5_video.asp`）播放视频
3. 扩展图标出现 badge 数字；在 service worker 控制台执行
   `chrome.storage.session.get(null, (o) => console.log(o))`，应看到 `media:<tabId>` 键下有 kind 为 `direct` 的记录

- [ ] **Step 4: Commit**

```bash
git add background/media-sniffer.js background/service-worker.js
git commit -m "feat(media-sniffer): add background webRequest sniffer engine"
```

---

### Task 6: MediaDownloader 下载器 + offscreen 落盘

**状态**
- [ ] 任务完成

**Dependencies:** Task 3, Task 4（+Task 5 的 getRecord 接口，需先行合并）
**Parallelizable:** No（依赖 Task 5 的 MediaSniffer 接口与 service-worker 接线点）

**Files:**
- Create: `background/media-downloader.js`
- Create: `offscreen/downloader.html`
- Create: `offscreen/downloader.js`
- Modify: `background/service-worker.js`

- [ ] **Step 1: 实现 offscreen 文档**

`offscreen/downloader.html`：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>media-saver</title>
</head>
<body>
  <script type="module" src="downloader.js"></script>
</body>
</html>
```

`offscreen/downloader.js`：

```js
// offscreen：接收分块数据，拼 blob 并生成 blob URL
// （MV3 service worker 无法稳定持有 blob，官方 BLOBS 场景 offscreen 方案）
const jobs = new Map(); // downloadId -> { chunks: Uint8Array[], mimeType }

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return false;
  (async () => {
    const { command, downloadId } = msg;
    const job = jobs.get(downloadId) || { chunks: [], mimeType: '' };

    if (command === 'begin') {
      job.mimeType = msg.mimeType || '';
      jobs.set(downloadId, job);
      sendResponse({ success: true, data: {} });
    } else if (command === 'chunk') {
      job.chunks.push(new Uint8Array(msg.data));
      jobs.set(downloadId, job);
      sendResponse({ success: true, data: { received: job.chunks.length } });
    } else if (command === 'finish') {
      const total = job.chunks.reduce((n, c) => n + c.byteLength, 0);
      const out = new Uint8Array(total);
      let offset = 0;
      for (const c of job.chunks) {
        out.set(c, offset);
        offset += c.byteLength;
      }
      const blob = new Blob([out], { type: job.mimeType || 'video/mp4' });
      jobs.delete(downloadId);
      sendResponse({ success: true, data: { blobUrl: URL.createObjectURL(blob) } });
    } else if (command === 'revoke') {
      if (msg.blobUrl) URL.revokeObjectURL(msg.blobUrl);
      sendResponse({ success: true, data: {} });
    } else if (command === 'abort') {
      jobs.delete(downloadId);
      sendResponse({ success: true, data: {} });
    }
  })();
  return true; // 异步 sendResponse
});
```

- [ ] **Step 2: 实现 MediaDownloader**

```js
// 媒体下载器：直链/HLS 拉取、AES 解密、offscreen 落盘、进度管理
import { parseM3u8, pickBestVariant } from '../tools/media-tool/lib/m3u8-parser.js';
import { decryptAes128, ivFromMediaSequence, ivFromHexString } from '../tools/media-tool/lib/hls-decrypt.js';
import { concatChunks, mergeFmp4Segments } from '../tools/media-tool/lib/stream-merger.js';

const CONCURRENCY = 6;
const CHUNK_SIZE = 8 * 1024 * 1024; // 消息传输分块，避开消息体积上限
const OFFSCREEN_URL = '/offscreen/downloader.html';
const progressKey = (id) => `download:${id}`;

export class MediaDownloader {
  constructor(sniffer) {
    this.sniffer = sniffer;
    this.tasks = new Map(); // recordId -> AbortController
    this.throttle = new Map(); // recordId -> lastTick
  }

  registerHandlers(messageHandler) {
    messageHandler.register('media-download', async (request) => {
      const { action, tabId, id } = request;
      if (action === 'start') {
        this.start(tabId, id); // 异步执行，立即返回
        return { started: true };
      }
      if (action === 'cancel') {
        this.tasks.get(id)?.abort();
        return { canceled: true };
      }
      throw new Error(`未知的 media-download action: ${action}`);
    });
  }

  async start(tabId, id) {
    if (this.tasks.has(id)) return;
    const controller = new AbortController();
    this.tasks.set(id, controller);
    const record = await this.sniffer.getRecord(tabId, id);
    if (!record) {
      this.tasks.delete(id);
      return;
    }

    let ruleId = null;
    try {
      await this.markEntry(tabId, id, { status: 'running' });
      await this.setProgress(id, { state: 'running', received: 0, total: record.contentLength || 0, error: null });
      ruleId = await this.enableReferer(record);

      const result = record.kind === 'hls'
        ? await this.fetchHls(record, controller.signal, id)
        : { buffer: await this.fetchDirect(record, controller.signal, id), isFmp4: false };

      const filename = outputFilename(record, result.isFmp4);
      const blobUrl = await this.saveViaOffscreen(id, result.buffer, record.contentType);
      await this.triggerDownload(blobUrl, filename);
      await this.notifyOffscreen({ target: 'offscreen', command: 'revoke', downloadId: id, blobUrl }).catch(() => {});

      await this.markEntry(tabId, id, { status: 'done' });
      await this.setProgress(id, { state: 'done' });
    } catch (e) {
      const canceled = controller.signal.aborted;
      await this.notifyOffscreen({ target: 'offscreen', command: 'abort', downloadId: id }).catch(() => {});
      await this.markEntry(tabId, id, { status: canceled ? 'idle' : 'failed' });
      await this.setProgress(id, { state: canceled ? 'canceled' : 'failed', error: e.message });
    } finally {
      if (ruleId !== null) {
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] }).catch(() => {});
      }
      this.tasks.delete(id);
      this.throttle.delete(id);
    }
  }

  // 防盗链：会话级 DNR 规则给目标媒体域补 Referer（host 权限由 <all_urls> 满足）
  async enableReferer(record) {
    const referer = record.documentUrl;
    if (!referer) return null;
    let host = '';
    try {
      host = new URL(record.url).hostname;
    } catch {
      return null;
    }
    const ruleId = stableRuleId(record.id);
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [{
        id: ruleId,
        priority: 1,
        condition: { requestDomains: [host], resourceTypes: ['xmlhttprequest', 'media', 'other'] },
        action: {
          type: 'modifyHeaders',
          setRequestHeaders: [{ header: 'referer', value: referer }],
        },
      }],
    });
    return ruleId;
  }

  async fetchDirect(record, signal, id) {
    const resp = await fetch(record.url, { credentials: 'include', signal });
    if (!resp.ok) throw new Error(`下载失败 HTTP ${resp.status}`);
    const total = Number(resp.headers.get('content-length')) || record.contentLength || 0;
    const reader = resp.body.getReader();
    const parts = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      received += value.byteLength;
      await this.tickProgress(id, { received, total });
    }
    return concatChunks(parts);
  }

  async fetchHls(record, signal, id) {
    // master → 最高码率变体 → 媒体播放列表
    let playlistUrl = record.url;
    let parsed = parseM3u8(await this.fetchText(playlistUrl, signal), playlistUrl);
    if (parsed.isMaster) {
      const best = pickBestVariant(parsed.variants);
      playlistUrl = best.url;
      parsed = parseM3u8(await this.fetchText(playlistUrl, signal), playlistUrl);
    }
    if (!parsed.segments.length) throw new Error('播放列表中没有可下载的分片');

    // 预取全部 AES key
    const keyCache = new Map(); // uri -> Uint8Array
    for (const k of parsed.keys) {
      if (k.method === 'AES-128' && k.uri && !keyCache.has(k.uri)) {
        const resp = await fetch(k.uri, { credentials: 'include', signal });
        if (!resp.ok) throw new Error(`拉取密钥失败 HTTP ${resp.status}`);
        keyCache.set(k.uri, new Uint8Array(await resp.arrayBuffer()));
      }
    }

    const total = parsed.segments.length;
    let done = 0;
    let cursor = 0;
    const chunks = new Array(total);
    const worker = async () => {
      while (cursor < total) {
        const idx = cursor++;
        const seg = parsed.segments[idx];
        let data = await this.fetchWithRetry(seg.url, signal);
        if (seg.key && seg.key.method === 'AES-128') {
          const keyBytes = keyCache.get(seg.key.uri);
          if (!keyBytes) throw new Error('缺少解密密钥');
          const iv = seg.key.iv ? ivFromHexString(seg.key.iv) : ivFromMediaSequence(parsed.mediaSequence + idx);
          data = await decryptAes128(data, keyBytes, iv);
        }
        chunks[idx] = data;
        done++;
        await this.tickProgress(id, { received: done, total });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));

    const isFmp4 = Boolean(parsed.initSegment);
    if (isFmp4) {
      const init = await this.fetchWithRetry(parsed.initSegment, signal);
      return { buffer: mergeFmp4Segments(init, chunks), isFmp4 };
    }
    return { buffer: concatChunks(chunks), isFmp4 };
  }

  async fetchText(url, signal) {
    const resp = await fetch(url, { credentials: 'include', signal });
    if (!resp.ok) throw new Error(`拉取播放列表失败 HTTP ${resp.status}`);
    return resp.text();
  }

  async fetchWithRetry(url, signal, times = 3) {
    let lastErr;
    for (let i = 0; i < times; i++) {
      try {
        const resp = await fetch(url, { credentials: 'include', signal });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return new Uint8Array(await resp.arrayBuffer());
      } catch (e) {
        if (signal.aborted) throw e;
        lastErr = e;
        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
      }
    }
    throw lastErr;
  }

  // ---- offscreen 落盘 ----

  async ensureOffscreen() {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (contexts.length > 0) return;
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['BLOBS'],
      justification: '拼接媒体分片并生成用于下载的 blob URL',
    });
  }

  async notifyOffscreen(msg) {
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch (e) {
      throw new Error(`offscreen 通道不可用: ${e.message}`);
    }
  }

  async saveViaOffscreen(downloadId, buffer, mimeType) {
    await this.ensureOffscreen();
    await this.notifyOffscreen({ target: 'offscreen', command: 'begin', downloadId, mimeType });
    for (let offset = 0; offset < buffer.byteLength; offset += CHUNK_SIZE) {
      const copy = buffer.slice(offset, Math.min(offset + CHUNK_SIZE, buffer.byteLength));
      await this.notifyOffscreen({ target: 'offscreen', command: 'chunk', downloadId, data: copy.buffer });
    }
    const resp = await this.notifyOffscreen({ target: 'offscreen', command: 'finish', downloadId });
    if (!resp || !resp.data || !resp.data.blobUrl) throw new Error('生成 blob URL 失败');
    return resp.data.blobUrl;
  }

  async triggerDownload(blobUrl, filename) {
    const downloadId = await chrome.downloads.download({
      url: blobUrl,
      filename,
      saveAs: false,
      conflictAction: 'uniquify',
    });
    // 等待进入 in_progress/complete，确保 blob URL 已被消费
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 500); // 兜底放行
      const listener = (delta) => {
        if (delta.id === downloadId && delta.state && (delta.state.current === 'in_progress' || delta.state.current === 'complete')) {
          clearTimeout(timer);
          chrome.downloads.onChanged.removeListener(listener);
          resolve();
        }
      };
      chrome.downloads.onChanged.addListener(listener);
    });
  }

  // ---- 状态维护 ----

  async tickProgress(id, patch) {
    const now = Date.now();
    const last = this.throttle.get(id) || 0;
    if (now - last < 400) return;
    this.throttle.set(id, now);
    await this.setProgress(id, patch);
  }

  async setProgress(id, patch) {
    const k = progressKey(id);
    const cur = (await chrome.storage.session.get(k))[k] || {};
    await chrome.storage.session.set({ [k]: { ...cur, ...patch, updatedAt: Date.now() } });
  }

  async markEntry(tabId, id, patch) {
    const records = await this.sniffer.read(tabId);
    if (records[id]) Object.assign(records[id], patch);
    await this.sniffer.write(tabId, records);
  }
}

// 稳定规则号：SW 重启后重加同 id 规则会覆盖而非泄漏
function stableRuleId(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  }
  return (h % 1000000) + 1;
}

// HLS 输出名：基础名 + .ts / .mp4
function outputFilename(record, isFmp4) {
  if (record.kind !== 'hls') return record.filename;
  const base = record.filename.replace(/\.[a-z0-9]{2,5}$/i, '');
  return `${base || 'hls'}.${isFmp4 ? 'mp4' : 'ts'}`;
}
```

- [ ] **Step 3: service-worker 接线**

在 `background/service-worker.js` 追加（import 区 + 初始化区各一行）：

```js
import { MediaDownloader } from './media-downloader.js';
// ...
const downloader = new MediaDownloader(sniffer);
downloader.registerHandlers(messageHandler);
```

- [ ] **Step 4: 手工验证（需先完成 Task 8 manifest，或临时手加权限）**

1. 重载扩展
2. SW 控制台执行（模拟 popup 触发下载，tabId 换成实际值）：
   `chrome.runtime.sendMessage({ type: 'media-download', action: 'start', tabId: <id>, id: '<media记录id>' }, console.log)`
3. 观察下载栏出现文件、进度键 `download:<id>` 状态流转到 done
4. HLS：打开 `https://hlsjs.video-dev.org/demo/` 播放默认流后按同法触发，产出可播放 .ts 文件

- [ ] **Step 5: Commit**

```bash
git add background/media-downloader.js offscreen/
git commit -m "feat(media-sniffer): add media downloader with hls/aes support and offscreen saver"
```

（service-worker.js 的两行接线随本提交一起 `git add`。）

---

### Task 7: MediaTool UI（popup）

**状态**
- [ ] 任务完成

**Dependencies:** Task 5, Task 6
**Parallelizable:** No（消息类型依赖两引擎的 handler）

**Files:**
- Create: `tools/media-tool/tool.js`
- Create: `tools/media-tool/tool.css`
- Modify: `utils/constants.js`
- Modify: `popup/popup.js`
- Modify: `popup/popup.html`

- [ ] **Step 1: 常量注册**

`utils/constants.js` 的 `TOOL_TYPES` 增加一项：

```js
export const TOOL_TYPES = {
  COOKIE: 'cookie-tool',
  XPATH: 'xpath-helper',
  JSON_TREE: 'json-tree-tool',
  MEDIA_SNIFFER: 'media-sniffer-tool',
};
```

- [ ] **Step 2: 实现 MediaTool**

```js
// 媒体嗅探工具（popup 内）
import { BaseTool } from '../base-tool.js';
import { TOOL_TYPES } from '../../utils/constants.js';
import { ToolMessenger } from '../../utils/messaging.js';

const KIND_META = {
  direct: { icon: '🎬', label: '直链文件' },
  hls: { icon: '📺', label: 'HLS 流' },
  'video-stream': { icon: '🎞️', label: '视频流（无音轨）' },
  'audio-stream': { icon: '🎵', label: '音频流' },
};

export class MediaTool extends BaseTool {
  constructor() {
    super('Media Sniffer', TOOL_TYPES.MEDIA_SNIFFER);
    this.name = '媒体嗅探';
    this.description = '嗅探并下载当前页面加载的视频/音频';
    this.icon = '🎬';
    this.tabId = null;
    this.records = [];
    this.progress = new Map();
    this.storageListener = (changes, area) => this.onStorageChange(changes, area);

    this.element = document.createElement('div');
    this.element.className = 'media-tool';
    this.element.innerHTML = `
      <div class="media-toolbar">
        <span class="media-hint">页面播放视频后，这里会出现可下载的媒体</span>
        <button class="media-clear-btn">清空</button>
      </div>
      <div class="media-list"></div>
      <div class="media-empty hidden">当前页面还没有嗅探到媒体</div>
    `;
    this.listEl = this.element.querySelector('.media-list');
    this.emptyEl = this.element.querySelector('.media-empty');
    this.element.querySelector('.media-clear-btn').addEventListener('click', () => this.clear());
  }

  async initialize() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id == null) return;
    this.tabId = tab.id;
    chrome.storage.onChanged.addListener(this.storageListener);
    await this.refresh();
  }

  onStorageChange(changes, area) {
    if (area !== 'session' || this.tabId == null) return;
    const touched = Object.keys(changes).some(
      (k) => k === `media:${this.tabId}` || k.startsWith('download:')
    );
    if (touched) this.refresh();
  }

  async refresh() {
    if (this.tabId == null) return;
    const progressKeys = [...new Set(this.records.map((r) => `download:${r.id}`))];
    const store = await chrome.storage.session.get([`media:${this.tabId}`, ...progressKeys]);
    const records = store[`media:${this.tabId}`] || {};
    this.records = Object.values(records).sort((a, b) => b.firstSeenAt - a.firstSeenAt);
    this.progress.clear();
    for (const [k, v] of Object.entries(store)) {
      if (k.startsWith('download:')) this.progress.set(k.slice('download:'.length), v);
    }
    this.render();
  }

  render() {
    if (!this.records.length) {
      this.listEl.innerHTML = '';
      this.emptyEl.classList.remove('hidden');
      return;
    }
    this.emptyEl.classList.add('hidden');
    this.listEl.innerHTML = '';
    for (const r of this.records) {
      this.listEl.appendChild(this.renderItem(r));
    }
  }

  renderItem(r) {
    const meta = KIND_META[r.kind] || KIND_META.direct;
    const item = document.createElement('div');
    item.className = 'media-item';

    const sizeText = r.kind === 'hls'
      ? (r.segmentCount ? `${meta.label} · ${r.segmentCount} 分片` : meta.label)
      : `${meta.label}${r.contentLength ? ` · ${formatBytes(r.contentLength)}` : ''}`;

    let statusHtml = '';
    const prog = this.progress.get(r.id);
    if (r.status === 'done') {
      statusHtml = '<span class="media-status ok">已下载</span>';
    } else if (prog && prog.state === 'running') {
      const pct = prog.total ? Math.min(100, Math.round((prog.received / prog.total) * 100)) : 0;
      statusHtml = `
        <div class="media-progress"><div class="media-progress-bar" style="width:${pct}%"></div></div>
        <div class="media-progress-row">
          <span class="media-progress-text">${pct}%</span>
          <button class="media-cancel-btn" data-id="${r.id}">取消</button>
        </div>`;
    } else if (prog && prog.state === 'failed') {
      statusHtml = `<span class="media-status err">${escapeHtml(prog.error || '下载失败')}</span>`;
    } else if (r.status === 'failed') {
      statusHtml = '<span class="media-status err">下载失败</span>';
    } else if (r.status === 'running') {
      statusHtml = '<span class="media-status">准备中...</span>';
    }

    const showDownload = r.status !== 'done' && r.status !== 'running';
    item.innerHTML = `
      <div class="media-item-head">
        <span class="media-kind-icon">${meta.icon}</span>
        <span class="media-filename" title="${escapeHtml(r.filename)}">${escapeHtml(r.filename)}</span>
        ${showDownload ? `<button class="media-dl-btn" data-id="${r.id}">下载</button>` : ''}
      </div>
      <div class="media-item-sub">${sizeText}</div>
      ${statusHtml}`;

    item.querySelector('.media-dl-btn')?.addEventListener('click', () => this.startDownload(r.id));
    item.querySelector('.media-cancel-btn')?.addEventListener('click', () => this.cancelDownload(r.id));
    return item;
  }

  async startDownload(id) {
    await ToolMessenger.sendMessage('media-download', 'start', { tabId: this.tabId, id });
  }

  async cancelDownload(id) {
    await ToolMessenger.sendMessage('media-download', 'cancel', { tabId: this.tabId, id });
  }

  async clear() {
    await ToolMessenger.sendMessage('media-sniffer', 'clear', { tabId: this.tabId });
  }

  async execute() {
    return { success: true, message: '' };
  }

  async destroy() {
    chrome.storage.onChanged.removeListener(this.storageListener);
    this.log('媒体嗅探工具已销毁');
  }
}

function formatBytes(n) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
```

- [ ] **Step 3: 样式 `tools/media-tool/tool.css`**

```css
/* 媒体嗅探工具样式 */
.media-tool {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.media-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.media-hint {
  font-size: 12px;
  color: #6b7280;
}

.media-clear-btn {
  border: 1px solid #d1d5db;
  background: #fff;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}

.media-clear-btn:hover {
  background: #f3f4f6;
}

.media-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.media-item {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.media-item-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.media-filename {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.media-dl-btn {
  border: none;
  background: #2563eb;
  color: #fff;
  border-radius: 6px;
  padding: 3px 10px;
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
}

.media-dl-btn:hover {
  background: #1d4ed8;
}

.media-item-sub {
  font-size: 11px;
  color: #6b7280;
}

.media-progress {
  height: 6px;
  border-radius: 3px;
  background: #e5e7eb;
  overflow: hidden;
}

.media-progress-bar {
  height: 100%;
  background: #2563eb;
  transition: width 0.3s;
}

.media-progress-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.media-progress-text {
  font-size: 11px;
  color: #6b7280;
}

.media-cancel-btn {
  border: 1px solid #d1d5db;
  background: #fff;
  border-radius: 6px;
  padding: 1px 8px;
  font-size: 11px;
  cursor: pointer;
}

.media-status {
  font-size: 11px;
  color: #6b7280;
}

.media-status.ok {
  color: #16a34a;
}

.media-status.err {
  color: #dc2626;
  word-break: break-all;
}

.media-empty {
  text-align: center;
  color: #9ca3af;
  font-size: 12px;
  padding: 20px 0;
}
```

- [ ] **Step 4: popup 接线**

`popup/popup.html` head 增加样式链接：

```html
  <link rel="stylesheet" href="../tools/media-tool/tool.css">
```

`popup/popup.js` import 区增加：

```js
import { MediaTool } from '../tools/media-tool/tool.js';
```

`registerTools()` 增加注册：

```js
    this.registerTool(new MediaTool());
```

- [ ] **Step 5: 手工验证**

1. 重载扩展 → popup 出现「媒体嗅探」卡片
2. 打开直链视频页播放 → 点开 popup → 列表出现条目 → 点「下载」→ 进度条推进 → 系统下载栏出现文件
3. 下载中关闭再重开 popup → 进度条仍能恢复显示
4. 「清空」→ 列表与 badge 清空

- [ ] **Step 6: Commit**

```bash
git add tools/media-tool/tool.js tools/media-tool/tool.css utils/constants.js popup/popup.js popup/popup.html
git commit -m "feat(media-sniffer): add media tool popup UI"
```

---

### Task 8: Manifest 权限 + 回归验证

**状态**
- [ ] 任务完成

**Dependencies:** Task 7
**Parallelizable:** No（收尾）

**Files:**
- Modify: `manifest.json`

- [ ] **Step 1: manifest 更新**

permissions 数组替换为：

```json
  "permissions": [
    "activeTab",
    "cookies",
    "storage",
    "scripting",
    "webRequest",
    "downloads",
    "declarativeNetRequest",
    "offscreen"
  ],
```

description 更新为：

```json
  "description": "轻量实用的Chrome工具集：Cookie获取、XPath选择器、JSON树图可视化、媒体嗅探下载",
```

- [ ] **Step 2: 语法检查 + 全量单测**

Run: `node tools/media-tool/tests/run-tests.js && node tools/json-tool/tests/run-tests.js`
Expected: 两组 ALL PASS

Run: `node --check background/media-sniffer.js && node --check background/media-downloader.js && node --check tools/media-tool/tool.js && node --check offscreen/downloader.js && node --check popup/popup.js`
Expected: 无输出（语法通过）

- [ ] **Step 3: 手工验收矩阵（真机）**

| 场景 | 预期 |
|------|------|
| w3schools html5_video 播放 mp4 | direct 条目，下载为可播放 mp4 |
| B站视频页播放 | 视频流 + 音频流各一条（🎞️/🎵），分别可下载 |
| hlsjs.video-dev.org/demo 默认流 | HLS 条目，下载为 .ts，VLC 可播 |
| mux.dev AES-128 测试流（经 hls.js demo 加载） | HLS 条目，下载后可播（解密成功） |
| 失效链接（等待过期后点下载） | 条目标红「下载失败 HTTP 403」 |
| 下载中点取消 | 进度终止，条目回到可下载状态 |
| Cookie / XPath / JSON 三工具 | 功能不受影响 |
| 重启浏览器 | 媒体列表清空（storage.session 预期行为） |

- [ ] **Step 4: Commit**

```bash
git add manifest.json
git commit -m "feat(media-sniffer): add webRequest/downloads/dnr/offscreen permissions"
```

---

## Self-Review 记录

- 规格覆盖：嗅探识别/聚合/降噪（Task 5）、直链+HLS+AES 下载（Task 6）、UI+badge（Task 5/7）、manifest（Task 8）、纯函数测试与验收矩阵（Task 4/8）均已映射；「MSE 钩子抽象预留」按规格为 v2 范围，不在本计划
- 实现期对规格的一处收窄：AES-128 仅支持 16 字节对齐（HLS 规范行为）的分片，非对齐流报错明示——WebCrypto 无法安全处理非对齐密文，属 v1 已知限制，已写入 Global Constraints
- 类型一致性：MediaRecord 字段（id/kind/url/documentUrl/contentType/contentLength/filename/firstSeenAt/status/segmentCount）在 Task 5 定义、Task 6/7 消费一致；消息类型 `media-sniffer` / `media-download`、offscreen 通道 `target:'offscreen'` 各处一致
- 占位符扫描：无 TBD/TODO；所有代码步骤含完整代码

## v1.1 修订（测试反馈）

- **网络拉取从 SW 移入 offscreen 文档执行**：MV3 service worker 有 30s 空闲回收，B站等大文件下载中途 SW 被杀导致进度停滞且无报错。offscreen 常驻执行 fetch/HLS/AES/拼接，进度经 `target:'offscreen-event'` 消息回传 SW（同时保活 SW），SW 只做 DNR 防盗链、任务下发、`chrome.downloads` 落盘与状态维护
- **进度展示增强**：直链显示「百分比 · 已收/总字节」，HLS 显示「分片数 · 百分比」；总大小未知时进度条用流动动画 + 字节计数
- **popup 增加 1s 轮询兜底**：storage 事件丢失时进度仍可刷新
- **条目去重改为资源键（origin+pathname）**：同一文件重新签名（query 变化）不再产生重复条目；仍重名的条目展示层加序号后缀 `(2)`、`(3)`
- **DNR modifyHeaders schema 修正**：`setRequestHeaders` 为错误写法，正确为 `requestHeaders: [{ header, operation: 'set', value }]`；该错误导致点击下载即在设置防盗链规则时抛异常、任务直接失败

## v1.2 修订（用户反馈：按需嗅探）

- **嗅探默认关闭，改为手动开关**：新增 `media-sniffer:enabled` 会话级开关（storage.session，浏览器重启自动归零）。关闭时不记录任何请求、badge 熄灭；开启后持续捕获（含 popup 关闭期间，保证「先播视频再开工具」流程可用）
- **工具栏改为**：`[嗅探开关] [提示] [↻ 刷新] [清空]`；新增 `getStatus` / `setEnabled` 消息；停止嗅探时清掉所有 tab 的 badge
- MV3 约束：webRequest 监听保持顶层同步注册，事件处理入口按 enabled 标志短路

## v1.3 修订（用户反馈：保存框抢焦点导致 popup 被关闭）

- **新增独立标签页模式** `tools/media-tool/page.html`（经 `?tabId=` 绑定目标标签页）：popup 工具栏新增「↗」按钮打开。系统保存框弹出时标签页不会被关闭，可作为常驻下载管理面板
- MediaTool 构造函数支持 `{ tabId, standalone }` 参数；独立页直开时回退猜测最近活跃的非本页标签
- **修复**：`.media-empty` 依赖的 `hidden` 类在 popup.css 中无对应规则（仅 `.view.hidden`），tool.css 补 `.media-tool .hidden`
- 说明：保存框由浏览器「下载前询问每个文件的保存位置」设置触发（扩展的 saveAs:false 无法覆盖），关闭该设置则直接落盘不弹框

## v1.4 修订（用户反馈：独立页的嗅探范围）

- **独立标签页改为全局聚合视图**：展示所有标签页嗅探到的媒体（嗅探开关本就是全局的），每条标注来源域名（取记录的 documentUrl，回退媒体 URL）；下载/取消按各条目自己的 tabId 定位；「清空」新增 `clearAll` 动作清全部标签页
- popup 保持「只看当前页」的轻量定位；独立页不再需要 `?tabId=` 参数

## v1.5 修订（用户反馈：为何不直接弹出独立页）

- **工具卡片点击直接打开独立标签页**：popup 详情视图被全局聚合页完全覆盖、只剩跳板成本，取消该中间步骤。popup.js 的 `openTool` 增加通用 `openExternal()` 钩子（工具声明即外部打开，不对具体工具特判）
- 修复：page.html 内联 module 脚本违反扩展 CSP（`script-src 'self'` 禁内联），外置为 page.js；移除 openInTab 遗留的 tabId 空值守卫与 ↗ 按钮（含孤儿 CSS）

## v1.6 修订（用户反馈：按标签页分组展示）

- **独立页列表按标签页分组**：组头显示标签页标题 + 条目数（`chrome.tabs.get` 读标题，`<all_urls>` host 权限已覆盖、无需新增权限）；已关闭标签页回退显示记录的来源域名；组间按组内最新发现时间倒序，组内按发现时间倒序
- popup 视图维持扁平列表（只看当前页）

## v1.7 修订（用户反馈：单视频出现重复条目）

- **去重键从 origin+pathname 改为仅 pathname**：B站重签名时同时更换镜像域名，origin 参与匹配导致去重失效；文件路径本身已唯一标识资源。代价是同 tab 内不同站点恰好同路径的极端情况会被折叠，可接受
- **组内条目按体积降序**：多清晰度 rendition（如 30232/100024）并存时，最大的（通常最高清）排最前；体积未知的条目（HLS）保持时间序
- 说明：播放器加载多个清晰度/编码版本属自适应流正常行为，各自为独立可下载文件

## v2：音视频无损合并（mp4box.js 方案）

- **目标**：B站式「视频流 + 音频流」一键合并为单个双轨 mp4，无损不重编码（等价 `ffmpeg -c copy`）
- **选型**：打包 mp4box.js 0.5.4（`lib/mp4box/mp4box.all.min.js`，约 160KB，BSD-3）；
  弃选 ffmpeg.wasm（25MB+ 体积）与运行时远程加载（MV3 禁止远程代码）
- **组件**：
  - `tools/media-tool/lib/mp4-merge.js`：`mergeFmp4Tracks(MP4Box, videoBuffer, audioBuffer)`，依赖注入 MP4Box 保持纯函数；
    demux 两条单轨 fMP4 到样本级 → `addTrack`（avcC/hvcC/av1C/esds 配置盒从源文件原样搬移）→ 双轨按 dts（归一化秒）交错 `addSample` → 全碎片化输出
    （每样本一个 moof+mdat，播放器通用）
  - offscreen：`<script>` 加载 mp4box；job `kind:'merge'` 拉取双流（合计字节进度）后合并
  - SW：`startMerge` 动作，双流各自建 DNR 规则（rules 条目统一为 `ruleIds` 数组 + `merge` 标记），输出名 `{基础名}-merged.mp4`
  - UI：视频流条目在同页存在音频流时显示「合并下载」按钮，自动配对体积最大的音频流；进度挂在视频流条目上
- **测试**：`test-mp4-merge.js` 用真实 fMP4 夹具（Apple bipbop HEVC 示例流裁剪，`fixtures/build.mjs` 可重跑生成）
  验证双轨结构、样本数无损；node 侧经 CJS 快照加载 UMD
- **踩坑记录**：mp4box `addTrack` 的 `samplerate` 必须传原始值（写出时内部做 16.16 定点转换，调用方预移位会溢出为 0）

## v2.1 修订（诊断确认：响应头从未拿到）

- **根因**：`onHeadersReceived` 注册时漏传 `extraInfoSpec: ['responseHeaders']`，`details.responseHeaders` 恒为 undefined，
  所有条目 contentType/contentLength 均为空。连锁后果：audio.m4s 因拿不到 `audio/mp4` 头被 ext 分支判成 video-stream
  （音频流从未正确入列）→「合并下载」前置条件（存在 audio-stream 条目）永不满足；列表大小不显示、下载进度无总量
- **修复**：注册监听时显式声明 `['responseHeaders']`
- 诊断方法：SW 控制台读 `chrome.storage.session` 中 `media:*` 记录的 `contentType`/`contentLength` 字段

## v2.2 修订（用户反馈：开关交互与已播放视频的捕获）

- **「页面即开关」模型**：打开独立页自动开启嗅探；关闭最后一个独立页自动停止
  （`tabs.onRemoved` → 查询剩余嗅探页数 → 归零则 setEnabled(false)）。页内手动开关保留；
  开两个页关一个不受影响。依据：打开页面是「要使用」的最明确信号，与「未使用不嗅探」的初衷闭环
- **已知限制明示**：webRequest 无历史回溯，开启嗅探前已加载的流无法捕获（刷新页面重新请求即可）；
  嗅探中状态下提示文案改为「已在播放的页面需刷新后才能捕获」
- 附加：popup 工具卡片新增 `checkAvailability` 可用性预检钩子（XPath 在浏览器内部页/扩展页置灰并提示）
- 移除工具栏「↻ 刷新」按钮：1s 轮询 + storage 事件双保险下，列表最多滞后一秒自动更新，手动刷新无实际作用（历史遗留）

---

**Execution Mode:** parallel（任务依赖层级：[1,2,3,4] → [5,6] → [7] → [8]）
