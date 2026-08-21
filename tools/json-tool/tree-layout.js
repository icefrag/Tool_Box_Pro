// 表格化横向树布局（纯函数，无 DOM / chrome API 依赖）
// 每个 object/array 节点渲染为一个紧凑表格：高度只由自身行数决定，行距固定。
// 展开行的子树盒（该行挂出的全部内容）垂直居中于行中心；同级子树盒自上而下推挤防重叠。
// 透明数组（元素全为非空复合节点）不建中转表格：元素子树直接挂到数组行。
// 返回 { rows: Map<path,{x,y,w,node}>, tables: Map<path,{x,y,w,h,node}>,
//        visible: Set<path>, edges: {from,to}[], bounds }
// edges：from = 起始行 path（普通表格=表格自身；透明数组=数组行），to = 目标表格 path
export const LAYOUT = { TABLE_W: 300, ROW_H: 24, TABLE_GAP: 60, PAD_X: 8, PAD_Y: 4, SUBTREE_GAP: 10 };
const COL_PITCH = LAYOUT.TABLE_W + LAYOUT.TABLE_GAP;

export function layoutTree(root, collapsed = new Set()) {
  const rows = new Map();
  const tables = new Map();
  const visible = new Set();

  const tableH = (node) => Math.max(LAYOUT.ROW_H, node.children.length * LAYOUT.ROW_H) + LAYOUT.PAD_Y * 2;
  const isExpanded = (node) => node.children && node.children.length > 0 && !collapsed.has(node.id);

  // 递归布局：返回以「子树盒顶部」为原点的局部坐标
  // { height: 子树盒高度, table: 自身表格矩形, rows: [], tables: [], edges: [] }
  function layoutNode(node, depth) {
    const x = depth * COL_PITCH;
    const h = tableH(node);
    const out = {
      height: h,
      table: { x, y: 0, w: LAYOUT.TABLE_W, h, node },
      rows: [],
      tables: [],
      edges: [],
    };
    let minY = 0;
    let maxY = h;
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
    const expandInto = (child, rowPath, rowY, depth) => {
      if (child.transparent) {
        for (const elem of child.children) expandInto(elem, rowPath, rowY, depth);
        return;
      }
      const sub = layoutNode(child, depth + 1);
      const preferred = rowY + LAYOUT.ROW_H / 2 - sub.height / 2;
      attach(sub, Math.max(preferred, cursor), rowPath);
    };
    node.children.forEach((child, i) => {
      const rowY = LAYOUT.PAD_Y + i * LAYOUT.ROW_H;
      out.rows.push({ x: x + LAYOUT.PAD_X, y: rowY, w: LAYOUT.TABLE_W - LAYOUT.PAD_X * 2, node: child });
      if (isExpanded(child)) expandInto(child, child.id, rowY, depth);
    });
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
