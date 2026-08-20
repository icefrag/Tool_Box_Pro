# JSON 树图工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use nbl.subagent-driven-development (recommended) or nbl.executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 ToolBox Pro 新增 JSON 树图工具：全屏标签页中左右分栏（CodeMirror 编辑器 + 手写 SVG 横向树图），支持格式化/压缩/校验、搜索高亮、编辑器↔树图双向联动。

**Architecture:** JsonTool 继承 BaseTool 作为 popup 启动卡片，execute() 用 chrome.tabs.create 打开 `tools/json-tool/index.html` 全屏页（已打开则复用标签页）。全屏页是独立 ES6 模块入口：手写带位置信息的 JSON 解析器 → 树模型（path/源码区间/父引用）→ 整洁树布局（纯函数）→ SVG 渲染（缩放/拖拽/折叠）。manifest.json 零改动。

**Tech Stack:** Chrome Extension Manifest V3、原生 ES6 Modules（无构建）、CodeMirror 5.65.16（vendored 到 lib/）、Node 原生 ES 模块 + node:assert/strict 做纯函数测试。

**Spec:** `docs/superpowers/specs/2026-08-20-json-tree-tool-design.md`

## Global Constraints

- 纯静态 ES6 模块，无构建步骤；禁止引入 npm 依赖、打包器、CDN 引用
- 扩展页 CSP `script-src 'self'`：第三方库必须下载到 `lib/` 本地引用；禁止内联 `<script>` 代码块
- 纯函数模块（json-parser / tree-model / tree-layout / search）禁止访问 DOM 或 chrome API
- UI 文案全部中文；提交消息遵循约定式提交（feat / fix / docs / test / chore）
- 纯函数测试统一入口：`node tools/json-tool/tests/run-tests.js`，零第三方依赖，全部通过输出 `ALL PASS`
- DOM 模块语法检查用 `node --check <file>`（项目根 package.json 有 `"type": "module"` 后该命令按 ESM 解析）
- 手动验证流程：`chrome://extensions` → 本扩展「重新加载」→ 打开工具页；改代码后扩展需重新加载，已打开的工具页按 F5
- 编辑器缩进 2 空格；主题主色渐变 `#667eea → #764ba2`；类型色：object 紫 `#764ba2` / array 蓝 `#2f80ed` / string 绿 `#27ae60` / number 橙 `#e67e22` / boolean 青 `#17a2b8` / null 灰 `#828282`
- 嵌套深度上限 500；单层子节点 > 50 默认折叠；折叠状态按节点 path 在重渲染间保留

---

### Task 1: Vendor CodeMirror 5 到 lib/

**状态**
- [x] 任务完成

**Dependencies:** None
**Parallelizable:** Yes

**Files:**
- Create: `lib/codemirror/codemirror.min.js`
- Create: `lib/codemirror/codemirror.css`
- Create: `lib/codemirror/mode/javascript/javascript.min.js`
- Create: `lib/codemirror/addon/edit/matchbrackets.min.js`

- [ ] **Step 1: 创建目录并下载 4 个文件**

```bash
cd /d/workspace-script/Tool_Box_Pro
mkdir -p lib/codemirror/mode/javascript lib/codemirror/addon/edit
curl -sL -o lib/codemirror/codemirror.min.js https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.js
curl -sL -o lib/codemirror/codemirror.css https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.css
curl -sL -o lib/codemirror/mode/javascript/javascript.min.js https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/javascript/javascript.min.js
curl -sL -o lib/codemirror/addon/edit/matchbrackets.min.js https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/edit/matchbrackets.min.js
```

- [ ] **Step 2: 验证文件完整性**

Run: `ls -la lib/codemirror/ lib/codemirror/mode/javascript/ lib/codemirror/addon/edit/ && head -c 80 lib/codemirror/codemirror.min.js`
Expected: 4 个文件均存在且非空（codemirror.min.js 约 160KB、css 约 8KB、javascript.min.js 约 26KB、matchbrackets.min.js 约 3KB），首个文件开头是 JS 压缩代码而非 404/HTML 错误页。

- [ ] **Step 3: Commit**

```bash
git add lib/codemirror/
git commit -m "chore: vendor CodeMirror 5.65.16 for JSON tree tool"
```

---

### Task 2: package.json + 带位置信息的 JSON 解析器（TDD）

**状态**
- [x] 任务完成

**Dependencies:** None
**Parallelizable:** Yes

**Files:**
- Create: `package.json`
- Create: `tools/json-tool/tests/run-tests.js`
- Create: `tools/json-tool/tests/test-json-parser.js`
- Create: `tools/json-tool/json-parser.js`

- [ ] **Step 1: 创建 package.json（Node 按 ESM 解析项目内 .js）**

```json
{
  "type": "module",
  "private": true
}
```

说明：Chrome 完全忽略此文件，仅供 Node 测试使用，不引入任何依赖。

- [ ] **Step 2: 创建测试入口 run-tests.js（自动发现 test-*.js）**

```javascript
// 纯函数模块测试入口：node tools/json-tool/tests/run-tests.js
import { readdirSync } from 'node:fs';

const dir = new URL('.', import.meta.url);
const files = readdirSync(dir).filter((f) => f.startsWith('test-') && f.endsWith('.js')).sort();

let failed = 0;
for (const f of files) {
  try {
    await import(new URL(f, dir).href);
    console.log(`PASS ${f}`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${f}\n${e && e.stack || e}`);
  }
}
console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
if (failed) process.exit(1);
```

- [ ] **Step 3: 写失败测试 test-json-parser.js**

```javascript
import assert from 'node:assert/strict';
import { parseJson, childPath, itemPath } from '../json-parser.js';

// 基础解析 + 区间
{
  const text = '{"a": 1}';
  const r = parseJson(text);
  assert.equal(r.ok, true);
  assert.equal(r.ast.type, 'object');
  const prop = r.ast.properties[0];
  assert.equal(prop.key, 'a');
  assert.equal(prop.value.type, 'number');
  assert.equal(prop.value.value, 1);
  assert.equal(text.slice(prop.value.start, prop.value.end), '1');
  assert.equal(text.slice(prop.keyStart, prop.keyEnd), '"a"');
}

// 嵌套区间
{
  const text = '{"a": {"b": [1, "x"]}}';
  const r = parseJson(text);
  const inner = r.ast.properties[0].value.properties[0].value.items[1];
  assert.equal(text.slice(inner.start, inner.end), '"x"');
  assert.equal(inner.value, 'x');
}

