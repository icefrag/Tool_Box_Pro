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
