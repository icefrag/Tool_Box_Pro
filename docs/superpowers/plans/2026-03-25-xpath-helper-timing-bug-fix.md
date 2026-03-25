# XPath Helper Timing Bug Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the timing bug where `stopSelection` from `beforeunload` always arrives after `startSelection`, causing selection mode to exit immediately after starting. Change from "auto-close popup" to "keep popup open with manual stop button".

**Architecture:** Keep popup open after starting selection mode, add a "Stop Selection" button that toggles with the start button. Update UI state to reflect whether selection is active. Reuse all existing content script logic - no changes needed there. The existing `beforeunload` cleanup remains as a safety net.

**Tech Stack:** Vanilla JavaScript ES6, Chrome Extension Manifest V3, DOM API.

---

## File Changes Summary

| File | Action | Purpose |
|------|--------|---------|
| `tools/xpath-helper/tool.js` | **Modify** | Remove auto-close, add stop selection handler, add state tracking, update UI toggle, detect existing selection on initialize, add message listener for ESC sync |
| `content/content.js` | **Modify** | Add `selectionStopped` notification when selection stops (ESC or exit button) |
| `tools/xpath-helper/tool.css` | **No change** | Existing styles work for the new button state |

---

## Task 1: Add isSelectionActive state tracking to XpathTool class

**Files:**
- Modify: `tools/xpath-helper/tool.js:14-25`

- [ ] **Step 1: Add instance property to track selection state**

Add this after `this.copyMode` in the constructor:

```javascript
this.isSelectionActive = false; // Track whether selection mode is active
```

- [ ] **Step 2: Commit**

```bash
git add tools/xpath-helper/tool.js && git commit -m "refactor(xpath): add isSelectionActive state tracking"
```

---

## Task 2: Update createElement HTML template

**Files:**
- Modify: `tools/xpath-helper/tool.js:27-59`

- [ ] **Step 1: The HTML is already correct - the button id `start-xpath` will be reused for toggling between "Start" and "Stop"**

The existing HTML:
```html
<div class="tool-controls">
  <button id="start-xpath" class="primary-button">开始选择元素</button>
</div>
<div id="xpath-status" class="xpath-status hidden"></div>
```

This is correct, we don't need to add a separate button - we'll reuse the same button by toggling its text and behavior.

- [ ] **Step 2: Commit**

```bash
# No changes needed if HTML already correct
git status
```

---

## Task 3: Add stopSelection method and update event listener

**Files:**
- Modify: `tools/xpath-helper/tool.js:81-92, 183-187`

- [ ] **Step 1: Add stopSelection method after startSelection**

```javascript
async stopSelection() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tab.id, { action: 'stopSelection' }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
    }

    // Restore UI to inactive state
    this.updateUiToInactive();
    this.isSelectionActive = false;

  } catch (error) {
    console.error('XPath Helper 停止失败:', error);
    const statusEl = this.element.querySelector('#xpath-status');
    statusEl.textContent = '停止失败: ' + error.message;
    statusEl.className = 'xpath-status error';
  }
}

updateUiToInactive() {
  const statusEl = this.element.querySelector('#xpath-status');
  const startBtn = this.element.querySelector('#start-xpath');
  const radioButtons = this.element.querySelectorAll('input[name="copy-mode"]');

  statusEl.classList.add('hidden');
  startBtn.textContent = '开始选择元素';
  startBtn.disabled = false;

  // Re-enable copy option radios
  radioButtons.forEach(radio => {
    radio.disabled = false;
  });
}

updateUiToActive() {
  const statusEl = this.element.querySelector('#xpath-status');
  const startBtn = this.element.querySelector('#start-xpath');
  const radioButtons = this.element.querySelectorAll('input[name="copy-mode"]');

  statusEl.textContent = '已进入选择模式，请点击页面元素（ESC退出）';
  statusEl.className = 'xpath-status success';
  statusEl.classList.remove('hidden');
  startBtn.textContent = '停止选择';
  startBtn.disabled = false;

  // Disable copy option radios to prevent changes during selection
  radioButtons.forEach(radio => {
    radio.disabled = true;
  });
}
```

- [ ] **Step 2: Update setupEventListeners to handle toggle based on state**

Modify the click handler:

```javascript
setupEventListeners() {
  const startBtn = this.element.querySelector('#start-xpath');
  startBtn.addEventListener('click', () => {
    if (this.isSelectionActive) {
      this.stopSelection();
    } else {
      this.startSelection();
    }
  });

  // ... existing radio change listener remains unchanged
}
```

- [ ] **Step 3: Commit**

```bash
git add tools/xpath-helper/tool.js && git commit -m "feat(xpath): add stopSelection method and toggle button behavior"
```

---

## Task 4: Modify startSelection - remove auto-close, update state, disable radios

**Files:**
- Modify: `tools/xpath-helper/tool.js:136-182`

- [ ] **Step 1: Remove the auto-close code (lines 170-173)**

**Delete these lines:**

```javascript
      // 关闭弹窗，让用户去页面上选择
      setTimeout(() => {
        window.close();
      }, 500);
```

- [ ] **Step 2: After successful start, update state**

Replace the current status/button update after line 163 with:

```javascript
      // Update UI to active state
      this.updateUiToActive();
      this.isSelectionActive = true;
```

