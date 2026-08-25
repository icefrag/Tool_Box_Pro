// offscreen：接收分块数据，拼 blob 并生成 blob URL
// （MV3 service worker 无法稳定持有 blob，官方 BLOBS 场景 offscreen 方案）
const jobs = new Map(); // downloadId -> { chunks: Uint8Array[], mimeType }

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return false;
  (async () => {
    const { command, downloadId } = msg;
    const job = jobs.get(downloadId) || { chunks: [], mimeType: '' };

    if (command === 'begin') {
      job.mimeType = msg.mimeType || '';
      jobs.set(downloadId, job);
      sendResponse({ success: true, data: {} });
    } else if (command === 'chunk') {
      job.chunks.push(new Uint8Array(msg.data));
      jobs.set(downloadId, job);
      sendResponse({ success: true, data: { received: job.chunks.length } });
    } else if (command === 'finish') {
      const total = job.chunks.reduce((n, c) => n + c.byteLength, 0);
      const out = new Uint8Array(total);
      let offset = 0;
      for (const c of job.chunks) {
        out.set(c, offset);
        offset += c.byteLength;
      }
      const blob = new Blob([out], { type: job.mimeType || 'video/mp4' });
      jobs.delete(downloadId);
      sendResponse({ success: true, data: { blobUrl: URL.createObjectURL(blob) } });
    } else if (command === 'revoke') {
      if (msg.blobUrl) URL.revokeObjectURL(msg.blobUrl);
      sendResponse({ success: true, data: {} });
    } else if (command === 'abort') {
      jobs.delete(downloadId);
      sendResponse({ success: true, data: {} });
    }
  })();
  return true; // 异步 sendResponse
});
