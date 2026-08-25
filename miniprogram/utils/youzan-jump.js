const env = require("../config/env");

const PLACEHOLDER_APP_IDS = ["", "wx1234567890abcdef", "wx0000000000000000"];

function isConfiguredAppId(appId) {
  return !PLACEHOLDER_APP_IDS.includes(String(appId || "").trim());
}

function isMiniProgramShortLink(value) {
  return /^#小程序:\/\//.test(String(value || "").trim());
}

function isConfiguredProductPath(value, allowedQueryKeys = ["alias", "shopAutoEnter"]) {
  const path = String(value || "").trim();
  if (!path || isMiniProgramShortLink(path)) return false;
  const [pathname, query = ""] = path.split("?");
  if (pathname !== "packages/goods/detail/index") return false;
  const allowed = new Set(allowedQueryKeys.map((key) => String(key || "").trim()).filter(Boolean));
  const entries = query.split("&").filter(Boolean);
  if (!entries.length || entries.some((entry) => !allowed.has(entry.split("=")[0]))) return false;
  return entries.some((entry) => {
    const [key, rawValue = ""] = entry.split("=");
    if (key !== "alias") return false;
    try {
      return Boolean(decodeURIComponent(rawValue).trim());
    } catch (_) {
      return false;
    }
  });
}

function mergeJumpTarget(product = {}, jumpResult = {}) {
  const target = jumpResult.jumpTarget || product.youzan || {};
  const productId = product.productId || product.youzanProductId || "";
  const rawPath = target.path || env.youzanProductPath || "";
  const shortLink = target.shortLink || target.short_link || (isMiniProgramShortLink(rawPath) ? rawPath : "");
  return {
    enabled: target.enabled !== false,
    appId: target.appId || env.youzanAppId || "",
    path: shortLink ? "" : rawPath,
    shortLink,
    allowedQueryKeys: target.allowedQueryKeys || ["alias", "shopAutoEnter"],
    updatedAt: target.updatedAt || "",
    envVersion: target.envVersion || "release",
    extraData: {
      from: "myroot_product",
      productId,
      ...((target && target.extraData) || {}),
    },
  };
}

function jumpError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function jumpToYouzanProduct(target) {
  return new Promise((resolve, reject) => {
    if (target.enabled === false) {
      reject(jumpError("PRODUCT_DISABLED", "该商品暂不可购买"));
      return;
    }
    if (target.shortLink) {
      wx.navigateToMiniProgram({
        shortLink: target.shortLink,
        envVersion: target.envVersion || "release",
        success: resolve,
        fail() {
          reject(jumpError("MINIPROGRAM_JUMP_FAILED", "跳转失败，请稍后重试"));
        },
      });
      return;
    }
    if (!isConfiguredAppId(target.appId)) {
      reject(jumpError("MEMBER_APP_UNCONFIGURED", "Root 会员中心暂未配置"));
      return;
    }
    if (!isConfiguredProductPath(target.path, target.allowedQueryKeys)) {
      reject(jumpError("PRODUCT_PATH_INVALID", "Root 会员中心商品路径暂未配置"));
      return;
    }
    wx.navigateToMiniProgram({
      appId: target.appId,
      path: target.path,
      extraData: target.extraData || {},
      envVersion: target.envVersion || "release",
      success: resolve,
      fail() {
        reject(jumpError("MINIPROGRAM_JUMP_FAILED", "跳转失败，请稍后重试"));
      },
    });
  });
}

module.exports = {
  isConfiguredAppId,
  isConfiguredProductPath,
  isMiniProgramShortLink,
  jumpToYouzanProduct,
  jumpError,
  mergeJumpTarget,
};
