// XPath Helper 工具实现
import { BaseTool } from '../base-tool.js';
import { TOOL_TYPES } from '../../utils/constants.js';

export class XpathTool extends BaseTool {
  constructor() {
    super('XPath Helper', TOOL_TYPES.XPATH);

    this.name = 'XPath Helper';
    this.description = '点击页面元素获取 XPath 和 CSS Selector';
    this.icon = '🔍';

    this.element = null;
    this.createElement();
  }

  createElement() {
    this.element = document.createElement('div');
    this.element.className = 'xpath-tool';
    this.element.innerHTML = `
      <div class="xpath-tool-intro">
        <p>点击下方按钮开始选择元素，页面会进入选择模式</p>
      </div>
      <div class="tool-controls">
        <button id="start-xpath" class="primary-button">开始选择元素</button>
      </div>
      <div id="xpath-status" class="xpath-status hidden"></div>
    `;

    this.setupEventListeners();
  }

  setupEventListeners() {
    const startBtn = this.element.querySelector('#start-xpath');
    startBtn.addEventListener('click', () => this.startSelection());
  }

  async initialize() {
    this.log('XPath Helper 工具初始化完成');
  }

  async injectContentScript() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      throw new Error('未找到活动标签页');
    }

    // 检查是否是受限页面
    const url = tab.url || '';
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('edge://')) {
      throw new Error('无法在浏览器内部页面上运行');
    }

    try {
      // 注入脚本
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/content.js']
      });

      // 注入样式
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['content/content.css']
      });

      return tab.id;
    } catch (err) {
      // 脚本可能已经注入，忽略错误
      console.log('Script injection:', err);
      return tab.id;
    }
  }

  async startSelection() {
    const statusEl = this.element.querySelector('#xpath-status');
    const startBtn = this.element.querySelector('#start-xpath');

    statusEl.textContent = '正在启动...';
    statusEl.className = 'xpath-status info';
    statusEl.classList.remove('hidden');

    try {
      const tabId = await this.injectContentScript();

      // 等待脚本就绪
      await new Promise(resolve => setTimeout(resolve, 150));

      // 发送消息
      await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, { action: 'startSelection' }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });

      // 更新状态
      statusEl.textContent = '已进入选择模式，请点击页面元素（ESC退出）';
      statusEl.className = 'xpath-status success';
      startBtn.textContent = '选择模式进行中...';
      startBtn.disabled = true;

      // 关闭弹窗，让用户去页面上选择
      setTimeout(() => {
        window.close();
      }, 500);

    } catch (error) {
      console.error('XPath Helper 启动失败:', error);
      statusEl.textContent = '启动失败: ' + error.message;
      statusEl.className = 'xpath-status error';
      startBtn.textContent = '开始选择元素';
      startBtn.disabled = false;
    }
  }

  async execute() {
    await this.startSelection();
    return { success: true, message: '已进入选择模式' };
  }

  async destroy() {
    // 尝试停止选择模式
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id) {
        chrome.tabs.sendMessage(tab.id, { action: 'stopSelection' }).catch(() => {});
      }
    } catch (err) {
      // 忽略错误
    }

    this.log('XPath Helper 工具已销毁');
    this.element = null;
  }
}
