// SVG 树图（表格布局）：每个 object/array 渲染为一个表格，子项为行；缩放/拖拽、折叠切换、搜索/焦点高亮
// 折叠状态由调用方（main.js）持有，本组件只读 + 通过 onToggleCollapse 回调通知
import { layoutTree, LAYOUT } from './tree-layout.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// JSON 六类型语义色(暗色主题)——与 tool.css 的 --c-* token 同源,编辑器 token 色一致
export const TYPE_COLORS = {
  object: '#b39ddb',
  array: '#6ca8ff',
  string: '#7ee787',
  number: '#f4a960',
  boolean: '#5fd3d3',
  null: '#7d8590',
};

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// CJK / 全角字符（按 2 单位视觉宽度计）
const WIDE_CHAR_RE = /[\u2E80-\u9FFF\uF900-\uFAFF\u3000-\u303F\uFF00-\uFFEF]/;

// 按视觉宽度截断：汉字/全角记 2 单位、其余 1 单位；内容可用满上限，放不下时以 … 附加结尾
export function ellipsize(text, maxUnits) {
  const t = String(text ?? '');
  let units = 0;
  let out = '';
  for (const ch of t) {
    const w = WIDE_CHAR_RE.test(ch) ? 2 : 1;
    if (units + w > maxUnits) return out + '…';
    units += w;
    out += ch;
  }
  return t;
}

// 复合值徽标文本：{} / [] / {n} / [n]
function badgeText(node) {
  const [open, close] = node.type === 'object' ? ['{', '}'] : ['[', ']'];
  return open + (node.children.length || '') + close;
}

