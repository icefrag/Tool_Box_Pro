// Content script - runs on every page

// Store selected element
window._selectedElement = null;

// Store previous highlight to remove it
let _previousHighlight = null;

// Store hover highlight to remove it
let _hoverHighlight = null;

// X marker overlay element
let _xMarker = null;

// Scroll ticking flag for throttling
let _scrollTicking = false;

// Is selection mode active
let _selectionActive = false;

// XPath tooltip element
let _tooltip = null;

// Copy mode: 'both' | 'xpath' | 'selector'
let _copyMode = 'both';

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
    // Count total siblings with same tag name
    let total = 0;
    sibling = current.parentElement ? current.parentElement.firstElementChild : null;
    while (sibling) {
      if (sibling.tagName === current.tagName) total++;
      sibling = sibling.nextElementSibling;
    }

    const tagName = current.tagName.toLowerCase();
    // Chrome DevTools rules:
    // 1. html element always omits [1]
    // 2. Other elements: omit [1] only when total === 1; otherwise keep all indices
    if (tagName === 'html' || total === 1) {
      parts.unshift(tagName);
    } else {
      parts.unshift(`${tagName}[${index}]`);
    }
    current = current.parentElement;
  }

  return '/' + parts.join('/');
}

// ============================================
// CSS Selector Generation (matches browser DevTools)
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

    // Add class names - handle SVG elements which have SVGAnimatedString
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

    // Always add nth-child index to guarantee uniqueness
    if (current.parentElement) {
      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) index++;
        sibling = sibling.previousElementSibling;
      }
      selector += `:nth-child(${index})`;
    }

    parts.unshift(selector);
    current = current.parentElement;
  }

  // Add body
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
    <div class="xpath-helper-tooltip-content">
      <div class="xpath-helper-tooltip-header">
        <span class="xpath-helper-title">XPath Helper</span>
        <span class="xpath-helper-hint-inline">按 ESC 退出</span>
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
      <div class="xpath-helper-hint">点击页面元素获取路径</div>
    </div>
  `;
  document.body.appendChild(_tooltip);

  // Bind event listeners
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

  // Prevent tooltip clicks from triggering selection
  _tooltip.addEventListener('click', (e) => {
    e.stopPropagation();
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
  tooltip.querySelector('.xpath-helper-hint').textContent = '已选择: ' + element.tagName.toLowerCase();
}

function hideTooltip() {
  if (_tooltip) {
    _tooltip.style.display = 'none';
  }
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

function createXMarker() {
  if (_xMarker) return _xMarker;
  _xMarker = document.createElement('div');
  _xMarker.className = 'xpath-helper-x-marker';
  _xMarker.textContent = '✕';
  document.body.appendChild(_xMarker);
  return _xMarker;
}

function updateXMarkerPosition(element) {
  if (!_xMarker) createXMarker();
  const rect = element.getBoundingClientRect();
  // Position X at top-right corner of the element
  _xMarker.style.top = rect.top + 'px';
  _xMarker.style.right = (window.innerWidth - rect.right) + 'px';
  _xMarker.style.display = 'flex';
}

function hideXMarker() {
  if (_xMarker) {
    _xMarker.style.display = 'none';
  }
}

function removeXMarker() {
  if (_xMarker) {
    _xMarker.remove();
    _xMarker = null;
  }
}

function hoverHighlightElement(element) {
  // Skip if it's our own tooltip or marker
  if (element.id === 'xpath-helper-tooltip' ||
      element.classList.contains('xpath-helper-x-marker') ||
      (element.closest && element.closest('#xpath-helper-tooltip'))) {
    hideXMarker();
    return;
  }

  // Remove previous hover highlight
  if (_hoverHighlight && _hoverHighlight !== element) {
    _hoverHighlight.classList.remove('xpath-helper-highlight-hover');
  }

  // Add new hover highlight
  if (element !== _hoverHighlight) {
    element.classList.add('xpath-helper-highlight-hover');
    _hoverHighlight = element;
    updateXMarkerPosition(element);
  }
}

function removeHoverHighlight() {
  if (_hoverHighlight) {
    _hoverHighlight.classList.remove('xpath-helper-highlight-hover');
    _hoverHighlight = null;
  }
  hideXMarker();
}

// ============================================
// Event Handlers
// ============================================

function handleMouseDown(event) {
  // Check if click is on the tooltip itself
  if (_tooltip && (_tooltip.contains(event.target) || event.target === _tooltip ||
      (event.target.closest && event.target.closest('#xpath-helper-tooltip')))) {
    // Click on tooltip, prevent it from reaching the page element
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }

  if (!_selectionActive) return;

  // Prevent default and stop propagation to prevent navigation
  event.preventDefault();
  event.stopImmediatePropagation();

  // Use elementFromPoint to get the element at click position
  // This works even if the element has its own click handler
  const target = document.elementFromPoint(event.clientX, event.clientY);

  if (!target || target === document.documentElement || target === document.body || target === null) {
    return;
  }

  // Don't select our own tooltip
  if (target.id === 'xpath-helper-tooltip' || (target.closest && target.closest('#xpath-helper-tooltip'))) {
    return;
  }

  window._selectedElement = target;
  highlightElement(target);
  showTooltip(target);

  // Auto-copy based on copy mode configuration - copy every selection
  const xpath = getAbsoluteXPath(target);
  const selector = getCssSelector(target);
  let copyText = '';

  switch (_copyMode) {
    case 'xpath':
      copyText = xpath;
      break;
    case 'selector':
      copyText = selector;
      break;
    case 'both':
    default:
      copyText = `${xpath}\n${selector}`;
      break;
  }

  if (copyText) {
    navigator.clipboard.writeText(copyText).catch(() => {
      // Silently ignore copy failures
    });
  }
}

function handleClick(event) {
  // Check if click is on the tooltip itself
  if (_tooltip && (_tooltip.contains(event.target) || event.target === _tooltip)) {
    return;
  }

  if (!_selectionActive) return;

  // Prevent any click events from triggering navigation
  event.preventDefault();
  event.stopImmediatePropagation();
}

function handleMouseUp(event) {
  if (_tooltip && (_tooltip.contains(event.target) || event.target === _tooltip)) {
    return;
  }

  if (!_selectionActive) return;

  // Prevent mouseup default behavior (some sites use this for navigation)
  event.preventDefault();
  event.stopImmediatePropagation();
}

function handleKeyDown(event) {
  // ESC key to exit selection mode
  if (event.key === 'Escape' && _selectionActive) {
    stopSelection();
  }
}

function handleMouseOver(event) {
  if (!_selectionActive) return;

  // Skip if it's our own tooltip
  if (event.target.id === 'xpath-helper-tooltip' || (event.target.closest && event.target.closest('#xpath-helper-tooltip'))) {
    return;
  }

  // Use elementFromPoint for accurate targeting
  const target = document.elementFromPoint(event.clientX, event.clientY);
  if (target) {
    hoverHighlightElement(target);
  }
}

function handleMouseOut(event) {
  if (!_selectionActive) return;

  // Check if we're leaving to another element within the page
  const relatedTarget = event.relatedTarget;
  if (relatedTarget &&
      (relatedTarget.id === 'xpath-helper-tooltip' ||
       relatedTarget.classList.contains('xpath-helper-x-marker') ||
       (relatedTarget.closest && relatedTarget.closest('#xpath-helper-tooltip')))) {
    return;
  }

  removeHoverHighlight();
}

function handleScroll() {
  if (!_selectionActive || !_hoverHighlight) return;
  // Use requestAnimationFrame for throttling
  if (!_scrollTicking) {
    window.requestAnimationFrame(() => {
      if (_hoverHighlight) {
        updateXMarkerPosition(_hoverHighlight);
      }
      _scrollTicking = false;
    });
    _scrollTicking = true;
  }
}

function handleResize() {
  if (!_selectionActive || !_hoverHighlight) return;
  // Update X marker position when window resizes
  updateXMarkerPosition(_hoverHighlight);
}

function startSelection(copyMode = 'both') {
  if (_selectionActive) return;

  _selectionActive = true;
  _copyMode = copyMode;
  document.body.style.cursor = 'crosshair';

  // Capture all mouse events at capture phase to prevent navigation
  document.addEventListener('mousedown', handleMouseDown, true);
  document.addEventListener('mouseup', handleMouseUp, true);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('mouseover', handleMouseOver, true);
  document.addEventListener('mouseout', handleMouseOut, true);
  window.addEventListener('scroll', handleScroll, true);
  window.addEventListener('resize', handleResize);

  // Create and show tooltip and X marker
  createTooltip();
  createXMarker();
  _tooltip.style.display = 'block';
  _tooltip.querySelector('.xpath-helper-hint').textContent = '点击页面元素获取路径 (ESC退出)';

  // Clear previous selection
  window._selectedElement = null;
  if (_previousHighlight) {
    _previousHighlight.classList.remove('xpath-helper-highlight');
    _previousHighlight = null;
  }
  if (_hoverHighlight) {
    _hoverHighlight.classList.remove('xpath-helper-highlight-hover');
    _hoverHighlight = null;
  }
  hideXMarker();
}

function stopSelection() {
  _selectionActive = false;
  document.body.style.cursor = '';
  document.removeEventListener('mousedown', handleMouseDown, true);
  document.removeEventListener('mouseup', handleMouseUp, true);
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('keydown', handleKeyDown);
  document.removeEventListener('mouseover', handleMouseOver, true);
  document.removeEventListener('mouseout', handleMouseOut, true);
  window.removeEventListener('scroll', handleScroll, true);
  window.removeEventListener('resize', handleResize);

  if (_previousHighlight) {
    _previousHighlight.classList.remove('xpath-helper-highlight');
    _previousHighlight = null;
  }
  if (_hoverHighlight) {
    _hoverHighlight.classList.remove('xpath-helper-highlight-hover');
    _hoverHighlight = null;
  }
  window._selectedElement = null;

  removeXMarker();
  removeTooltip();
}

// ============================================
// Message Listener
// ============================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startSelection') {
    startSelection(request.copyMode || 'both');
    sendResponse({ success: true });
  } else if (request.action === 'stopSelection') {
    stopSelection();
    sendResponse({ success: true });
  }
  return true;
});
