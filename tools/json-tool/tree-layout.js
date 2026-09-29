// 表格化横向树布局（纯函数，无 DOM / chrome API 依赖）
// 每个 object/array 节点渲染为一个紧凑表格：高度只由自身行数决定，行距固定。
// 展开行的子树盒（该行挂出的全部内容）垂直居中于行中心；同级子树盒自上而下推挤防重叠。
// 透明数组（元素全为非空复合但含非对象）不建中转表格：元素子树直接挂到数组行。
// 网格数组（元素全为非空对象，node.grid）渲染为一张网格表格：表头=字段并集、行=元素，
// 复合值单元格挂子表格（递归同规则），整张网格由数组行的折叠状态收起/展开。
// 返回 { rows: Map<path,{x,y,w,node}>, tables: Map<path,{x,y,w,h,node,kind?}>,
//        visible: Set<path>, edges: {from,to}[], bounds }
// edges：from = 起始行/单元格 path（普通表格=表格自身；透明数组=数组行；网格=数组行或单元格），to = 目标表格 path
// 列起点：同深度表格左缘对齐；列宽取该深度可见表格的最大宽（网格比普通表格宽时整列右移防重叠）
export const LAYOUT = {
  TABLE_W: 300, ROW_H: 24, TABLE_GAP: 60, PAD_X: 8, PAD_Y: 4, SUBTREE_GAP: 10,
  // 网格列宽：徽标列固定窄宽；标量列按列画像 units 换算(7px/单位+内边距)，clamp 到 [MIN, MAX]
  GRID_BADGE_W: 64, GRID_COL_MIN: 90, GRID_COL_MAX: 300, GRID_MAX_W: 900,
};

// 列画像(kinds/units)→像素列宽；总宽超上限时按比例压缩标量列(徽标列不动)，但不低于最小宽。
// 结果缓存到 grid.widths，供布局(列偏移/表宽)与渲染共用。
export function computeGridWidths(grid) {
  const widths = grid.cols.map((_, i) => (grid.kinds[i] === 'badge'
    ? LAYOUT.GRID_BADGE_W
    : Math.min(LAYOUT.GRID_COL_MAX, Math.max(LAYOUT.GRID_COL_MIN, grid.units[i] * 7 + 14))));
  const total = widths.reduce((a, b) => a + b, 0);
  if (total > LAYOUT.GRID_MAX_W) {
    const badgeTotal = widths.reduce((a, w, i) => a + (grid.kinds[i] === 'badge' ? w : 0), 0);
    const scalarTotal = total - badgeTotal;
    const budget = LAYOUT.GRID_MAX_W - badgeTotal;
    if (budget > 0 && scalarTotal > budget) {
      const k = budget / scalarTotal;
      widths.forEach((w, i) => {
        if (grid.kinds[i] !== 'badge') widths[i] = Math.max(LAYOUT.GRID_COL_MIN, Math.floor(w * k));
      });
    }
  }
  return widths;
}

