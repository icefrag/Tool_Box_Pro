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
