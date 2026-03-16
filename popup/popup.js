// 主弹窗逻辑 - 工具管理和路由
import { TOOL_TYPES, UI_EVENTS } from '../utils/constants.js';
import { CookieTool } from '../tools/cookie-tool/tool.js';

class ToolManager {
  constructor() {
    this.tools = new Map();
    this.currentView = 'tool-list-view';
    this.currentTool = null;
    this.initialize();
  }

  async initialize() {
    this.registerTools();
    this.setupEventListeners();
    this.renderToolList();
  }

  registerTools() {
    // 注册所有工具
    this.registerTool(new CookieTool());
    // 未来工具在这里注册：
    // this.registerTool(new FutureTool());
  }

  registerTool(tool) {
    this.tools.set(tool.toolId, tool);
  }

  setupEventListeners() {
    document.getElementById('back-button').addEventListener('click', () => {
      this.showToolList();
    });
  }

  renderToolList() {
    const toolListContainer = document.getElementById('tool-list');
    toolListContainer.innerHTML = '';

    this.tools.forEach((tool, toolId) => {
      const toolCard = this.createToolCard(tool);
      toolListContainer.appendChild(toolCard);
    });
  }

  createToolCard(tool) {
    const card = document.createElement('div');
    card.className = 'tool-card';
    card.innerHTML = `
      <h3>
        <span class="tool-icon">${tool.icon}</span>
        ${tool.name}
      </h3>
      <p>${tool.description}</p>
    `;

    card.addEventListener('click', async () => {
      // 对于Cookie工具，直接执行复制操作，不跳转
      if (tool.name === '获取当前网页cookie') {
        await this.executeDirectTool(tool);
      } else {
        this.openTool(tool.toolId);
      }
    });

    return card;
  }

  async executeDirectTool(tool) {
    // 显示加载提示
    this.showDirectMessage('正在获取Cookie...', 'info');

    try {
      await tool.initialize();
      const result = await tool.execute();

      if (result && result.success) {
        this.showDirectMessage(result.message, 'info');
        // 复制成功后1.5秒自动关闭弹窗
        setTimeout(() => {
          window.close();
        }, 1500);
      } else {
        this.showDirectMessage(result ? result.message : '操作失败', 'error');
      }
    } catch (error) {
      console.error('Error executing tool:', error);
      this.showDirectMessage('操作失败: ' + error.message, 'error');
    }
  }

  showDirectMessage(message, type) {
    const toolListView = document.getElementById('tool-list-view');
    const existing = document.getElementById('direct-message');
    if (existing) {
      existing.remove();
    }

    const msgDiv = document.createElement('div');
    msgDiv.id = 'direct-message';
    msgDiv.className = `direct-message direct-${type}`;
    msgDiv.textContent = message;
    toolListView.appendChild(msgDiv);
  }

  async openTool(toolId) {
    const tool = this.tools.get(toolId);
    if (!tool) {
      console.error(`Tool not found: ${toolId}`);
      return;
    }

    try {
      // 初始化工具
      await tool.initialize();

      // 更新UI
      this.showToolDetailView(tool);

      // 保持引用以便后续销毁
      this.currentTool = tool;
    } catch (error) {
      console.error('Error opening tool:', error);
      this.showError('无法打开工具');
    }
  }

  showToolDetailView(tool) {
    document.getElementById('tool-list-view').classList.add('hidden');
    document.getElementById('tool-detail-view').classList.remove('hidden');
    document.getElementById('tool-title').textContent = tool.name;

    const container = document.getElementById('tool-container');
    container.innerHTML = '';

    if (!tool.element || !(tool.element instanceof Node)) {
      console.error('[ToolManager] tool.element无效:', tool.element);
      this.showError('工具初始化失败');
      return;
    }

    container.appendChild(tool.element);
  }

  showToolList() {
    // 清理当前工具
    if (this.currentTool) {
      try {
        this.currentTool.destroy();
      } catch (error) {
        console.error('Error destroying tool:', error);
      }
      this.currentTool = null;
    }

    // 切换视图
    document.getElementById('tool-detail-view').classList.add('hidden');
    document.getElementById('tool-list-view').classList.remove('hidden');
    this.currentView = 'tool-list-view';
  }

  showError(message) {
    const container = document.getElementById('tool-container');
    container.innerHTML = `
      <div class="error-message">
        <p>${message}</p>
      </div>
    `;
  }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
  new ToolManager();
});
