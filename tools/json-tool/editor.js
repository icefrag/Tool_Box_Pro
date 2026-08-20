// CodeMirror 封装：语法高亮、格式化/压缩、复制、区间选中高亮、匹配标记
export class JsonEditor {
  constructor(container, { onChange, onCursor } = {}) {
    this.cm = CodeMirror(container, {
      value: '',
      mode: 'application/json',
      lineNumbers: true,
      matchBrackets: true,
      tabSize: 2,
      indentUnit: 2,
    });
    this.changeTimer = null;
    this.cursorTimer = null;
    this.marks = [];
    this.syncMark = null;

    this.cm.on('change', () => {
      clearTimeout(this.changeTimer);
      this.changeTimer = setTimeout(() => onChange && onChange(), 300);
    });
    this.cm.on('cursorActivity', () => {
      clearTimeout(this.cursorTimer);
      this.cursorTimer = setTimeout(() => {
        if (onCursor) onCursor(this.cm.indexFromPos(this.cm.getCursor('head')));
      }, 200);
    });
  }

  getValue() { return this.cm.getValue(); }

  setValue(text) { this.cm.setValue(text); }

  format() {
    this.cm.setValue(JSON.stringify(JSON.parse(this.cm.getValue()), null, 2));
  }

  minify() {
    this.cm.setValue(JSON.stringify(JSON.parse(this.cm.getValue())));
  }

  async copy() {
    const text = this.cm.getValue();
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  // 联动：滚动到区间并高亮背景（树图 → 编辑器）
  selectRange(start, end) {
    const from = this.cm.posFromIndex(start);
    const to = this.cm.posFromIndex(end);
    this.clearSyncMark();
    this.syncMark = this.cm.markText(from, to, { className: 'cm-sync-highlight' });
    this.cm.setCursor(to);
    this.cm.scrollIntoView({ from, to }, 60);
  }

  gotoOffset(offset) {
    this.cm.setCursor(this.cm.posFromIndex(offset));
    this.cm.scrollIntoView(null, 40);
  }

  // 搜索命中标记（编辑器侧）
  markRanges(ranges) {
    this.clearMarks();
    this.marks = ranges.map((r) =>
      this.cm.markText(this.cm.posFromIndex(r.start), this.cm.posFromIndex(r.end), { className: 'cm-search-match' })
    );
  }

  clearMarks() {
    this.marks.forEach((m) => m.clear());
    this.marks = [];
  }

  clearSyncMark() {
    if (this.syncMark) {
      this.syncMark.clear();
      this.syncMark = null;
    }
  }
}
