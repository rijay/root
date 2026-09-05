const env = require("../config/env");
const router = require("./router");
const { openProducts } = require("./product-navigation");
const { FIXED_GUT_ASSESSMENT_PATH } = require("./gut-assessment-entry");

function isRootMemberCenterShortLink(value) {
  return /^#小程序:\/\/ROOT会员(?:中心|商城)\/[A-Za-z0-9_-]{4,80}$/.test(String(value || "").trim());
}

async function executeContentAction(action) {
  if (!action) return false;
  if (action.type === "PRODUCTS") {
    openProducts(action.productId || "", action.source || "content_banner");
    return true;
  }
  if (action.type === "MINIPROGRAM_PAGE") {
    if (action.path === FIXED_GUT_ASSESSMENT_PATH) {
      router.open(action.path);
      return true;
    }
    const allowed = await router.routeGuard(action.path);
    if (!allowed) return false;
    router.open(action.path);
    return true;
  }
  if (action.type === "ROOT_MEMBER_CENTER") {
    if (isRootMemberCenterShortLink(action.shortLink)) {
      wx.navigateToMiniProgram({
        shortLink: action.shortLink,
        fail() {
          wx.showToast({ title: "会员中心暂时无法打开", icon: "none" });
        },
      });
      return true;
    }
    if (!env.rootMemberCenterAppId || action.appId !== env.rootMemberCenterAppId) return false;
    wx.navigateToMiniProgram({ appId: action.appId, path: action.path });
    return true;
  }
  if (action.type === "BUSINESS_WEBVIEW" && /^[A-Za-z0-9_-]{3,80}$/.test(String(action.actionId || ""))) {
    router.open(`/subpkg/content/pages/webview/index?actionId=${encodeURIComponent(action.actionId)}`);
    return true;
  }
  wx.showToast({ title: "该内容暂不可跳转", icon: "none" });
  return false;
}

module.exports = { executeContentAction, isRootMemberCenterShortLink };
