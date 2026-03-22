# ToolBox Pro

一款轻量实用的 Chrome 扩展工具箱，帮助你快速完成日常开发、调试任务。

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)

## 功能特性

### 1. Cookie 获取工具 🍪
- 一键获取当前页面所有 Cookie
- 自动复制到剪贴板，格式：`name1=value1; name2=value2`
- 适合快速导出登录态、测试接口

### 2. XPath Helper 🔍
- 点击页面任意元素，获取其 XPath 和 CSS Selector
- 鼠标悬停高亮显示当前元素
- 自动复制到剪贴板，支持配置：
  - 仅复制 XPath
  - 仅复制 CSS Selector
  - 两者都复制
- 生成唯一性路径，支持复杂多卡片布局

## 安装

1. 打开 Chrome 浏览器 → 扩展程序 (`chrome://extensions/`)
2. 开启右上角的「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本项目目录
5. 点击扩展图标即可使用

## 使用截图

```
┌─────────────────────────────┐
│  🔧 ToolBox Pro            │
│  选择一个工具开始使用        │
├─────────────────────────────┤
│  ┌─────────────────────┐   │
│  │ 🍪 获取当前网页cookie │   │
│  │ 点击直接复制Cookie    │   │
│  └─────────────────────┘   │
│  ┌─────────────────────┐   │
│  │ 🔍 XPath Helper     │   │
│  │ 点击元素获取路径     │   │
│  └─────────────────────┘   │
└─────────────────────────────┘
```

## 项目结构

```
chrome-plugin/
├── manifest.json                 # Chrome 扩展配置
├── popup/                        # 弹窗 UI
│   ├── popup.html
│   ├── popup.css
│   └── popup.js                  # 工具管理器
├── tools/                        # 工具目录
│   ├── base-tool.js              # 工具基类
│   ├── cookie-tool/              # Cookie 工具
│   └── xpath-helper/             # XPath 选择工具
├── content/                      # 注入页面的脚本
│   ├── content.js
│   └── content.css
├── utils/                        # 工具函数
│   ├── constants.js
│   └── messaging.js
├── background/                   # 后台服务
│   └── service-worker.js
└── icons/                        # 图标
```

## 开发指南

### 添加新工具

1. 在 `tools/` 创建工具目录，如 `tools/my-tool/`
2. 继承 `BaseTool` 实现工具类：

```javascript
import { BaseTool } from '../base-tool.js';
import { TOOL_TYPES } from '../../utils/constants.js';

export class MyTool extends BaseTool {
  constructor() {
    super('My Tool', TOOL_TYPES.MY_TOOL);
    this.name = '我的工具';
    this.description = '工具描述';
    this.icon = '🛠️';
    this.createElement();
  }

  createElement() {
    this.element = document.createElement('div');
    this.element.innerHTML = '...';
  }

  async initialize() { }
  async execute() { return { success: true }; }
  async destroy() { this.element = null; }
}
```

3. 在 `popup/popup.js` 注册：

```javascript
import { MyTool } from '../tools/my-tool/tool.js';

registerTools() {
  this.registerTool(new MyTool());
}
```

### 消息通信

工具与 content script 通过 `ToolMessenger` 通信：

```javascript
// 发送到当前标签页
await this.sendToActiveTab('type', 'action', { data });

// 发送到 background
await this.sendMessage('type', 'action', { data });
```

## 技术栈

- **Manifest V3** - 最新 Chrome 扩展规范
- **ES6 Modules** - 原生模块化，无需构建工具
- **Service Worker** - 后台任务处理
- **Content Scripts** - 页面注入

## 更新日志

### v1.0.0
- 初始版本
- Cookie 获取工具
- XPath Helper 工具

## 许可证

MIT
