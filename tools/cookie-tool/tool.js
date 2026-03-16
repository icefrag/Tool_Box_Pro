// Cookie工具实现
import { BaseTool } from '../base-tool.js';
import { TOOL_TYPES } from '../../utils/constants.js';

export class CookieTool extends BaseTool {
  constructor() {
    super('Cookie Tool', TOOL_TYPES.COOKIE);

    this.name = '获取当前网页cookie';
    this.description = '点击直接复制当前页面的Cookie';
    this.icon = '🍪';

    this.cookies = [];
    this.element = null;

    // 创建DOM元素
    this.createElement();
  }

  createElement() {
    this.element = document.createElement('div');
    this.element.className = 'cookie-tool';
    this.element.innerHTML = `
      <div class="tool-controls">
        <button id="fetch-and-copy" class="primary-button">获取并复制Cookie</button>
      </div>

      <div id="cookie-loading" class="loading hidden">
        <span>正在获取Cookie...</span>
      </div>

      <div id="cookie-message" class="cookie-message hidden"></div>

      <div id="cookie-error" class="error-message hidden">
        <p>获取Cookie失败</p>
        <p id="error-details" class="error-details"></p>
      </div>
    `;

    this.setupEventListeners();
  }

  setupEventListeners() {
    const button = this.element.querySelector('#fetch-and-copy');
    button.addEventListener('click', () => this.fetchAndCopyCookies());
  }

  async initialize() {
    this.log('Cookie工具初始化完成');
    this.resetUI();
  }

  resetUI() {
    if (!this.element) return;

    const messageEl = this.element.querySelector('#cookie-message');
    const errorEl = this.element.querySelector('#cookie-error');
    const loadingEl = this.element.querySelector('#cookie-loading');

    messageEl?.classList.add('hidden');
    errorEl?.classList.add('hidden');
    loadingEl?.classList.add('hidden');

    this.cookies = [];
  }

  async fetchAndCopyCookies() {
    this.resetUI();
    if (this.element) {
      this.element.querySelector('#cookie-loading')?.classList.remove('hidden');
    }

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab) {
        throw new Error('未找到活动标签页');
      }

      const url = new URL(tab.url);
      this.cookies = await chrome.cookies.getAll({ url: url.href });

      if (this.element) {
        this.element.querySelector('#cookie-loading')?.classList.add('hidden');
      }

      if (this.cookies.length === 0) {
        this.showMessage('当前页面没有Cookie');
        return { success: false, message: '当前页面没有Cookie' };
      }

      const cookieString = this.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
      await navigator.clipboard.writeText(cookieString);

      const message = `已复制 ${this.cookies.length} 个Cookie到剪贴板`;
      this.showMessage(message);
      this.log(`从${url.hostname}获取到${this.cookies.length}个Cookie并已复制`);

      return { success: true, message };
    } catch (error) {
      console.error('[CookieTool] 获取Cookie失败:', error);
      const message = error.message || '未知错误';
      if (this.element) {
        const loadingEl = this.element.querySelector('#cookie-loading');
        const errorEl = this.element.querySelector('#cookie-error');
        const errorDetailsEl = this.element.querySelector('#error-details');
        loadingEl?.classList.add('hidden');
        errorEl?.classList.remove('hidden');
        if (errorDetailsEl) errorDetailsEl.textContent = message;
      }
      return { success: false, message: '获取Cookie失败: ' + message };
    }
  }

  showMessage(text) {
    if (!this.element) return;
    const messageEl = this.element.querySelector('#cookie-message');
    if (messageEl) {
      messageEl.textContent = text;
      messageEl.classList.remove('hidden');
    }
  }

  async execute() {
    return this.fetchAndCopyCookies();
  }

  async destroy() {
    this.log('Cookie工具已销毁');
    this.resetUI();
    this.element = null;
    this.cookies = [];
  }
}
