// XPath Helper 工具实现
import { BaseTool } from '../base-tool.js';
import { TOOL_TYPES } from '../../utils/constants.js';

// 配置项
const COPY_OPTIONS = {
  XPATH_ONLY: 'xpath',
  SELECTOR_ONLY: 'selector',
  BOTH: 'both'
};

const STORAGE_KEY = 'xpath-helper-copy-mode';

export class XpathTool extends BaseTool {
  constructor() {
    super('XPath Helper', TOOL_TYPES.XPATH);

    this.name = 'XPath Helper';
    this.description = '点击页面元素获取 XPath 和 CSS Selector';
    this.icon = '🔍';

    this.copyMode = COPY_OPTIONS.BOTH; // 默认两者都复制
    this.isSelectionActive = false; // Track whether selection mode is active
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
      <div class="copy-option-group">
        <label class="copy-option-label">自动复制内容：</label>
        <div class="copy-options">
          <label class="copy-option">
            <input type="radio" name="copy-mode" value="${COPY_OPTIONS.XPATH_ONLY}">
            <span>仅 XPath</span>
          </label>
          <label class="copy-option">
            <input type="radio" name="copy-mode" value="${COPY_OPTIONS.SELECTOR_ONLY}">
            <span>仅 Selector</span>
          </label>
          <label class="copy-option">
            <input type="radio" name="copy-mode" value="${COPY_OPTIONS.BOTH}" checked>
            <span>两者都复制</span>
          </label>
        </div>
      </div>
      <div class="tool-controls">
        <button id="start-xpath" class="primary-button">开始选择元素</button>
      </div>
      <div id="xpath-status" class="xpath-status hidden"></div>
      <div id="xpath-result" class="xpath-result hidden">
        <div class="xpath-result-header">✅ 已选择: <span id="result-element-tag"></span></div>
        <div class="xpath-result-row">
          <div class="xpath-result-label">XPath:</div>
          <code id="result-xpath" class="xpath-result-code"></code>
          <button class="xpath-result-copy-btn" data-type="xpath">复制</button>
        </div>
        <div class="xpath-result-row">
          <div class="xpath-result-label">Selector:</div>
          <code id="result-selector" class="xpath-result-code"></code>
          <button class="xpath-result-copy-btn" data-type="selector">复制</button>
        </div>
      </div>
    `;

    this.loadSettings();
    this.setupEventListeners();
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get(STORAGE_KEY);
      if (result[STORAGE_KEY]) {
        this.copyMode = result[STORAGE_KEY];
        const radio = this.element.querySelector(`input[name="copy-mode"][value="${this.copyMode}"]`);
        if (radio) radio.checked = true;
      }
    } catch (err) {
      console.log('Failed to load settings:', err);
    }
  }

  saveSettings(copyMode) {
    this.copyMode = copyMode;
    chrome.storage.sync.set({ [STORAGE_KEY]: copyMode }).catch(err => {
      console.log('Failed to save settings:', err);
    });
  }

  setupEventListeners() {
    const startBtn = this.element.querySelector('#start-xpath');
    startBtn.addEventListener('click', () => {
      if (this.isSelectionActive) {
        this.stopSelection();
      } else {
        this.startSelection();
      }
    });

    // 配置选项变化监听
    const radioButtons = this.element.querySelectorAll('input[name="copy-mode"]');
    radioButtons.forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.saveSettings(e.target.value);
      });
    });

    // Bind copy button click handlers
    this.element.querySelectorAll('.xpath-result-copy-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const type = e.target.dataset.type;
        const text = type === 'xpath'
          ? this.element.querySelector('#result-xpath').textContent
          : this.element.querySelector('#result-selector').textContent;
        navigator.clipboard.writeText(text).then(() => {
          e.target.textContent = '已复制!';
          setTimeout(() => e.target.textContent = '复制', 1500);
        });
      });
    });

    // Listen for selection stopped notifications (e.g., from ESC key in page)
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'selectionStopped' && this.isSelectionActive) {
        this.updateUiToInactive();
        this.isSelectionActive = false;
        sendResponse({ received: true });
      }
      return true;
    });

    // Listen for selection result from content script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'selectionResult' && this.isSelectionActive) {
        this.showResult(message.elementTag, message.xpath, message.selector);
        sendResponse({ received: true });
      }
      return true;
    });
  }

  async initialize() {
    // If element was destroyed (set to null), recreate it
    if (!this.element) {
      this.createElement();
    }

    // Check if selection is already active when popup is reopened
    this.detectSelectionState();

    this.log('XPath Helper 工具初始化完成');
  }

  async detectSelectionState() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id) {
        // Ping content script to see if it's running
        chrome.tabs.sendMessage(tab.id, { action: 'ping' }, (response) => {
          if (chrome.runtime.lastError) {
            // No connection = selection not active
            this.isSelectionActive = false;
            this.updateUiToInactive();
          } else {
            // Connection successful = selection might be active
            // Assume it's active - user can click stop to exit
            this.isSelectionActive = true;
            this.updateUiToActive();
          }
        });
      }
    } catch (err) {
      // Ignore detection errors, default to inactive
      this.isSelectionActive = false;
    }
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

      // 发送消息，携带复制模式配置
      await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, {
          action: 'startSelection',
          copyMode: this.copyMode
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });

      // Update UI to active state
      this.updateUiToActive();
      this.isSelectionActive = true;

    } catch (error) {
      console.error('XPath Helper 启动失败:', error);
      statusEl.textContent = '启动失败: ' + error.message;
      statusEl.className = 'xpath-status error';
      startBtn.textContent = '开始选择元素';
      startBtn.disabled = false;
    }
  }

  async stopSelection() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id) {
        await new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tab.id, { action: 'stopSelection' }, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(response);
            }
          });
        });
      }

      // Restore UI to inactive state
      this.updateUiToInactive();
      this.isSelectionActive = false;

    } catch (error) {
      console.error('XPath Helper 停止失败:', error);
      const statusEl = this.element.querySelector('#xpath-status');
      statusEl.textContent = '停止失败: ' + error.message;
      statusEl.className = 'xpath-status error';
    }
  }

  updateUiToInactive() {
    const statusEl = this.element.querySelector('#xpath-status');
    const startBtn = this.element.querySelector('#start-xpath');
    const radioButtons = this.element.querySelectorAll('input[name="copy-mode"]');

    statusEl.classList.add('hidden');
    startBtn.textContent = '开始选择元素';
    startBtn.disabled = false;

    // Re-enable copy option radios
    radioButtons.forEach(radio => {
      radio.disabled = false;
    });
  }

  updateUiToActive() {
    const statusEl = this.element.querySelector('#xpath-status');
    const startBtn = this.element.querySelector('#start-xpath');
    const radioButtons = this.element.querySelectorAll('input[name="copy-mode"]');

    statusEl.textContent = '已进入选择模式，请点击页面元素（ESC退出）';
    statusEl.className = 'xpath-status success';
    statusEl.classList.remove('hidden');
    startBtn.textContent = '停止选择';
    startBtn.disabled = false;

    // Disable copy option radios to prevent changes during selection
    radioButtons.forEach(radio => {
      radio.disabled = true;
    });
  }

  showResult(elementTag, xpath, selector) {
    const resultEl = this.element.querySelector('#xpath-result');
    const elementTagEl = this.element.querySelector('#result-element-tag');
    const xpathEl = this.element.querySelector('#result-xpath');
    const selectorEl = this.element.querySelector('#result-selector');
    const statusEl = this.element.querySelector('#xpath-status');

    elementTagEl.textContent = elementTag;
    xpathEl.textContent = xpath;
    selectorEl.textContent = selector;
    resultEl.classList.remove('hidden');
    statusEl.classList.add('hidden');

    this.isSelectionActive = false;
    this.updateUiToInactive();
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
