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

// B站 DASH 音频码率档编号（30216=64k 30232=132k 30250=杜比 30251=Hi-Res 30280=192k）
// B站 CDN 对 audio.m4s 也返回 video/mp4，Content-Type 无法区分音视频，只能按编号识别
const BILIBILI_AUDIO_CODE_RE = /-(30216|30232|30250|30251|30280)\.m4s$/i;

export function isBilibiliAudioM4s(url) {
  try {
    const u = new URL(url);
    return u.hostname.includes('bilivideo') && BILIBILI_AUDIO_CODE_RE.test(u.pathname);
  } catch {
    return false;
  }
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
    const isAudio = contentType.toLowerCase().startsWith('audio/') || isBilibiliAudioM4s(url);
    return { ext, streamKind: isAudio ? 'audio' : 'video' };
  }
  if (ext === 'm4s' && isBilibiliAudioM4s(url)) {
    return { ext, streamKind: 'audio' };
  }
  return { ext, streamKind: ext === 'ts' || ext === 'm4s' ? 'segment' : 'video' };
}
