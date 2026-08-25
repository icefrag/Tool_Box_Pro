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