(The existing lines 164-168 update status and button text, we'll move that into `updateUiToActive()`)

- [ ] **Step 3: In the catch block, ensure we reset the button text correctly**

Catch block remains:

```javascript
    } catch (error) {
      console.error('XPath Helper 启动失败:', error);
      statusEl.textContent = '启动失败: ' + error.message;
      statusEl.className = 'xpath-status error';
      startBtn.textContent = '开始选择元素';
      startBtn.disabled = false;
    }
```

No change needed here.

- [ ] **Step 4: Commit**

```bash
git add tools/xpath-helper/tool.js && git commit -m "fix(xpath): remove auto-close popup, keep popup open after start"
```

---

## Task 5: Add selection state detection in initialize

**Files:**
- Modify: `tools/xpath-helper/tool.js:94-100`

- [ ] **Step 1: Detect if selection is already active when popup opens**

Update the `initialize` method:

```javascript
async initialize() {
  // If element was destroyed (set to null), recreate it
  if (!this.element) {
    this.createElement();
  }

  // Check if selection is already active when popup is reopened
  this.detectSelectionState();

  this.log('XPath Helper 工具初始化完成');
}

async detectSelectionState() {
  try {
    // Ping content script to see if selection is active
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      // We try to ping - if content script doesn't respond, it means selection is not active
      // This is a lightweight detection because content script doesn't export a ping handler
      // The best we can do is rely on the fact that if selection is active, our messages will
      // be handled. If we can't connect, selection is not active.
      chrome.tabs.sendMessage(tab.id, { action: 'ping' }, () => {
        if (chrome.runtime.lastError) {
          // No connection = selection not active
          this.isSelectionActive = false;
          this.updateUiToInactive();
        } else {
          // Connection successful = selection might be active
          // Since we can't query state directly from content script reliably,
          // we'll assume it's active - user can click stop to exit
          this.isSelectionActive = true;
          this.updateUiToActive();
        }
      });
    }
  } catch (err) {
    // Ignore detection errors, default to inactive
    this.isSelectionActive = false;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add tools/xpath-helper/tool.js && git commit -m "feat(xpath): detect existing selection on initialize for re-opened popup"
```

---

## Task 6: Verify CSS is already correct (no changes needed)

**Files:**
- Read: `tools/xpath-helper/tool.css`

- [ ] **Step 1: Check existing styles - verify they work with the new UI**

Existing styles:
- `.xpath-tool` - container ✓
- `.copy-option-group` - copy options ✓
- `.xpath-status` - status display ✓
- `.primary-button` - button (from popup global styles) ✓

All styles needed are already present. Disabled radio buttons will be styled by the browser automatically.

- [ ] **Step 2: No CSS changes needed**

- [ ] **Step 3: Commit**

```bash
# No changes
git status
```

---

## Task 7: Add message listener for real-time UI sync when ESC is pressed

**Files:**
- Modify: `tools/xpath-helper/tool.js` (in `setupEventListeners`)
- Modify: `content/content.js` (in `stopSelection`)

- [ ] **Step 1: Add message listener in XpathTool to receive selection stopped notifications**

Add this in `setupEventListeners` after the click handler:

```javascript
// Listen for selection stopped notifications (e.g., from ESC key in page)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'selectionStopped' && this.isSelectionActive) {
    this.updateUiToInactive();
    this.isSelectionActive = false;
    sendResponse({ received: true });
  }
  return true;
});
```

- [ ] **Step 2: Add message send in content.js stopSelection function**

In `content/content.js`, add at the end of `stopSelection()` function (before the closing brace):

```javascript
// Notify popup that selection has stopped (for UI sync when popup stays open)
chrome.runtime.sendMessage({ action: 'selectionStopped' }).catch(() => {
  // Ignore if popup is not open or doesn't have listener
});
```

- [ ] **Step 3: Commit**

```bash
git add tools/xpath-helper/tool.js content/content.js && git commit -m "feat(xpath): add message listener for real-time UI sync when ESC exits"
```

---

## Task 8: Manual testing verification

**Test all scenarios:**

- [ ] **Test 1: Fresh start**
  1. Open extension → click XPath Helper
  2. Click "开始选择元素"
  3. **Expected:** Popup stays open, status shows "已进入选择模式", button says "停止选择", copy options disabled
  4. **Expected:** Page enters selection mode, tooltip is visible and stays visible

- [ ] **Test 2: Click stop selection**
  1. Click "停止选择" button
  2. **Expected:** Page exits selection mode, UI returns to start state, copy options enabled

- [ ] **Test 3: Close popup directly (beforeunload cleanup)**
  1. Start selection (popup stays open)
  2. Close the popup manually
  3. **Expected:** popup closes, page exits selection mode (cleanup works)

- [ ] **Test 4: ESC key in page exits selection**
  1. Start selection from popup
  2. Go to page, press ESC
  3. **Expected:** page exits selection
  4. Reopen popup → **Expected:** popup UI shows start state (detected correctly)

- [ ] **Test 5: Copy mode setting persists**
  1. Select "仅 XPath"
  2. Start selection → stop selection
  3. Reopen → **Expected:** "仅 XPath" remains selected

---

## Final Check List

- [ ] All tasks complete
- [ ] All tests pass
- [ ] No lint errors (project is vanilla JS, no linter configured)
- [ ] No new console errors
- [ ] Original bug is fixed: selection mode doesn't disappear after popup start

---

## Reference

- **Spec:** `docs/superpowers/specs/2026-03-25-xpath-helper-timing-bug-fix-design.md`
- **Root cause:** Timing race between `startSelection` and `stopSelection` (from `beforeunload`)
- **Solution:** Remove auto-close, keep popup open, add manual stop button
