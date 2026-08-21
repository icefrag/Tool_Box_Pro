// AST → 树节点模型（纯函数，无 DOM / chrome API 依赖）
// TreeNode：{ id(path), label, type, valueText, searchText, childCount, children|null,
//             transparent?, start, end, keyStart?, keyEnd?, parent }
// transparent：仅数组可能为 true——元素全部为非空复合节点时，渲染层跳过数组中转表格，
//              元素表格直接挂到数组行（标量/混合/空元素数组与根数组不透明）
import { childPath, itemPath } from './json-parser.js';

const VALUE_TEXT_MAX = 30;

function summarize(value) {
  const text = typeof value === 'string' ? JSON.stringify(value) : String(value);
  return text.length > VALUE_TEXT_MAX ? text.slice(0, VALUE_TEXT_MAX - 1) + '…' : text;
}

function fromValueNode(astNode, label, path, keyRange, parent) {
  const node = {
    id: path,
    label,
    type: astNode.type,
    valueText: '',
    searchText: '',
    childCount: 0,
    children: null,
    start: astNode.start,
    end: astNode.end,
    keyStart: keyRange ? keyRange.start : undefined,
    keyEnd: keyRange ? keyRange.end : undefined,
    parent,
  };
  if (astNode.type === 'object') {
    node.children = astNode.properties.map((p) =>
      fromValueNode(p.value, p.key, childPath(path, p.key), { start: p.keyStart, end: p.keyEnd }, node)
    );
    node.childCount = node.children.length;
  } else if (astNode.type === 'array') {
    node.children = astNode.items.map((item, i) => fromValueNode(item, `[${i}]`, itemPath(path, i), null, node));
    node.childCount = node.children.length;
    node.transparent = node.children.length > 0
      && node.children.every((c) => c.children !== null && c.children.length > 0);
  } else {
    node.valueText = summarize(astNode.value);
    // searchText：未截断全文，供搜索匹配（valueText 仅用于显示，可能截断）
    node.searchText = typeof astNode.value === 'string' ? JSON.stringify(astNode.value) : String(astNode.value);
  }
  return node;
}

export function buildTree(ast) {
  return fromValueNode(ast, '$', '$', null, null);
}

// 返回最深包含 offset 的节点（值区间或 key 区间命中均可）
export function findNodeAt(root, offset) {
  const inValue = root.start <= offset && offset <= root.end;
  const inKey = root.keyStart !== undefined && root.keyStart <= offset && offset <= root.keyEnd;
  if (!inValue && !inKey) return null;
  if (root.children) {
    for (const child of root.children) {
      const hit = findNodeAt(child, offset);
      if (hit) return hit;
    }
  }
  return root;
}

export function findNodeById(root, id) {
  if (root.id === id) return root;
  if (root.children) {
    for (const child of root.children) {
      const hit = findNodeById(child, id);
      if (hit) return hit;
    }
  }
  return null;
}
