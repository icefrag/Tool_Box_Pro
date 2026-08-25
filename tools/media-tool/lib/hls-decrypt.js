// HLS AES-128 解密（WebCrypto，浏览器与 node ≥19 通用）
// 仅支持 HLS 规范要求的 PKCS7 填充（分片长度 16 字节对齐）
export function ivFromMediaSequence(seq) {
  const iv = new Uint8Array(16);
  new DataView(iv.buffer).setUint32(12, seq >>> 0);
  return iv;
}

export function ivFromHexString(hex) {
  const h = String(hex).replace(/^0x/i, '');
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.substr(i * 2, 2), 16);
  }
  return bytes;
}

export async function decryptAes128(encrypted, keyBytes, iv) {
  if (encrypted.byteLength % 16 !== 0) {
    throw new Error('加密分片长度不符合 AES-128 规范（非 16 字节对齐），暂不支持');
  }
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, encrypted);
  return new Uint8Array(plain);
}
