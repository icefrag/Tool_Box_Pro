# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# ToolBox Pro

一个轻量实用的 Chrome 扩展工具箱，基于 Manifest V3 开发，采用模块化设计，易于添加新工具。

## 架构概览

### 核心分层

| 层级 | 位置 | 职责 |
|------|------|------|
| **ToolManager** | `popup/popup.js` | 工具注册、路由管理、UI 切换 |
| **BaseTool** | `tools/base-tool.js` | 抽象基类，定义工具接口 |
| **Tools** | `tools/*` | 各个具体工具实现 |
| **Background** | `background/service-worker.js` | 后台服务，消息路由 |
| **Content Scripts** | `content/` | 注入到页面的脚本（如 XPath 选择） |
| **Utils** | `utils/` | 常量定义、消息通信工具 |

### 工具扩展机制

**所有工具必须继承 `BaseTool` 并实现以下方法：**

```javascript
constructor()              // 构造函数：设置名称、描述、图标，创建 DOM 元素
async initialize()         // 初始化：在工具打开前调用
async execute()            // 执行工具操作
async destroy()            // 清理：工具关闭时调用
```

**两种执行模式：**
1. **直接执行** - 点击卡片直接执行操作后关闭（如 Cookie 工具）
2. **打开详情视图** - 跳转到工具详情页交互（如 XPath Helper）

### 消息通信

- `MessageHandler` - Service Worker 端消息路由
- `ToolMessenger` - 提供统一发送消息方法：
  - `sendMessage(type, action, data)` - 发送到 background
  - `sendToTab(tabId, type, action, data)` - 发送到指定标签页
  - `sendToActiveTab(type, action, data)` - 发送到当前活动标签页

## 项目结构

```
chrome-plugin/
├── manifest.json                 # Chrome 扩展配置（Manifest V3）
├── popup/
│   ├── popup.html               # 主弹窗 HTML
│   ├── popup.css                # 主弹窗样式
│   └── popup.js                 # ToolManager - 工具管理器
├── tools/
│   ├── base-tool.js             # 工具抽象基类
│   ├── cookie-tool/             # Cookie 获取工具
│   │   ├── tool.html
│   │   ├── tool.css
│   │   └── tool.js
│   └── xpath-helper/            # XPath 选择工具
│       ├── tool.js
│       └── tool.css
├── content/
│   ├── content.js               # XPath 选择逻辑（注入页面）
│   └── content.css              # 高亮样式
├── utils/
│   ├── constants.js             # 常量定义（TOOL_TYPES, MESSAGE_TYPES 等）
│   └── messaging.js             # 消息通信工具
├── background/
│   └── service-worker.js        # 后台服务
├── lib/                         # 第三方库
└── icons/                       # 扩展图标（16x16, 48x48, 128x128）
```

## 当前工具

| 工具 | 功能 |
|------|------|
| **Cookie 获取** | 一键获取当前活动标签页的 Cookie 并自动复制到剪贴板，格式：`name1=value1; name2=value2` |
| **XPath Helper** | 点击页面元素获取 XPath 和 CSS Selector，支持一键复制，鼠标悬停高亮 |

## 开发命令

这个项目是纯静态 JavaScript ES6 模块，**无构建步骤**：

### 安装扩展
1. 打开 Chrome 浏览器 → 扩展程序 → 打开开发者模式
2. 点击"加载已解压的扩展程序"
3. 选择本项目目录

### 重新加载
修改代码后，在 Chrome 扩展管理页面点击扩展的"重新加载"按钮。

### 调试
- 扩展弹窗：右键点击扩展图标 → "检查弹出式窗口"
- Content Script：打开页面开发者工具 → Sources → Content scripts 中查找
- Service Worker：扩展管理页面 → 查看视图背景页

## 添加新工具步骤

1. **创建工具目录**：在 `tools/` 下新建目录，如 `tools/my-tool/`
2. **创建文件**：
   - `tool.js` - 主要逻辑（必须）
   - `tool.css` - 样式（可选）
   - `tool.html` - 完整 HTML（可选，一般通过 JS 创建 DOM）
3. **实现工具类**：继承 `BaseTool`，实现 `constructor`, `initialize`, `execute`, `destroy`
4. **注册工具**：
   - 在 `utils/constants.js` 的 `TOOL_TYPES` 添加工具类型
   - 在 `popup/popup.js` import 并在 `registerTools()` 中注册
5. **重新加载** 扩展即可测试

**示例模板：**

```javascript
import { BaseTool } from '../base-tool.js';
import { TOOL_TYPES } from '../../utils/constants.js';

export class MyTool extends BaseTool {
  constructor() {
    super('My Tool', TOOL_TYPES.MY_TOOL);
    this.name = '工具名称';
    this.description = '工具描述';
    this.icon = '🔧';
    this.createElement();
  }

  createElement() {
    this.element = document.createElement('div');
    this.element.className = 'my-tool';
    this.element.innerHTML = `...`;
    this.setupEventListeners();
  }

  setupEventListeners() {
    // 绑定事件
  }

  async initialize() {
    this.log('工具初始化完成');
  }

  async execute() {
    // 执行逻辑
    return { success: true, message: '执行成功' };
  }

  async destroy() {
    this.log('工具已销毁');
    this.element = null;
  }
}
```

## 权限说明

`manifest.json` 中已声明权限：

| 权限 | 用途 |
|------|------|
| `activeTab` | 访问当前活动标签页 |
| `cookies` | 获取页面 Cookie |
| `storage` | 存储数据（未使用） |
| `scripting` | 动态注入 Content Script |
| `<all_urls>` | 允许在所有页面注入脚本 |

## 代码规范

- 使用 ES6 模块语法 (`import`/`export`)
- 每个工具独立目录，高内聚低耦合
- 遵循 BaseTool 接口约定
- 使用 Chrome 扩展 API 时处理错误