// 字符串转义
{
  const r = parseJson('{"k": "a\\"b\\u0041"}');
  assert.equal(r.ast.properties[0].value.value, 'a"bA');
}

// 顶层标量
{
  const r = parseJson('42');
  assert.equal(r.ok, true);
  assert.equal(r.ast.value, 42);
}

// 错误：行列号
{
  const r = parseJson('{abc}');
  assert.equal(r.ok, false);
  assert.equal(r.error.line, 1);
  assert.equal(r.error.column, 2);
}

// 错误：跨行定位
{
  const r = parseJson('{\n  "a": ,\n}');
  assert.equal(r.ok, false);
  assert.equal(r.error.line, 2);
}

// 尾随垃圾 / 空输入
{
  assert.equal(parseJson('{} x').ok, false);
  assert.equal(parseJson('').ok, false);
  assert.equal(parseJson('   ').ok, false);
}

// 深度限制：500 层通过，501 层报错
{
  assert.equal(parseJson('['.repeat(500) + ']'.repeat(500)).ok, true);
  const r = parseJson('['.repeat(501) + ']'.repeat(501));
  assert.equal(r.ok, false);
  assert.match(r.error.message, /500/);
}

// 数字格式
{
  assert.equal(parseJson('{"n": -1.5e3}').ast.properties[0].value.value, -1500);
  assert.equal(parseJson('01').ok, false);
  assert.equal(parseJson('1.').ok, false);
}

// path 构造工具
{
  assert.equal(childPath('$', 'a'), '$.a');
  assert.equal(childPath('$', 'a b'), '$["a b"]');
  assert.equal(itemPath('$.a', 0), '$.a[0]');
}
```

- [ ] **Step 4: 运行测试确认失败**

Run: `node tools/json-tool/tests/run-tests.js`
Expected: FAIL test-json-parser.js，错误为 `Cannot find module .../json-parser.js`

- [ ] **Step 5: 实现 json-parser.js**

```javascript
// 带位置信息的 JSON 解析器（纯函数，无 DOM / chrome API 依赖）
// 返回 { ok: true, ast } 或 { ok: false, error: { message, offset, line, column } }
// AST 节点：
//   { type: 'object',  start, end, properties: [{ key, keyStart, keyEnd, value }] }
//   { type: 'array',   start, end, items: [ValueNode] }
//   { type: 'string'|'number'|'boolean'|'null', start, end, value }
const MAX_DEPTH = 500;
const NUM_RE = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const IDENT_KEY_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function parseJson(text) {
  let pos = 0;
  let depth = 0;

  function error(message, offset = pos) {
    let line = 1;
    let column = 1;
    for (let i = 0; i < offset; i++) {
      if (text.charCodeAt(i) === 10) { line++; column = 1; } else { column++; }
    }
    return { message, offset, line, column };
  }

  function skipWs() {
    while (pos < text.length) {
      const c = text[pos];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') pos++;
      else break;
    }
  }

  function parseValue() {
    skipWs();
    if (pos >= text.length) throw error('意外的输入结束，期望 JSON 值');
    const c = text[pos];
    if (c === '{') return parseObject();
    if (c === '[') return parseArray();
    if (c === '"') return parseString();
    if (c === '-' || (c >= '0' && c <= '9')) return parseNumber();
    if (text.startsWith('true', pos)) {
      const node = { type: 'boolean', start: pos, end: pos + 4, value: true };
      pos += 4;
      return node;
    }
    if (text.startsWith('false', pos)) {
      const node = { type: 'boolean', start: pos, end: pos + 5, value: false };
      pos += 5;
      return node;
    }
    if (text.startsWith('null', pos)) {
      const node = { type: 'null', start: pos, end: pos + 4, value: null };
      pos += 4;
      return node;
    }
    throw error(`意外的字符 '${c}'，期望 JSON 值`);
  }

  function parseObject() {
    const start = pos;
    pos++; // {
    depth++;
    if (depth > MAX_DEPTH) throw error(`嵌套层级超过 ${MAX_DEPTH} 层`);
    const properties = [];
    skipWs();
    if (text[pos] === '}') {
      depth--;
      pos++;
      return { type: 'object', start, end: pos, properties };
    }
    while (true) {
      skipWs();
      if (text[pos] !== '"') throw error(`意外的字符 '${text[pos] ?? ''}'，期望属性名 '"'`);
      const keyNode = parseString();
      skipWs();
      if (text[pos] !== ':') throw error(`意外的字符 '${text[pos] ?? ''}'，期望 ':'`);
      pos++;
      const value = parseValue();
      properties.push({ key: keyNode.value, keyStart: keyNode.start, keyEnd: keyNode.end, value });
      skipWs();
      if (text[pos] === ',') { pos++; continue; }
      if (text[pos] === '}') { pos++; break; }
      throw error(`意外的字符 '${text[pos] ?? ''}'，期望 ',' 或 '}'`);
    }
    depth--;
    return { type: 'object', start, end: pos, properties };
  }

  function parseArray() {
    const start = pos;
    pos++; // [
    depth++;
    if (depth > MAX_DEPTH) throw error(`嵌套层级超过 ${MAX_DEPTH} 层`);
    const items = [];
    skipWs();
    if (text[pos] === ']') {
      depth--;
      pos++;
      return { type: 'array', start, end: pos, items };
    }
    while (true) {
      items.push(parseValue());
      skipWs();
      if (text[pos] === ',') { pos++; continue; }
      if (text[pos] === ']') { pos++; break; }
      throw error(`意外的字符 '${text[pos] ?? ''}'，期望 ',' 或 ']'`);
    }
    depth--;
    return { type: 'array', start, end: pos, items };
  }

  function parseString() {
    const start = pos;
    pos++; // "
    while (pos < text.length) {
      const c = text[pos];
      if (c === '\\') { pos += 2; continue; }
      if (c === '"') {
        pos++;
        const token = text.slice(start, pos);
        try {
          return { type: 'string', start, end: pos, value: JSON.parse(token) };
        } catch {
          throw error('非法的字符串转义', start);
        }
      }
      pos++;
    }
    throw error('字符串未闭合', start);
  }

  function parseNumber() {
    NUM_RE.lastIndex = pos;
    const m = NUM_RE.exec(text);
    if (!m) throw error(`非法的数字，始于 '${text.slice(pos, pos + 12)}'`);
    const token = m[0];
    pos += token.length;
    return { type: 'number', start: pos - token.length, end: pos, value: Number(token) };
  }

  try {
    if (typeof text !== 'string') throw error('输入必须是字符串');
    const ast = parseValue();
    skipWs();
    if (pos < text.length) throw error(`多余的输入，始于 '${text.slice(pos, pos + 12)}'`);
    return { ok: true, ast };
  } catch (e) {
    if (e && e.offset !== undefined) return { ok: false, error: e };
    return { ok: false, error: error((e && e.message) || '解析失败') };
  }
}

