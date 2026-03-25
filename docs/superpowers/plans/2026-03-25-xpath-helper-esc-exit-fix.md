# XPath Helper ESC 退出问题修复实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 XPath Helper 插件 ESC 键无法退出选择模式的问题，同时修复复制按钮点击失效问题。

**Architecture:** 在现有 content script 架构基础上，改进事件监听器注册方式，添加 multiple layers of defense（capture phase + visibilitychange + popup 关闭兜底 + 退出按钮）。所有修改遵循现有代码风格，只修复问题不重构架构。

**Tech Stack:** 纯 JavaScript ES6 模块，Chrome Extension Manifest V3。

---

## 文件修改清单

| 文件 | 操作 | 修改范围 |
|------|------|----------|
| `content/content.js` | 修改 | ESC 监听器改用 capture phase，添加 visibilitychange 监听，增强鼠标事件检查，添加退出按钮事件绑定，增强 stopSelection() 清理 |
| `content/content.css` | 修改 | 添加退出按钮样式 |
| `popup/popup.js` | 修改 | 添加 beforeunload 监听，关闭弹窗时清理 content script 选择状态 |

---

## 任务分解

### Task 1: 修复 ESC 监听器改用 capture phase

**Files:**
- Modify: `content/content.js:533-636`

- [ ] **Step 1: 修改 handleKeyDown 函数**

在第 533 行 `handleKeyDown` 改为：

```javascript
function handleKeyDown(event) {
  // ESC key to exit selection mode
  if (event.key === 'Escape' && _selectionActive) {
    event.stopImmediatePropagation();
    stopSelection();
  }
}
```

- [ ] **Step 2: 修改 startSelection 中 keydown 注册，改为 capture phase**

第 601 行：
```javascript
document.addEventListener('keydown', handleKeyDown, true);
```

- [ ] **Step 3: 修改 stopSelection 中 keydown 移除，匹配参数**

第 632 行：
```javascript
document.removeEventListener('keydown', handleKeyDown, true);
```

- [ ] **Step 4: Commit**

```bash
git add content/content.js
git commit -m "fix(xpath): change ESC listener to capture phase"
```

---

### Task 2: 添加 visibilitychange 兜底监听

**Files:**
- Modify: `content/content.js:1-26, 590-650`

- [ ] **Step 1: 在文件开头全局变量区域添加引用**

第 25 行附近添加：
```javascript
// Visibility change handler reference
let _handleVisibilityChange = null;
```

- [ ] **Step 2: 在 startSelection 中注册监听**

在 `startSelection` 函数末尾（第 611 行之后）添加：
```javascript
_handleVisibilityChange = function() {
  if (document.hidden && _selectionActive) {
    stopSelection();
  }
};
document.addEventListener('visibilitychange', _handleVisibilityChange);
```

- [ ] **Step 3: 在 stopSelection 中移除监听**

在 `stopSelection` 函数中，事件移除部分（第 636 行之后）添加：
```javascript
if (_handleVisibilityChange) {
  document.removeEventListener('visibilitychange', _handleVisibilityChange);
  _handleVisibilityChange = null;
}
```

- [ ] **Step 4: Commit**

```bash
git add content/content.js
git commit -m "feat(xpath): add visibilitychange auto-exit"
```

---

### Task 3: 修复复制按钮点击问题（增强鼠标事件检查）

**Files:**
- Modify: `content/content.js:450-531`

- [ ] **Step 1: 修改 handleMouseDown 开头检查逻辑**

第 450-458 行：

```javascript
function handleMouseDown(event) {
  // Check if click is on any of our own UI elements (tooltip, buttons)
  if (_tooltip) {
    const isOurUI = _tooltip.contains(event.target) ||
                    event.target === _tooltip ||
                    (event.target.closest && event.target.closest('#xpath-helper-tooltip'));
    if (isOurUI) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return; // Don't select anything - we clicked our own UI
    }
  }

  if (!_selectionActive) return;

  // ... rest of existing code stays the same
}
```

- [ ] **Step 2: 修改 handleMouseUp 开头检查逻辑**

第 521-531 行：

```javascript
function handleMouseUp(event) {
  if (_tooltip) {
    const isOurUI = _tooltip.contains(event.target) ||
                    event.target === _tooltip ||
                    (event.target.closest && event.target.closest('#xpath-helper-tooltip'));
    if (isOurUI) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
  }

  if (!_selectionActive) return;

  // ... rest of existing code stays the same
}
```

- [ ] **Step 3: 修改 handleClick 开头检查逻辑**

第 508-519 行：

```javascript
function handleClick(event) {
  // Check if click is on the tooltip itself
  if (_tooltip) {
    const isOurUI = _tooltip.contains(event.target) ||
                    event.target === _tooltip ||
                    (event.target.closest && event.target.closest('#xpath-helper-tooltip'));
    if (isOurUI) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
  }

  if (!_selectionActive) return;

  // ... rest of existing code stays the same
}
```

- [ ] **Step 4: Commit**

```bash
git add content/content.js
git commit -m "fix(xpath): prevent mouse selection on tooltip clicks"
```

---

### Task 4: 添加退出按钮到 tooltip

**Files:**
- Modify: `content/content.js:294-343`
- Modify: `content/content.css:1-138`

