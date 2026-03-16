# Chrome 小工具箱

一个轻量实用的 Chrome 扩展小工具箱。

## 项目结构

```
chrome-plugin/
├── manifest.json          # 扩展配置文件
├── popup/                 # 主弹窗
│   ├── popup.html
│   ├── popup.css
│   └── popup.js          # 工具管理和路由
├── tools/                 # 工具目录
│   ├── base-tool.js      # 工具基类
│   └── cookie-tool/      # Cookie工具
│       ├── tool.html
│       ├── tool.css
│       └── tool.js
├── utils/                 # 工具函数
│   ├── constants.js
│   └── messaging.js
├── background/
│   └── service-worker.js
└── lib/                   # 第三方库
```

## 当前工具

### 1. 获取当前网页cookie
- **功能**: 一键获取当前活动标签页的Cookie并自动复制到剪贴板
- **使用方式**: 点击工具卡片，自动完成获取和复制，弹窗自动关闭
- **格式**: `name1=value1; name2=value2`

## 安装方法

1. 打开 Chrome 浏览器 → 扩展程序 → 打开开发者模式
2. 点击"加载已解压的扩展程序"
3. 选择本项目目录

## 开发指南

### 添加新工具
1. 在 `tools/` 下创建新目录
2. 继承 `BaseTool` 类
3. 实现必要方法：`constructor()`, `initialize()`, `execute()`, `destroy()`
4. 在 `popup/popup.js` 的 `registerTools()` 中注册工具

## 权限说明

- `cookies`: 获取Cookie权限
- `activeTab`: 访问当前标签页
- `storage`: 存储数据

## 最近更新

- v1.0.0 - 初始化项目，添加Cookie获取工具，支持一键复制
