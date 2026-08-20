// SVG 树图（表格布局）：每个 object/array 渲染为一个表格，子项为行；缩放/拖拽、折叠切换、搜索/焦点高亮
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
    this.onNodeClick = null;        // (node) => void，行选中（联动编辑器）
    this.onToggleCollapse = null;   // (node) => void，行徽标点击（main 更新折叠集）
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.rowEls = new Map();
    this._layout = null;

    this.edgesLayer = svgEl('g', { class: 'tg-edges' });
    this.nodesLayer = svgEl('g', { class: 'tg-tables' });
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
      if (e.target.closest('.tg-row')) return; // 行区域不触发画布拖拽
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
    this.svg.addEventListener('pointercancel', () => { dragging = false; });
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
    this.rowEls = new Map();
    if (!root) {
      this._layout = null;
      return;
    }
    this._layout = layoutTree(root, collapsed);
    const { rows, tables, edges } = this._layout;

    // 连线：每个非根表格对应一条「行右缘 → 子表格左缘」的连线
    for (const path of edges) {
      this.edgesLayer.appendChild(this._edgePath(rows.get(path), tables.get(path)));
    }
    // 表格与行
    for (const table of tables.values()) {
      this.nodesLayer.appendChild(this._tableCard(table, rows));
    }
    this._updateStates();
    if (fit) this.fitView();
  }

  _edgePath(row, table) {
    const x1 = row.x + row.w;
    const y1 = row.y + LAYOUT.ROW_H / 2;
    const x2 = table.x;
    const y2 = table.y + table.h / 2;
    const dx = Math.max(30, (x2 - x1) / 2);
    return svgEl('path', {
      class: 'tg-edge',
      d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
    });
  }

  _tableCard(table, rows) {
    const node = table.node;
    const g = svgEl('g', {
      class: 'tg-table',
      transform: `translate(${table.x},${table.y})`,
      'data-path': node.id,
    });
    g.appendChild(svgEl('rect', {
      class: 'tg-table-bg',
      width: table.w,
      height: table.h,
      rx: 8,
      fill: '#ffffff',
      stroke: TYPE_COLORS[node.type] || '#999999',
      'stroke-width': 1.5,
    }));
    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        const rowEl = this._rowCard(child, rows.get(child.id), table);
        this.rowEls.set(child.id, rowEl);
        g.appendChild(rowEl);
      }
    } else {
      // 空对象/空数组/标量根：占位行
      const empty = svgEl('text', {
        class: 'tg-empty-row',
        x: LAYOUT.PAD_X + 4,
        y: LAYOUT.PAD_Y + LAYOUT.ROW_H / 2 + 4,
      });
      empty.textContent = node.children ? '（空）' : node.valueText;
      g.appendChild(empty);
    }
    return g;
  }

  _rowCard(node, row, table) {
    const color = TYPE_COLORS[node.type] || '#333333';
    const expandable = node.children && node.children.length > 0;
    const isExpanded = expandable && !this.collapsed.has(node.id);
    // 行在表格 <g> 内部，需将画布绝对坐标换算为表格相对坐标
    const g = svgEl('g', {
      class: 'tg-row',
      transform: `translate(${row.x - table.x},${row.y - table.y})`,
      'data-path': node.id,
    });
    g.appendChild(svgEl('rect', { class: 'tg-row-bg', width: row.w, height: LAYOUT.ROW_H, rx: 4 }));

    const key = svgEl('text', { class: 'tg-key', x: 4, y: LAYOUT.ROW_H / 2 + 4 });
    key.textContent = node.label.length > 16 ? node.label.slice(0, 15) + '…' : node.label;
    g.appendChild(key);

    if (node.children) {
      // 复合行：{n} / [n] 徽标（空容器显示 {} / []），徽标可点击展开/收起
      const badgeText = node.children.length === 0
        ? (node.type === 'object' ? '{}' : '[]')
        : (node.type === 'object' ? `{${node.childCount}}` : `[${node.childCount}]`);
      if (isExpanded) {
        const bw = badgeText.length * 7.5 + 12;
        g.appendChild(svgEl('rect', {
          x: row.w - 4 - bw,
          y: 3,
          width: bw,
          height: LAYOUT.ROW_H - 6,
          rx: 4,
          fill: color,
        }));
      }
      const badge = svgEl('text', {
        class: 'tg-badge',
        x: row.w - 10,
        y: LAYOUT.ROW_H / 2 + 4,
        'text-anchor': 'end',
        fill: isExpanded ? '#ffffff' : color,
      });
      badge.textContent = badgeText;
      g.appendChild(badge);
      if (expandable) {
        const hit = svgEl('rect', {
          class: 'tg-badge-hit',
          x: row.w - 64,
          width: 64,
          height: LAYOUT.ROW_H,
          fill: 'transparent',
        });
        hit.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.onToggleCollapse) this.onToggleCollapse(node);
        });
        g.appendChild(hit);
      }
    } else {
      const val = svgEl('text', {
        class: 'tg-val',
        x: row.w - 4,
        y: LAYOUT.ROW_H / 2 + 4,
        'text-anchor': 'end',
      });
      val.textContent = node.valueText;
      g.appendChild(val);
    }

    g.addEventListener('click', () => {
      if (this.onNodeClick) this.onNodeClick(node);
    });
    return g;
  }

  _updateStates() {
    const hasQuery = this.matchedPaths !== null;
    for (const [id, el] of this.rowEls) {
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
    const layout = this._layout;
    const target = (layout && layout.rows.get(path)) || (layout && layout.tables.get(path));
    if (!target) return;
    const h = target.h || LAYOUT.ROW_H;
    const r = this.svg.getBoundingClientRect();
    this.tx = r.width / 2 - (target.x + target.w / 2) * this.scale;
    this.ty = r.height / 2 - (target.y + h / 2) * this.scale;
    this._applyTransform();
  }
}