// path 段构造：标识符安全的 key 用 .key，否则用 ["key"]
export function childPath(parentPath, key) {
  return IDENT_KEY_RE.test(key) ? `${parentPath}.${key}` : `${parentPath}[${JSON.stringify(key)}]`;
}

export function itemPath(parentPath, index) {
  return `${parentPath}[${index}]`;
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `node tools/json-tool/tests/run-tests.js`
Expected: `PASS test-json-parser.js` + `ALL PASS`

- [ ] **Step 7: Commit**

```bash
git add package.json tools/json-tool/json-parser.js tools/json-tool/tests/
git commit -m "feat(json-tool): add position-aware JSON parser with node tests"
```

---

### Task 3: 树模型 tree-model.js（TDD）

**状态**
- [x] 任务完成

**Dependencies:** Task 2
**Parallelizable:** Yes

**Files:**
- Create: `tools/json-tool/tests/test-tree-model.js`
- Create: `tools/json-tool/tree-model.js`

- [ ] **Step 1: 写失败测试 test-tree-model.js**

```javascript
import assert from 'node:assert/strict';
import { parseJson } from '../json-parser.js';
import { buildTree, findNodeAt, findNodeById } from '../tree-model.js';

const tree = buildTree(parseJson('{"a": 1, "b": {"c": [true, null]}}').ast);

// 结构与 path
assert.equal(tree.id, '$');
assert.equal(tree.type, 'object');
const b = tree.children[1];
assert.equal(b.id, '$.b');
assert.equal(b.childCount, 1);
const arr = b.children[0];
assert.equal(arr.id, '$.b.c');
assert.equal(arr.children[1].id, '$.b.c[1]');
assert.equal(arr.children[1].type, 'null');

// 标量 valueText
assert.equal(tree.children[0].valueText, '1');

// 长字符串截断（≤30 字符，带省略号）
{
  const t = buildTree(parseJson('{"s": "0123456789012345678901234567890123456789"}').ast);
  assert.ok(t.children[0].valueText.endsWith('…'));
  assert.ok(t.children[0].valueText.length <= 30);
}

// 特殊字符 key 用引号形式
{
  const t = buildTree(parseJson('{"a b": 1}').ast);
  assert.equal(t.children[0].id, '$["a b"]');
}

// findNodeAt：最深包含 offset 的节点
{
  const text = '{"a": {"b": 1}, "c": 2}';
  const t = buildTree(parseJson(text).ast);
  assert.equal(findNodeAt(t, text.indexOf('1')).id, '$.a.b');
  assert.equal(findNodeAt(t, text.indexOf('2')).id, '$.c');
  assert.equal(findNodeAt(t, 0).id, '$');
  assert.equal(findNodeAt(t, text.length + 5), null);
}

// findNodeById + parent 引用链
{
  const n = findNodeById(tree, '$.b.c[0]');
  assert.equal(n.type, 'boolean');
  assert.equal(n.parent.id, '$.b.c');
  assert.equal(n.parent.parent.id, '$.b');
  assert.equal(n.parent.parent.parent.id, '$');
  assert.equal(n.parent.parent.parent.parent, null);
  assert.equal(findNodeById(tree, '$.not-exist'), null);
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tools/json-tool/tests/run-tests.js`
Expected: FAIL test-tree-model.js，错误为 `Cannot find module .../tree-model.js`（test-json-parser.js 仍 PASS）

- [ ] **Step 3: 实现 tree-model.js**

```javascript
// AST → 树节点模型（纯函数，无 DOM / chrome API 依赖）
// TreeNode：{ id(path), label, type, valueText, childCount, children|null,
//             start, end, keyStart?, keyEnd?, parent }
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
  } else {
    node.valueText = summarize(astNode.value);
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node tools/json-tool/tests/run-tests.js`
Expected: `PASS test-json-parser.js`、`PASS test-tree-model.js` + `ALL PASS`

- [ ] **Step 5: Commit**

```bash
git add tools/json-tool/tree-model.js tools/json-tool/tests/test-tree-model.js
git commit -m "feat(json-tool): add tree model with path, ranges and parent links"
```

---

### Task 4: 树布局 tree-layout.js（TDD）

**状态**
- [x] 任务完成

**Dependencies:** Task 3
**Parallelizable:** Yes

**Files:**
- Create: `tools/json-tool/tests/test-tree-layout.js`
- Create: `tools/json-tool/tree-layout.js`

- [ ] **Step 1: 写失败测试 test-tree-layout.js**

```javascript
import assert from 'node:assert/strict';
import { parseJson } from '../json-parser.js';
import { buildTree } from '../tree-model.js';
import { layoutTree, LAYOUT } from '../tree-layout.js';

const T = (json) => buildTree(parseJson(json).ast);
const COL_PITCH = LAYOUT.CARD_W + LAYOUT.COL_GAP;

// 单叶：根在原点
{
  const { positions, visible, bounds } = layoutTree(T('42'));
  assert.deepEqual(positions.get('$'), { x: 0, y: 0 });
  assert.equal(visible.size, 1);
  assert.equal(bounds.width, LAYOUT.CARD_W);
  assert.equal(bounds.height, LAYOUT.CARD_H);
}

// 两叶 + 根垂直居中于两叶之间
{
  const { positions, bounds } = layoutTree(T('{"a": 1, "b": 2}'));
  const a = positions.get('$.a');
  const b = positions.get('$.b');
  const root = positions.get('$');
  assert.equal(a.x, COL_PITCH);
  assert.equal(b.x, COL_PITCH);
  assert.equal(b.y, a.y + LAYOUT.CARD_H + LAYOUT.ROW_GAP);
  assert.equal(root.y, (a.y + b.y) / 2);
  assert.equal(bounds.width, COL_PITCH + LAYOUT.CARD_W);
}

// 折叠节点视为叶：后代不进 visible
{
  const { positions, visible } = layoutTree(T('{"a": {"x": 1, "y": 2}}'), new Set(['$.a']));
  assert.equal(visible.has('$.a.x'), false);
  assert.equal(visible.size, 2);
  assert.ok(positions.has('$.a'));
}

// 空对象/空数组是叶
{
  const { visible } = layoutTree(T('{"e": {}, "arr": []}'));
  assert.equal(visible.size, 3);
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tools/json-tool/tests/run-tests.js`
Expected: FAIL test-tree-layout.js（`Cannot find module .../tree-layout.js`），前两个测试文件仍 PASS

- [ ] **Step 3: 实现 tree-layout.js**

```javascript
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node tools/json-tool/tests/run-tests.js`
Expected: 三个测试文件全 PASS + `ALL PASS`

- [ ] **Step 5: Commit**

```bash
git add tools/json-tool/tree-layout.js tools/json-tool/tests/test-tree-layout.js
git commit -m "feat(json-tool): add horizontal tidy tree layout"
```

---

### Task 5: 搜索 search.js（TDD）

**状态**
- [x] 任务完成

**Dependencies:** Task 3
**Parallelizable:** Yes

**Files:**
- Create: `tools/json-tool/tests/test-search.js`
- Create: `tools/json-tool/search.js`

- [ ] **Step 1: 写失败测试 test-search.js**

```javascript
import assert from 'node:assert/strict';
import { parseJson } from '../json-parser.js';
import { buildTree } from '../tree-model.js';
import { findMatches } from '../search.js';

const json = '{"apple": 1, "banana": "apple", "cat": {"dog": 2}}';
const tree = buildTree(parseJson(json).ast);

// key 与标量值都参与匹配，大小写不敏感
{
  const matches = findMatches(tree, 'APP');
  assert.equal(matches.length, 2);
  assert.ok(matches.some((m) => m.path === '$.apple' && m.isKey));
  const valueMatch = matches.find((m) => !m.isKey);
  assert.equal(valueMatch.path, '$.banana');
  assert.equal(json.slice(valueMatch.start, valueMatch.end), '"apple"');
}

// 数字值匹配
{
  const matches = findMatches(tree, '2');
  assert.ok(matches.some((m) => m.path === '$.cat.dog' && !m.isKey));
}

// 空查询 / 空树
assert.deepEqual(findMatches(tree, '   '), []);
assert.deepEqual(findMatches(null, 'app'), []);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tools/json-tool/tests/run-tests.js`
Expected: FAIL test-search.js（`Cannot find module .../search.js`），其余测试文件仍 PASS

- [ ] **Step 3: 实现 search.js**

```javascript
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node tools/json-tool/tests/run-tests.js`
Expected: 四个测试文件全 PASS + `ALL PASS`

- [ ] **Step 5: Commit**

```bash
git add tools/json-tool/search.js tools/json-tool/tests/test-search.js
git commit -m "feat(json-tool): add search matching over keys and scalar values"
```

---

### Task 6: 全屏页骨架 index.html + tool.css

**状态**
- [x] 任务完成

**Dependencies:** Task 1
**Parallelizable:** Yes

**Files:**
- Create: `tools/json-tool/index.html`
- Create: `tools/json-tool/tool.css`

- [ ] **Step 1: 创建 index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>JSON 树图工具 - ToolBox Pro</title>
  <link rel="stylesheet" href="../../lib/codemirror/codemirror.css">
  <link rel="stylesheet" href="tool.css">
</head>
<body>
  <header class="jt-toolbar">
    <span class="jt-brand">🌳 JSON 树图工具</span>
    <div class="jt-actions">
      <button id="btn-sample" title="载入示例数据">示例</button>
      <button id="btn-clear" title="清空编辑器">清空</button>
      <button id="btn-format" title="2 空格缩进格式化">格式化</button>
      <button id="btn-minify" title="压缩为一行">压缩</button>
      <button id="btn-copy" title="复制全部内容">复制</button>
    </div>
    <div class="jt-search">
      <input id="search-input" type="text" placeholder="搜索 key / 值，Enter 跳转">
      <span id="search-count"></span>
    </div>
    <span id="validation-status" class="jt-status"></span>
  </header>

  <div class="jt-main">
    <div id="editor-pane"></div>
    <div id="graph-pane">
      <svg id="graph-svg"></svg>
      <div id="graph-empty" class="jt-empty hidden">输入 JSON 后此处显示树图</div>
      <div class="jt-graph-controls">
        <button id="zoom-in" title="放大">＋</button>
        <button id="zoom-out" title="缩小">－</button>
        <button id="zoom-fit" title="适应画布">⤢</button>
        <button id="zoom-reset" title="重置视图">↺</button>
      </div>
    </div>
  </div>

  <div id="error-bar" class="jt-error-bar hidden"></div>

  <script src="../../lib/codemirror/codemirror.min.js"></script>
  <script src="../../lib/codemirror/mode/javascript/javascript.min.js"></script>
  <script src="../../lib/codemirror/addon/edit/matchbrackets.min.js"></script>
  <script type="module" src="main.js"></script>
</body>
</html>
```

注意：`main.js` 此时还不存在（Task 9 创建），模块 404 会被浏览器静默忽略，不影响本任务验证骨架。

- [ ] **Step 2: 创建 tool.css**

```css
/* JSON 树图工具全屏页样式 */
* { box-sizing: border-box; margin: 0; padding: 0; }

html, body { height: 100%; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  display: flex;
  flex-direction: column;
  background: #f5f5f5;
  color: #333;
  overflow: hidden;
}

/* ── 工具栏 ─────────────────────────── */
.jt-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  flex-wrap: wrap;
}

