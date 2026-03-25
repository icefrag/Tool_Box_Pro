# XPath Helper Auto-exit After Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add feature that automatically exits selection mode after user selects an element, keeps popup open and displays the result for viewing and recopying.

**Architecture:** After the user clicks an element in the page, content script sends the XPath/Selector result to the popup, then automatically stops selection mode. Popup receives the result, displays it in a new result area with copy buttons, and returns to ready state for another selection.

**Tech Stack:** Vanilla JavaScript ES6, Chrome Extension Messaging API, DOM API.

---

## File Changes Summary

| File | Action | Purpose |
|------|--------|---------|
| `content/content.js` | **Modify** | Send `selectionResult` message after selecting element, then call `stopSelection()` |
| `tools/xpath-helper/tool.js` | **Modify** | Add result area to HTML template, add `selectionResult` message listener, add `showResult()` and `clearResult()` methods, add copy button handlers |
| `tools/xpath-helper/tool.css` | **Modify** | Add CSS styles for the result display area |

---

## Task 1: Add result area HTML to createElement template

**Files:**
- Modify: `tools/xpath-helper/tool.js` (createElement method)

- [ ] **Step 1: Add result display area to the HTML template**

After the status div, add:

```html
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
```

- [ ] **Step 2: Commit**

```bash
git add tools/xpath-helper/tool.js && git commit -m "feat(xpath): add result display area HTML template"
```

---

## Task 2: Add CSS styles for result area

**Files:**
- Modify: `tools/xpath-helper/tool.css`

- [ ] **Step 1: Append CSS styles at the end of the file**

Add:

```css
/* Result display styles */
.xpath-result {
  margin-top: 16px;
  padding: 12px;
  background: #f8f9fa;
  border-radius: 8px;
}

.xpath-result.hidden {
  display: none;
}

.xpath-result-header {
  font-size: 13px;
  font-weight: 500;
  color: #2e7d32;
  margin-bottom: 12px;
}

.xpath-result-row {
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.xpath-result-row:last-child {
  margin-bottom: 0;
}

.xpath-result-label {
  font-size: 12px;
  font-weight: 500;
  color: #555;
  min-width: 55px;
}

.xpath-result-code {
  flex: 1;
  padding: 4px 8px;
  background: white;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 11px;
  word-break: break-all;
  color: #333;
  line-height: 1.4;
}

.xpath-result-copy-btn {
  padding: 4px 10px;
  font-size: 12px;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.xpath-result-copy-btn:hover {
  background: #5568d3;
}
```

- [ ] **Step 2: Commit**

```bash
git add tools/xpath-helper/tool.css && git commit -m "style(xpath): add CSS styles for result display area"
```

---

## Task 3: Add selectionResult message listener and copy button handlers in setupEventListeners

**Files:**
- Modify: `tools/xpath-helper/tool.js` (setupEventListeners method)

- [ ] **Step 1: After the existing `selectionStopped` listener, add the new `selectionResult` listener**

Add:

```javascript
// Listen for selection result from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'selectionResult' && this.isSelectionActive) {
    this.showResult(message.elementTag, message.xpath, message.selector);
    // After showing result, selection is already stopped by content script
    // selectionStopped message will be sent from stopSelection() which updates UI
    sendResponse({ received: true });
  }
  return true;
});
```

- [ ] **Step 2: Add click handlers for the copy buttons**

After adding the listener above, add:

```javascript
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
```

- [ ] **Step 3: Commit**

```bash
git add tools/xpath-helper/tool.js && git commit -m "feat(xpath): add selectionResult message listener and copy button handlers"
```

---

## Task 4: Implement showResult and clearResult methods

**Files:**
- Modify: `tools/xpath-helper/tool.js` (after updateUiToActive method)

- [ ] **Step 1: Add showResult and clearResult methods**

Add:

