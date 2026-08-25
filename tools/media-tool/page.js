// 媒体嗅探独立页脚本（必须外置：扩展 CSP 禁止内联脚本）
import { MediaTool } from './tool.js';

// 聚合视图：展示所有标签页嗅探到的媒体，无需绑定具体标签页
const tool = new MediaTool({ standalone: true });
document.getElementById('media-tool-root').appendChild(tool.element);
await tool.initialize();
window.addEventListener('beforeunload', () => tool.destroy());