- [ ] **Step 1: 更新 createTooltip HTML 模板添加退出按钮**

第 299 行修改：

```javascript
_tooltip.innerHTML = `
  <div class="xpath-helper-tooltip-content">
    <div class="xpath-helper-tooltip-header">
      <span class="xpath-helper-title">XPath Helper</span>
      <button class="xpath-helper-exit-btn" title="退出选择模式">✕ 退出</button>
    </div>
    <div class="xpath-helper-paths">
      <div class="xpath-helper-path-group">
        <span class="xpath-helper-label">XPath:</span>
        <code class="xpath-helper-xpath"></code>
        <button class="xpath-helper-copy-btn" data-type="xpath">复制</button>
      </div>
      <div class="xpath-helper-path-group">
        <span class="xpath-helper-label">Selector:</span>
        <code class="xpath-helper-selector"></code>
        <button class="xpath-helper-copy-btn" data-type="selector">复制</button>
      </div>
    </div>
    <div class="xpath-helper-hint">点击页面元素获取路径</div>
  </div>
`;
```

- [ ] **Step 2: 在 createTooltip 中添加退出按钮事件绑定**

在第 335 行之后（复制按钮绑定之后）添加：

```javascript
// Bind exit button
_tooltip.querySelector('.xpath-helper-exit-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  stopSelection();
});
```

- [ ] **Step 3: 在 content.css 末尾添加退出按钮样式**

第 138 行之后添加：

```css
.xpath-helper-exit-btn {
  padding: 2px 8px;
  background: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  color: #666;
  transition: all 0.2s;
}

.xpath-helper-exit-btn:hover {
  background: #ff4444;
  border-color: #ff4444;
  color: white;
}
```

- [ ] **Step 4: Commit**

```bash
git add content/content.js content/content.css
git commit -m "feat(xpath): add exit button to tooltip"
```

---

### Task 5: 添加 popup 关闭时的状态清理

**Files:**
- Modify: `popup/popup.js:170-172`（在 DOMContentLoaded 回调内部添加）

- [ ] **Step 1: 修改 DOMContentLoaded 初始化添加 beforeunload 监听**

原代码：

```javascript
// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
  new ToolManager();
});
```

修改为：

```javascript
// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
  const toolManager = new ToolManager();

  // Popup 关闭时兜底清理 content script 选择状态
  window.addEventListener('beforeunload', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'stopSelection' })
          .catch(() => {});
      }
    });
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add popup/popup.js
git commit -m "fix(xpath): add popup unload cleanup for selection mode"
```

---

### Task 6: 增强 stopSelection() 清理完整性

**Files:**
- Modify: `content/content.js:626-650`

- [ ] **Step 1: 在 stopSelection 函数开头添加早期返回守卫**

在第 626 行函数开头添加：

```javascript
function stopSelection() {
  // 防止重复调用
  if (!_selectionActive) return;

  _selectionActive = false;
  // ... rest of function
}
```

- [ ] **Step 2: Commit**

```bash
git add content/content.js
git commit -m "refactor(xpath): add early return guard in stopSelection"
```

---

### Task 7: 验证完整功能并完成

**Files:**
- Review all changes

- [ ] **Step 1: 检查所有事件移除参数是否一致**

确认 `addEventListener` 和 `removeEventListener` 的 `useCapture` 参数一致：

- `mousedown, mouseup, click, mouseover, mouseout, keydown` → 都使用 `true`
- `visibilitychange` → 不使用 capture（默认 false）

- [ ] **Step 2: 检查所有修改是否符合设计文档**

对比 `docs/superpowers/specs/2026-03-25-xpath-helper-esc-exit-design.md`

- [ ] **Step 3: 最终提交（如有遗漏）**

```bash
git status
```

如果有未提交文件，补充提交。

- [ ] **Step 4: 总结修改**

预期所有修改完成后：
1. ESC 键在 capture phase 优先处理，不会被页面脚本拦截
2. 切换标签页时自动退出
3. 点击复制按钮不会选中下方元素
4. tooltip 上有退出按钮兜底
5. popup 关闭时自动清理

---

## 测试指南

测试步骤（手动测试，因为是 Chrome 扩展 UI 功能）：

1. **基础 ESC 退出测试**
   - 打开任意网页，点击"开始选择元素"
   - 按 ESC 键 → 应该立即退出选择模式，cursor 恢复

2. **复制按钮测试**
   - 开始选择，点击一个元素
   - tooltip 显示 XPath 和 Selector
   - 点击"复制"按钮 → 应该成功复制，不会选中下方元素

3. **退出按钮测试**
   - 开始选择，点击一个元素
   - 点击 tooltip 的"✕ 退出"按钮 → 应该立即退出

4. **visibilitychange 测试**
   - 开始选择，保持选择模式
   - 切换到另一个标签页
   - 切回来 → 选择模式已经自动退出，cursor 恢复

5. **popup 关闭测试**
   - 开始选择，保持选择模式
   - 直接点击 popup 外部关闭弹窗
   - 刷新页面 → 选择模式已经退出

6. **特殊网站测试（推荐）**
   - Google Docs
   - Gmail
   - 复杂 React/Vue SPA 应用
   - 测试 ESC 退出和复制按钮都正常工作
