# XPath Helper 退出机制优化设计

## 背景

XPath Helper 插件的退出机制存在问题：用户按 ESC 键后有时无法退出选择模式，复制按钮点击也会误选下方页面元素。

## 问题分析

### 问题 1：ESC 键无法退出

**原因：**
1. `content.js` 第 601 行的 keydown 监听器使用默认的 bubble phase，事件被网站脚本拦截后无法到达
2. 某些网站（Google Docs、Gmail、部分 SPA）会 stopPropagation() ESC 键
3. 如果用户焦点在扩展弹窗，content script 可能收不到键盘事件
4. 切换标签页时如果选择模式仍在激活，不会自动清理

### 问题 2：复制按钮点击失效

**原因：**
1. 鼠标事件使用 capture phase 注册（第 598-600 行）
2. `handleMouseDown` 虽然检查了 tooltip，但在 `event.stopImmediatePropagation()` 之前就已经执行了 `elementFromPoint()`
3. tooltip 遮挡了下方页面元素，但 `elementFromPoint` 仍然能穿透获取到

## 解决方案

### 1. 修复 ESC 键监听（capture phase 优先）

**修改文件：** `content/content.js`

```javascript
// 第 601 行修改
// 原来：
document.addEventListener('keydown', handleKeyDown);
// 改为：
document.addEventListener('keydown', handleKeyDown, true);
```

**修改 handleKeyDown 函数：**

```javascript
function handleKeyDown(event) {
  if (event.key === 'Escape' && _selectionActive) {
    event.stopImmediatePropagation();
    stopSelection();
  }
}
```

**效果：**
- capture phase 保证我们的 ESC 处理先于页面脚本执行
- `stopImmediatePropagation` 阻止事件继续传播给页面脚本
- 不使用 `preventDefault()`，避免干扰 ESC 键的正常浏览器行为

### 2. 添加 visibilitychange 兜底监听

**修改文件：** `content/content.js`

**在 startSelection() 中添加：**

```javascript
document.addEventListener('visibilitychange', handleVisibilityChange);

function handleVisibilityChange() {
  if (document.hidden && _selectionActive) {
    stopSelection();
  }
}
```

**在 stopSelection() 中移除：**

```javascript
document.removeEventListener('visibilitychange', handleVisibilityChange);
```

**效果：**
- 用户切换标签页时，如果选择模式仍激活，自动退出
- 防止用户切出去后忘记退出，切回来发现还在选择模式

### 3. 修复复制按钮点击问题

**修改文件：** `content/content.js`

**增强 handleMouseDown 检查逻辑：**

```javascript
function handleMouseDown(event) {
  // 检查是否点击在我们的 UI 元素上（tooltip、退出按钮、复制按钮）
  const isOurUI = _tooltip && (
    _tooltip.contains(event.target) ||
    event.target === _tooltip ||
    (event.target.closest && event.target.closest('#xpath-helper-tooltip'))
  );

  if (isOurUI) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return; // 直接返回，不做任何选择
  }

  // ... 原有逻辑
}
```

**同步修改 handleMouseUp 和 handleClick：**

```javascript
function handleMouseUp(event) {
  // 同样的检查
  const isOurUI = _tooltip && (
    _tooltip.contains(event.target) ||
    event.target === _tooltip ||
    (event.target.closest && event.target.closest('#xpath-helper-tooltip'))
  );

  if (isOurUI) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }

  // ... 原有逻辑
}

function handleClick(event) {
  // 同样的检查
  const isOurUI = _tooltip && (
    _tooltip.contains(event.target) ||
    event.target === _tooltip ||
    (event.target.closest && event.target.closest('#xpath-helper-tooltip'))
  );

  if (isOurUI) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }

  // ... 原有逻辑
}
```

**效果：**
- 所有鼠标事件在最早阶段就检查是否点击在我们自己的 UI 上
- 如果是，立即阻止并返回，不会执行 `elementFromPoint` 获取下方元素

### 4. 添加退出按钮

**修改文件：** `content/content.css` 和 `content/content.js`

**在 createTooltip() 中添加退出按钮到标题栏：**

