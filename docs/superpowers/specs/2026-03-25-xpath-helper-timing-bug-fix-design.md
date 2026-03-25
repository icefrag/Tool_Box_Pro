# XPath Helper 时序 Bug 修复设计

## 问题描述

点击"开始选择"后：
1. 弹窗自动关闭，但 **页面选择模式也自动消失了**
2. 用户观察到的现象是：tooltip 提示框"出现一下又没了"

## 根因分析

### 时序问题

当前流程：
```
点击开始 → inject script → 发送 startSelection → setTimeout 500ms close popup →
popup beforeunload 触发 → 发送 stopSelection →
content script 收到顺序：startSelection → stopSelection → 选择模式停止
```

问题本质：**`beforeunload` 发送的 `stopSelection` 总是在 `startSelection` 之后到达**，导致选择模式刚启动就被停止。

这是因为 Chrome 扩展消息传递存在微小延迟，popup 关闭事件触发后，stopSelection 消息会在 startSelection 处理完成后才送达。

## 解决方案：保持弹窗打开

### 设计决策

采用**方案一**：点击开始后不自动关闭弹窗，保持打开状态显示当前状态。

优势：
- ✅ 完全避免消息时序竞争问题
- ✅ 用户可以直观看到当前状态（是否在选择模式）
- ✅ 用户可以手动点击"停止选择"退出
- ✅ popup 关闭时仍然有 `beforeunload` 兜底清理，资源不会泄漏
- ✅ 比"延迟 stop"方案更可靠

### UI 变更

**启动前：**
- 标题：XPath Helper
- 说明文字：点击下方按钮开始选择元素，页面会进入选择模式
- 复制选项（保留）
- 按钮："开始选择元素"

**启动后：**
- 更新状态文字为"已进入选择模式，请点击页面元素"
- 按钮文字变成"停止选择"且可点击
- 禁用复制选项 radios（避免选择中修改配置）
- **弹窗保持打开**，用户可手动关闭

### 交互流程

```
1. 用户打开扩展 → 点击 XPath Helper → 显示工具界面
2. 选择复制模式 → 点击"开始选择元素"
3. 注入脚本 → 发送 startSelection → 更新 UI 状态 → 弹窗保持打开
4. 用户切换到页面点击元素 → 自动复制路径
5. 用户完成后可以：
   a) 直接关闭弹窗 → beforeunload 自动发送 stopSelection
   b) 点击"停止选择"按钮 → 发送 stopSelection 并恢复 UI
   c) 按 ESC (在页面) → content script 自动停止
```

### 边界情况处理

**1. 重复点击"开始选择"（已选择中再次点击）**
- UI 会防止重复点击：按钮在选择进行中已经禁用，所以无法点击
- 若通过非正常途径触发多次调用，content script 已有 `if (_selectionActive) return;` 守卫，会静默忽略

**2. 选择模式已经在运行（用户重新打开弹窗）**
- 当用户已经在页面进入选择模式，然后重新打开扩展弹窗，进入 XPath Helper 界面
- 实现方案：`initialize()` 时探测选择状态，如果检测到选择已激活，直接将 UI 更新为"选择中"状态（显示停止按钮）
- 这样用户可以从弹窗中看到当前状态，并可以点击停止

**3. 在页面按 ESC 退出选择**
- content script 会调用 `stopSelection()` 清理所有 UI
- popup 由于保持打开，下次用户打开时，`initialize()` 探测到选择未激活，恢复 UI 为初始状态

### 代码变更范围

| 文件 | 变更 |
|------|------|
| `tools/xpath-helper/tool.js` | 移除自动关闭代码，添加停止按钮逻辑，更新UI状态 |
| `tools/xpath-helper/tool.css` | 调整样式适应新按钮和状态 |
| `content/content.js` | 无需变更（已有逻辑正确） |
| `popup/popup.js` | 无需变更 |

## 验收标准

- [ ] 点击开始后弹窗不关闭，显示正确状态
- [ ] 点击开始后页面正确进入选择模式，tooltip 保持显示
- [ ] 点击"停止选择"正确退出选择模式并恢复 UI
- [ ] 直接关闭弹窗仍会自动清理选择模式
- [ ] ESC 键在页面仍能退出选择模式
- [ ] 复制模式设置正确保存

## 风险评估

- **风险等级**：低
- 不影响核心逻辑，只改变交互流程
- 保持了兜底清理机制，不会产生资源泄漏
- 现有功能（XPath 生成、复制、高亮）全部保持不变
