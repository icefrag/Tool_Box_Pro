// 重新生成合并测试夹具：node tools/media-tool/tests/fixtures/build.mjs
// 数据源：Apple 公开 HLS 示例（fMP4 + EXT-X-MAP，单轨结构与B站 m4s 同构）。
// 完整分片体积过大，这里下载后用 mp4box 截取前若干样本重封装，控制仓库体积。
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { parseM3u8 } from '../../lib/m3u8-parser.js';

const cjsPath = join(tmpdir(), `mp4box-build-${process.pid}.cjs`);
writeFileSync(cjsPath, readFileSync(new URL('../../../../lib/mp4box/mp4box.all.min.js', import.meta.url)));
const MP4Box = createRequire(import.meta.url)(cjsPath);

const BASE = 'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_adv_example_hevc/master.m3u8';
const VIDEO_SAMPLES = 200;
const AUDIO_SAMPLES = 8000;

const get = async (u) => {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${u}`);
  return r.text();
};

const masterText = await get(BASE);
const master = parseM3u8(masterText, BASE);
const audioUri = masterText.match(/#EXT-X-MEDIA:TYPE=AUDIO[^\n]*URI="([^"]+)"/)[1];
const vUrl = master.variants.slice().sort((a, b) => a.bandwidth - b.bandwidth)[0].url;
const aUrl = new URL(audioUri, BASE).href;

const grab = async (pl, n) => {
  const chunks = [];
  if (pl.initSegment) chunks.push(new Uint8Array(await (await fetch(pl.initSegment)).arrayBuffer()));
  for (const s of pl.segments.slice(0, n)) {
    chunks.push(new Uint8Array(await (await fetch(s.url)).arrayBuffer()));
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const c of chunks) { out.set(c, i); i += c.length; }
  return out;
};

// 下载源分片（各取 2 段足够裁出所需样本）
const vPl = parseM3u8(await get(vUrl), vUrl);
const aPl = parseM3u8(await get(aUrl), aUrl);
const srcVideo = await grab(vPl, 2);
const srcAudio = await grab(aPl, 2);
console.log(`downloaded: video ${srcVideo.length}B, audio ${srcAudio.length}B`);

// 解封装 → 截取前 N 样本 → 单轨重封装
function demux(buffer, label) {
  return new Promise((resolve, reject) => {
    const f = MP4Box.createFile();
    const samples = [];
    let track = null;
    f.onError = (e) => reject(new Error(`${label}解析失败: ${e}`));
    f.onReady = (info) => {
      track = info.tracks.find((t) => t.audio || t.video) || null;
      if (!track) return reject(new Error(`${label}无音视频轨`));
      f.setExtractionOptions(track.id, null, { nbSamples: Infinity });
      f.start();
    };
    f.onSamples = (_id, _u, ss) => samples.push(...ss);
    const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    ab.fileStart = 0;
    f.appendBuffer(ab);
    f.flush();
    if (!track || !samples.length) return reject(new Error(`${label}无样本`));
    resolve({ track, samples, entry: samples[0].description });
  });
}

function remux({ track, samples, entry }, n) {
  const out = MP4Box.createFile();
  const isVideo = !!track.video;
  const opts = {
    type: entry.type,
    hdlr: isVideo ? 'vide' : 'soun',
    timescale: track.timescale,
    description_boxes: entry.boxes.filter((b) => ['avcC', 'hvcC', 'av1C', 'esds'].includes(b.type)),
  };
  if (isVideo) {
    opts.width = track.video.width;
    opts.height = track.video.height;
  } else {
    opts.channel_count = track.audio.channel_count;
    opts.samplesize = track.audio.sample_size || 16;
    opts.samplerate = track.audio.sample_rate; // mp4box 写出时自行做 16.16 转换
  }
  const id = out.addTrack(opts);
  if (!id) throw new Error(`不支持的编码: ${entry.type}`);
  for (const s of samples.slice(0, n)) {
    out.addSample(id, s.data, { duration: s.duration, dts: s.dts, cts: s.cts, is_sync: s.is_sync });
  }
  return new Uint8Array(out.getBuffer());
}

const dir = new URL('./', import.meta.url);
mkdirSync(dir, { recursive: true });
const video = remux(await demux(srcVideo, '视频'), VIDEO_SAMPLES);
const audio = remux(await demux(srcAudio, '音频'), AUDIO_SAMPLES);
writeFileSync(new URL('video.mp4', dir), video);
writeFileSync(new URL('audio.mp4', dir), audio);
console.log(`fixtures written: video ${video.length}B (${VIDEO_SAMPLES}样本), audio ${audio.length}B (${AUDIO_SAMPLES}样本)`);
