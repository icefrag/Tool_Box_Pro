// TS / fMP4 分片拼接（纯函数，禁止 import chrome API）
export function concatChunks(chunks) {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

// fMP4：init 段（ftyp+moov）打头，媒体段顺序拼接
export function mergeFmp4Segments(initChunk, chunks) {
  return concatChunks([initChunk, ...chunks]);
}
