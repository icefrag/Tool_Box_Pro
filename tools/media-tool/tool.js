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
  constructor({ tabId = null, standalone = false } = {}) {
    super('Media Sniffer', TOOL_TYPES.MEDIA_SNIFFER);
    this.name = '媒体嗅探';
    this.description = '嗅探并下载当前页面加载的视频/音频';
    this.icon = '🎬';
    this.tabId = tabId;
    this.standalone = standalone;
    this.records = [];
    this.progress = new Map();
    this.storageListener = (changes, area) => this.onStorageChange(changes, area);

    this.element = document.createElement('div');
    this.element.className = 'media-tool';
    this.element.innerHTML = `
      <div class="media-toolbar">
        <button class="media-toggle-btn">▶ 开始嗅探</button>
        <span class="media-hint">开启后播放页面视频即可捕获</span>
        <button class="media-open-tab-btn" title="在独立标签页打开">↗</button>
        <button class="media-refresh-btn" title="刷新列表">↻ 刷新</button>
        <button class="media-clear-btn">清空</button>
      </div>
      <div class="media-list"></div>
      <div class="media-empty hidden">当前页面还没有嗅探到媒体</div>
    `;
    this.listEl = this.element.querySelector('.media-list');
    this.emptyEl = this.element.querySelector('.media-empty');
    if (this.standalone) {
      this.element.querySelector('.media-open-tab-btn').classList.add('hidden');
      this.emptyEl.textContent = '开启嗅探后，任意标签页播放的媒体都会出现在这里';
    }
    this.element.querySelector('.media-toggle-btn').addEventListener('click', () => this.toggleSniffing());
    this.element.querySelector('.media-open-tab-btn').addEventListener('click', () => this.openInTab());
    this.element.querySelector('.media-refresh-btn').addEventListener('click', () => this.refresh());
    this.element.querySelector('.media-clear-btn').addEventListener('click', () => this.clear());
    if (this.standalone) {
      this.element.querySelector('.media-open-tab-btn').classList.add('hidden');
    }
  }

  async initialize() {
    if (this.tabId == null && !this.standalone) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || tab.id == null) return;
      this.tabId = tab.id;
    }
    const status = await ToolMessenger.sendMessage('media-sniffer', 'getStatus', {});
    this.sniffingEnabled = !!(status && status.enabled);
    this.updateToggleUi();
    chrome.storage.onChanged.addListener(this.storageListener);
    // 轮询兜底：即使 storage 事件丢失，进度也能刷新
    this.pollTimer = setInterval(() => this.refresh(), 1000);
    await this.refresh();
  }

  // 在独立标签页打开（popup 会被系统保存框抢焦点关闭，标签页不会）
  async openInTab() {
    try {
      await chrome.tabs.create({ url: chrome.runtime.getURL('tools/media-tool/page.html') });
      window.close(); // popup 场景：打开页面后关闭弹窗
    } catch (e) {
      console.error('[MediaTool] 打开独立页失败:', e);
    }
  }

  async toggleSniffing() {
    const next = !this.sniffingEnabled;
    const status = await ToolMessenger.sendMessage('media-sniffer', 'setEnabled', { tabId: this.tabId, enabled: next });
    this.sniffingEnabled = !!(status && status.enabled);
    this.updateToggleUi();
    await this.refresh();
  }

  updateToggleUi() {
    const btn = this.element?.querySelector('.media-toggle-btn');
    if (!btn) return;
    if (this.sniffingEnabled) {
      btn.textContent = '● 嗅探中';
      btn.classList.add('active');
    } else {
      btn.textContent = '▶ 开始嗅探';
      btn.classList.remove('active');
    }
  }

  onStorageChange(changes, area) {
    if (area !== 'session') return;
    const touched = Object.keys(changes).some((k) =>
      k.startsWith('download:')
      || (this.standalone ? k.startsWith('media:') : k === `media:${this.tabId}`)
    );
    if (touched) this.refresh();
  }

  async refresh() {
    const store = await chrome.storage.session.get(null);
    if (this.standalone) {
      // 全局聚合：所有标签页的媒体，按发现时间倒序
      const all = [];
      for (const [k, records] of Object.entries(store)) {
        if (!k.startsWith('media:')) continue;
        const tabId = Number(k.slice('media:'.length));
        for (const r of Object.values(records)) {
          r._tabId = tabId;
          all.push(r);
        }
      }
      this.records = all.sort((a, b) => b.firstSeenAt - a.firstSeenAt);
    } else {
      if (this.tabId == null) return;
      const records = store[`media:${this.tabId}`] || {};
      this.records = Object.values(records).sort((a, b) => b.firstSeenAt - a.firstSeenAt);
    }
    // 重名条目加序号后缀（仅展示层，不改存储）
    const nameCount = new Map();
    for (const r of this.records) {
      const n = (nameCount.get(r.filename) || 0) + 1;
      nameCount.set(r.filename, n);
      if (n > 1) {
        const dot = r.filename.lastIndexOf('.');
        r.displayName = dot > 0
          ? `${r.filename.slice(0, dot)}(${n})${r.filename.slice(dot)}`
          : `${r.filename}(${n})`;
      } else {
        r.displayName = r.filename;
      }
    }
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

    // 独立页聚合视图：标注来源域名
    const host = this.standalone ? sourceHost(r) : '';
    const hostPrefix = host ? `${host} · ` : '';
    const sizeText = r.kind === 'hls'
      ? `${hostPrefix}${r.segmentCount ? `${meta.label} · ${r.segmentCount} 分片` : meta.label}`
      : `${hostPrefix}${meta.label}${r.contentLength ? ` · ${formatBytes(r.contentLength)}` : ''}`;

    let statusHtml = '';
    const prog = this.progress.get(r.id);
    const name = r.displayName || r.filename;
    if (r.status === 'done') {
      statusHtml = '<span class="media-status ok">已下载</span>';
    } else if (prog && prog.state === 'running') {
      let counter;
      let pct = null;
      if (prog.unit === 'segments') {
        pct = prog.total ? Math.min(100, Math.round((prog.received / prog.total) * 100)) : null;
        counter = `${prog.received}/${prog.total} 分片${pct !== null ? ` · ${pct}%` : ''}`;
      } else {
        pct = prog.total ? Math.min(100, Math.round((prog.received / prog.total) * 100)) : null;
        counter = pct !== null
          ? `${pct}% · ${formatBytes(prog.received || 0)} / ${formatBytes(prog.total)}`
          : `已接收 ${formatBytes(prog.received || 0)}`;
      }
      statusHtml = `
        <div class="media-progress${pct === null ? ' indeterminate' : ''}"><div class="media-progress-bar"${pct !== null ? ` style="width:${pct}%"` : ''}></div></div>
        <div class="media-progress-row">
          <span class="media-progress-text">${counter}</span>
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
        <span class="media-filename" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
        ${showDownload ? `<button class="media-dl-btn" data-id="${r.id}">下载</button>` : ''}
      </div>
      <div class="media-item-sub">${sizeText}</div>
      ${statusHtml}`;

    item.querySelector('.media-dl-btn')?.addEventListener('click', () => this.startDownload(r.id));
    item.querySelector('.media-cancel-btn')?.addEventListener('click', () => this.cancelDownload(r.id));
    return item;
  }

  async startDownload(id) {
    await ToolMessenger.sendMessage('media-download', 'start', { tabId: this.resolveTabId(id), id });
  }

  async cancelDownload(id) {
    await ToolMessenger.sendMessage('media-download', 'cancel', { tabId: this.resolveTabId(id), id });
  }

  // 聚合视图里每条记录归属各自标签页；popup 视图固定当前页
  resolveTabId(id) {
    const r = this.records.find((x) => x.id === id);
    return (r && r._tabId) || this.tabId;
  }

  async clear() {
    if (this.standalone) {
      await ToolMessenger.sendMessage('media-sniffer', 'clearAll', {});
    } else {
      await ToolMessenger.sendMessage('media-sniffer', 'clear', { tabId: this.tabId });
    }
  }

  async execute() {
    return { success: true, message: '' };
  }

  async destroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    chrome.storage.onChanged.removeListener(this.storageListener);
    this.log('媒体嗅探工具已销毁');
  }
}

// 来源域名：优先记录的 documentUrl，回退媒体 URL 自身
function sourceHost(r) {
  try {
    return new URL(r.documentUrl || r.url).hostname;
  } catch {
    return '';
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
