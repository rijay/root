const env = require("../config/env");
const router = require("./router");

async function executeContentAction(action) {
  if (!action) return false;
  if (action.type === "MINIPROGRAM_PAGE") {
    const allowed = await router.routeGuard(action.path);
    if (!allowed) return false;
    router.open(action.path);
    return true;
  }
  if (action.type === "ROOT_MEMBER_CENTER") {
    if (!env.rootMemberCenterAppId || action.appId !== env.rootMemberCenterAppId) return false;
    wx.navigateToMiniProgram({ appId: action.appId, path: action.path });
    return true;
  }
  wx.showToast({ title: "该内容暂不可跳转", icon: "none" });
  return false;
}

module.exports = { executeContentAction };
