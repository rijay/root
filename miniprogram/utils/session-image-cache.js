const cachedPaths = new Map();
const inflightDownloads = new Map();

function remoteImageUrl(value) {
  const url = String(value || "").trim();
  return /^https:\/\/[^\s]+$/.test(url) || /^cloud:\/\/[^\s]+$/.test(url) ? url : "";
}

function cachedImageUrl(value) {
  const url = String(value || "").trim();
  return cachedPaths.get(url) || url;
}

function downloadImage(url) {
  return new Promise((resolve) => {
    const success = (result = {}) => {
      const tempPath = String(result.tempFilePath || "").trim();
      const statusCode = Number(result.statusCode || 200);
      resolve(tempPath && statusCode >= 200 && statusCode < 300 ? tempPath : url);
    };
    const fail = () => resolve(url);
    if (url.startsWith("cloud://") && wx.cloud && typeof wx.cloud.downloadFile === "function") {
      wx.cloud.downloadFile({ fileID: url, success, fail });
      return;
    }
    if (typeof wx.downloadFile === "function") {
      wx.downloadFile({ url, success, fail });
      return;
    }
    resolve(url);
  });
}

function prewarmSessionImage(value) {
  const original = String(value || "").trim();
  const url = remoteImageUrl(original);
  if (!url || typeof wx === "undefined") return Promise.resolve(original);
  if (cachedPaths.has(url)) return Promise.resolve(cachedPaths.get(url));
  if (inflightDownloads.has(url)) return inflightDownloads.get(url);
  const pending = downloadImage(url)
    .then((path) => {
      if (path && path !== url) cachedPaths.set(url, path);
      return path || url;
    })
    .finally(() => inflightDownloads.delete(url));
  inflightDownloads.set(url, pending);
  return pending;
}

function resetSessionImageCacheForTests() {
  cachedPaths.clear();
  inflightDownloads.clear();
}

module.exports = Object.freeze({
  cachedImageUrl,
  prewarmSessionImage,
  resetSessionImageCacheForTests,
});
