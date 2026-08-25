// mp4 无损合并测试：单轨视频 fMP4 + 单轨音频 fMP4 → 双轨 mp4
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { mergeFmp4Tracks } from '../lib/mp4-merge.js';

// node 下以 CJS 方式加载 mp4box UMD 构建（exports.createFile）
const cjsPath = join(tmpdir(), `mp4box-test-${process.pid}.cjs`);
writeFileSync(cjsPath, readFileSync(new URL('../../../lib/mp4box/mp4box.all.min.js', import.meta.url)));
const MP4Box = createRequire(import.meta.url)(cjsPath);
assert.equal(typeof MP4Box.createFile, 'function');

// 夹具缺失时（未运行 fixtures/build.mjs）跳过本测试
let videoBuf;
let audioBuf;
try {
  videoBuf = readFileSync(new URL('./fixtures/video.mp4', import.meta.url));
  audioBuf = readFileSync(new URL('./fixtures/audio.mp4', import.meta.url));
} catch {
  console.log('test-mp4-merge skipped（无夹具，运行 node tools/media-tool/tests/fixtures/build.mjs 生成）');
}

if (videoBuf && audioBuf) {
  const merged = await mergeFmp4Tracks(MP4Box, videoBuf, audioBuf);
  assert.ok(merged.byteLength > 1000, '输出文件过小');

  // 解析输出：应为 1 条视频轨 + 1 条音频轨，样本数 > 0
  const info = await new Promise((resolve, reject) => {
    const f = MP4Box.createFile();
    f.onError = (e) => reject(new Error(e));
    f.onReady = resolve;
    const ab = merged.buffer.slice(merged.byteOffset, merged.byteOffset + merged.byteLength);
    ab.fileStart = 0;
    f.appendBuffer(ab);
    f.flush();
  });

  assert.equal(info.tracks.length, 2, `轨道数应为 2，实际 ${info.tracks.length}`);
  const video = info.tracks.find((t) => t.video);
  const audio = info.tracks.find((t) => t.audio);
  assert.ok(video, '输出缺少视频轨');
  assert.ok(audio, '输出缺少音频轨');
  assert.ok(video.video.width > 0 && video.video.height > 0, '视频尺寸缺失');
  assert.ok(audio.audio.sample_rate > 0 && audio.audio.channel_count > 0, '音频参数缺失');

  // 输出样本数应与源文件一致（无损搬移）
  const countSamples = (buf) => new Promise((resolve, reject) => {
    const f = MP4Box.createFile();
    let n = 0;
    f.onError = (e) => reject(new Error(e));
    f.onReady = (i) => {
      const t = i.tracks.find((x) => x.audio || x.video);
      if (!t) { resolve(0); return; }
      f.setExtractionOptions(t.id, null, { nbSamples: Infinity });
      f.start();
    };
    f.onSamples = (_id, _u, ss) => { n += ss.length; };
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    ab.fileStart = 0;
    f.appendBuffer(ab);
    f.flush();
    resolve(n);
  });
  const srcVideoSamples = await countSamples(videoBuf);
  const srcAudioSamples = await countSamples(audioBuf);

  const outCounts = await new Promise((resolve) => {
    const f = MP4Box.createFile();
    const counts = {};
    f.onReady = (i) => {
      for (const t of i.tracks) f.setExtractionOptions(t.id, null, { nbSamples: Infinity });
      f.start();
    };
    f.onSamples = (id, _u, ss) => { counts[id] = (counts[id] || 0) + ss.length; };
    const ab = merged.buffer.slice(merged.byteOffset, merged.byteOffset + merged.byteLength);
    ab.fileStart = 0;
    f.appendBuffer(ab);
    f.flush();
    resolve(Object.values(counts));
  });
  assert.deepEqual([...outCounts].sort((a, b) => b - a),
    [srcVideoSamples, srcAudioSamples].sort((a, b) => b - a),
    `输出样本数 (${outCounts}) 应与源一致 ([${srcVideoSamples}, ${srcAudioSamples}])`);

  console.log(`test-mp4-merge ok（${video.nb_samples || srcVideoSamples} 视频样本 + ${audio.nb_samples || srcAudioSamples} 音频样本 → ${merged.byteLength} 字节）`);
}
