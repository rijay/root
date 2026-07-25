const { normalizeAppCode } = require("./identity");
const { normalizeVerifiedAssertion } = require("./trustedWechatIdentity");

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
  const requestedAppCodeValue = input.appCode || input.app_code || readHeader(headers, "x-root-app-code");
  const requestedAppCode = requestedAppCodeValue ? normalizeAppCode(requestedAppCodeValue) : "";
  const rawOpenidHeaderObserved = Boolean(String(readHeader(headers, "x-wx-openid") || "").trim());
  const rawUnionidHeaderObserved = Boolean(String(readHeader(headers, "x-wx-unionid") || "").trim());
  const trustedInput = input.trustedWechatIdentity || input.trusted_wechat_identity || null;
  const trustedIdentity = trustedInput ? normalizeVerifiedAssertion(trustedInput) : null;
  const appCode = trustedIdentity ? trustedIdentity.appCode : normalizeAppCode(requestedAppCodeValue || "MYROOT");
  const appCodeMismatch = Boolean(trustedIdentity && requestedAppCode && requestedAppCode !== trustedIdentity.appCode);
  const openid = trustedIdentity ? trustedIdentity.openid : "";
  const unionid = trustedIdentity ? trustedIdentity.unionid : "";
  const appid = String(readHeader(headers, "x-wx-appid") || readHeader(headers, "x-wx-from-appid") || "").trim();
  const openidPresent = Boolean(openid);
  const unionidPresent = Boolean(unionid);
  const checks = [
    makeCheck(
      "openid_header",
      "CloudBase openid 原始头观测",
      "WARNING",
      rawOpenidHeaderObserved
        ? "已观测到 x-wx-openid；原始请求头不可作为登录凭据，仍需可信身份 Adapter 验证。"
        : "未观测到 x-wx-openid，CloudBase 到后端的身份传输路径尚未得到验证。"
    ),
    makeCheck(
      "unionid_header",
      "CloudBase unionid 原始头观测",
      "WARNING",
      rawUnionidHeaderObserved
        ? "已观测到 x-wx-unionid；原始请求头不能证明两个小程序账号已可信打通。"
        : "未观测到 x-wx-unionid，微信开放平台认证或应用绑定完成后需复测。"
    ),
    makeCheck(
      "trusted_identity",
      "可信微信身份断言",
      openidPresent ? "PASS" : "BLOCKER",
      openidPresent
        ? `可信身份 Adapter 已验证 ${trustedIdentity.source} 身份断言。`
        : "未取得可信微信身份 Adapter 的断言；不得用原始 X-WX-* 请求头登录或关闭身份 Gate。"
    ),
    makeCheck(
      "trusted_app_code",
      "可信微信应用归属",
      appCodeMismatch ? "BLOCKER" : trustedIdentity ? "PASS" : "BLOCKER",
      appCodeMismatch
        ? "请求应用与可信身份 Adapter 断言的 appCode 不一致，禁止绑定。"
        : trustedIdentity
          ? `应用归属由可信身份 Adapter 断言为 ${trustedIdentity.appCode}。`
          : "未取得可信 appCode，客户端 body/header 不能决定微信身份所属应用。"
    ),
    makeCheck(
      "privacy_guard",
      "身份值脱敏",
      "PASS",
      "探针只返回脱敏预览，不返回原始 openid / unionid。"
    ),
  ];
  const status = !openidPresent || appCodeMismatch ? "BLOCKED" : unionidPresent ? "READY" : "UNIONID_PENDING";
  const nextActions = [];
  if (!openidPresent) {
    nextActions.push("接入并验证 CloudBase 或微信网关可信身份 Adapter，再用同一路径复测；原始请求头观测不能替代该证明。");
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
    source: trustedIdentity ? trustedIdentity.source : "UNVERIFIED_TRANSPORT",
    appCodeMismatch,
    readyForUnionPrimaryKey: openidPresent && unionidPresent,
    openidPresent,
    unionidPresent,
    rawOpenidHeaderObserved,
    rawUnionidHeaderObserved,
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