.jt-brand { font-size: 15px; font-weight: 600; margin-right: 8px; }

.jt-actions { display: flex; gap: 8px; }

.jt-actions button {
  padding: 5px 12px;
  border: 1px solid rgba(255, 255, 255, 0.6);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}

.jt-actions button:hover { background: rgba(255, 255, 255, 0.3); }

.jt-search { display: flex; align-items: center; gap: 6px; margin-left: auto; }

.jt-search input {
  width: 220px;
  padding: 5px 10px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  background: #fff;
}

#search-count { font-size: 12px; opacity: 0.9; min-width: 48px; }

.jt-status { font-size: 12px; padding: 4px 10px; border-radius: 10px; }
.jt-status.ok { background: rgba(46, 204, 113, 0.25); color: #eafff3; }
.jt-status.error { background: rgba(231, 76, 60, 0.35); }

/* ── 主区域 ─────────────────────────── */
.jt-main { flex: 1; display: flex; min-height: 0; }

#editor-pane { flex: 1; min-width: 0; border-right: 1px solid #e0e0e0; }
#editor-pane .CodeMirror { height: 100%; font-size: 13px; }

#graph-pane { flex: 1; position: relative; background: #fafbfc; overflow: hidden; }

#graph-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  cursor: grab;
}

#graph-svg:active { cursor: grabbing; }

