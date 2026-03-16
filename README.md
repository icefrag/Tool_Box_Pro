# 小工具箱 Chrome 插件

一个包含多个实用小工具的Chrome扩展，第一个工具是Cookie管理器，支持获取当前页面Cookie并一键复制为Key=Value格式。

## 目录结构

```
chrome-plugin/
├── manifest.json                          # 插件配置
├── background/
│   └── service-worker.js                 # 后台服务工作者
├── popup/
│   ├── popup.html                        # 主弹窗（工具列表）
│   ├── popup.css                         # 弹窗样式
│   └── popup.js                          # 工具管理器
├── tools/
│   ├── base-tool.js                      # 工具基类
│   └── cookie-tool/                      # Cookie工具
│       ├── tool.html
│       ├── tool.css
│       └── tool.js
├── utils/
│   ├── constants.js                      # 常量定义
│   └── messaging.js                      # 消息通信工具
├── icons/                                # 插件图标
└── README.md
```

## 安装方法

1. 打开Chrome浏览器，访问 `chrome://extensions/`
2. 开启右上角的"开发者模式"
3. 点击左上角"加载已解压的扩展程序"
4. 选择当前 `chrome-plugin` 目录
5. 插件即可成功安装

## 使用说明

### Cookie工具使用方法
1. 点击浏览器右上角的插件图标，打开"小工具箱"
2. 在工具列表中点击"Cookie管理器"
3. 点击"获取Cookie"按钮，即可看到当前页面的所有Cookie
4. 点击"复制全部"按钮，即可将所有Cookie复制为 `name1=value1; name2=value2` 格式

## 添加新工具

添加新工具非常简单，只需要以下几步：

1. 在 `tools/` 目录下创建新工具的目录，例如 `tools/headers-tool/`
2. 新建三个文件：`tool.html`（UI）、`tool.css`（样式）、`tool.js`（逻辑）
3. 在 `tool.js` 中继承 `BaseTool` 类，实现 `initialize()`、`execute()`、`destroy()` 方法
4. 在 `utils/constants.js` 中添加新工具类型常量
5. 在 `popup/popup.js` 的 `registerTools()` 方法中注册新工具
6. 重新加载插件即可使用

## 示例：添加Headers查看器工具

```javascript
// utils/constants.js
export const TOOL_TYPES = {
  COOKIE: 'cookie-tool',
  HEADERS: 'headers-tool', // 新增
};

// popup/popup.js
import { HeadersTool } from '../tools/headers-tool/tool.js';

registerTools() {
  this.registerTool(new CookieTool());
  this.registerTool(new HeadersTool()); // 新增
}
```

## 技术特点

- **高度模块化**：每个工具都是独立模块，互不影响
- **统一接口**：所有工具继承自BaseTool，开发规范一致
- **低耦合**：新增工具几乎不需要修改核心代码
- **渐变紫色UI**：现代美观的界面设计
- **Manifest V3**：采用最新Chrome扩展规范

## 图标说明

当前 `icons/` 目录下需要添加三个尺寸的图标：
- `icon16.png` (16x16)
- `icon48.png` (48x48)
- `icon128.png` (128x128)

可以自己设计图标，或使用在线工具生成。
