const env = require("../config/env");

function isPersistedAvatar(value) {
  return /^(https?:\/\/|cloud:\/\/)/i.test(String(value || "").trim());
}

function fileExtension(filePath) {
  const match = String(filePath || "").match(/\.(png|jpg|jpeg|webp)$/i);
  return match ? match[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
}

function uploadCloudAvatar(filePath, userId) {
  return new Promise((resolve) => {
    if (!filePath || isPersistedAvatar(filePath) || !wx.cloud || !wx.cloud.uploadFile || !env.cloudEnvId) {
      resolve(isPersistedAvatar(filePath) ? filePath : "");
      return;
    }

    try {
      wx.cloud.init({ env: env.cloudEnvId, traceUser: true });
    } catch (error) {
      // wx.cloud may already be initialized by app.js; continue to upload.
    }

    const safeUserId = String(userId || "guest").replace(/[^a-zA-Z0-9_-]/g, "");
    const cloudPath = `avatars/${safeUserId || "guest"}-${Date.now()}.${fileExtension(filePath)}`;
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success(result) {
        resolve(result.fileID || "");
      },
      fail() {
        resolve("");
      },
    });
  });
}

module.exports = {
  isPersistedAvatar,
  uploadCloudAvatar,
};