.jt-graph-controls {
  position: absolute;
  right: 14px;
  bottom: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.jt-graph-controls button {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: 1px solid #ddd;
  background: #fff;
  font-size: 15px;
  cursor: pointer;
  color: #555;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

.jt-graph-controls button:hover { background: #f0f0f5; }

.jt-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #aaa;
  font-size: 14px;
  pointer-events: none;
}

.jt-empty.hidden { display: none; }

/* ── 错误条 ─────────────────────────── */
.jt-error-bar {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: #e74c3c;
  color: #fff;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  z-index: 10;
  max-width: 80vw;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.jt-error-bar.hidden { display: none; }

/* ── 树图节点 ───────────────────────── */
.tg-edge { fill: none; stroke: #c5cbe0; stroke-width: 1.5; }

.tg-node { cursor: pointer; }
.tg-node:hover .tg-card { stroke-width: 2.5; }

.tg-label { font-size: 12px; fill: #333; font-weight: 600; }
.tg-value { font-size: 11px; fill: #888; font-family: Consolas, Menlo, monospace; }
.tg-toggle-sign { font-size: 9px; font-weight: 700; pointer-events: none; }

.tg-node.matched .tg-card { stroke: #f39c12; stroke-width: 2.5; }
.tg-node.current .tg-card { stroke: #e67e22; stroke-width: 3.5; }
.tg-node.dim { opacity: 0.22; }
.tg-node.focused .tg-card { stroke: #667eea; stroke-width: 3; }

/* ── 编辑器联动 / 搜索高亮 ──────────── */
.CodeMirror { font-family: Consolas, Menlo, monospace; }
.cm-sync-highlight { background: #fff3c4; }
.cm-search-match { background: #ffe082; }
```

- [ ] **Step 3: 手动验证骨架**

1. `chrome://extensions` → ToolBox Pro → 「重新加载」
2. 从扩展卡片复制 ID，访问 `chrome-extension://<ID>/tools/json-tool/index.html`
3. 预期：紫色渐变工具栏（5 个按钮 + 搜索框 + 状态位）、下方左右双栏（左侧空白、右侧浅色画布区 + 右下角 4 个缩放按钮）；控制台有 main.js 404 告警属预期

- [ ] **Step 4: Commit**

```bash
git add tools/json-tool/index.html tools/json-tool/tool.css
git commit -m "feat(json-tool): add fullscreen page skeleton with toolbar and split panes"
```

---

### Task 7: 编辑器封装 editor.js

**状态**
- [x] 任务完成

**Dependencies:** Task 1, Task 6
**Parallelizable:** Yes

**Files:**
- Create: `tools/json-tool/editor.js`

- [ ] **Step 1: 实现 editor.js**

CodeMirror 已由 index.html 以经典 `<script>` 加载，此处直接使用全局 `CodeMirror`。

```javascript
// CodeMirror 封装：语法高亮、格式化/压缩、复制、区间选中高亮、匹配标记
export class JsonEditor {
  constructor(container, { onChange, onCursor } = {}) {
    this.cm = CodeMirror(container, {
      value: '',
      mode: 'application/json',
      lineNumbers: true,
      matchBrackets: true,
      tabSize: 2,
      indentUnit: 2,
    });
    this.changeTimer = null;
    this.cursorTimer = null;
    this.marks = [];
    this.syncMark = null;

    this.cm.on('change', () => {
      clearTimeout(this.changeTimer);
      this.changeTimer = setTimeout(() => onChange && onChange(), 300);
    });
    this.cm.on('cursorActivity', () => {
      clearTimeout(this.cursorTimer);
      this.cursorTimer = setTimeout(() => {
        if (onCursor) onCursor(this.cm.indexFromPos(this.cm.getCursor('head')));
      }, 200);
    });
  }

  getValue() { return this.cm.getValue(); }

  setValue(text) { this.cm.setValue(text); }

  format() {
    this.cm.setValue(JSON.stringify(JSON.parse(this.cm.getValue()), null, 2));
  }

  minify() {
    this.cm.setValue(JSON.stringify(JSON.parse(this.cm.getValue())));
  }

  async copy() {
    const text = this.cm.getValue();
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  // 联动：滚动到区间并高亮背景（树图 → 编辑器）
  selectRange(start, end) {
    const from = this.cm.posFromIndex(start);
    const to = this.cm.posFromIndex(end);
    this.clearSyncMark();
    this.syncMark = this.cm.markText(from, to, { className: 'cm-sync-highlight' });
    this.cm.setCursor(to);
    this.cm.scrollIntoView({ from, to }, 60);
  }

  gotoOffset(offset) {
    this.cm.setCursor(this.cm.posFromIndex(offset));
    this.cm.scrollIntoView(null, 40);
  }

  // 搜索命中标记（编辑器侧）
  markRanges(ranges) {
    this.clearMarks();
    this.marks = ranges.map((r) =>
      this.cm.markText(this.cm.posFromIndex(r.start), this.cm.posFromIndex(r.end), { className: 'cm-search-match' })
    );
  }

  clearMarks() {
    this.marks.forEach((m) => m.clear());
    this.marks = [];
  }

  clearSyncMark() {
    if (this.syncMark) {
      this.syncMark.clear();
      this.syncMark = null;
    }
  }
}
```

- [ ] **Step 2: 语法检查**

Run: `node --check tools/json-tool/editor.js`
Expected: 无输出（退出码 0）

说明：编辑器交互行为（输入、格式化、选中高亮）在 Task 9 接入 main.js 后统一手动验证。

- [ ] **Step 3: Commit**

```bash
git add tools/json-tool/editor.js
git commit -m "feat(json-tool): add CodeMirror editor wrapper with sync and search marks"
```

---

### Task 8: 树图渲染 tree-graph.js

**状态**
- [x] 任务完成

**Dependencies:** Task 4, Task 6
**Parallelizable:** Yes

**Files:**
- Create: `tools/json-tool/tree-graph.js`

- [ ] **Step 1: 实现 tree-graph.js**

```javascript
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
```

- [ ] **Step 2: 语法检查**

Run: `node --check tools/json-tool/tree-graph.js`
Expected: 无输出（退出码 0）

说明：渲染/交互行为在 Task 9 接入 main.js 后统一手动验证。

- [ ] **Step 3: Commit**

```bash
git add tools/json-tool/tree-graph.js
git commit -m "feat(json-tool): add SVG tree graph with zoom, pan and collapse"
```

---

### Task 9: 主入口 main.js 组装全部交互

**状态**
- [x] 任务完成

**Dependencies:** Task 2, Task 3, Task 4, Task 5, Task 7, Task 8
**Parallelizable:** No（依赖全部核心模块，是集成点）

**Files:**
- Create: `tools/json-tool/main.js`

- [ ] **Step 1: 实现 main.js**

```javascript
// 全屏页入口：组装编辑器、解析管线、树图、搜索与双向联动
import { JsonEditor } from './editor.js';
import { parseJson } from './json-parser.js';
import { buildTree, findNodeAt, findNodeById } from './tree-model.js';
import { TreeGraph } from './tree-graph.js';
import { findMatches } from './search.js';

const SAMPLE_JSON = `{
  "name": "ToolBox Pro",
  "version": "1.0.0",
  "features": [
    { "id": 1, "title": "Cookie 获取", "enabled": true },
    { "id": 2, "title": "XPath Helper", "enabled": true },
    { "id": 3, "title": "JSON 树图", "enabled": true, "tags": ["json", "tree", "graph"] }
  ],
  "author": { "name": "ToolBox", "contacts": { "email": null, "site": "https://example.com" } },
  "stats": { "downloads": 12345, "rating": 4.9, "beta": false }
}`;

const $ = (id) => document.getElementById(id);

class JsonTreeApp {
  constructor() {
    // 折叠状态三件套：autoCollapsed(>50 默认折叠) ∪ userCollapsed − userExpanded
    // 保证用户手动展开/折叠的决策在每次重新解析渲染后保留
    this.autoCollapsed = new Set();
    this.userCollapsed = new Set();
    this.userExpanded = new Set();
    this.tree = null; // 最近一次有效树
    this.matches = [];
    this.matchIndex = -1;

    this.editor = new JsonEditor($('editor-pane'), {
      onChange: () => this.handleInput(),
      onCursor: (offset) => this.handleCursor(offset),
    });
    this.graph = new TreeGraph($('graph-svg'));
    this.graph.onNodeClick = (node) => this.editor.selectRange(node.start, node.end);
    this.graph.onToggleCollapse = (node) => this.toggleCollapse(node);

    this.bindToolbar();
    this.bindSearch();
    this.editor.setValue(SAMPLE_JSON);
    this.handleInput();
  }

  effectiveCollapsed() {
    const set = new Set([...this.autoCollapsed, ...this.userCollapsed]);
    this.userExpanded.forEach((id) => set.delete(id));
    return set;
  }

  toggleCollapse(node) {
    if (this.effectiveCollapsed().has(node.id)) {
      this.userCollapsed.delete(node.id);
      this.userExpanded.add(node.id);
    } else {
      this.userExpanded.delete(node.id);
      this.userCollapsed.add(node.id);
    }
    this.refreshGraph(false);
  }

  bindToolbar() {
    $('btn-sample').addEventListener('click', () => {
      this.editor.setValue(SAMPLE_JSON);
      this.handleInput();
    });
    $('btn-clear').addEventListener('click', () => {
      this.editor.setValue('');
      this.handleInput();
    });
    $('btn-format').addEventListener('click', () => {
      if (!this.tree) return;
      this.editor.format();
      this.handleInput();
    });
    $('btn-minify').addEventListener('click', () => {
      if (!this.tree) return;
      this.editor.minify();
      this.handleInput();
    });
    $('btn-copy').addEventListener('click', async () => {
      const ok = await this.editor.copy();
      this.flashStatus(ok ? '已复制' : '复制失败', ok ? 'ok' : 'error');
    });
    $('zoom-in').addEventListener('click', () => this.graph.zoomIn());
    $('zoom-out').addEventListener('click', () => this.graph.zoomOut());
    $('zoom-fit').addEventListener('click', () => this.graph.fitView());
    $('zoom-reset').addEventListener('click', () => this.graph.resetView());
  }

  bindSearch() {
    let timer = null;
    const input = $('search-input');
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => this.handleSearch(), 200);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (this.matches.length === 0) return;
      this.matchIndex = e.shiftKey
        ? (this.matchIndex - 1 + this.matches.length) % this.matches.length
        : (this.matchIndex + 1) % this.matches.length;
      this.applyCurrentMatch();
    });
  }

  handleSearch() {
    const q = $('search-input').value;
    this.matches = this.tree ? findMatches(this.tree, q) : [];
    this.matchIndex = -1;
    $('search-count').textContent = this.matches.length ? `${this.matches.length} 个匹配` : '';
    this.editor.markRanges(this.matches.map((m) => ({ start: m.start, end: m.end })));
    if (this.matches.length > 0) {
      this.matchIndex = 0;
      this.applyCurrentMatch();
    } else {
      this.graph.setSearchState(null, null);
      this.refreshGraph(false);
    }
  }

  applyCurrentMatch() {
    const m = this.matches[this.matchIndex];
    // 展开被折叠的祖先后跳转
    let node = findNodeById(this.tree, m.path);
    while (node && node.parent) {
      this.userCollapsed.delete(node.parent.id);
      this.userExpanded.add(node.parent.id);
      node = node.parent;
    }
    this.graph.setSearchState(new Set(this.matches.map((x) => x.path)), m.path);
    this.refreshGraph(false);
    this.graph.focusNode(m.path);
  }

  handleInput() {
    const text = this.editor.getValue();
    if (!text.trim()) {
      this.tree = null;
      this.matches = [];
      this.matchIndex = -1;
      $('search-count').textContent = '';
      this.setError(null);
      this.setStatus('', '');
      this.graph.setSearchState(null, null);
      this.graph.render(null);
      $('graph-empty').classList.remove('hidden');
      return;
    }
    const res = parseJson(text);
    if (res.ok) {
      this.setError(null);
      this.setStatus('✓ 有效 JSON', 'ok');
      this.tree = buildTree(res.ast);
      this.autoCollapsed = computeDefaultCollapsed(this.tree);
      $('graph-empty').classList.add('hidden');
      this.refreshGraph(true);
      if ($('search-input').value) this.handleSearch();
    } else {
      // 树图保持上次有效状态
      this.setStatus('✗ 无效 JSON', 'error');
      this.setError(res.error);
    }
  }

  refreshGraph(fit) {
    if (!this.tree) return;
    this.graph.render(this.tree, { fit, collapsed: this.effectiveCollapsed() });
  }

  handleCursor(offset) {
    if (!this.tree) return;
    const node = findNodeAt(this.tree, offset);
    this.graph.setFocus(node ? node.id : null);
  }

  setError(err) {
    const bar = $('error-bar');
    if (!err) {
      bar.classList.add('hidden');
      bar.onclick = null;
      return;
    }
    bar.textContent = `第 ${err.line} 行第 ${err.column} 列：${err.message}（点击跳转）`;
    bar.classList.remove('hidden');
    bar.onclick = () => this.editor.gotoOffset(err.offset);
  }

  setStatus(text, cls) {
    const el = $('validation-status');
    el.textContent = text;
    el.className = 'jt-status' + (cls ? ' ' + cls : '');
  }

  flashStatus(text, cls) {
    const el = $('validation-status');
    const prevText = el.textContent;
    const prevCls = el.className;
    el.textContent = text;
    el.className = 'jt-status ' + cls;
    setTimeout(() => {
      el.textContent = prevText;
      el.className = prevCls;
    }, 1200);
  }
}

// 单层子节点超过 50 时该层默认折叠
function computeDefaultCollapsed(root) {
  const collapsed = new Set();
  (function walk(node) {
    if (node.children && node.children.length > 50) collapsed.add(node.id);
    if (node.children) node.children.forEach(walk);
  })(root);
  return collapsed;
}

document.addEventListener('DOMContentLoaded', () => new JsonTreeApp());
```

- [ ] **Step 2: 语法检查 + 单测回归**

Run: `node --check tools/json-tool/main.js && node tools/json-tool/tests/run-tests.js`
Expected: 语法检查无输出；四个测试文件 PASS + `ALL PASS`

- [ ] **Step 3: 手动验证全链路**

1. `chrome://extensions` → 「重新加载」→ 打开 `chrome-extension://<ID>/tools/json-tool/index.html`
2. 打开即见示例 JSON 的树图（自动适应画布），状态位显示「✓ 有效 JSON」
3. 编辑器删一个字符制造语法错误 → 红色错误条出现（含行列号），点击错误条光标跳到出错位置，树图保持上次画面
4. 恢复后点「格式化」「压缩」往返 → 内容不变（仅空白变化），树图正常
5. 点任一树节点 → 编辑器滚动到对应源码并黄色高亮；点编辑器任意位置 → 对应树节点紫色描边
6. 点节点右侧「−」徽标折叠 → 显示子节点数；再点恢复
7. 滚轮缩放（以光标为中心）、空白处拖拽平移、右下角 4 按钮生效
8. 搜索 `tool` → 匹配节点橙色、其余淡化、编辑器黄色标记、计数显示；Enter/Shift+Enter 循环跳转且自动居中

- [ ] **Step 4: Commit**

```bash
git add tools/json-tool/main.js
git commit -m "feat(json-tool): wire editor, parser pipeline, graph, search and sync"
```

---

### Task 10: JsonTool 启动器 + popup 注册

**状态**
- [x] 任务完成

**Dependencies:** None
**Parallelizable:** Yes

**Files:**
- Create: `tools/json-tool/tool.js`
- Create: `tools/json-tool/launcher.css`
- Modify: `utils/constants.js`
- Modify: `popup/popup.js`
- Modify: `popup/popup.html`

- [ ] **Step 1: 创建 launcher.css**

```css
/* JSON 树图工具 popup 启动卡片样式 */
.json-tool-launcher { text-align: center; padding: 20px 10px; }
.json-tool-tip { font-size: 13px; color: #666; margin-bottom: 14px; line-height: 1.5; }
```

- [ ] **Step 2: 创建 tools/json-tool/tool.js**

```javascript
// JSON 树图工具 - popup 启动器（全屏页入口为 index.html / main.js）
import { BaseTool } from '../base-tool.js';
import { TOOL_TYPES } from '../../utils/constants.js';

export class JsonTool extends BaseTool {
  constructor() {
    super('JSON 树图工具', TOOL_TYPES.JSON_TREE);
    this.name = 'JSON 树图工具';
    this.description = 'JSON 可视化树图，支持搜索与编辑器联动';
    this.icon = '🌳';
    this.createElement();
  }

  createElement() {
    this.element = document.createElement('div');
    this.element.className = 'json-tool-launcher';
    this.element.innerHTML = `
      <p class="json-tool-tip">JSON 树图工具在全屏页面中打开，适合编辑与查看大型 JSON。</p>
      <button id="open-json-tool" class="primary-button">打开 JSON 树图页面</button>
    `;
    this.element.querySelector('#open-json-tool').addEventListener('click', () => this.execute());
  }

  async initialize() {
    this.log('JSON 树图工具初始化完成');
  }

  async execute() {
    const url = chrome.runtime.getURL('tools/json-tool/index.html');
    const tabs = await chrome.tabs.query({ url });
    if (tabs.length > 0) {
      await chrome.tabs.update(tabs[0].id, { active: true });
      const win = await chrome.windows.get(tabs[0].windowId);
      if (!win.focused) await chrome.windows.update(tabs[0].windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url });
    }
    return { success: true, message: '已打开 JSON 树图页面' };
  }

  async destroy() {
    this.log('JSON 树图工具已销毁');
    this.element = null;
  }
}
```

- [ ] **Step 3: 修改 utils/constants.js**

在 `TOOL_TYPES` 中 `XPATH` 之后加一行：

```javascript
export const TOOL_TYPES = {
  COOKIE: 'cookie-tool',
  XPATH: 'xpath-helper',
  JSON_TREE: 'json-tree-tool',
  // 未来工具类型在这里添加
};
```

- [ ] **Step 4: 修改 popup/popup.js**

import 区（第 4 行后）加：

```javascript
import { JsonTool } from '../tools/json-tool/tool.js';
```

`registerTools()` 中注册：

```javascript
  registerTools() {
    // 注册所有工具
    this.registerTool(new CookieTool());
    this.registerTool(new XpathTool());
    this.registerTool(new JsonTool());
    // 未来工具在这里注册：
    // this.registerTool(new FutureTool());
  }
```

- [ ] **Step 5: 修改 popup/popup.html**

`<head>` 中 xpath 样式之后加一行：

```html
  <link rel="stylesheet" href="../tools/json-tool/launcher.css">
```

- [ ] **Step 6: 手动验证**

1. `chrome://extensions` → 「重新加载」
2. 点扩展图标 → 工具列表出现第三张卡片「🌳 JSON 树图工具」
3. 点卡片 → popup 显示详情页（提示文案 + 按钮）→ 点「打开 JSON 树图页面」→ 新标签页打开工具页
4. 切回 popup 再点一次按钮 → 复用并聚焦已打开的标签页，不开新标签
5. Cookie / XPath 两个工具卡片功能不受影响

- [ ] **Step 7: Commit**

```bash
git add tools/json-tool/tool.js tools/json-tool/launcher.css utils/constants.js popup/popup.js popup/popup.html
git commit -m "feat(json-tool): register JSON tree tool launcher in popup"
```

---

### Task 11: 端到端验收 + 文档同步

**状态**
- [x] 任务完成

**Dependencies:** Task 9, Task 10
**Parallelizable:** No（收尾任务，依赖全部完成）

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-08-20-json-tree-tool-design.md`

- [ ] **Step 1: 运行全部自动化测试**

Run: `node tools/json-tool/tests/run-tests.js`
Expected: 四个测试文件全 PASS + `ALL PASS`

- [ ] **Step 2: 按设计文档验收清单逐项手动验证**

- [ ] popup 出现「JSON 树图工具」卡片，点击打开全屏标签页；再次点击复用并聚焦已开标签页
- [ ] 粘贴合法 JSON 后树图实时更新；粘贴非法 JSON 显示行列号错误条且可点击跳转
- [ ] 格式化（2空格缩进）与压缩往返不丢数据
- [ ] 树图：节点卡片按类型着色；折叠/展开正常；单层子节点 >50 默认折叠
- [ ] 画布：滚轮缩放（以光标为中心）、拖拽平移、四个工具按钮生效
- [ ] 搜索：匹配节点橙色高亮、其余淡化；Enter/Shift+Enter 循环跳转并自动展开折叠祖先
- [ ] 双向联动：点树节点 → 编辑器滚动并高亮对应源码；点编辑器位置 → 树节点高亮描边
- [ ] 复制按钮复制当前编辑器内容
- [ ] 深嵌套（50层）、大数组（1000+ 元素）页面不崩溃
- [ ] 现有 Cookie / XPath 工具不受影响

深嵌套/大数组验证：在全屏页 DevTools 控制台执行下面两条 snippet，把输出粘贴到编辑器：

```javascript
// 深嵌套 50 层
copy('['.repeat(50) + JSON.stringify({ deep: true }) + ']'.repeat(50));

// 大数组 1200 个元素（父层 >50 应默认折叠）
copy(JSON.stringify({ items: Array.from({ length: 1200 }, (_, i) => ({ id: i, name: 'item-' + i })) }));
```

（`copy()` 是 DevTools 内置函数；粘贴后树图正常渲染即通过。）

- [ ] **Step 3: 更新 README.md**

「功能特性」章节 XPath 之后追加：

```markdown
### 3. JSON 树图工具 🌳
- 全屏页面打开，左侧 CodeMirror 编辑器 + 右侧可交互树图
- 格式化 / 压缩 / 校验（错误行列号定位，可点击跳转）
- JSON 数据渲染为横向节点树图：缩放、拖拽、折叠/展开
- 搜索 key 与值：树图与编辑器双侧高亮，Enter 循环跳转
- 编辑器 ↔ 树图双向联动定位
```

「项目结构」的 tools 目录块中 `xpath-helper` 行后追加：

```
│   └── json-tool/              # JSON 树图工具（全屏页 + popup 启动器）
```

- [ ] **Step 4: 更新 CLAUDE.md**

「当前工具」表格追加一行：

```markdown
| **JSON 树图工具** | 全屏页面：JSON 编辑器（格式化/压缩/校验）+ 横向树图可视化，搜索高亮与编辑器↔树图双向联动 |
```

「项目结构」的 tools 目录块中 `xpath-helper` 行后追加：

```
│   └── json-tool/             # JSON 树图工具（全屏页 + popup 启动器）
```

- [ ] **Step 5: 修正设计文档文件清单**

`docs/superpowers/specs/2026-08-20-json-tree-tool-design.md` 的文件树中 `search.js` 之后补两行：

```
  ├── tool.js                   # JsonTool 启动器（popup 注册入口）
  ├── launcher.css              # popup 启动卡片样式
```

「代码变更范围」表中 `tools/json-tool/*` 行的描述改为「新增：全屏页、启动器与测试（index/tool/main/editor/json-parser/tree-model/tree-layout/tree-graph/search/launcher.css + tests/）」。

- [ ] **Step 6: Commit**

```bash
git add README.md CLAUDE.md docs/superpowers/specs/2026-08-20-json-tree-tool-design.md
git commit -m "docs: document JSON tree tool and sync spec file list"
```

---

## 任务依赖总览

```
Level 0: Task 1 (vendor CodeMirror) ─┬─→ Task 6 (骨架) ─┬─→ Task 7 (编辑器) ─┐
                                      │                   └─→ Task 8 (树图) ─┤
Level 0: Task 2 (解析器) ─→ Task 3 (树模型) ─┬─→ Task 4 (布局) ─→ Task 8     ├─→ Task 9 (组装) ─→ Task 11 (验收+文档)
Level 0: Task 10 (启动器) ──────────────────────────────────────────────────┘         ↑
                                              └────────────────────────────────────── Task 10
```

---
**Execution Mode:** parallel
