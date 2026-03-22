// XPath Helper Content Script - 页面交互层

// Store selected element
window._xpathHelperSelectedElement = null;

// Store previous highlight
let _previousHighlight = null;

// Is selection mode active
let _selectionActive = false;

// XPath tooltip element
let _tooltip = null;

// ============================================
// XPath Generation Functions
// ============================================

function getAbsoluteXPath(element) {
  if (!element || element.nodeType !== 1) return '';

  let parts = [];
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
  if (_tooltip) return _tooltip;

  _tooltip = document.createElement('div');
  _tooltip.id = 'xpath-helper-tooltip';
  _tooltip.innerHTML = `
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
  document.body.appendChild(_tooltip);

  // Bind copy button events
  _tooltip.querySelectorAll('.xpath-helper-copy-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const type = btn.dataset.type;
      const text = type === 'xpath'
        ? _tooltip.querySelector('.xpath-helper-xpath').textContent
        : _tooltip.querySelector('.xpath-helper-selector').textContent;
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = '已复制!';
        setTimeout(() => btn.textContent = '复制', 1500);
      });
    });
  });

  return _tooltip;
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
  if (_tooltip) {
    _tooltip.remove();
    _tooltip = null;
  }
}

// ============================================
// Highlighting
// ============================================

function highlightElement(element) {
  if (_previousHighlight) {
    _previousHighlight.classList.remove('xpath-helper-highlight');
  }

  element.classList.add('xpath-helper-highlight');
  _previousHighlight = element;
}

// ============================================
// Event Handlers
// ============================================

function handleMouseDown(event) {
  if (_tooltip && (_tooltip.contains(event.target) || event.target === _tooltip)) {
    return;
  }

  if (!_selectionActive) return;

  event.preventDefault();

  const target = document.elementFromPoint(event.clientX, event.clientY);

  if (!target || target === document.documentElement || target === document.body || target === null) {
    return;
  }

  if (target.id === 'xpath-helper-tooltip' || (target.closest && target.closest('#xpath-helper-tooltip'))) {
    return;
  }

  window._xpathHelperSelectedElement = target;
  highlightElement(target);
  showTooltip(target);

  event.stopPropagation();
}

function handleKeyDown(event) {
  if (event.key === 'Escape' && _selectionActive) {
    stopSelection();
  }
}

// ============================================
// Public API (called from popup)
// ============================================

function startSelection() {
  if (_selectionActive) return;

  _selectionActive = true;
  document.body.style.cursor = 'crosshair';

  document.addEventListener('mousedown', handleMouseDown, true);
  document.addEventListener('keydown', handleKeyDown);

  createTooltip();
  _tooltip.style.display = 'block';

  window._xpathHelperSelectedElement = null;
  if (_previousHighlight) {
    _previousHighlight.classList.remove('xpath-helper-highlight');
    _previousHighlight = null;
  }

  return { success: true };
}

function stopSelection() {
  _selectionActive = false;
  document.body.style.cursor = '';
  document.removeEventListener('mousedown', handleMouseDown, true);
  document.removeEventListener('keydown', handleKeyDown);

  if (_previousHighlight) {
    _previousHighlight.classList.remove('xpath-helper-highlight');
    _previousHighlight = null;
  }
  window._xpathHelperSelectedElement = null;

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
