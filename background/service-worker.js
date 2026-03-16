// Service Worker - 处理后台任务和消息路由
import { MessageHandler } from '../utils/messaging.js';

// 初始化消息处理器
const messageHandler = new MessageHandler();

// 监听来自content scripts和popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  messageHandler.handle(request, sender, sendResponse);
  return true; // 保持消息通道开启
});

// 监听插件安装事件
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('小工具箱已安装');
  }
});
