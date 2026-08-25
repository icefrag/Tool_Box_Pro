// AES-128 解密测试（node ≥19 自带 WebCrypto）
import assert from 'node:assert/strict';
import { decryptAes128, ivFromMediaSequence, ivFromHexString } from '../lib/hls-decrypt.js';

// 序号 IV：128 位大端，低 32 位为媒体序号
const seqIv = ivFromMediaSequence(10);
assert.equal(seqIv.length, 16);
assert.equal(seqIv[15], 10);
assert.equal(seqIv[12], 0);

// 显式 IV 十六进制还原
const hexIv = ivFromHexString('0x9c7db877f50769be');
assert.equal(hexIv.length, 8);
assert.deepEqual([...hexIv], [0x9c, 0x7d, 0xb8, 0x77, 0xf5, 0x07, 0x69, 0xbe]);

// 加解密往返：WebCrypto AES-CBC（PKCS7 填充，即 HLS 规范行为）
const keyBytes = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(16));
const plain = crypto.getRandomValues(new Uint8Array(333));
const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt']);
const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, cryptoKey, plain));
const decrypted = await decryptAes128(cipher, keyBytes, iv);
assert.equal(decrypted.byteLength, plain.byteLength);
assert.deepEqual([...decrypted], [...plain]);

// 非 16 字节对齐的密文：明确抛错（v1 不支持不规范流）
await assert.rejects(() => decryptAes128(new Uint8Array(10), keyBytes, iv), /不符合 AES-128 规范/);
console.log('test-hls-decrypt ok');
