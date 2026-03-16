// 工具基类 - 所有工具必须继承此类
import { ToolMessenger } from '../utils/messaging.js';

export class BaseTool {
  constructor(toolName, toolId) {
    this.toolName = toolName;
    this.toolId = toolId;
    this.element = null;
    this.isActive = false;
  }

  // 必须实现的方法
  async initialize() {
    throw new Error('initialize() must be implemented by subclass');
  }

  async execute() {
    throw new Error('execute() must be implemented by subclass');
  }

  async destroy() {
    throw new Error('destroy() must be implemented by subclass');
  }

  // 可选的钩子方法
  onActivate() {
    this.isActive = true;
  }

  onDeactivate() {
    this.isActive = false;
  }

  // 通用工具方法
  async sendMessage(type, action, data) {
    return ToolMessenger.sendMessage(type, action, data);
  }

  showError(message) {
    console.error(`[${this.toolName}] Error:`, message);
    // 可以扩展为UI显示错误
  }

  log(message) {
    console.log(`[${this.toolName}] ${message}`);
  }
}
