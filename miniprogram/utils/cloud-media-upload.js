const defaultEnv = require("../config/env");

function isPersistedMedia(value) {
  return /^(https:\/\/|cloud:\/\/)/i.test(String(value || "").trim());
}

function fileExtension(filePath) {
  const match = String(filePath || "").match(/\.(png|jpg|jpeg|webp)$/i);
  return match ? match[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
}

function safeSegment(value, fallback) {
  const normalized = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return normalized || fallback;
}

function uploadCloudMedia(filePath, options = {}, context = {}) {
  const api = context.wxApi || (typeof wx !== "undefined" ? wx : null);
  const env = context.env || defaultEnv;
  return new Promise((resolve) => {
    if (!filePath || isPersistedMedia(filePath)) {
      resolve(isPersistedMedia(filePath) ? filePath : "");
      return;
    }
    if (!api || !api.cloud || typeof api.cloud.uploadFile !== "function" || !env.cloudEnvId) {
      resolve("");
      return;
    }
    try {
      api.cloud.init({ env: env.cloudEnvId, traceUser: true });
    } catch (_) {
      // The app may have initialized the same CloudBase environment already.
    }
    const folder = safeSegment(options.folder, "media");
    const ownerId = safeSegment(options.ownerId, "guest");
    const suffix = `${Date.now()}-${safeSegment(options.index, "0")}-${Math.random().toString(36).slice(2, 10)}`;
    const cloudPath = `${folder}/${ownerId}/${suffix}.${fileExtension(filePath)}`;
    api.cloud.uploadFile({
      cloudPath,
      filePath,
      success: (result) => resolve(result.fileID || ""),
      fail: () => resolve(""),
    });
  });
}

function deleteCloudMedia(fileIds, context = {}) {
  const api = context.wxApi || (typeof wx !== "undefined" ? wx : null);
  const values = (Array.isArray(fileIds) ? fileIds : [fileIds]).filter((item) => /^cloud:\/\//i.test(String(item || "")));
  if (!values.length || !api || !api.cloud || typeof api.cloud.deleteFile !== "function") return Promise.resolve(false);
  return new Promise((resolve) => {
    api.cloud.deleteFile({
      fileList: values,
      success: () => resolve(true),
      fail: () => resolve(false),
    });
  });
}

module.exports = {
  deleteCloudMedia,
  isPersistedMedia,
  uploadCloudMedia,
};