```javascript
_tooltip.innerHTML = `
  <div class="xpath-helper-tooltip-content">
    <div class="xpath-helper-tooltip-header">
      <span class="xpath-helper-title">XPath Helper</span>
      <button class="xpath-helper-exit-btn" title="退出选择模式">✕ 退出</button>
    </div>
    ...
  </div>
`;

// 绑定退出按钮事件
_tooltip.querySelector('.xpath-helper-exit-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  stopSelection();
});
```

**CSS 样式：**

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

**效果：**
- 提供明确的退出方式，100% 可靠
- 鼠标 hover 变红，提供视觉反馈

### 5. 保证清理完整性

**修改文件：** `content/content.js`

**改进 stopSelection()：**

```javascript
function stopSelection() {
  // 优先设置标志，防止重复调用时的问题
  if (!_selectionActive) return;

  _selectionActive = false;
  document.body.style.cursor = '';

  // 使用相同的参数移除事件监听器
  document.removeEventListener('mousedown', handleMouseDown, true);
  document.removeEventListener('mouseup', handleMouseUp, true);
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('keydown', handleKeyDown, true);
  document.removeEventListener('mouseover', handleMouseOver, true);
  document.removeEventListener('mouseout', handleMouseOut, true);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('scroll', handleScroll, true);
  window.removeEventListener('resize', handleResize);

  // 清理高亮
  if (_previousHighlight) {
    _previousHighlight.classList.remove('xpath-helper-highlight');
    _previousHighlight = null;
  }
  if (_hoverHighlight) {
    _hoverHighlight.classList.remove('xpath-helper-highlight-hover');
    _hoverHighlight = null;
  }
  window._selectedElement = null;

  // 清理 UI
  removeXMarker();
  removeTooltip();
}
```

**效果：**
- 统一使用 `true` 作为 useCapture 参数，与添加时保持一致
- 早期返回机制防止重复清理
- `_selectionActive = false` 放在最前面，确保状态一致

### 6. 添加 Popup 关闭时的状态清理

**修改文件：** `popup/popup.js`

**添加 unload 监听：**

```javascript
// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
  const toolManager = new ToolManager();
  // Popup 关闭时确保清理 content script 选择状态
  window.addEventListener('beforeunload', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'stopSelection' }).catch(() => {});
      }
    });
  });
});
```

**效果：**
- 当用户直接点击弹窗外部关闭 popup 时，一定会发送 stopSelection 消息
- 即使 user 关闭 popup 不退出，下次打开也不会残留选择模式
- `XpathTool.destroy()` 已经会发送 stopSelection，这里作为兜底

---

### 7. 可见性变化监听（添加函数引用管理）

**修改文件：** `content/content.js`

**在全局变量区域添加：**

```javascript
// Visibility change handler reference
let _handleVisibilityChange = null;
```

**在 startSelection() 中添加：**

```javascript
_handleVisibilityChange = function() {
  if (document.hidden && _selectionActive) {
    stopSelection();
  }
};
document.addEventListener('visibilitychange', _handleVisibilityChange);
```

**在 stopSelection() 中移除：**

```javascript
if (_handleVisibilityChange) {
  document.removeEventListener('visibilitychange', _handleVisibilityChange);
  _handleVisibilityChange = null;
}
```

---

## 修改文件清单

| 文件 | 修改内容 |
|------|----------|
| `content/content.js` | ESC 改用 capture phase、添加 visibilitychange 监听、增强鼠标事件检查、添加退出按钮处理、修复函数引用管理 |
| `content/content.css` | 添加退出按钮样式 |
| `popup/popup.js` | 添加 beforeunload 监听，关闭 popup 时强制清理选择状态 |

## 测试计划

1. **基础功能测试**
   - 点击开始选择，进入选择模式
   - 按 ESC 键退出
   - 切换标签页自动退出

2. **复制按钮测试**
   - 选择一个元素后，tooltip 显示
   - 点击复制按钮，确认复制成功
   - 多次点击复制，确认每次都有效

3. **退出按钮测试**
   - 选择模式中点击 "✕ 退出" 按钮
   - 确认立即退出，tooltip 消失

4. **边界场景测试**
   - 在 Google Docs 等网站测试 ESC 退出
   - 在深层嵌套元素的页面测试复制按钮
   - 快速切换标签页测试 visibilitychange 清理
