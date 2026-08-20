// SVG 树图：节点卡片渲染、缩放/拖拽、折叠切换、搜索/焦点高亮
// 折叠状态由调用方（main.js）持有，本组件只读 + 通过 onToggleCollapse 回调通知
import { layoutTree, LAYOUT } from './tree-layout.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export const TYPE_COLORS = {
  object: '#764ba2',
  array: '#2f80ed',
  string: '#27ae60',
  number: '#e67e22',
  boolean: '#17a2b8',
  null: '#828282',
};

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

export class TreeGraph {
  constructor(svg) {
    this.svg = svg;
    this.root = null;
    this.collapsed = new Set();
    this.matchedPaths = null; // Set<string> | null，null 表示无搜索
    this.currentPath = null;  // 搜索循环当前项
    this.focusPath = null;    // 编辑器光标联动焦点
    this.onNodeClick = null;        // (node) => void，节点选中（联动编辑器）
    this.onToggleCollapse = null;   // (node) => void，折叠徽标点击（main 更新折叠集）
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.nodeEls = new Map();
    this._layout = null;

    this.edgesLayer = svgEl('g', { class: 'tg-edges' });
    this.nodesLayer = svgEl('g', { class: 'tg-nodes' });
    this.content = svgEl('g', { class: 'tg-content' });
    this.content.append(this.edgesLayer, this.nodesLayer);
    this.svg.append(this.content);
    this._bindCanvasEvents();
  }

