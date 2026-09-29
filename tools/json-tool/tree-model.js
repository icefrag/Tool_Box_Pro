// AST → 树节点模型（纯函数，无 DOM / chrome API 依赖）
// TreeNode：{ id(path), label, type, valueText, searchText, childCount, children|null,
//             grid?, transparent?, start, end, keyStart?, keyEnd?, parent }
// grid：仅数组可能有——元素全部为非空对象时 grid = { cols, kinds, units }：
//   cols   字段并集（首次出现顺序）
//   kinds  每列 badge（整列复合值，渲染为徽标窄列）| scalar（含标量，宽列）
//   units  每列最长内容单位数（含表头 +2 余量；汉字/全角记 2，布局层换算像素）
// transparent：仅数组可能为 true——元素全部为非空复合但含非对象（如嵌套数组）时，
//              渲染层跳过数组中转表格，元素表格直接挂到数组行（与 grid 互斥）
import { childPath, itemPath } from './json-parser.js';

const VALUE_TEXT_MAX = 30;

// CJK / 全角字符（按 2 单位视觉宽度计，与 tree-graph.ellipsize 的宽度逻辑同源）
const WIDE_CHAR_RE = /[\u2E80-\u9FFF\uF900-\uFAFF\u3000-\u303F\uFF00-\uFFEF]/;

function charUnits(text) {
  const s = String(text ?? '');
  let units = 0;
  for (const ch of s) units += WIDE_CHAR_RE.test(ch) ? 2 : 1;
  return units;
}

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
    const allCompound = node.children.length > 0
      && node.children.every((c) => c.children !== null && c.children.length > 0);
    if (allCompound && node.children.every((c) => c.type === 'object')) {
      const cols = [];
      const kinds = [];
      const units = [];
      const seen = new Set();
      const ensureCol = (label) => {
        if (seen.has(label)) return cols.indexOf(label);
        seen.add(label);
        cols.push(label);
        kinds.push('badge');          // 先按徽标列假设，遇标量改 scalar
        units.push(charUnits(label) + 2);
        return cols.length - 1;
      };
      for (const elem of node.children) {
        for (const p of elem.children) {
          const ci = ensureCol(p.label);
          if (p.children === null) {
            kinds[ci] = 'scalar';
            units[ci] = Math.max(units[ci], charUnits(p.valueText));
          }
        }
      }
      node.grid = { cols, kinds, units };
    } else {
      node.transparent = allCompound;
    }
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

// 默认折叠集：单层子节点超过 autoThreshold 的节点整层收起；
// 网格行数超过 gridRows 时，属性 ≥ cellThreshold 的复合单元格默认收起
// （小对象直接展开出子表与连线），孙网格递归适用；用户手动展开由调用方的 userExpanded 抵消
export function computeDefaultCollapsed(root, { autoThreshold = 50, gridRows = 6, cellThreshold = 3 } = {}) {
  const collapsed = new Set();
  (function walk(node) {
    if (node.children && node.children.length > autoThreshold) collapsed.add(node.id);
    if (node.grid && node.children.length > gridRows) {
      for (const elem of node.children) {
        for (const p of elem.children) {
          if (p.children && p.children.length >= cellThreshold) collapsed.add(p.id);
        }
      }
    }
    if (node.children) node.children.forEach(walk);
  })(root);
  return collapsed;
}
