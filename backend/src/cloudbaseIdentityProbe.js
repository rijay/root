const { normalizeAppCode } = require("./identity");

function readHeader(headers = {}, name) {
  const lowerName = name.toLowerCase();
  const value = headers[name] || headers[lowerName];
  return Array.isArray(value) ? value[0] : value || "";
}

function maskIdentity(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 4) return `${text.slice(0, 1)}***`;
  if (text.length <= 8) return `${text.slice(0, 2)}***${text.slice(-2)}`;
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function makeCheck(id, label, status, message) {
  return { id, label, status, message };
}

function buildCloudbaseIdentityProbe(input = {}) {
  const headers = input.headers || {};
  const appCode = normalizeAppCode(input.appCode || input.app_code || readHeader(headers, "x-root-app-code") || "MYROOT");
  const openid = String(readHeader(headers, "x-wx-openid") || "").trim();
  const unionid = String(readHeader(headers, "x-wx-unionid") || "").trim();
  const appid = String(readHeader(headers, "x-wx-appid") || readHeader(headers, "x-wx-from-appid") || "").trim();
  const openidPresent = Boolean(openid);
  const unionidPresent = Boolean(unionid);
  const checks = [
    makeCheck(
      "openid_header",
      "CloudBase openid 透传",
      openidPresent ? "PASS" : "BLOCKER",
      openidPresent ? "已收到 x-wx-openid，可用作当前小程序登录凭据。" : "未收到 x-wx-openid，CloudBase 到后端的微信身份透传不可用。"
    ),
    makeCheck(
      "unionid_header",
      "CloudBase unionid 透传",
      unionidPresent ? "PASS" : "WARNING",
      unionidPresent ? "已收到 x-wx-unionid，可验证两个小程序账号打通。" : "未收到 x-wx-unionid，微信开放平台认证或应用绑定完成后需复测。"
    ),
    makeCheck(
      "privacy_guard",
      "身份值脱敏",
      "PASS",
      "探针只返回脱敏预览，不返回原始 openid / unionid。"
    ),
  ];
  const status = !openidPresent ? "BLOCKED" : unionidPresent ? "READY" : "UNIONID_PENDING";
  const nextActions = [];
  if (!openidPresent) {
    nextActions.push("确认请求经过 CloudBase 微信小程序运行环境，并检查后端是否接收到 x-wx-openid。");
  }
  if (!unionidPresent) {
    nextActions.push("微信开放平台认证通过并绑定两个小程序后，使用同一路径复测 x-wx-unionid。");
  }
  if (openidPresent && unionidPresent) {
    nextActions.push("把该用户在 myRoot 与 Root会员中心的 unionid 映射作为账号打通验收证据。");
  }

  return {
    status,
    appCode,
    source: "cloudbase_headers",
    readyForUnionPrimaryKey: openidPresent && unionidPresent,
    openidPresent,
    unionidPresent,
    openidPreview: maskIdentity(openid),
    unionidPreview: maskIdentity(unionid),
    appidPreview: maskIdentity(appid),
    checks,
    nextActions,
  };
}

module.exports = {
  buildCloudbaseIdentityProbe,
  maskIdentity,
  readHeader,
};