  _bindCanvasEvents() {
    this.svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.svg.getBoundingClientRect();
      this._zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.1 : 0.9);
    }, { passive: false });

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    this.svg.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.tg-node')) return; // 节点区域不触发画布拖拽
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      this.svg.setPointerCapture(e.pointerId);
    });
    this.svg.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.tx += e.clientX - lastX;
      this.ty += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      this._applyTransform();
    });
    this.svg.addEventListener('pointerup', () => { dragging = false; });
  }

  _zoomAt(cx, cy, factor) {
    const next = Math.min(4, Math.max(0.15, this.scale * factor));
    const k = next / this.scale;
    this.tx = cx - (cx - this.tx) * k;
    this.ty = cy - (cy - this.ty) * k;
    this.scale = next;
    this._applyTransform();
  }

  _applyTransform() {
    this.content.setAttribute('transform', `translate(${this.tx},${this.ty}) scale(${this.scale})`);
  }

  zoomIn() {
    const r = this.svg.getBoundingClientRect();
    this._zoomAt(r.width / 2, r.height / 2, 1.2);
  }

  zoomOut() {
    const r = this.svg.getBoundingClientRect();
    this._zoomAt(r.width / 2, r.height / 2, 1 / 1.2);
  }

  resetView() {
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this._applyTransform();
  }

  fitView() {
    if (!this._layout) return;
    const r = this.svg.getBoundingClientRect();
    const { width, height } = this._layout.bounds;
    if (!r.width || !r.height || !width || !height) return;
    const pad = 40;
    const s = Math.min((r.width - pad * 2) / width, (r.height - pad * 2) / height, 1.5);
    this.scale = Math.max(0.15, s);
    this.tx = (r.width - width * this.scale) / 2;
    this.ty = (r.height - height * this.scale) / 2;
    this._applyTransform();
  }

  // 渲染整棵树；fit=true 时渲染后自动适应画布
  render(root, { fit = false, collapsed = new Set() } = {}) {
    this.root = root;
    this.collapsed = collapsed;
    this.edgesLayer.innerHTML = '';
    this.nodesLayer.innerHTML = '';
    this.nodeEls = new Map();
    if (!root) {
      this._layout = null;
      return;
    }
    this._layout = layoutTree(root, collapsed);
    const { positions, visible } = this._layout;
    for (const node of this._walkVisible(root, visible)) {
      const p = positions.get(node.id);
      if (node.parent && visible.has(node.parent.id)) {
        this.edgesLayer.appendChild(this._edgePath(positions.get(node.parent.id), p));
      }
      const card = this._nodeCard(node, p);
      this.nodeEls.set(node.id, card);
      this.nodesLayer.appendChild(card);
    }
    this._updateStates();
    if (fit) this.fitView();
  }

  *_walkVisible(node, visible) {
    if (!visible.has(node.id)) return;
    yield node;
    if (node.children && !this.collapsed.has(node.id)) {
      for (const child of node.children) {
        yield* this._walkVisible(child, visible);
      }
    }
  }

  _edgePath(from, to) {
    const x1 = from.x + LAYOUT.CARD_W;
    const y1 = from.y + LAYOUT.CARD_H / 2;
    const x2 = to.x;
    const y2 = to.y + LAYOUT.CARD_H / 2;
    const dx = Math.max(30, (x2 - x1) / 2);
    return svgEl('path', {
      class: 'tg-edge',
      d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
    });
  }

  _nodeCard(node, p) {
    const color = TYPE_COLORS[node.type] || '#333';
    const g = svgEl('g', {
      class: 'tg-node',
      transform: `translate(${p.x},${p.y})`,
      'data-path': node.id,
    });
    g.appendChild(svgEl('rect', {
      class: 'tg-card',
      width: LAYOUT.CARD_W,
      height: LAYOUT.CARD_H,
      rx: 8,
      fill: '#ffffff',
      stroke: color,
      'stroke-width': 1.5,
    }));
    g.appendChild(svgEl('circle', { cx: 12, cy: LAYOUT.CARD_H / 2, r: 5, fill: color }));

    const label = svgEl('text', { class: 'tg-label', x: 24, y: LAYOUT.CARD_H / 2 + 4 });
    label.textContent = node.label.length > 16 ? node.label.slice(0, 15) + '…' : node.label;
    g.appendChild(label);

    if (node.valueText) {
      const value = svgEl('text', {
        class: 'tg-value',
        x: LAYOUT.CARD_W - 12,
        y: LAYOUT.CARD_H / 2 + 4,
        'text-anchor': 'end',
      });
      value.textContent = node.valueText;
      g.appendChild(value);
    }

    if (node.children && node.children.length > 0) {
      const isCollapsed = this.collapsed.has(node.id);
      const toggle = svgEl('g', { class: 'tg-toggle' });
      toggle.appendChild(svgEl('circle', {
        cx: LAYOUT.CARD_W,
        cy: LAYOUT.CARD_H / 2,
        r: 9,
        fill: isCollapsed ? color : '#ffffff',
        stroke: color,
        'stroke-width': 1.5,
      }));
      const sign = svgEl('text', {
        class: 'tg-toggle-sign',
        x: LAYOUT.CARD_W,
        y: LAYOUT.CARD_H / 2 + 4,
        'text-anchor': 'middle',
        fill: isCollapsed ? '#ffffff' : color,
      });
      sign.textContent = isCollapsed ? String(node.childCount) : '−';
      toggle.appendChild(sign);
      g.appendChild(toggle);
    }

    g.addEventListener('click', (e) => {
      if (e.target.closest('.tg-toggle')) {
        if (this.onToggleCollapse) this.onToggleCollapse(node);
      } else if (this.onNodeClick) {
        this.onNodeClick(node);
      }
    });
    return g;
  }

  _updateStates() {
    const hasQuery = this.matchedPaths !== null;
    for (const [id, el] of this.nodeEls) {
      const matched = hasQuery && this.matchedPaths.has(id);
      el.classList.toggle('matched', matched);
      el.classList.toggle('current', this.currentPath === id);
      el.classList.toggle('dim', hasQuery && !matched);
      el.classList.toggle('focused', this.focusPath === id);
    }
  }

  setSearchState(matchedPaths, currentPath) {
    this.matchedPaths = matchedPaths;
    this.currentPath = currentPath;
    this._updateStates();
  }

  setFocus(path) {
    this.focusPath = path;
    this._updateStates();
  }

  focusNode(path) {
    const p = this._layout && this._layout.positions.get(path);
    if (!p) return;
    const r = this.svg.getBoundingClientRect();
    this.tx = r.width / 2 - (p.x + LAYOUT.CARD_W / 2) * this.scale;
    this.ty = r.height / 2 - (p.y + LAYOUT.CARD_H / 2) * this.scale;
    this._applyTransform();
  }
}
