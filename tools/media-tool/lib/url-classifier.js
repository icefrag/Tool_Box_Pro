// 媒体 URL 分类（纯函数，禁止 import chrome API）
const MEDIA_EXTENSIONS = new Set(['mp4', 'webm', 'm3u8', 'ts', 'm4s', 'flv', 'mov']);

const MEDIA_CONTENT_TYPE_PREFIXES = [
  'video/',
  'audio/',
  'application/x-mpegurl',
  'application/vnd.apple.mpegurl',
];

// 从 URL 提取媒体扩展名；仅看 pathname，容忍查询串与签名
export function mediaExtensionFromUrl(url) {
  try {
    const m = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

export function isMediaContentType(contentType) {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  return MEDIA_CONTENT_TYPE_PREFIXES.some((p) => ct.startsWith(p));
}

// 返回 null 表示非媒体；否则 { ext, streamKind }
// streamKind: 'playlist' | 'segment' | 'video' | 'audio'
export function classifyMediaRequest(url, contentType = '') {
  const ext = mediaExtensionFromUrl(url);
  const typeMatch = isMediaContentType(contentType);
  const extMatch = ext && MEDIA_EXTENSIONS.has(ext);
  if (!extMatch && !typeMatch) return null;

  if (ext === 'm3u8') return { ext, streamKind: 'playlist' };
  if (typeMatch) {
    return { ext, streamKind: contentType.toLowerCase().startsWith('audio/') ? 'audio' : 'video' };
  }
  return { ext, streamKind: ext === 'ts' || ext === 'm4s' ? 'segment' : 'video' };
}
