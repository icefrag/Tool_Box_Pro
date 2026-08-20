// 带位置信息的 JSON 解析器（纯函数，无 DOM / chrome API 依赖）
// 返回 { ok: true, ast } 或 { ok: false, error: { message, offset, line, column } }
// AST 节点：
//   { type: 'object',  start, end, properties: [{ key, keyStart, keyEnd, value }] }
//   { type: 'array',   start, end, items: [ValueNode] }
//   { type: 'string'|'number'|'boolean'|'null', start, end, value }
const MAX_DEPTH = 500;
const NUM_RE = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const IDENT_KEY_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function parseJson(text) {
  let pos = 0;
  let depth = 0;

  function error(message, offset = pos) {
    let line = 1;
    let column = 1;
    for (let i = 0; i < offset; i++) {
      if (text.charCodeAt(i) === 10) { line++; column = 1; } else { column++; }
    }
    return { message, offset, line, column };
  }

  function skipWs() {
    while (pos < text.length) {
      const c = text[pos];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') pos++;
      else break;
    }
  }

  function parseValue() {
    skipWs();
    if (pos >= text.length) throw error('意外的输入结束，期望 JSON 值');
    const c = text[pos];
    if (c === '{') return parseObject();
    if (c === '[') return parseArray();
    if (c === '"') return parseString();
    if (c === '-' || (c >= '0' && c <= '9')) return parseNumber();
    if (text.startsWith('true', pos)) {
      const node = { type: 'boolean', start: pos, end: pos + 4, value: true };
      pos += 4;
      return node;
    }
    if (text.startsWith('false', pos)) {
      const node = { type: 'boolean', start: pos, end: pos + 5, value: false };
      pos += 5;
      return node;
    }
    if (text.startsWith('null', pos)) {
      const node = { type: 'null', start: pos, end: pos + 4, value: null };
      pos += 4;
      return node;
    }
    throw error(`意外的字符 '${c}'，期望 JSON 值`);
  }

  function parseObject() {
    const start = pos;
    pos++; // {
    depth++;
    if (depth > MAX_DEPTH) throw error(`嵌套层级超过 ${MAX_DEPTH} 层`);
    const properties = [];
    skipWs();
    if (text[pos] === '}') {
      depth--;
      pos++;
      return { type: 'object', start, end: pos, properties };
    }
    while (true) {
      skipWs();
      if (text[pos] !== '"') throw error(`意外的字符 '${text[pos] ?? ''}'，期望属性名 '"'`);
      const keyNode = parseString();
      skipWs();
      if (text[pos] !== ':') throw error(`意外的字符 '${text[pos] ?? ''}'，期望 ':'`);
      pos++;
      const value = parseValue();
      properties.push({ key: keyNode.value, keyStart: keyNode.start, keyEnd: keyNode.end, value });
      skipWs();
      if (text[pos] === ',') { pos++; continue; }
      if (text[pos] === '}') { pos++; break; }
      throw error(`意外的字符 '${text[pos] ?? ''}'，期望 ',' 或 '}'`);
    }
    depth--;
    return { type: 'object', start, end: pos, properties };
  }

  function parseArray() {
    const start = pos;
    pos++; // [
    depth++;
    if (depth > MAX_DEPTH) throw error(`嵌套层级超过 ${MAX_DEPTH} 层`);
    const items = [];
    skipWs();
    if (text[pos] === ']') {
      depth--;
      pos++;
      return { type: 'array', start, end: pos, items };
    }
    while (true) {
      items.push(parseValue());
      skipWs();
      if (text[pos] === ',') { pos++; continue; }
      if (text[pos] === ']') { pos++; break; }
      throw error(`意外的字符 '${text[pos] ?? ''}'，期望 ',' 或 ']'`);
    }
    depth--;
    return { type: 'array', start, end: pos, items };
  }

  function parseString() {
    const start = pos;
    pos++; // "
    while (pos < text.length) {
      const c = text[pos];
      if (c === '\\') { pos += 2; continue; }
      if (c === '"') {
        pos++;
        const token = text.slice(start, pos);
        try {
          return { type: 'string', start, end: pos, value: JSON.parse(token) };
        } catch {
          throw error('非法的字符串转义', start);
        }
      }
      pos++;
    }
    throw error('字符串未闭合', start);
  }

  function parseNumber() {
    NUM_RE.lastIndex = pos;
    const m = NUM_RE.exec(text);
    if (!m) throw error(`非法的数字，始于 '${text.slice(pos, pos + 12)}'`);
    const token = m[0];
    pos += token.length;
    return { type: 'number', start: pos - token.length, end: pos, value: Number(token) };
  }

  try {
    if (typeof text !== 'string') throw error('输入必须是字符串');
    const ast = parseValue();
    skipWs();
    if (pos < text.length) throw error(`多余的输入，始于 '${text.slice(pos, pos + 12)}'`);
    return { ok: true, ast };
  } catch (e) {
    if (e && e.offset !== undefined) return { ok: false, error: e };
    return { ok: false, error: error((e && e.message) || '解析失败') };
  }
}

// path 段构造：标识符安全的 key 用 .key，否则用 ["key"]
export function childPath(parentPath, key) {
  return IDENT_KEY_RE.test(key) ? `${parentPath}.${key}` : `${parentPath}[${JSON.stringify(key)}]`;
}

export function itemPath(parentPath, index) {
  return `${parentPath}[${index}]`;
}