// 悬停提示全文：复合值显示容器计数徽标，标量显示未截断全文
function titleText(node) {
  const summary = node.children ? badgeText(node) : (node.searchText ?? node.valueText);
  return `${node.label}: ${summary}`;
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
    this.gridRows = new Map(); // 网格数据行几何（元素节点不在 layout.rows/tables，focusNode 兜底用）
    this._layout = null;

    // 缩略图（minimap）状态
    this.minimapSvg = null;
    this._mmRoot = null;
    this._mmContent = null;
    this._mmViewport = null;
    this._mm = null; // { s: 缩放比, ox, oy: 内容居中偏移 }

    this.edgesLayer = svgEl('g', { class: 'tg-edges' });
    this.nodesLayer = svgEl('g', { class: 'tg-tables' });
    this.content = svgEl('g', { class: 'tg-content' });
    this.content.append(this.edgesLayer, this.nodesLayer);
    this.svg.append(this.content);
    this._bindCanvasEvents();
  }

  // 挂载缩略图：预览整树 + 视口框 + 点击/拖动跳转
  attachMinimap(minimapSvg) {
    this.minimapSvg = minimapSvg;
    minimapSvg.innerHTML = '';
    this._mmContent = svgEl('g', { class: 'mm-content' });
    this._mmViewport = svgEl('rect', { class: 'mm-viewport' });
    this._mmRoot = svgEl('g', {});
    this._mmRoot.append(this._mmContent, this._mmViewport);
    minimapSvg.append(this._mmRoot);
    this._bindMinimapEvents();
    if (this._layout) this._renderMinimap();
  }

  _bindMinimapEvents() {
    const svg = this.minimapSvg;
    let down = false;
    const jump = (e) => {
      if (!this._mm) return;
      const rect = svg.getBoundingClientRect();
      const cx = ((e.clientX - rect.left) - this._mm.ox) / this._mm.s;
      const cy = ((e.clientY - rect.top) - this._mm.oy) / this._mm.s;
      const r = this.svg.getBoundingClientRect();
      this.tx = r.width / 2 - cx * this.scale;
      this.ty = r.height / 2 - cy * this.scale;
      this._applyTransform();
    };
    svg.addEventListener('pointerdown', (e) => {
      down = true;
      svg.setPointerCapture(e.pointerId);
      jump(e);
    });
    svg.addEventListener('pointermove', (e) => {
      if (down) jump(e);
    });
    svg.addEventListener('pointerup', () => { down = false; });
    svg.addEventListener('pointercancel', () => { down = false; });
  }

  _renderMinimap() {
    const container = this.minimapSvg && this.minimapSvg.parentElement;
    if (!container || !this._layout) return;
    container.classList.remove('hidden');
    const { tables, edges, bounds } = this._layout;
    const r = this.minimapSvg.getBoundingClientRect();
    if (!r.width || !r.height || !bounds.width) return;
    const s = Math.min(r.width / bounds.width, r.height / bounds.height, 1);
    const ox = (r.width - bounds.width * s) / 2;
    const oy = (r.height - bounds.height * s) / 2;
    this._mm = { s, ox, oy };
    this._mmRoot.setAttribute('transform', `translate(${ox},${oy}) scale(${s})`);
    this._mmContent.innerHTML = '';
    for (const t of tables.values()) {
      this._mmContent.appendChild(svgEl('rect', {
        x: t.x,
        y: t.y,
        width: t.w,
        height: t.h,
        fill: '#161b26',
        stroke: TYPE_COLORS[t.node.type] || TYPE_COLORS.null,
        'stroke-width': 1 / s,
      }));
    }
    for (const { from, to } of edges) {
      const row = this._layout.rows.get(from);
      const table = tables.get(to);
      this._mmContent.appendChild(svgEl('path', {
        class: 'tg-edge',
        stroke: '#39446a',
        'stroke-width': 1 / s,
        fill: 'none',
        d: this._edgePath(row, table).getAttribute('d'),
      }));
    }
    this._syncMinimapViewport();
  }

  _syncMinimapViewport() {
    if (!this._mm || !this._mmViewport) return;
    const r = this.svg.getBoundingClientRect();
    this._mmViewport.setAttribute('x', -this.tx / this.scale);
    this._mmViewport.setAttribute('y', -this.ty / this.scale);
    this._mmViewport.setAttribute('width', r.width / this.scale);
    this._mmViewport.setAttribute('height', r.height / this.scale);
  }

  _hideMinimap() {
    if (this.minimapSvg && this.minimapSvg.parentElement) {
      this.minimapSvg.parentElement.classList.add('hidden');
    }
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
    this._syncMinimapViewport();
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
    this.gridRows = new Map();
    if (!root) {
      this._layout = null;
      this._hideMinimap();
      return;
    }
    this._layout = layoutTree(root, collapsed);
    const { rows, tables, edges } = this._layout;

    // 连线：每个非根表格对应一条「行右缘 → 子表格左缘」的连线
    for (const { from, to } of edges) {
      this.edgesLayer.appendChild(this._edgePath(rows.get(from), tables.get(to)));
    }
    // 表格与行
    for (const table of tables.values()) {
      this.nodesLayer.appendChild(this._tableCard(table, rows));
    }
    this._updateStates();
    if (fit) this.fitView();
    this._renderMinimap();
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
    if (table.node.grid) return this._gridCard(table, rows);
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
    }));
    // 左侧类型色条:表格内容类型一眼可辨(IDE 文件树图标色心智),边框保持中性
    g.appendChild(svgEl('rect', {
      class: 'tg-type-strip',
      width: 3,
      height: table.h,
      rx: 1.5,
      fill: TYPE_COLORS[node.type] || TYPE_COLORS.null,
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
    const color = TYPE_COLORS[node.type] || TYPE_COLORS.null;
    const expandable = node.children && node.children.length > 0;
    const isExpanded = expandable && !this.collapsed.has(node.id);
    // 行在表格 <g> 内部，需将画布绝对坐标换算为表格相对坐标
    const g = svgEl('g', {
      class: 'tg-row',
      transform: `translate(${row.x - table.x},${row.y - table.y})`,
      'data-path': node.id,
    });
    g.appendChild(svgEl('rect', { class: 'tg-row-bg', width: row.w, height: LAYOUT.ROW_H, rx: 4 }));

    // 悬停显示完整内容（值列显示时被截断，title 里给全文）
    const title = svgEl('title');
    title.textContent = titleText(node);
    g.appendChild(title);

    const key = svgEl('text', { class: 'tg-key', x: 4, y: LAYOUT.ROW_H / 2 + 4 });
    key.textContent = ellipsize(node.label, 16);
    g.appendChild(key);

    if (node.children) {
      // 复合行：{n} / [n] 徽标（空容器显示 {} / []），徽标可点击展开/收起
      const text = badgeText(node);
      if (isExpanded) {
        const bw = text.length * 7.5 + 12;
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
        fill: isExpanded ? '#0d1017' : color,
      });
      badge.textContent = text;
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
        class: 'tg-val tg-t-' + node.type,
        x: row.w - 4,
        y: LAYOUT.ROW_H / 2 + 4,
        'text-anchor': 'end',
      });
      val.textContent = ellipsize(node.valueText, 22);
      g.appendChild(val);
    }

    g.addEventListener('click', () => {
      if (this.onNodeClick) this.onNodeClick(node);
    });
    return g;
  }

  // 网格表格：表头=字段并集，每元素一行；单元格=元素属性，复合值显示徽标（点击折叠子表格）
  _gridCard(table, rows) {
    const node = table.node;
    const cols = node.grid.cols;
    const colW = table.w / cols.length;
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
    }));
    // 左侧类型色条:表格内容类型一眼可辨(IDE 文件树图标色心智),边框保持中性
    g.appendChild(svgEl('rect', {
      class: 'tg-type-strip',
      width: 3,
      height: table.h,
      rx: 1.5,
      fill: TYPE_COLORS[node.type] || TYPE_COLORS.null,
    }));

    // 表头行
    g.appendChild(svgEl('rect', {
      class: 'tg-grid-head',
      x: 1,
      y: LAYOUT.PAD_Y,
      width: table.w - 2,
      height: LAYOUT.ROW_H,
    }));
    cols.forEach((label, ci) => {
      const t = svgEl('text', {
        class: 'tg-grid-head-text',
        x: ci * colW + 6,
        y: LAYOUT.PAD_Y + LAYOUT.ROW_H / 2 + 4,
      });
      t.textContent = ellipsize(label, Math.max(4, Math.floor((colW - 12) / 7)));
      g.appendChild(t);
    });

    // 列分隔线（贯穿表头与数据行）
    for (let ci = 1; ci < cols.length; ci++) {
      g.appendChild(svgEl('line', {
        class: 'tg-grid-line',
        x1: ci * colW,
        y1: LAYOUT.PAD_Y,
        x2: ci * colW,
        y2: table.h - LAYOUT.PAD_Y,
      }));
    }

    node.children.forEach((elem, i) => {
      const rowY = LAYOUT.PAD_Y + (1 + i) * LAYOUT.ROW_H;
      if (i < node.children.length - 1) {
        g.appendChild(svgEl('line', {
          class: 'tg-grid-line',
          x1: 1,
          y1: rowY + LAYOUT.ROW_H,
          x2: table.w - 1,
          y2: rowY + LAYOUT.ROW_H,
        }));
      }
      const rowG = svgEl('g', {
        class: 'tg-row tg-grid-row',
        transform: `translate(0,${rowY})`,
        'data-path': elem.id,
      });
      rowG.appendChild(svgEl('rect', { class: 'tg-row-bg', width: table.w, height: LAYOUT.ROW_H }));
      const title = svgEl('title');
      title.textContent = titleText(elem);
      rowG.appendChild(title);
      rowG.addEventListener('click', () => {
        if (this.onNodeClick) this.onNodeClick(elem);
      });
      this.rowEls.set(elem.id, rowG);
      this.gridRows.set(elem.id, { x: table.x, y: table.y + rowY, w: table.w, h: LAYOUT.ROW_H });
      for (const p of elem.children) {
        const cell = this._gridCell(p, rows.get(p.id), table);
        this.rowEls.set(p.id, cell);
        rowG.appendChild(cell);
      }
      g.appendChild(rowG);
    });
    return g;
  }

  // 网格单元格：标量显示值；复合值显示居中徽标，徽标可点击折叠、格内其余区域点击联动编辑器
  _gridCell(node, cell, table) {
    const color = TYPE_COLORS[node.type] || TYPE_COLORS.null;
    const expandable = node.children && node.children.length > 0;
    const isExpanded = expandable && !this.collapsed.has(node.id);
    // 单元格挂在数据行 g 内部（行已平移到 rowY），此处只做列偏移，勿再减表格原点
    const g = svgEl('g', {
      class: 'tg-cell',
      transform: `translate(${cell.x - table.x},0)`,
      'data-path': node.id,
    });
    g.appendChild(svgEl('rect', { class: 'tg-cell-bg', width: cell.w, height: LAYOUT.ROW_H }));

    const title = svgEl('title');
    title.textContent = titleText(node);
    g.appendChild(title);

    if (node.children) {
      const text = badgeText(node);
      const bw = text.length * 7.5 + 12;
      if (isExpanded) {
        g.appendChild(svgEl('rect', {
          x: (cell.w - bw) / 2,
          y: 3,
          width: bw,
          height: LAYOUT.ROW_H - 6,
          rx: 4,
          fill: color,
        }));
      }
      const badge = svgEl('text', {
        class: 'tg-badge',
        x: cell.w / 2,
        y: LAYOUT.ROW_H / 2 + 4,
        'text-anchor': 'middle',
        fill: isExpanded ? '#0d1017' : color,
      });
      badge.textContent = text;
      g.appendChild(badge);
      if (expandable) {
        const hit = svgEl('rect', {
          class: 'tg-badge-hit',
          x: (cell.w - bw) / 2 - 6,
          width: bw + 12,
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
        class: 'tg-val tg-t-' + node.type,
        x: 6,
        y: LAYOUT.ROW_H / 2 + 4,
      });
      val.textContent = ellipsize(node.valueText, Math.max(4, Math.floor((cell.w - 12) / 6.5)));
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
      // 网格数据行只做焦点高亮：不参与匹配/淡化，避免整行半透明压暗其中命中的单元格
      if (el.classList.contains('tg-grid-row')) {
        el.classList.toggle('focused', this.focusPath === id);
        continue;
      }
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
    const target = (layout && layout.rows.get(path))
      || (layout && layout.tables.get(path))
      || this.gridRows.get(path);
    if (!target) return;
    const h = target.h || LAYOUT.ROW_H;
    const r = this.svg.getBoundingClientRect();
    this.tx = r.width / 2 - (target.x + target.w / 2) * this.scale;
    this.ty = r.height / 2 - (target.y + h / 2) * this.scale;
    this._applyTransform();
  }
}
