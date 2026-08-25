// Service Worker - 处理后台任务和消息路由
import { MessageHandler } from '../utils/messaging.js';
import { MediaSniffer } from './media-sniffer.js';
import { MediaDownloader } from './media-downloader.js';

// 初始化消息处理器
const messageHandler = new MessageHandler();

// 媒体嗅探引擎
const sniffer = new MediaSniffer();
sniffer.start();
sniffer.registerHandlers(messageHandler);

// 媒体下载器
const downloader = new MediaDownloader(sniffer);
downloader.registerHandlers(messageHandler);

// 监听来自content scripts和popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // offscreen 专用通道：不进入 MessageHandler 路由
  if (request && request.target === 'offscreen') return false;
  messageHandler.handle(request, sender, sendResponse);
  return true; // 保持消息通道开启
});

// 监听插件安装事件
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('小工具箱已安装');
  }
});
