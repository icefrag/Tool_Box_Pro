// 全屏页入口：组装编辑器、解析管线、树图、搜索与双向联动
import { JsonEditor } from './editor.js';
import { parseJson } from './json-parser.js';
import { buildTree, findNodeAt, findNodeById } from './tree-model.js';
import { TreeGraph } from './tree-graph.js';
import { findMatches } from './search.js';

const SAMPLE_JSON = `{
  "name": "ToolBox Pro",
  "version": "1.0.0",
  "features": [
    { "id": 1, "title": "Cookie 获取", "enabled": true },
    { "id": 2, "title": "XPath Helper", "enabled": true },
    { "id": 3, "title": "JSON 树图", "enabled": true, "tags": ["json", "tree", "graph"] }
  ],
  "author": { "name": "ToolBox", "contacts": { "email": null, "site": "https://example.com" } },
  "stats": { "downloads": 12345, "rating": 4.9, "beta": false }
}`;

const $ = (id) => document.getElementById(id);

class JsonTreeApp {
  constructor() {
    // 折叠状态三件套：autoCollapsed(>50 默认折叠) ∪ userCollapsed − userExpanded
    // 保证用户手动展开/折叠的决策在每次重新解析渲染后保留
    this.autoCollapsed = new Set();
    this.userCollapsed = new Set();
    this.userExpanded = new Set();
    this.tree = null; // 最近一次有效树
    this.matches = [];
    this.matchIndex = -1;
    this.flashTimer = null;

    this.editor = new JsonEditor($('editor-pane'), {
      onChange: () => this.handleInput(),
      onCursor: (offset) => this.handleCursor(offset),
    });
    this.graph = new TreeGraph($('graph-svg'));
    this.graph.attachMinimap($('minimap-svg'));
    this.graph.onNodeClick = (node) => this.editor.selectRange(node.start, node.end);
    this.graph.onToggleCollapse = (node) => this.toggleCollapse(node);

    this.bindToolbar();
    this.bindSearch();
    this.bindSplitter();
    this.editor.setValue(SAMPLE_JSON);
    this.handleInput();
  }

  effectiveCollapsed() {
    const set = new Set([...this.autoCollapsed, ...this.userCollapsed]);
    this.userExpanded.forEach((id) => set.delete(id));
    return set;
  }

  toggleCollapse(node) {
    if (this.effectiveCollapsed().has(node.id)) {
      this.userCollapsed.delete(node.id);
      this.userExpanded.add(node.id);
    } else {
      this.userExpanded.delete(node.id);
      this.userCollapsed.add(node.id);
    }
    this.refreshGraph(false);
  }

  bindToolbar() {
    $('btn-sample').addEventListener('click', () => {
      this.editor.setValue(SAMPLE_JSON);
    });
    $('btn-clear').addEventListener('click', () => {
      this.editor.setValue('');
    });
    $('btn-format').addEventListener('click', () => {
      if (!this.tree) return;
      if (!this.editor.format()) {
        this.flashStatus('当前内容不是有效 JSON，无法格式化', 'error');
        return;
      }
    });
    $('btn-minify').addEventListener('click', () => {
      if (!this.tree) return;
      if (!this.editor.minify()) {
        this.flashStatus('当前内容不是有效 JSON，无法压缩', 'error');
        return;
      }
    });
    $('btn-copy').addEventListener('click', async () => {
      const ok = await this.editor.copy();
      this.flashStatus(ok ? '已复制' : '复制失败', ok ? 'ok' : 'error');
    });
    $('zoom-in').addEventListener('click', () => this.graph.zoomIn());
    $('zoom-out').addEventListener('click', () => this.graph.zoomOut());
    $('zoom-fit').addEventListener('click', () => this.graph.fitView());
    $('zoom-reset').addEventListener('click', () => this.graph.resetView());
  }

  // 拖动分隔条调整编辑器/树图分栏宽度（20% ~ 80%）
  bindSplitter() {
    const splitter = $('jt-splitter');
    const pane = $('editor-pane');
    const main = document.querySelector('.jt-main');
    let dragging = false;

    splitter.addEventListener('pointerdown', (e) => {
      dragging = true;
      splitter.classList.add('active');
      splitter.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    splitter.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const rect = main.getBoundingClientRect();
      const pct = Math.min(0.8, Math.max(0.2, (e.clientX - rect.left) / rect.width));
      pane.style.flexBasis = (pct * 100).toFixed(2) + '%';
      this.scheduleEditorRefresh();
    });
    const stop = () => {
      if (!dragging) return;
      dragging = false;
      splitter.classList.remove('active');
      this.editor.refresh();
    };
    splitter.addEventListener('pointerup', stop);
    splitter.addEventListener('pointercancel', stop);
  }

  scheduleEditorRefresh() {
    if (this._refreshRaf) return;
    this._refreshRaf = requestAnimationFrame(() => {
      this._refreshRaf = null;
      this.editor.refresh();
    });
  }

