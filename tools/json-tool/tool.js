// JSON 树图工具 - popup 启动器（全屏页入口为 index.html / main.js）
import { BaseTool } from '../base-tool.js';
import { TOOL_TYPES } from '../../utils/constants.js';

export class JsonTool extends BaseTool {
  constructor() {
    super('JSON 树图工具', TOOL_TYPES.JSON_TREE);
    this.name = 'JSON 树图工具';
    this.description = 'JSON 可视化树图，支持搜索与编辑器联动，点击打开全屏页面';
    this.icon = '🌳';
  }

  // 点击工具卡片直接打开全屏页（popup.js openExternal 钩子），已打开则复用并聚焦
  async openExternal() {
    try {
      const url = chrome.runtime.getURL('tools/json-tool/index.html');
      const tabs = await chrome.tabs.query({ url });
      if (tabs.length > 0) {
        await chrome.tabs.update(tabs[0].id, { active: true });
        const win = await chrome.windows.get(tabs[0].windowId);
        if (!win.focused) await chrome.windows.update(tabs[0].windowId, { focused: true });
      } else {
        await chrome.tabs.create({ url });
      }
      window.close();
      return true;
    } catch (e) {
      console.error('[JsonTool] 打开全屏页失败:', e);
      return false;
    }
  }

  async initialize() {}

  async execute() {
    const ok = await this.openExternal();
    return { success: ok, message: ok ? '已打开 JSON 树图页面' : '打开 JSON 树图页面失败' };
  }

  async destroy() {}
}
