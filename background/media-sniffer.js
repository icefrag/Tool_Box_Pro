// 媒体嗅探引擎：webRequest 监听 → 识别 → storage.session 按 tab 归档
import { classifyMediaRequest } from '../tools/media-tool/lib/url-classifier.js';
import { filenameFromUrl } from '../tools/media-tool/lib/filename.js';

const MIN_BYTES = 100 * 1024; // 小于 100KB 视为噪声
const MAX_PER_TAB = 50;
const storageKey = (tabId) => `media:${tabId}`;
const ENABLED_KEY = 'media-sniffer:enabled';

// 资源键：pathname 末两段（父目录 + 文件名），忽略查询串签名、镜像域名与 CDN 路径前缀差异
// （B站同一文件会以 upos-*.bilivideo.com/upgcxcode/... 与 mcdn.bilivideo.cn/v1/resource/upgcxcode/... 两种形态请求）
const resourceKey = (url) => {
  try {
    const segs = new URL(url).pathname.split('/').filter(Boolean);
    return segs.slice(-2).join('/');
  } catch {
    return url;
  }
};

export class MediaSniffer {
  constructor() {
    this.pending = new Map();   // requestId -> { url, tabId, documentUrl }
    this.playlists = new Map(); // tabId -> Set<m3u8 url>，分片归并上下文（SW 重启失效，可接受）
    this.enabled = false;       // 默认不嗅探，用户显式开启
  }

  async start() {
    // 事件监听必须同步注册（MV3 要求），开关状态异步恢复
    chrome.webRequest.onBeforeRequest.addListener((d) => this.onRequest(d), { urls: ['<all_urls>'] });
    // responseHeaders 必须显式声明 extraInfoSpec，否则 details.responseHeaders 恒为 undefined
    chrome.webRequest.onHeadersReceived.addListener((d) => this.onHeaders(d), { urls: ['<all_urls>'] }, ['responseHeaders']);
    chrome.tabs.onRemoved.addListener((tabId) => this.cleanup(tabId));
    await this.loadState();
  }

  async loadState() {
    const obj = await chrome.storage.session.get(ENABLED_KEY);
    this.enabled = obj[ENABLED_KEY] === true;
  }

  async setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    await chrome.storage.session.set({ [ENABLED_KEY]: this.enabled });
    if (!this.enabled) await this.clearAllBadges();
    return this.enabled;
  }

  async clearAllBadges() {
    const all = await chrome.storage.session.get(null);
    for (const k of Object.keys(all)) {
      if (!k.startsWith('media:')) continue;
      const tabId = Number(k.slice('media:'.length));
      if (!Number.isNaN(tabId)) {
        try {
          await chrome.action.setBadgeText({ tabId, text: '' });
        } catch {
          // 标签页可能已关闭
        }
      }
    }
  }

  onRequest(details) {
    if (!this.enabled) return;
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
    if (!this.enabled) return;
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
    // （m4s/ts 是 Range 分块加载常态，首块常小于阈值，不参与过滤）
    const chunkedExt = cls.ext === 'm4s' || cls.ext === 'ts';
    if (!chunkedExt && contentLength && contentLength < MIN_BYTES) return;
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
      // 同资源（Range 分块）再次请求：不重复入列，仅在拿到更大块时更新大小
      const existing = Object.values(records).find((r) => resourceKey(r.url) === resourceKey(record.url));
      if (existing) {
        if (record.contentLength > (existing.contentLength || 0)) {
          existing.contentLength = record.contentLength;
          await this.write(tabId, records);
        }
        return;
      }
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
    try {
      await chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count) : '' });
    } catch {
      // 标签页可能已关闭，badge 更新失败可忽略
    }
  }

  async clear(tabId) {
    await chrome.storage.session.remove(storageKey(tabId));
    try {
      await chrome.action.setBadgeText({ tabId, text: '' });
    } catch {
      // 标签页可能已关闭
    }
  }

  // 清空所有标签页的媒体列表（独立页聚合视图的「清空」）
  async clearAll() {
    const all = await chrome.storage.session.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith('media:'));
    if (keys.length) {
      await chrome.storage.session.remove(keys);
    }
    await this.clearAllBadges();
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
      if (action === 'clearAll') {
        await this.clearAll();
        return { cleared: true };
      }
      if (action === 'getRecord') {
        return this.getRecord(tabId, id);
      }
      if (action === 'setEnabled') {
        const enabled = await this.setEnabled(request.enabled);
        return { enabled };
      }
      if (action === 'getStatus') {
        return { enabled: this.enabled };
      }
      throw new Error(`未知的 media-sniffer action: ${action}`);
    });
  }
}
