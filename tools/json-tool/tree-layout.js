// 横向整洁树布局（纯函数，无 DOM / chrome API 依赖）
// x = 深度 * 列间距；叶子自上而下占一行，父节点垂直居中于子树
export const LAYOUT = { CARD_W: 170, CARD_H: 36, COL_GAP: 60, ROW_GAP: 14 };
const COL_PITCH = LAYOUT.CARD_W + LAYOUT.COL_GAP;

export function layoutTree(root, collapsed = new Set()) {
  const positions = new Map();
  const visible = new Set();

  function place(node, depth, top) {
    visible.add(node.id);
    const isLeaf = !node.children || collapsed.has(node.id) || node.children.length === 0;
    if (isLeaf) {
      positions.set(node.id, { x: depth * COL_PITCH, y: top });
      return LAYOUT.CARD_H;
    }
    let childTop = top;
    let total = 0;
    for (const child of node.children) {
      const h = place(child, depth + 1, childTop);
      childTop += h + LAYOUT.ROW_GAP;
      total += h + LAYOUT.ROW_GAP;
    }
    total -= LAYOUT.ROW_GAP;
    positions.set(node.id, { x: depth * COL_PITCH, y: top + (total - LAYOUT.CARD_H) / 2 });
    return total;
  }

  place(root, 0, 0);

  let maxX = 0;
  let maxY = 0;
  for (const p of positions.values()) {
    maxX = Math.max(maxX, p.x + LAYOUT.CARD_W);
    maxY = Math.max(maxY, p.y + LAYOUT.CARD_H);
  }
  return { positions, visible, bounds: { width: Math.max(maxX, 1), height: Math.max(maxY, 1) } };
}
