// HLS m3u8 解析（纯函数，禁止 import chrome API）
// master: { isMaster: true, variants: [{ url, bandwidth, resolution }] }
// media:  { isMaster: false, mediaSequence, segments: [{ url, key }], initSegment, keys }
export function parseM3u8(text, baseUrl) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (!lines.length || !lines[0].startsWith('#EXTM3U')) {
    throw new Error('不是有效的m3u8播放列表');
  }
  const resolve = (u) => new URL(u, baseUrl).href;

  const variants = [];
  const segments = [];
  const keys = [];
  let initSegment = null;
  let mediaSequence = 0;
  let pendingKey = null;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      const attrs = parseAttributes(line.slice('#EXT-X-STREAM-INF:'.length));
      const next = lines[i + 1];
      if (next && !next.startsWith('#')) {
        variants.push({
          url: resolve(next),
          bandwidth: Number(attrs.BANDWIDTH || attrs['AVERAGE-BANDWIDTH'] || 0),
          resolution: attrs.RESOLUTION || null,
        });
        i++;
      }
    } else if (line.startsWith('#EXT-X-MAP')) {
      const attrs = parseAttributes(line.slice('#EXT-X-MAP:'.length));
      if (attrs.URI) initSegment = resolve(attrs.URI);
    } else if (line.startsWith('#EXT-X-KEY')) {
      const attrs = parseAttributes(line.slice('#EXT-X-KEY:'.length));
      if (attrs.METHOD && attrs.METHOD !== 'NONE') {
        pendingKey = {
          method: attrs.METHOD,
          uri: attrs.URI ? resolve(attrs.URI) : null,
          iv: attrs.IV || null,
        };
        keys.push(pendingKey);
      } else {
        pendingKey = null;
      }
    } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE')) {
      mediaSequence = Number(line.split(':')[1] || 0);
    } else if (!line.startsWith('#')) {
      segments.push({ url: resolve(line), key: pendingKey });
    }
  }

  return { isMaster: variants.length > 0 && segments.length === 0, variants, segments, initSegment, keys, mediaSequence };
}

// 选最高码率变体
export function pickBestVariant(variants) {
  return variants.slice().sort((a, b) => b.bandwidth - a.bandwidth)[0] || null;
}

// 解析标签属性 ATTR=value 或 ATTR="quoted value"
function parseAttributes(s) {
  const attrs = {};
  const re = /([A-Z0-9-]+)=("([^"]*)"|[^,]*)/g;
  let m;
  while ((m = re.exec(s))) {
    attrs[m[1]] = m[2].startsWith('"') ? m[3] : m[2];
  }
  return attrs;
}
