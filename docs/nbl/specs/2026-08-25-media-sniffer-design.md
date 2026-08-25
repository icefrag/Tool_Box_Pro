# 媒体嗅探下载工具（media-sniffer）设计文档

- 日期：2026-08-25
- 状态：已批准（方案一：纯 webRequest 嗅探）
- 分支：feature/media-sniffer

## 需求背景

ToolBox Pro 需要一个新的拉新功能：用户在任意网站观看视频时，页面不提供下载入口，
扩展能嗅探到浏览器实际加载的媒体资源并提供下载。

- 定位：**通用媒体嗅探器**（方案 A），不针对特定站点；不点名任何网站（商店合规）
- 发布渠道：Chrome Web Store（随主扩展提审）；Edge / Firefox 为备选兜底
- 背景约束：MV3 禁止远程代码（ffmpeg.wasm 不能运行时加载）；视频下载品类提审风险
  已知，用户量小、重提审成本低，接受该风险

## 目标 / 非目标

**目标（v1）**
- 嗅探并下载：直链媒体文件（mp4/webm/flv/mov 等）、整文件 m4s 流（视频/音频分离展示）、
  标准 HLS（m3u8，含 AES-128）
- 按标签页归组展示，popup 内一键下载，后台异步执行，popup 关闭不中断
- 图标 badge 显示当前 tab 媒体数

**非目标（v1 明确不做，UI 如实标注）**
- DRM 内容（Widevine/PlayRight/EME）——技术不可行且法律禁止
- 音视频合并（不打包 ffmpeg.wasm；v2 评估 mp4box.js）
- 分片级独立签名的流（每段 URL 一次性）——提示「链接已过期，请重新播放」
- MSE 注入钩子（方案二留作 v2，架构上预留嗅探源抽象）
- 下载历史管理页

## 组件划分

| 组件 | 位置 | 职责 |
|------|------|------|
| Sniffer | `background/media-sniffer.js` | 监听 webRequest，识别媒体请求，按 tab 归组，写 storage.session |
| Downloader | `background/media-downloader.js` | fetch 拉取 / m3u8 解析调度 / AES 解密 / 进度与重试管理 |
| OffscreenSaver | `offscreen/downloader.html` + `downloader.js` | 接收分块数据拼 blob，生成 blob URL，回传 SW 触发下载 |
| MediaTool UI | `tools/media-tool/`（继承 BaseTool） | popup 内列表 + 进度界面 |
| 纯函数库 | `tools/media-tool/lib/` | m3u8 解析、URL 分类、文件名清洗、流拼接；不 import chrome API |

边界：Sniffer 只发现、Downloader 只取回、OffscreenSaver 只落盘；lib/ 纯函数与 chrome API
彻底解耦，沿用 json-tool 的 node 直跑测试模式（`tests/run-tests.js`）。

## 嗅探逻辑（Sniffer）

- 监听 `webRequest.onBeforeRequest`（URL、tabId、documentUrl）+ `onHeadersReceived`
  （Content-Type、Content-Length），`urls: ["<all_urls>"]`，代码内过滤
- 识别规则（命中任一）：
  - URL pathname 匹配扩展名 `.mp4 .webm .m3u8 .ts .m4s .flv .mov`
  - Content-Type 属于 `video/*`、`audio/*`、`application/x-mpegurl`、
    `application/vnd.apple.mpegurl`
- 说明：`.mpd`/DASH manifest 不在 v1 识别范围（无对应下载处理，收了只会得到无用的
  manifest 文件）；B站式整文件 m4s 不经 mpd、直接按分流感知，不受影响
- 聚合：同 tab 出现过 m3u8 后，后续 `.ts/.m4s` 分片归并到该 m3u8 名下，列表显示单条
  「HLS 流（N 分片）」；无 m3u8 上下文的整文件 m4s 按 Content-Type 标注「视频流」「音频流」
- 降噪：Content-Length < 100KB 丢弃；同 tab 同 URL 去重；每 tab 上限 50 条（超出挤掉最旧）
- 每条记录保存 documentUrl（发起请求的页面地址），供下载时补 Referer
- 存储 `chrome.storage.session`（SW 重启不丢，浏览器关闭自动清）；badge 数量同步更新

MediaRecord 结构（storage.session 中按 `media:{tabId}` 分键存储）：
`{ id, url, documentUrl, tabId, kind: 'direct'|'hls'|'video-stream'|'audio-stream',
contentType, contentLength, filename, firstSeenAt }`

## 下载逻辑（Downloader + OffscreenSaver)

- 直链：SW `fetch(url, { credentials: 'include' })`（host 权限下 Cookie 自动附带）→
  分块（≤16MB/块，消息传输上限内）传 offscreen → 拼 blob → 回传 blob URL →
  SW 调 `chrome.downloads.download({ url, filename, saveAs: false })`
- HLS：fetch m3u8 → master 则选最高码率变体（递归一层）→ 收集分片 → 并发拉取（限 6）→
  AES-128 则 WebCrypto `AES-CBC` 解密 → TS 顺序拼接 / fMP4 init 段打头拼接 → 同上落盘
- 防盗链：下载开始时创建 `declarativeNetRequest` 会话规则（modifyHeaders 设 Referer 为
  嗅探记录的 documentUrl，条件限定目标媒体域），下载结束/失败即删规则
- 重试：单分片失败重试 2 次；整任务失败标记 entry 状态为 failed + 原因
- 进度：`{ received, total, speed, state }` 写 storage.session（键 `download:{id}`），
  popup 重开可重新挂进度；取消用 AbortController
- offscreen 生命周期：按需 `chrome.offscreen.createDocument`，下载进入 in_progress 后释放
- 内存极限：blob 全程驻内存，> ~2GB 大概率失败；UI 对超大条目提示风险

## UI 设计（MediaTool）

- popup 工具列表新增卡片「媒体嗅探」；进入后展示当前 tab 的媒体列表
- 条目：类型图标 + 文件名 + 大小 + 下载按钮；下载中显示进度条/速度/取消
- 顶部「清空列表」；按发现时间倒序
- 文件名取 URL pathname，清洗非法字符；冲突由 chrome.downloads 自动改名

## Manifest 变更

- permissions 新增：`webRequest`、`downloads`、`declarativeNetRequest`、`offscreen`
- host_permissions 不变（已有 `<all_urls>`）
- listing 措辞：「嗅探并保存浏览器正在加载的无 DRM 媒体文件」，不点网站名

## 测试策略

- lib 纯函数 node 测试：m3u8 解析（master/media/AES-128/变体选择）、URL 分类、
  文件名清洗、TS/fMP4 拼接
- 手工验收矩阵：直链 mp4 站点、B站视频页（视频流+音频流各一条）、公开 HLS 测试源、
  AES-128 测试源、过期链接报错路径
- 权限变更后回归 Cookie / XPath / JSON 三工具

## 风险与开放问题

- webRequest + `<all_urls>` 提审可能触发人工审查：接受，措辞已保守
- SW 生命周期：长下载依赖活跃 fetch/消息保活；失败靠重试兜底
- 分片签名流不可下载属预期限制，UI 明示
