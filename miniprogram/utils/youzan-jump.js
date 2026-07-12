const env = require("../config/env");

const PLACEHOLDER_APP_IDS = ["", "wx1234567890abcdef", "wx0000000000000000"];

function isConfiguredAppId(appId) {
  return !PLACEHOLDER_APP_IDS.includes(String(appId || "").trim());
}

function isMiniProgramShortLink(value) {
  return /^#小程序:\/\//.test(String(value || "").trim());
}

function mergeJumpTarget(product = {}, jumpResult = {}) {
  const target = jumpResult.jumpTarget || product.youzan || {};
  const productId = product.productId || product.youzanProductId || "";
  const rawPath = target.path || env.youzanProductPath || "";
  const shortLink = target.shortLink || target.short_link || (isMiniProgramShortLink(rawPath) ? rawPath : "");
  return {
    appId: target.appId || env.youzanAppId || "",
    path: shortLink ? "" : rawPath,
    shortLink,
    envVersion: target.envVersion || "release",
    extraData: {
      from: "myroot_product",
      productId,
      ...((target && target.extraData) || {}),
    },
  };
}

function jumpToYouzanProduct(target) {
  return new Promise((resolve, reject) => {
    if (target.shortLink) {
      wx.navigateToMiniProgram({
        shortLink: target.shortLink,
        envVersion: target.envVersion || "release",
        success: resolve,
        fail() {
          reject(new Error("跳转失败，请稍后重试"));
        },
      });
      return;
    }
    if (!isConfiguredAppId(target.appId)) {
      reject(new Error("Root 会员中心暂未配置"));
      return;
    }
    wx.navigateToMiniProgram({
      appId: target.appId,
      path: target.path,
      extraData: target.extraData || {},
      envVersion: target.envVersion || "release",
      success: resolve,
      fail() {
        reject(new Error("跳转失败，请稍后重试"));
      },
    });
  });
}

module.exports = {
  isConfiguredAppId,
  isMiniProgramShortLink,
  jumpToYouzanProduct,
  mergeJumpTarget,
};