  bindSearch() {
    let timer = null;
    const input = $('search-input');
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => this.handleSearch(), 200);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (this.matches.length === 0) return;
      this.matchIndex = e.shiftKey
        ? (this.matchIndex - 1 + this.matches.length) % this.matches.length
        : (this.matchIndex + 1) % this.matches.length;
      this.applyCurrentMatch();
    });
  }

  handleSearch() {
    const q = $('search-input').value;
    this.matches = this.tree ? findMatches(this.tree, q) : [];
    this.matchIndex = -1;
    $('search-count').textContent = this.matches.length ? `${this.matches.length} 个匹配` : '';
    this.editor.markRanges(this.matches.map((m) => ({ start: m.start, end: m.end })));
    if (this.matches.length > 0) {
      this.matchIndex = 0;
      this.applyCurrentMatch();
    } else {
      this.graph.setSearchState(null, null);
      this.refreshGraph(false);
    }
  }

  applyCurrentMatch() {
    const m = this.matches[this.matchIndex];
    // 展开被折叠的祖先后跳转
    let node = findNodeById(this.tree, m.path);
    while (node && node.parent) {
      this.userCollapsed.delete(node.parent.id);
      this.userExpanded.add(node.parent.id);
      node = node.parent;
    }
    this.graph.setSearchState(new Set(this.matches.map((x) => x.path)), m.path);
    this.refreshGraph(false);
    this.graph.focusNode(m.path);
  }

  handleInput() {
    const text = this.editor.getValue();
    if (!text.trim()) {
      this.tree = null;
      this.matches = [];
      this.matchIndex = -1;
      $('search-count').textContent = '';
      this.setError(null);
      this.setStatus('', '');
      this.graph.setSearchState(null, null);
      this.graph.render(null);
      $('graph-empty').classList.remove('hidden');
      return;
    }
    const res = parseJson(text);
    if (res.ok) {
      this.setError(null);
      this.setStatus('✓ 有效 JSON', 'ok');
      this.tree = buildTree(res.ast);
      this.autoCollapsed = computeDefaultCollapsed(this.tree);
      this.lastFocusId = null; // 树重建后光标定位状态失效
      $('graph-empty').classList.add('hidden');
      this.refreshGraph(true);
      if ($('search-input').value) this.handleSearch();
    } else {
      // 树图保持上次有效状态
      this.setStatus('✗ 无效 JSON', 'error');
      this.setError(res.error);
    }
  }

  refreshGraph(fit) {
    if (!this.tree) return;
    this.graph.render(this.tree, { fit, collapsed: this.effectiveCollapsed() });
  }

  handleCursor(offset) {
    if (!this.tree) return;
    const node = findNodeAt(this.tree, offset);
    const id = node ? node.id : null;
    this.graph.setFocus(id);
    if (!id) {
      this.lastFocusId = null;
      return;
    }
    if (id === this.lastFocusId) return; // 同一节点内移动光标不重复定位，避免打字时画布抖动
    this.lastFocusId = id;
    // 目标行可能被折叠隐藏：展开其全部祖先后定位居中
    let n = node;
    while (n && n.parent) {
      if (this.effectiveCollapsed().has(n.parent.id)) {
        this.userCollapsed.delete(n.parent.id);
        this.userExpanded.add(n.parent.id);
      }
      n = n.parent;
    }
    this.refreshGraph(false);
    this.graph.focusNode(id);
  }

  setError(err) {
    const bar = $('error-bar');
    if (!err) {
      bar.classList.add('hidden');
      bar.onclick = null;
      return;
    }
    bar.textContent = `第 ${err.line} 行第 ${err.column} 列：${err.message}（点击跳转）`;
    bar.classList.remove('hidden');
    bar.onclick = () => this.editor.gotoOffset(err.offset);
  }

  setStatus(text, cls) {
    const el = $('validation-status');
    el.textContent = text;
    el.className = 'jt-status' + (cls ? ' ' + cls : '');
  }

  flashStatus(text, cls) {
    clearTimeout(this.flashTimer);
    const el = $('validation-status');
    const prevText = el.textContent;
    const prevCls = el.className;
    el.textContent = text;
    el.className = 'jt-status ' + cls;
    this.flashTimer = setTimeout(() => {
      el.textContent = prevText;
      el.className = prevCls;
    }, 1200);
  }
}

// 自动折叠阈值：单层子节点超过该值时该层默认折叠
const AUTO_COLLAPSE_THRESHOLD = 50;
function computeDefaultCollapsed(root) {
  const collapsed = new Set();
  (function walk(node) {
    if (node.children && node.children.length > AUTO_COLLAPSE_THRESHOLD) collapsed.add(node.id);
    if (node.children) node.children.forEach(walk);
  })(root);
  return collapsed;
}

document.addEventListener('DOMContentLoaded', () => new JsonTreeApp());
