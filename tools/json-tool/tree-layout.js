// 表格化横向树布局（纯函数，无 DOM / chrome API 依赖）
// 每个 object/array 节点渲染为一个表格：子项是表格中的行（一行两列：key | 值/徽标）。
// 复合行展开后，其子表格挂在右一列，行垂直居中于子表格；折叠行只占一行高。
// 返回 { rows: Map<path,{x,y,w,node}>, tables: Map<path,{x,y,w,h,node}>,
//        visible: Set<path>, edges: path[], bounds }
// edges：每个非根表格的 path（行与子表格同节点，渲染层据此连线）
export const LAYOUT = { TABLE_W: 300, ROW_H: 26, TABLE_GAP: 60, PAD_X: 8, PAD_Y: 6 };
const COL_PITCH = LAYOUT.TABLE_W + LAYOUT.TABLE_GAP;

export function layoutTree(root, collapsed = new Set()) {
  const rows = new Map();
  const tables = new Map();
  const visible = new Set();

  function placeTable(node, depth, top) {
    visible.add(node.id);
    const x = depth * COL_PITCH;
    let y = top + LAYOUT.PAD_Y;
    for (const child of node.children) {
      visible.add(child.id);
      const expandable = child.children && child.children.length > 0;
      const expanded = expandable && !collapsed.has(child.id);
      let spaceH = LAYOUT.ROW_H;
      if (expanded) {
        spaceH = Math.max(LAYOUT.ROW_H, placeTable(child, depth + 1, y));
      }
      rows.set(child.id, {
        x: x + LAYOUT.PAD_X,
        y: y + (spaceH - LAYOUT.ROW_H) / 2,
        w: LAYOUT.TABLE_W - LAYOUT.PAD_X * 2,
        node: child,
      });
      y += spaceH;
    }
    const h = Math.max(LAYOUT.ROW_H, y - top - LAYOUT.PAD_Y) + LAYOUT.PAD_Y * 2;
    tables.set(node.id, { x, y: top, w: LAYOUT.TABLE_W, h, node });
    return h;
  }

  if (root.children && root.children.length > 0) {
    placeTable(root, 0, 0);
  } else {
    // 标量根 / 空对象 / 空数组根：根自身作为表格中的唯一一行
    visible.add(root.id);
    rows.set(root.id, { x: LAYOUT.PAD_X, y: LAYOUT.PAD_Y, w: LAYOUT.TABLE_W - LAYOUT.PAD_X * 2, node: root });
    tables.set(root.id, { x: 0, y: 0, w: LAYOUT.TABLE_W, h: LAYOUT.ROW_H + LAYOUT.PAD_Y * 2, node: root });
  }

  let maxX = 0;
  let maxY = 0;
  for (const t of tables.values()) {
    maxX = Math.max(maxX, t.x + t.w);
    maxY = Math.max(maxY, t.y + t.h);
  }
  // 每个非根表格对应一条连线：行（=表格自身节点）右缘 → 子表格左缘
  const edges = [];
  for (const [path, t] of tables) {
    if (t.node.parent) edges.push(path);
  }
  return { rows, tables, visible, edges, bounds: { width: Math.max(maxX, 1), height: Math.max(maxY, 1) } };
}
