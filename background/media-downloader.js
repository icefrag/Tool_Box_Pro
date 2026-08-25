// 媒体下载编排：DNR 防盗链、下发 offscreen 拉取任务、落盘与状态维护
// 网络拉取在 offscreen 文档执行（MV3 SW 30s 空闲回收会杀死长下载）
const OFFSCREEN_URL = '/offscreen/downloader.html';
const progressKey = (id) => `download:${id}`;

export class MediaDownloader {
  constructor(sniffer) {
    this.sniffer = sniffer;
    this.rules = new Map(); // downloadId -> { ruleId, tabId }
  }

  registerHandlers(messageHandler) {
    messageHandler.register('media-download', async (request) => {
      const { action, tabId, id, videoId, audioId } = request;
      if (action === 'start') {
        await this.start(tabId, id);
        return { started: true };
      }
      if (action === 'startMerge') {
        await this.startMerge(tabId, videoId, audioId);
        return { started: true };
      }
      if (action === 'cancel') {
        await this.notifyOffscreen({ target: 'offscreen', command: 'cancel', downloadId: id });
        return { canceled: true };
      }
      throw new Error(`未知的 media-download action: ${action}`);
    });
  }

  // 音视频双流无损合并下载（进度挂在视频流条目上）
  async startMerge(tabId, videoId, audioId) {
    const video = await this.sniffer.getRecord(tabId, videoId);
    const audio = await this.sniffer.getRecord(tabId, audioId);
    if (!video || !audio || video.status === 'running') return;

    const total = (video.contentLength || 0) + (audio.contentLength || 0);
    await this.markEntry(tabId, videoId, { status: 'running' });
    await this.setProgress(videoId, { state: 'running', received: 0, total, error: null });

    const ruleIds = [];
    try {
      for (const record of [video, audio]) {
        const ruleId = await this.enableReferer(record);
        if (ruleId !== null) ruleIds.push(ruleId);
      }
      this.rules.set(videoId, { ruleIds, tabId, merge: true });

      await this.ensureOffscreen();
      await this.notifyOffscreen({
        target: 'offscreen',
        command: 'download',
        downloadId: videoId,
        job: {
          kind: 'merge',
          video: { url: video.url, contentLength: video.contentLength },
          audio: { url: audio.url, contentLength: audio.contentLength },
          mimeType: 'video/mp4',
        },
      });
      // 后续流程由 onOffscreenEvent 驱动
    } catch (e) {
      if (ruleIds.length) {
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ruleIds }).catch(() => {});
      }
      this.rules.delete(videoId);
      await this.markEntry(tabId, videoId, { status: 'failed' });
      await this.setProgress(videoId, { state: 'failed', error: e.message });
    }
  }

  async start(tabId, id) {
    const record = await this.sniffer.getRecord(tabId, id);
    if (!record || record.status === 'running') return;

    await this.markEntry(tabId, id, { status: 'running' });
    await this.setProgress(id, { state: 'running', received: 0, total: record.contentLength || 0, error: null });

    let ruleId = null;
    try {
      ruleId = await this.enableReferer(record);
      this.rules.set(id, { ruleIds: ruleId !== null ? [ruleId] : [], tabId, merge: false });

      await this.ensureOffscreen();
      await this.notifyOffscreen({
        target: 'offscreen',
        command: 'download',
        downloadId: id,
        job: {
          kind: record.kind === 'hls' ? 'hls' : 'direct',
          url: record.url,
          contentLength: record.contentLength,
          mimeType: record.contentType,
        },
      });
      // 后续流程由 onOffscreenEvent 驱动
    } catch (e) {
      if (ruleId !== null) {
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] }).catch(() => {});
        this.rules.delete(id);
      }
      await this.markEntry(tabId, id, { status: 'failed' });
      await this.setProgress(id, { state: 'failed', error: e.message });
    }
  }

  // offscreen 事件：progress / done / failed / canceled
  async onOffscreenEvent(msg) {
    const { downloadId, event } = msg;
    const entry = this.rules.get(downloadId) || {};
    const tabId = entry.tabId;

    if (event === 'progress') {
      await this.setProgress(downloadId, {
        state: 'running',
        received: msg.received,
        total: msg.total,
        unit: msg.unit,
      });
      return;
    }

    if (event === 'done') {
      try {
        const record = tabId != null ? await this.sniffer.getRecord(tabId, downloadId) : null;
        const filename = record ? outputFilename(record, msg.isFmp4, entry.merge) : `media-${downloadId}.mp4`;
        await this.triggerDownload(msg.blobUrl, filename);
        await this.notifyOffscreen({ target: 'offscreen', command: 'revoke', blobUrl: msg.blobUrl }).catch(() => {});
        if (tabId != null) await this.markEntry(tabId, downloadId, { status: 'done' });
        await this.setProgress(downloadId, { state: 'done' });
      } catch (e) {
        if (tabId != null) await this.markEntry(tabId, downloadId, { status: 'failed' });
        await this.setProgress(downloadId, { state: 'failed', error: e.message });
      }
    } else if (event === 'failed') {
      if (tabId != null) await this.markEntry(tabId, downloadId, { status: 'failed' });
      await this.setProgress(downloadId, { state: 'failed', error: msg.error });
    } else if (event === 'canceled') {
      if (tabId != null) await this.markEntry(tabId, downloadId, { status: 'idle' });
      await this.setProgress(downloadId, { state: 'canceled' });
    }

    await this.cleanupRule(downloadId);
  }

  async cleanupRule(downloadId) {
    const entry = this.rules.get(downloadId);
    if (!entry) return;
    this.rules.delete(downloadId);
    const ids = entry.ruleIds || [];
    if (ids.length) {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids }).catch(() => {});
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
          requestHeaders: [
            { header: 'referer', operation: 'set', value: referer },
          ],
        },
      }],
    });
    return ruleId;
  }

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

// 输出文件名：合并 → 基础名-merged.mp4；HLS → .ts/.mp4；其余原样
function outputFilename(record, isFmp4, isMerge) {
  if (isMerge) {
    const base = record.filename.replace(/\.[a-z0-9]{2,5}$/i, '');
    return `${base || 'video'}-merged.mp4`;
  }
  if (record.kind !== 'hls') return record.filename;
  const base = record.filename.replace(/\.[a-z0-9]{2,5}$/i, '');
  return `${base || 'hls'}.${isFmp4 ? 'mp4' : 'ts'}`;
}
