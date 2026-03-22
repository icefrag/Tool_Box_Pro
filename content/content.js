// XPath Helper Content Script - 页面交互层
(function() {
  'use strict';

  if (window._xpathHelperInitialized) return;
  window._xpathHelperInitialized = true;

  const state = {
    selectedElement: null,
    previousHighlight: null,
    selectionActive: false,
    tooltip: null,
    lastClickTarget: null
  };

  // ============================================
  // XPath Generation Functions
  // ============================================

  function getAbsoluteXPath(element) {
    if (!element || element.nodeType !== 1) return '';

    const parts = [];
    let current = element;

    while (current && current.nodeType === 1) {
      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) index++;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(`${current.tagName.toLowerCase()}[${index}]`);
      current = current.parentElement;
    }

    return '/' + parts.join('/');
  }

  // ============================================
  // CSS Selector Generation
  // ============================================

  function getCssSelector(element) {
    if (!element || element.nodeType !== 1) return '';

    if (element.id) {
      return '#' + CSS.escape(element.id);
    }

    const parts = [];
    let current = element;

    while (current && current.nodeType === 1 && current !== document.body && current !== document.documentElement) {
      let selector = current.tagName.toLowerCase();

      let className = '';
      if (current.className && typeof current.className === 'string') {
        className = current.className;
      } else if (current.className && 'baseVal' in current.className) {
        className = current.className.baseVal;
      }

      if (className && className.trim()) {
        const classes = className.trim().split(/\s+/).filter(c => c);
        if (classes.length > 0) {
          selector += '.' + classes.slice(0, 2).map(c => CSS.escape(c)).join('.');
        }
      }

      if (current.parentElement) {
        let index = 1;
        let sibling = current.previousElementSibling;
        while (sibling) {
          if (sibling.tagName === current.tagName) index++;
          sibling = sibling.previousElementSibling;
        }

        const totalSiblings = Array.from(current.parentElement.children).filter(s => s.tagName === current.tagName).length;
        if (totalSiblings > 1) {
          selector += `:nth-child(${index})`;
        }
      }

      parts.unshift(selector);
      current = current.parentElement;
    }

    if (document.body) {
      parts.unshift('body');
    } else if (document.documentElement) {
      parts.unshift('html');
    }

    return parts.join(' > ');
  }

  // ============================================
  // Tooltip UI
  // ============================================

  function createTooltip() {
    if (state.tooltip) return state.tooltip;

    state.tooltip = document.createElement('div');
    state.tooltip.id = 'xpath-helper-tooltip';
    state.tooltip.innerHTML = `
      <div class="xpath-helper-content">
        <div class="xpath-helper-header">
          <span class="xpath-helper-title">XPath Helper</span>
          <span class="xpath-helper-hint">ESC 退出</span>
        </div>
        <div class="xpath-helper-paths">
          <div class="xpath-helper-path-group">
            <span class="xpath-helper-label">XPath:</span>
            <code class="xpath-helper-xpath"></code>
            <button class="xpath-helper-copy-btn" data-type="xpath">复制</button>
          </div>
          <div class="xpath-helper-path-group">
            <span class="xpath-helper-label">Selector:</span>
            <code class="xpath-helper-selector"></code>
            <button class="xpath-helper-copy-btn" data-type="selector">复制</button>
          </div>
        </div>
        <div class="xpath-helper-hint-bottom">点击页面元素获取路径</div>
      </div>
    `;
    document.body.appendChild(state.tooltip);

    state.tooltip.querySelectorAll('.xpath-helper-copy-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const type = btn.dataset.type;
        const text = type === 'xpath'
          ? state.tooltip.querySelector('.xpath-helper-xpath').textContent
          : state.tooltip.querySelector('.xpath-helper-selector').textContent;
        navigator.clipboard.writeText(text).then(() => {
          btn.textContent = '已复制!';
          setTimeout(() => btn.textContent = '复制', 1500);
        });
      });
    });

    return state.tooltip;
  }

  function showTooltip(element) {
    const tooltip = createTooltip();
    tooltip.style.display = 'block';

    const xpath = getAbsoluteXPath(element);
    const selector = getCssSelector(element);

    tooltip.querySelector('.xpath-helper-xpath').textContent = xpath;
    tooltip.querySelector('.xpath-helper-selector').textContent = selector;
    tooltip.querySelector('.xpath-helper-hint-bottom').textContent = '已选择: ' + element.tagName.toLowerCase();
  }

  function removeTooltip() {
    if (state.tooltip) {
      state.tooltip.remove();
      state.tooltip = null;
    }
  }

  // ============================================
  // Highlighting
  // ============================================

  function highlightElement(element) {
    if (state.previousHighlight) {
      state.previousHighlight.classList.remove('xpath-helper-highlight');
    }
    element.classList.add('xpath-helper-highlight');
    state.previousHighlight = element;
  }

  // ============================================
  // Event Handlers
  // ============================================

  // 在 mousedown 时记录目标（capture 阶段）
  function handleMouseDownCapture(event) {
    if (!state.selectionActive) return;
    if (state.tooltip && (state.tooltip.contains(event.target) || event.target === state.tooltip)) return;

    // 记录点击目标
    state.lastClickTarget = event.target;
  }

  // 在 click 时处理（bubble 阶段）
  function handleClick(event) {
    if (!state.selectionActive) return;
    if (state.tooltip && (state.tooltip.contains(event.target) || event.target === state.tooltip)) return;

    // 使用 mousedown 时记录的目标
    let target = state.lastClickTarget;

    // 如果没有记录，尝试用 elementFromPoint
    if (!target) {
      target = document.elementFromPoint(event.clientX, event.clientY);
    }

    // 确保获取的是元素节点
    while (target && target.nodeType !== 1) {
      target = target.parentNode;
    }

    if (!target || target === document.documentElement || target === document.body) return;
    if (target.id === 'xpath-helper-tooltip') return;

    event.preventDefault();
    event.stopPropagation();

    state.selectedElement = target;
    highlightElement(target);
    showTooltip(target);

    // 清除记录
    state.lastClickTarget = null;
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape' && state.selectionActive) {
      stopSelection();
    }
  }

  // ============================================
  // Public API
  // ============================================

  function startSelection() {
    if (state.selectionActive) return { success: true };

    state.selectionActive = true;
    document.body.style.cursor = 'crosshair';

    // 同时监听 mousedown(capture) 和 click
    document.addEventListener('mousedown', handleMouseDownCapture, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeyDown);

    createTooltip();
    state.tooltip.style.display = 'block';

    state.selectedElement = null;
    state.lastClickTarget = null;
    if (state.previousHighlight) {
      state.previousHighlight.classList.remove('xpath-helper-highlight');
      state.previousHighlight = null;
    }

    return { success: true };
  }

  function stopSelection() {
    state.selectionActive = false;
    document.body.style.cursor = '';
    document.removeEventListener('mousedown', handleMouseDownCapture, true);
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('keydown', handleKeyDown);

    if (state.previousHighlight) {
      state.previousHighlight.classList.remove('xpath-helper-highlight');
      state.previousHighlight = null;
    }
    state.selectedElement = null;
    state.lastClickTarget = null;

    removeTooltip();
    return { success: true };
  }

  // ============================================
  // Message Listener
  // ============================================

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'startSelection') {
      sendResponse(startSelection());
    } else if (request.action === 'stopSelection') {
      sendResponse(stopSelection());
    }
    return true;
  });

})();