```javascript
showResult(elementTag, xpath, selector) {
  const resultArea = this.element.querySelector('#xpath-result');
  const elementTagSpan = this.element.querySelector('#result-element-tag');
  const xpathCode = this.element.querySelector('#result-xpath');
  const selectorCode = this.element.querySelector('#result-selector');

  elementTagSpan.textContent = elementTag.toLowerCase();
  xpathCode.textContent = xpath;
  selectorCode.textContent = selector;
  resultArea.classList.remove('hidden');
}

clearResult() {
  const resultArea = this.element.querySelector('#xpath-result');
  if (resultArea) {
    resultArea.classList.add('hidden');
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add tools/xpath-helper/tool.js && git commit -m "feat(xpath): add showResult and clearResult methods"
```

---

## Task 5: Update startSelection to clear previous result

**Files:**
- Modify: `tools/xpath-helper/tool.js` (startSelection method)

- [ ] **Step 1: At the beginning of `startSelection` after getting elements, add:**

```javascript
this.clearResult();
```

Full context at start of method:

```javascript
async startSelection() {
  const statusEl = this.element.querySelector('#xpath-status');
  const startBtn = this.element.querySelector('#start-xpath');

  this.clearResult();
  statusEl.textContent = '正在启动...';
  ...
}
```

- [ ] **Step 2: Commit**

```bash
git add tools/xpath-helper/tool.js && git commit -m "feat(xpath): clear previous result when starting new selection"
```

---

## Task 6: Add selectionResult send in content script

**Files:**
- Modify: `content/content.js` (handleMouseDown function)

- [ ] **Step 1: At the end of `handleMouseDown` (just before the closing brace), add:**

After line 518:

```javascript
  // Send selection result to popup for display, then auto-exit selection mode
  chrome.runtime.sendMessage({
    action: 'selectionResult',
    elementTag: target.tagName,
    xpath: smartXPath || absoluteXPath,
    selector: selector
  }).catch(() => {
    // Ignore if popup is not open to receive
  });
}
```

Note: `stopSelection()` will be called after sending the message, which will trigger `selectionStopped` notification.

- [ ] **Step 2: Commit**

```bash
git add content/content.js && git commit -m "feat(xpath): send selectionResult to popup after element selection"
```

---

## Task 7: Manual testing verification

**Test all scenarios:**

- [ ] **Test 1: Fresh start and auto-exit after selection**
  1. Open extension → click XPath Helper
  2. Click "开始选择元素"
  3. **Expected:** Popup stays open, status shows "已进入选择模式", button says "停止选择"
  4. Go to page and click an element
  5. **Expected:** Page exits selection mode (tooltip/highlight gone), popup shows result area with XPath/Selector and copy buttons

- [ ] **Test 2: Copy buttons work**
  1. After selecting an element, click the "复制" button next to XPath
  2. **Expected:** Text copied to clipboard, button text changes to "已复制!"

- [ ] **Test 3: Start new selection after result**
  1. After showing result, click "开始选择元素" again
  2. **Expected:** Previous result is hidden, enters selection mode again

- [ ] **Test 4: ESC in page still works**
  1. Start selection, press ESC in page
  2. **Expected:** Page exits selection, popup UI returns to inactive state

- [ ] **Test 5: Click stop button still works**
  1. Start selection, click "停止选择" button in popup
  2. **Expected:** Page exits selection, popup returns to inactive state

- [ ] **Test 6: Direct popup close still cleans up**
  1. Start selection, close popup
  2. **Expected:** Page exits selection (beforeunload cleanup works)

---

## Final Check List

- [ ] All tasks complete
- [ ] All tests pass
- [ ] Original functionality (manual stop, ESC, close cleanup) still works
- [ ] Copy mode settings still persist correctly
- [ ] No new console errors

---

## Reference

- **Spec:** `docs/superpowers/specs/2026-03-25-xpath-auto-exit-after-selection-design.md`
- **Original Bug Fix:** Fixes timing issue where `stopSelection` from beforeunload always arrives after `startSelection`
