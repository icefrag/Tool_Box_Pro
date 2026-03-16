// 消息通信工具 - 统一的消息路由和处理
export class MessageHandler {
  constructor() {
    this.handlers = new Map();
    this.registerDefaultHandlers();
  }

  registerDefaultHandlers() {
    // 可以在这里注册全局处理器
  }

  register(type, handler) {
    this.handlers.set(type, handler);
  }

  unregister(type) {
    this.handlers.delete(type);
  }

  async handle(request, sender, sendResponse) {
    const { type, action } = request;

    if (!type) {
      sendResponse({ error: 'Missing message type' });
      return;
    }

    const handler = this.handlers.get(type);
    if (!handler) {
      sendResponse({ error: `Unknown message type: ${type}` });
      return;
    }

    try {
      const response = await handler(request, sender);
      sendResponse({ success: true, data: response });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  }
}

// 工具消息助手
export class ToolMessenger {
  static async sendMessage(type, action, data = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, action, ...data }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response.data);
        }
      });
    });
  }

  static async sendToTab(tabId, type, action, data = {}) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { type, action, ...data }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        // content-script 返回格式：{ success: boolean, data/error }
        if (response.success === false) {
          reject(new Error(response.error || '未知错误'));
        } else {
          resolve(response.data);
        }
      });
    });
  }

  static async sendToActiveTab(type, action, data = {}) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      throw new Error('No active tab found');
    }
    return this.sendToTab(tab.id, type, action, data);
  }
}
