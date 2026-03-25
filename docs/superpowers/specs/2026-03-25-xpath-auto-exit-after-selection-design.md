# XPath Helper 选择后自动退出功能设计

## 需求描述

添加新功能：选择一个元素后自动退出选择模式，**保持弹窗打开**并在弹窗中显示选择结果，让用户可以方便地查看和复制。

## 当前问题

当前行为（修复时序 bug 后）：
- 点击开始后弹窗保持打开，页面进入选择模式
- 用户选择元素后，页面仍然保持选择模式
- 用户必须手动点击"停止选择"才能退出，体验不够流畅

用户期望：
- 点击一次元素 → 自动完成选择 → 自动退出页面选择模式 → 弹窗显示结果 → 用户查看/复制 → 可以再次开始新选择

## 设计方案

### 交互流程

```
1. 用户打开扩展 → 点击 XPath Helper → 显示工具界面
2. 选择复制模式 → 点击"开始选择元素"
3. 注入脚本 → 弹窗 UI 进入选择中状态 → 页面进入选择模式 → 弹窗保持打开
4. 用户在页面点击目标元素：
   a. content script 获取 XPath/Selector → 自动复制到剪贴板（保留原有行为）
   b. **新增**：content script 发送 `selectionResult` 消息给 popup
   c. **新增**：content script 调用 `stopSelection()` 自动退出页面选择模式
   d. popup 收到结果 → 更新 UI 显示结果（XPath + Selector + 复制按钮）
   e. popup UI 退出选择中状态 → 显示"开始选择元素"按钮可以再次选择
5. 用户可以：
   a. 点击弹窗的复制按钮再次复制
   b. 点击"开始选择元素"继续选择下一个元素
   c. 手动关闭弹窗
```

### UI 设计

**选择中状态（当前）：**
```
┌─────────────────────────────────┐
│  点击下方按钮开始选择元素...      │
│                                 │
│  [复制选项] ○ XPath ○ Selector ● both  │
│                                 │
│  [开始选择元素]                  │
└─────────────────────────────────┘
```

**结果展示状态（新增）：**
```
┌─────────────────────────────────┐
│  ✅ 已选择: div.container       │
│                                 │
│  XPath:                         │
│  /html/body/div[2]/main/article│
│  [复制]                         │
│                                 │
│  Selector:                      │
│  #main > article.container      │
│  [复制]                         │
│                                 │
│  [开始选择元素]                  │
└─────────────────────────────────┘
```

### 消息协议

新增消息类型：
- **From content → popup:** `selectionResult`
  ```javascript
  {
    action: 'selectionResult',
    elementTag: 'div',           // 选中元素的标签名
    xpath: '//*[@id="main"]/div', // XPath 路径
    selector: '#main > div',     // CSS Selector
  }
  ```

现有消息保持不变：
- `selectionStopped` - 退出选择后同步 UI（已有）

### 代码变更范围

| 文件 | 变更 |
|------|------|
| `content/content.js` | 在 `handleMouseDown` 末尾发送 `selectionResult` 消息，然后调用 `stopSelection()` |
| `tools/xpath-helper/tool.js` | 1. 添加 `selectionResult` 消息监听器；2. 添加 `showResult()` 方法更新 UI；3. 修改 HTML 添加结果展示区域；4. 添加复制按钮事件绑定 |
| `tools/xpath-helper/tool.css` | 添加结果展示区域的样式 |

### 边界情况处理

1. **多个快速点击**
   - 由于第一次点击后 `stopSelection()` 会立即退出，所以第二次点击不会被处理，正常

2. **点击后直接关闭弹窗**
   - `beforeunload` 仍然会发送 `stopSelection` 兜底清理，正常

3. **ESC 在页面退出**
   - 保持原有行为：`selectionStopped` 消息同步 UI，弹窗返回初始状态，正常

4. **重新打开弹窗**
   - 保持原有检测逻辑，如果选择未激活，返回初始状态，正常

5. **selectionResult 消息到达但选择状态已不活跃**
   - 添加 guard：`if (!this.isSelectionActive) return;`
   - 防止因竞态导致的错误状态更新

6. **开始新选择时清空之前的结果**
   - 在 `startSelection()` 中调用 `clearResult()` 隐藏结果区域
   - 确保每次选择都是干净的状态

### 验收标准

- [ ] 点击开始后进入选择模式，弹窗保持打开
- [ ] 在页面点击一个元素后，页面自动退出选择模式（高亮和 tooltip 消失）
- [ ] 弹窗更新 UI 显示 XPath 和 Selector 结果，带复制按钮
- [ ] 点击复制按钮可以复制对应路径到剪贴板
- [ ] 点击"开始选择元素"可以再次进入选择模式
- [ ] ESC 在页面仍然可以正常退出
- [ ] 直接关闭弹窗仍然会清理选择模式

## 风险评估

- **风险等级**：低
- 增量变更，不影响已有功能
- 原有功能（手动停止）仍然可用
- 只增加新逻辑，不删除原有逻辑
