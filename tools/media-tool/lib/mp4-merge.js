// 无损合并两条单轨 fMP4（如B站 video.m4s + audio.m4s）为一个双轨 mp4
// 依赖注入 MP4Box（浏览器由 <script> 提供 globalThis.MP4Box；node 测试注入），本模块保持纯函数
//
// 输出为全碎片化 mp4（每样本一个 moof+mdat），播放器通用；
// 等价于 ffmpeg -c copy 的无损搬移，不重新编码。

const VIDEO_CONFIG_BOXES = ['avcC', 'hvcC', 'av1C'];

export function mergeFmp4Tracks(MP4Box, videoBuffer, audioBuffer) {
  return Promise.all([
    demuxTrack(MP4Box, videoBuffer, '视频'),
    demuxTrack(MP4Box, audioBuffer, '音频'),
  ]).then(([{ track: vt, samples: vs, sampleEntry: ve }, { track: at, samples: as_, sampleEntry: ae }]) => {
    if (!vt.video) throw new Error('第一个文件不是视频轨');
    if (!at.audio) throw new Error('第二个文件不是音频轨');

    const out = MP4Box.createFile();

    // 视频轨：编解码配置盒（avcC/hvcC/av1C）从源文件原样搬移
    const videoId = out.addTrack({
      type: ve.type,
      hdlr: 'vide',
      width: vt.video.width,
      height: vt.video.height,
      timescale: vt.timescale,
      duration: vt.duration,
      description_boxes: ve.boxes.filter((b) => VIDEO_CONFIG_BOXES.includes(b.type)),
    });
    if (!videoId) throw new Error(`不支持的视频编码类型: ${ve.type}`);

    // 音频轨：esds 配置盒原样搬移；samplerate 传原始值（mp4box 写出时自行做 16.16 定点转换）
    const audioId = out.addTrack({
      type: ae.type,
      hdlr: 'soun',
      channel_count: at.audio.channel_count,
      samplesize: at.audio.sample_size || 16,
      samplerate: at.audio.sample_rate,
      timescale: at.timescale,
      description_boxes: ae.boxes.filter((b) => b.type === 'esds'),
    });
    if (!audioId) throw new Error(`不支持的音频编码类型: ${ae.type}`);

    // 双轨按解码时间戳（归一化为秒）交错写入
    const events = [];
    for (const s of vs) events.push({ dtsSec: s.dts / vt.timescale, trackId: videoId, s });
    for (const s of as_) events.push({ dtsSec: s.dts / at.timescale, trackId: audioId, s });
    events.sort((a, b) => a.dtsSec - b.dtsSec);

    for (const e of events) {
      out.addSample(e.trackId, e.s.data, {
        duration: e.s.duration,
        dts: e.s.dts,
        cts: e.s.cts,
        is_sync: e.s.is_sync,
      });
    }

    return new Uint8Array(out.getBuffer());
  });
}

// 解封装单轨 fMP4：返回 track 信息、全部样本、样本描述（含编解码配置盒）
// 注意：mp4box 的样本回调在 appendBuffer/flush 期间同步派发，flush 返回即收集完毕
function demuxTrack(MP4Box, buffer, label) {
  return new Promise((resolve, reject) => {
    const file = MP4Box.createFile();
    const samples = [];
    let track = null;

    file.onError = (e) => reject(new Error(`${label}流解析失败: ${e}`));
    file.onReady = (info) => {
      track = info.tracks.find((t) => t.audio || t.video) || null;
      if (!track) {
        reject(new Error(`${label}流中没有音视频轨`));
        return;
      }
      file.setExtractionOptions(track.id, null, { nbSamples: Infinity });
      file.start();
    };
    file.onSamples = (_id, _user, ss) => {
      for (const s of ss) samples.push(s);
    };

    // 兼容带偏移的 TypedArray（如 Buffer）与裸 ArrayBuffer
    const ab = buffer instanceof ArrayBuffer
      ? buffer
      : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    ab.fileStart = 0;
    try {
      file.appendBuffer(ab);
      file.flush();
    } catch (e) {
      reject(new Error(`${label}流解析失败: ${e.message}`));
      return;
    }

    if (!track) {
      reject(new Error(`${label}流解析失败: 无有效轨道`));
      return;
    }
    if (!samples.length) {
      reject(new Error(`${label}流中没有可提取的样本`));
      return;
    }
    resolve({ track, samples, sampleEntry: samples[0].description });
  });
}
