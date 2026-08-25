// 文件名生成与清洗（纯函数，禁止 import chrome API）
export function sanitizeFilename(name) {
  const cleaned = String(name).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 150) || 'media';
}

export function filenameFromUrl(url, fallbackExt = 'mp4') {
  let base = '';
  try {
    base = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
  } catch {
    base = '';
  }
  let decoded = base;
  try {
    decoded = decodeURIComponent(base);
  } catch {
    // 非法百分号序列，保留原样
  }
  let name = sanitizeFilename(decoded);
  if (!name) {
    name = `media.${fallbackExt}`;
  }
  if (!/\.[a-z0-9]{2,5}$/i.test(name)) {
    name += `.${fallbackExt}`;
  }
  return name;
}