export function layoutTree(root, collapsed = new Set()) {
  const rows = new Map();
  const tables = new Map();
  const visible = new Set();

  const tableW = (node) => {
    if (!node.grid) return LAYOUT.TABLE_W;
    if (!node.grid.widths) node.grid.widths = computeGridWidths(node.grid);
    return node.grid.widths.reduce((a, b) => a + b, 0);
  };
  const tableH = (node) => (node.grid
    ? 1 + node.children.length
    : Math.max(1, node.children ? node.children.length : 0)) * LAYOUT.ROW_H + LAYOUT.PAD_Y * 2;
  const isExpanded = (node) => node.children && node.children.length > 0 && !collapsed.has(node.id);

  // 第一遍：收集每个深度的最大表格宽度（展开/下钻规则与第二遍 layoutNode/expandInto 一致）
  const colWidths = new Map();
  const measure = (node, depth) => {
    colWidths.set(depth, Math.max(colWidths.get(depth) || 0, tableW(node)));
    if (node.grid) {
      for (const elem of node.children) {
        for (const p of elem.children) {
          if (isExpanded(p)) measureInto(p, depth + 1);
        }
      }
      return;
    }
    for (const child of node.children) {
      if (isExpanded(child)) measureInto(child, depth + 1);
    }
  };
  // transparent 数组不建表，元素子树与该数组行同挂 targetDepth（镜像 expandInto 的下钻）
  const measureInto = (child, targetDepth) => {
    if (child.transparent) {
      child.children.forEach((e) => measureInto(e, targetDepth));
      return;
    }
    measure(child, targetDepth);
  };
  if (root.children && root.children.length > 0) measure(root, 0);
  else colWidths.set(0, tableW(root));

  const colXs = new Map();
  let colX = 0;
  for (const d of [...colWidths.keys()].sort((a, b) => a - b)) {
    colXs.set(d, colX);
    colX += colWidths.get(d) + LAYOUT.TABLE_GAP;
  }

  // 递归布局：返回以「子树盒顶部」为原点的局部坐标
  // { height: 子树盒高度, table: 自身表格矩形, rows: [], tables: [], edges: [] }
  function layoutNode(node, depth) {
    const x = colXs.get(depth);
    const h = tableH(node);
    const out = {
      height: h,
      table: { x, y: 0, w: tableW(node), h, node },
      rows: [],
      tables: [],
      edges: [],
    };
    if (node.grid) out.table.kind = 'grid';
    let minY = 0;
    let maxY = out.height;
    let cursor = -Infinity;
    const attach = (sub, y, fromPath) => {
      out.rows.push(...sub.rows.map((r) => ({ ...r, y: r.y + y })));
      out.tables.push(...sub.tables.map((t) => ({ ...t, y: t.y + y })), { ...sub.table, y: sub.table.y + y });
      out.edges.push({ from: fromPath, to: sub.table.node.id }, ...sub.edges);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y + sub.height);
      cursor = y + sub.height + LAYOUT.SUBTREE_GAP;
    };
    // 展开行 child：透明数组不建表，其元素（含嵌套透明链）都挂到同一行
    const expandInto = (child, rowPath, rowY, d) => {
      if (child.transparent) {
        for (const elem of child.children) expandInto(elem, rowPath, rowY, d);
        return;
      }
      const sub = layoutNode(child, d + 1);
      const preferred = rowY + LAYOUT.ROW_H / 2 - sub.height / 2;
      attach(sub, Math.max(preferred, cursor), rowPath);
    };
    if (node.grid) {
      // 网格：跳过表头，每元素一行；单元格进 rows，复合值单元格挂子表；列宽由列画像决定
      if (!node.grid.widths) node.grid.widths = computeGridWidths(node.grid);
      const colXs = [0];
      for (let ci = 1; ci < node.grid.widths.length; ci++) {
        colXs[ci] = colXs[ci - 1] + node.grid.widths[ci - 1];
      }
      node.children.forEach((elem, i) => {
        const rowY = LAYOUT.PAD_Y + (1 + i) * LAYOUT.ROW_H;
        for (const p of elem.children) {
          const ci = node.grid.cols.indexOf(p.label);
          out.rows.push({ x: x + colXs[ci], y: rowY, w: node.grid.widths[ci], node: p });
          if (isExpanded(p)) expandInto(p, p.id, rowY, depth);
        }
      });
    } else {
      node.children.forEach((child, i) => {
        const rowY = LAYOUT.PAD_Y + i * LAYOUT.ROW_H;
        out.rows.push({ x: x + LAYOUT.PAD_X, y: rowY, w: out.table.w - LAYOUT.PAD_X * 2, node: child });
        if (isExpanded(child)) expandInto(child, child.id, rowY, depth);
      });
    }
    // 子树盒归一化：整体平移使盒顶为 0
    if (minY !== 0) {
      out.table.y -= minY;
      out.rows.forEach((r) => { r.y -= minY; });
      out.tables.forEach((t) => { t.y -= minY; });
    }
    out.height = maxY - minY;
    return out;
  }

  let rootEdges;
  if (root.children && root.children.length > 0) {
    const layout = layoutNode(root, 0);
    tables.set(root.id, layout.table);
    for (const r of layout.rows) rows.set(r.node.id, r);
    for (const t of layout.tables) tables.set(t.node.id, t);
    rootEdges = layout.edges;
  } else {
    // 标量根 / 空对象 / 空数组根：根自身作为表格中的唯一一行
    rows.set(root.id, { x: LAYOUT.PAD_X, y: LAYOUT.PAD_Y, w: LAYOUT.TABLE_W - LAYOUT.PAD_X * 2, node: root });
    tables.set(root.id, { x: 0, y: 0, w: LAYOUT.TABLE_W, h: LAYOUT.ROW_H + LAYOUT.PAD_Y * 2, node: root });
    rootEdges = [];
  }

  for (const id of rows.keys()) visible.add(id);
  for (const id of tables.keys()) visible.add(id);

  let maxX = 0;
  let maxY = 0;
  for (const t of tables.values()) {
    maxX = Math.max(maxX, t.x + t.w);
    maxY = Math.max(maxY, t.y + t.h);
  }
  return { rows, tables, visible, edges: rootEdges, bounds: { width: Math.max(maxX, 1), height: Math.max(maxY, 1) } };
}
