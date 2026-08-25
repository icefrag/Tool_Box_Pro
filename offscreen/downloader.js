// offscreen：网络拉取 + HLS/AES 处理 + 拼接 + blob 生成
// （MV3 service worker 有 30s 空闲回收，长下载必须放在常驻的 offscreen 文档执行）
import { parseM3u8, pickBestVariant } from '../tools/media-tool/lib/m3u8-parser.js';
import { decryptAes128, ivFromMediaSequence, ivFromHexString } from '../tools/media-tool/lib/hls-decrypt.js';
import { concatChunks, mergeFmp4Segments } from '../tools/media-tool/lib/stream-merger.js';

const CONCURRENCY = 6;

const tasks = new Map(); // downloadId -> AbortController

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return false;

  if (msg.command === 'download') {
    runDownload(msg.downloadId, msg.job).catch((e) => {
      report(msg.downloadId, 'failed', { error: e.message });
    });
    sendResponse({ success: true, data: {} });
  } else if (msg.command === 'cancel') {
    tasks.get(msg.downloadId)?.abort();
    sendResponse({ success: true, data: {} });
  } else if (msg.command === 'revoke') {
    if (msg.blobUrl) URL.revokeObjectURL(msg.blobUrl);
    sendResponse({ success: true, data: {} });
  }
  return false; // 响应均为同步
});

async function runDownload(downloadId, job) {
  const controller = new AbortController();
  tasks.set(downloadId, controller);
  let lastTick = 0;
  const tick = (received, total, unit) => {
    const now = Date.now();
    if (now - lastTick < 400) return;
    lastTick = now;
    report(downloadId, 'progress', { received, total, unit });
  };

  try {
    let buffer;
    let isFmp4 = false;
    if (job.kind === 'hls') {
      ({ buffer, isFmp4 } = await fetchHls(job.url, controller.signal, tick));
    } else {
      buffer = await fetchDirect(job.url, job.contentLength, controller.signal, tick);
    }
    const blob = new Blob([buffer], { type: job.mimeType || 'video/mp4' });
    report(downloadId, 'done', { blobUrl: URL.createObjectURL(blob), isFmp4 });
  } catch (e) {
    if (controller.signal.aborted) {
      report(downloadId, 'canceled', {});
    } else {
      report(downloadId, 'failed', { error: e.message });
    }
  } finally {
    tasks.delete(downloadId);
  }
}

function report(downloadId, event, data) {
  chrome.runtime.sendMessage({ target: 'offscreen-event', downloadId, event, ...data }).catch(() => {});
}

async function fetchDirect(url, fallbackTotal, signal, tick) {
  const resp = await fetch(url, { credentials: 'include', signal });
  if (!resp.ok) throw new Error(`下载失败 HTTP ${resp.status}`);
  const total = Number(resp.headers.get('content-length')) || fallbackTotal || 0;
  const reader = resp.body.getReader();
  const parts = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    received += value.byteLength;
    tick(received, total);
  }
  return concatChunks(parts);
}

async function fetchHls(playlistUrl, signal, tick) {
  // master → 最高码率变体 → 媒体播放列表
  let url = playlistUrl;
  let parsed = parseM3u8(await fetchText(url, signal), url);
  if (parsed.isMaster) {
    const best = pickBestVariant(parsed.variants);
    url = best.url;
    parsed = parseM3u8(await fetchText(url, signal), url);
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
      let data = await fetchWithRetry(seg.url, signal);
      if (seg.key && seg.key.method === 'AES-128') {
        const keyBytes = keyCache.get(seg.key.uri);
        if (!keyBytes) throw new Error('缺少解密密钥');
        const iv = seg.key.iv ? ivFromHexString(seg.key.iv) : ivFromMediaSequence(parsed.mediaSequence + idx);
        data = await decryptAes128(data, keyBytes, iv);
      }
      chunks[idx] = data;
      done++;
      tick(done, total, 'segments');
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));

  const isFmp4 = Boolean(parsed.initSegment);
  if (isFmp4) {
    const init = await fetchWithRetry(parsed.initSegment, signal);
    return { buffer: mergeFmp4Segments(init, chunks), isFmp4 };
  }
  return { buffer: concatChunks(chunks), isFmp4 };
}

async function fetchText(url, signal) {
  const resp = await fetch(url, { credentials: 'include', signal });
  if (!resp.ok) throw new Error(`拉取播放列表失败 HTTP ${resp.status}`);
  return resp.text();
}

async function fetchWithRetry(url, signal, times = 3) {
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
