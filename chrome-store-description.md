# ToolBox Pro - Chrome 网上应用店描述

## 中文版本

# ToolBox Pro - 轻量工具箱

四个高频实用工具，装完即用，所有操作均在本地完成。

## 功能

- **Cookie 获取**：一键复制当前页面 Cookie，支持 Header 与 Netscape（curl）两种格式。
- **XPath Helper**：点击页面元素即生成唯一 XPath 与 CSS 选择器，悬停高亮，一键复制。
- **JSON 树图**：JSON 一键渲染为可缩放拖拽的节点树图，支持格式化、校验、搜索与编辑联动。
- **媒体嗅探下载**：嗅探浏览器正在加载的无 DRM 视频/音频/HLS 流，支持单独下载或音视频无损合并为一个 MP4。

## 权限说明

- `cookies` / `activeTab`：读取当前页面 Cookie。
- `scripting`：仅在使用 XPath 工具时向页面注入选择器脚本。
- `webRequest`：仅用于识别页面正在加载的媒体请求地址，不上传任何数据。
- `downloads` / `offscreen`：将媒体文件保存到本地。
- `declarativeNetRequest`：仅在下载时临时为媒体请求补充 Referer 防盗链头，任务结束即删除规则。
- 不收集任何数据，无任何远程代码。

---

## English Version

# ToolBox Pro - Lightweight Toolkit

Four practical tools, ready to use after install. Everything runs locally.

## Features

- **Cookie Getter**: Copy all cookies of the current page in one click, in Header or Netscape (curl) format.
- **XPath Helper**: Click any element to generate a unique XPath and CSS selector, with hover highlight and one-click copy.
- **JSON Tree**: Render JSON into a zoomable, draggable node tree graph, with formatting, validation, search and editor sync.
- **Media Sniffer**: Sniff DRM-free video/audio/HLS streams loading in the browser, download them separately or losslessly merge video and audio into one MP4.

## Permissions

- `cookies` / `activeTab`: Read cookies of the current page.
- `scripting`: Inject the picker script only when the XPath tool is used.
- `webRequest`: Only identify media request URLs loading in the page; no data is uploaded.
- `downloads` / `offscreen`: Save media files locally.
- `declarativeNetRequest`: Only add a temporary Referer header for media requests during download; rules are removed when the task ends.
- No data collection, no remotely hosted code.
