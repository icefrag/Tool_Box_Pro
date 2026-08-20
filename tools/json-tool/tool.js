// JSON 树图工具 - popup 启动器（全屏页入口为 index.html / main.js）
import { BaseTool } from '../base-tool.js';
import { TOOL_TYPES } from '../../utils/constants.js';

export class JsonTool extends BaseTool {
  constructor() {
    super('JSON 树图工具', TOOL_TYPES.JSON_TREE);
    this.name = 'JSON 树图工具';
    this.description = 'JSON 可视化树图，支持搜索与编辑器联动';
    this.icon = '🌳';
    this.createElement();
  }

  createElement() {
    this.element = document.createElement('div');
    this.element.className = 'json-tool-launcher';
    this.element.innerHTML = `
      <p class="json-tool-tip">JSON 树图工具在全屏页面中打开，适合编辑与查看大型 JSON。</p>
      <button id="open-json-tool" class="primary-button">打开 JSON 树图页面</button>
    `;
    this.element.querySelector('#open-json-tool').addEventListener('click', () => this.execute());
  }

  async initialize() {
    this.log('JSON 树图工具初始化完成');
  }

  async execute() {
    const url = chrome.runtime.getURL('tools/json-tool/index.html');
    const tabs = await chrome.tabs.query({ url });
    if (tabs.length > 0) {
      await chrome.tabs.update(tabs[0].id, { active: true });
      const win = await chrome.windows.get(tabs[0].windowId);
      if (!win.focused) await chrome.windows.update(tabs[0].windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url });
    }
    return { success: true, message: '已打开 JSON 树图页面' };
  }

  async destroy() {
    this.log('JSON 树图工具已销毁');
    this.element = null;
  }
}
