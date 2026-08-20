// 搜索匹配（纯函数，无 DOM / chrome API 依赖）
// 匹配 TreeNode 的 key（label）与标量值（valueText），不区分大小写包含匹配
// 返回 [{ path, isKey, start, end }]（start/end 为源码区间，供编辑器 markText）
export function findMatches(root, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q || !root) return [];
  const out = [];
  (function walk(node) {
    if (node.keyStart !== undefined && node.label.toLowerCase().includes(q)) {
      out.push({ path: node.id, isKey: true, start: node.keyStart, end: node.keyEnd });
    }
    if (node.children === null && node.valueText.toLowerCase().includes(q)) {
      out.push({ path: node.id, isKey: false, start: node.start, end: node.end });
    }
    if (node.children) node.children.forEach(walk);
  })(root);
  return out;
}
