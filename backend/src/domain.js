const crypto = require("node:crypto");
const fs = require("node:fs");
const { createClientError } = require("./clientError");
const { resolveWechatOpenApiUrl } = require("./wechatOpenApiEndpoint");
const { addDays, daysBetween, nowISO, todayISO } = require("./dates");
const adapterRetryScheduler = require("./adapterRetryScheduler");
const adapterCalibration = require("./adapterCalibration");
const actionAdapterCalibration = require("./actionAdapterCalibration");
const adminAnalyticsPresenter = require("./adminAnalyticsPresenter");
const adminLifecycleFilterPresets = require("./adminLifecycleFilterPresets");
const adminLifecyclePresenter = require("./adminLifecyclePresenter");
const adminLifecycleUserExports = require("./adminLifecycleUserExports");
const adminOrderMatching = require("./adminOrderMatching");
const adminOrderIncrementSync = require("./adminOrderIncrementSync");
const adminProductSync = require("./adminProductSync");
const adminOpsPresenter = require("./adminOpsPresenter");
const adminUserPresenter = require("./adminUserPresenter");
const auditLog = require("./auditLog");
const activityModule = require("./activityModule");
const campaign = require("./campaign");
const consultationAdvisorAssignment = require("./consultationAdvisorAssignment");
const consultationAdvisorWorkbench = require("./consultationAdvisorWorkbench");
const consultationFollowup = require("./consultationFollowup");
const consultationSla = require("./consultationSla");
const consultationSlaEscalation = require("./consultationSlaEscalation");
const consultationWeworkWriteback = require("./consultationWeworkWriteback");
const {
  VERIFIED_UNIONID_RESOLUTION,
  listVerifiedWechatUnionIdAuthorities,
  resolveVerifiedWechatUnionIdOwnership,
} = require("./wechatUnionIdAuthority");
const coupon = require("./coupon");
const cloudbaseIdentityProbe = require("./cloudbaseIdentityProbe");
const contentModule = require("./contentModule");
const formalHealthModule = require("./formalHealthModule");
const csvImport = require("./csvImport");
const externalAdapterSamples = require("./externalAdapterSamples");
const externalPlatformAdapters = require("./externalPlatformAdapters");
const { getHomeViewModel } = require("./flowView");
const {
  findRootUser,
  identifyUser,
  normalizeAppCode,
  normalizePhone,
  recordLifecycleEvent,
  resolveByWechatLogin,
} = require("./identity");
const launchReadiness = require("./launchReadiness");
const adminLegacyDeprecationDecision = require("./adminLegacyDeprecationDecision");
const manualCorrection = require("./manualCorrection");
const operationTask = require("./operationTask");
const orderAfterSales = require("./orderAfterSales");
const orderFulfillment = require("./orderFulfillment");
const operationalAlerts = require("./operationalAlerts");
const productMirror = require("./productMirror");
const productionCutoverProof = require("./productionCutoverProof");
const healthDataRetention = require("./healthDataRetention");
const privacyConsent = require("./privacyConsent");
const profileModule = require("./profileModule");
const questionnaire = require("./questionnaire");
const releaseEvidenceArchive = require("./releaseEvidenceArchive");
const releaseEvidencePack = require("./releaseEvidencePack");
const releaseRecord = require("./releaseRecord");
const releaseSignoff = require("./releaseSignoff");
const rootMemberCenterJumpProof = require("./rootMemberCenterJumpProof");
const sessionModule = require("./sessionModule");
const refundWorkItem = require("./refundWorkItem");
const { fetchWechatJson } = require("./wechatHttp");
const { resolveWechatAccessToken } = require("./wechatAccessToken");
const weworkTouch = require("./weworkTouch");
const youzanCustomerMirror = require("./youzanCustomerMirror");
const { buildProductionEnvMatrix } = require("./productionEnvMatrix");
const {
  buildCloudbaseJobManifest,
  validateCloudbaseJobManifest,
} = require("../scripts/cloudbase-job-manifest");
const { createId, createSeedData } = require("./seed");
const { isProtectedRuntime, sessionTokenDigest } = require("./credentialProtection");
const {
  normalizeVerifiedAssertion,
  normalizeWechatSessionIdentity,
} = require("./trustedWechatIdentity");

const STATES = {
  GUEST: "GUEST",
  UNREGISTERED: "UNREGISTERED",
  REGISTERED_IDLE: "REGISTERED_IDLE",
  CHECKIN_ACTIVE: "CHECKIN_ACTIVE",
  CHECKIN_COMPLETED: "CHECKIN_COMPLETED",
  CHECKIN_FAILED: "CHECKIN_FAILED",
  DAILY_USER: "DAILY_USER",
};

const CLOUDBASE_ACCESS_TOKEN_FILE = "/.tencentcloudbase/wx/cloudbase_access_token";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const ROUTES_BY_STATE = {
  GUEST: "/pages/home/index",
  UNREGISTERED: "/pages/register/index",
  REGISTERED_IDLE: "/pages/home/index",
  CHECKIN_ACTIVE: "/pages/home/index",
  CHECKIN_COMPLETED: "/pages/home/index",
  CHECKIN_FAILED: "/pages/home/index",
  DAILY_USER: "/pages/home/index",
};

const LEGACY_ROUTES_BY_STATE = {
  ...ROUTES_BY_STATE,
  UNREGISTERED: "/pages/home/index",
};

const ROUTE_PERMISSIONS = {
  "/pages/login/index": [STATES.GUEST],
  "/pages/register/index": [STATES.UNREGISTERED],
  "/pages/health-consent/index": [STATES.UNREGISTERED, STATES.REGISTERED_IDLE, STATES.CHECKIN_ACTIVE, STATES.CHECKIN_COMPLETED, STATES.CHECKIN_FAILED, STATES.DAILY_USER],
  "/pages/activity/index": [STATES.REGISTERED_IDLE],
  "/pages/order/match": [STATES.REGISTERED_IDLE],
  "/pages/products/index": [STATES.UNREGISTERED, STATES.REGISTERED_IDLE, STATES.CHECKIN_ACTIVE, STATES.CHECKIN_COMPLETED, STATES.CHECKIN_FAILED, STATES.DAILY_USER],
  "/pages/product-detail/index": [STATES.UNREGISTERED, STATES.REGISTERED_IDLE, STATES.CHECKIN_ACTIVE, STATES.CHECKIN_COMPLETED, STATES.CHECKIN_FAILED, STATES.DAILY_USER],
  "/pages/tasks/index": [STATES.UNREGISTERED, STATES.REGISTERED_IDLE, STATES.CHECKIN_ACTIVE, STATES.CHECKIN_COMPLETED, STATES.CHECKIN_FAILED, STATES.DAILY_USER],
  "/pages/rewards/index": [STATES.UNREGISTERED, STATES.REGISTERED_IDLE, STATES.CHECKIN_ACTIVE, STATES.CHECKIN_COMPLETED, STATES.CHECKIN_FAILED, STATES.DAILY_USER],
  "/pages/home/index": [STATES.GUEST, STATES.UNREGISTERED, STATES.REGISTERED_IDLE, STATES.CHECKIN_ACTIVE, STATES.CHECKIN_COMPLETED, STATES.CHECKIN_FAILED, STATES.DAILY_USER],
  "/subpkg/task/pages/checkin/index": [STATES.UNREGISTERED, STATES.REGISTERED_IDLE, STATES.CHECKIN_ACTIVE],
  "/subpkg/task/pages/questionnaire/index": [STATES.UNREGISTERED, STATES.REGISTERED_IDLE, STATES.CHECKIN_ACTIVE, STATES.CHECKIN_COMPLETED, STATES.CHECKIN_FAILED, STATES.DAILY_USER],
  "/subpkg/task/pages/progress/index": [STATES.UNREGISTERED, STATES.REGISTERED_IDLE, STATES.CHECKIN_ACTIVE, STATES.CHECKIN_COMPLETED, STATES.CHECKIN_FAILED, STATES.DAILY_USER],
  "/subpkg/checkin/pages/today/index": [STATES.CHECKIN_ACTIVE],
  "/subpkg/checkin/pages/history/index": [STATES.CHECKIN_ACTIVE, STATES.CHECKIN_COMPLETED, STATES.CHECKIN_FAILED, STATES.DAILY_USER],
  "/subpkg/checkin/pages/result/index": [STATES.CHECKIN_ACTIVE, STATES.CHECKIN_COMPLETED, STATES.CHECKIN_FAILED, STATES.DAILY_USER],
  "/subpkg/checkin/pages/share-poster/index": [STATES.CHECKIN_ACTIVE, STATES.CHECKIN_COMPLETED, STATES.DAILY_USER],
  "/subpkg/checkin/pages/questionnaire/index": [STATES.CHECKIN_ACTIVE, STATES.CHECKIN_COMPLETED],
  "/subpkg/refund/pages/apply/index": [STATES.CHECKIN_COMPLETED],
  "/subpkg/refund/pages/status/index": [STATES.CHECKIN_COMPLETED, STATES.DAILY_USER],
  "/subpkg/profile/pages/tags/index": [STATES.UNREGISTERED, STATES.REGISTERED_IDLE, STATES.CHECKIN_ACTIVE, STATES.CHECKIN_COMPLETED, STATES.CHECKIN_FAILED, STATES.DAILY_USER],
  "/subpkg/profile/pages/orders/index": [STATES.REGISTERED_IDLE, STATES.CHECKIN_ACTIVE, STATES.CHECKIN_COMPLETED, STATES.CHECKIN_FAILED, STATES.DAILY_USER],
  "/subpkg/profile/pages/about/index": [STATES.GUEST, STATES.UNREGISTERED, STATES.REGISTERED_IDLE, STATES.CHECKIN_ACTIVE, STATES.CHECKIN_COMPLETED, STATES.CHECKIN_FAILED, STATES.DAILY_USER],
  "/subpkg/profile/pages/support/index": [STATES.GUEST, STATES.UNREGISTERED, STATES.REGISTERED_IDLE, STATES.CHECKIN_ACTIVE, STATES.CHECKIN_COMPLETED, STATES.CHECKIN_FAILED, STATES.DAILY_USER],
  "/pages/profile/index": [STATES.UNREGISTERED, STATES.REGISTERED_IDLE, STATES.CHECKIN_ACTIVE, STATES.CHECKIN_COMPLETED, STATES.CHECKIN_FAILED, STATES.DAILY_USER],
};

const profileQuestions = [
  {
    field: "joinReasons",
    type: "multi",
    title: "参与本次试饮的原因",
    options: [
      { value: "health", label: "饮食健康/便型调理" },
      { value: "gut_flora", label: "肠道菌群改善" },
      { value: "skin", label: "皮肤/情绪/睡眠改善" },
      { value: "none", label: "没有特殊原因", exclusive: true },
    ],
  },
  {
    field: "gutHealthStatus",
    type: "single",
    title: "您的肠道健康状况",
    options: [
      { value: "good", label: "良好，无明显问题" },
      { value: "normal", label: "一般，偶尔有问题" },
      { value: "poor", label: "较差，经常有问题" },
      { value: "very_poor", label: "很差，长期困扰" },
    ],
  },
  {
    field: "improvementMethods",
    type: "multi",
    title: "您目前肠道健康改善的方式",
    options: [
      { value: "diet", label: "调整饮食结构" },
      { value: "exercise", label: "规律运动" },
      { value: "probiotics", label: "服用益生菌/益生元" },
      { value: "medical", label: "看医生/吃药" },
      { value: "none", label: "暂未采取任何方式", exclusive: true },
    ],
  },
  {
    field: "stoolType",
    type: "stool",
    title: "便便日常是什么类型",
    options: [
      { value: "type1", label: "第一型：分散硬球，难排便" },
      { value: "type2", label: "第二型：腊肠状但表面凹凸" },
      { value: "type3", label: "第三型：腊肠状但表面有裂痕" },
      { value: "type4", label: "第四型：光滑柔软的腊肠状" },
      { value: "type5", label: "第五型：断边光滑的柔软块状" },
      { value: "type6", label: "第六型：粗边蓬松糊状" },
      { value: "type7", label: "第七型：水状无固体" },
    ],
  },
];

function createStore() {
  return createSeedData();
}

function getWechatConfig(env = process.env) {
  return {
    appid: env.ROOT_WECHAT_APPID || env.WECHAT_APPID || env.WX_APPID || "",
    secret: env.ROOT_WECHAT_APPSECRET || env.WECHAT_APPSECRET || env.WECHAT_SECRET || env.WX_SECRET || "",
  };
}

function isDirectPhoneLoginAllowed(env = process.env) {
  return !isProtectedRuntime(env) && String(env.ROOT_ALLOW_DIRECT_PHONE_LOGIN || "").toLowerCase() === "true";
}

function maskPhone(phone) {
  const text = String(phone || "");
  if (text.length < 7) return text;
  return `${text.slice(0, 3)}****${text.slice(-4)}`;
}

function verifiedUnionIdSummary(data, user, context = {}) {
  if (!data || !user) return { unionidStatus: "PENDING" };
  const rootUserId = user.root_user_id || user.user_id;
  const env = context.env || context || process.env;
  const authorities = listVerifiedWechatUnionIdAuthorities(data.wechatIdentities, { env })
    .filter((item) => item.rootUserId === rootUserId);
  const unionids = [...new Set(authorities.map((item) => item.unionid))];
  if (unionids.length !== 1) return { unionidStatus: "PENDING" };
  const ownership = resolveVerifiedWechatUnionIdOwnership(data.wechatIdentities, unionids[0], { env });
  return ownership.status === VERIFIED_UNIONID_RESOLUTION.VERIFIED
    && ownership.rootUserId === rootUserId
    ? { unionidStatus: "LINKED" }
    : { unionidStatus: "PENDING" };
}

function publicUser(user, data, context = {}) {
  if (!user) return { state: STATES.GUEST };
  const identity = verifiedUnionIdSummary(data, user, context);
  return {
    userId: user.user_id,
    rootUserId: user.root_user_id || user.user_id,
    phone: maskPhone(user.phone),
    state: user.state,
    lifecycleStatus: user.lifecycle_status || user.state,
    unionidStatus: identity.unionidStatus,
    appCode: user.app_code || "MYROOT",
    nickname: user.nickname || "ROOT体验官",
    avatarUrl: user.avatar_url || "",
    totalCheckinDays: user.total_checkin_days || 0,
    currentStreak: user.current_streak || 0,
    longestStreak: user.longest_streak || 0,
    lastCheckinDate: user.last_checkin_date || "",
  };
}

function isOpenidLoginAllowed(env = process.env) {
  return !isProtectedRuntime(env) && String(env.ROOT_ALLOW_OPENID_LOGIN || "").toLowerCase() === "true";
}

function isMyRootRebuildEnabled(env = process.env) {
  return String(env.MYROOT_REBUILD_ENABLED || "true").toLowerCase() !== "false";
}

function routesForEnv(env = process.env) {
  return isMyRootRebuildEnabled(env) ? ROUTES_BY_STATE : LEGACY_ROUTES_BY_STATE;
}

function routeForUser(user, env = process.env) {
  const routes = routesForEnv(env);
  return routes[user && user.state] || routes.GUEST;
}

function syncRootLifecycle(data, user, eventType, context = {}) {
  if (!user) return null;
  const rootUser = findRootUser(data, user.root_user_id || user.user_id);
  if (rootUser) {
    rootUser.lifecycle_status = user.state;
    rootUser.updated_at = nowISO();
  }
  user.lifecycle_status = user.state;
  return recordLifecycleEvent(data, user.root_user_id || user.user_id, eventType, context);
}

function normalizeNickname(value) {
  const text = String(value || "").trim();
  if (!text || text === "微信用户") return "";
  return text.slice(0, 24);
}

function normalizeAvatarUrl(value) {
  const text = String(value || "").trim();
  if (!/^(https?:\/\/|cloud:\/\/)/i.test(text)) return "";
  return text;
}

function applyUserDisplayProfile(user, body = {}) {
  const nickname = normalizeNickname(body.nickname || body.nickName);
  const avatarUrl = normalizeAvatarUrl(body.avatarUrl || body.avatar_url);
  if (nickname) user.nickname = nickname;
  if (avatarUrl) user.avatar_url = avatarUrl;
}

function addMsToNowIso(ms) {
  return nowISO(new Date(Date.now() + ms));
}

function isExpiredAt(value) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time <= Date.now();
}

function issueToken(data, userId) {
  const token = `root_${crypto.randomBytes(18).toString("hex")}`;
  const tokenHash = sessionTokenDigest(token);
  const now = nowISO();
  const session = {
    session_id: createId("ses"),
    token_hash: tokenHash,
    user_id: userId,
    created_at: now,
    last_seen_at: now,
    expires_at: addMsToNowIso(SESSION_TTL_MS),
    revoked_at: "",
  };
  ensureList(data, "sessions").push(session);
  data.tokens[tokenHash] = userId;
  return { ...session, token };
}

function findUserByToken(data, token) {
  if (!token) return null;
  const tokenHash = sessionTokenDigest(token);
  let session = ensureList(data, "sessions").find((item) => item.token_hash === tokenHash && !item.revoked_at);
  if (!session) {
    session = ensureList(data, "sessions").find((item) => item.token === token && !item.revoked_at);
    if (session) {
      session.token_hash = tokenHash;
      delete session.token;
      delete data.tokens[token];
    }
  }
  if (session) {
    if (isExpiredAt(session.expires_at)) {
      session.revoked_at = nowISO();
      delete data.tokens[tokenHash];
      return null;
    }
    session.last_seen_at = nowISO();
    data.tokens[tokenHash] = session.user_id;
    return data.users.find((user) => user.user_id === session.user_id) || null;
  }
  return null;
}

function stableRootUserIdForToken(data, token) {
  if (!token) return "";
  const tokenHash = sessionTokenDigest(token);
  const sessions = Array.isArray(data && data.sessions) ? data.sessions : [];
  const session = sessions.find((item) => (
    (item.token_hash === tokenHash || item.token === token) && !item.revoked_at
  ));
  if (!session || isExpiredAt(session.expires_at)) return "";
  const users = Array.isArray(data && data.users) ? data.users : [];
  const user = users.find((item) => item.user_id === session.user_id);
  return user ? user.root_user_id || user.user_id : "";
}

function requireUser(data, token) {
  const user = findUserByToken(data, token);
  if (!user) {
    throw createClientError(1003, "登录已过期，请重新登录", 401);
  }
  return user;
}

function response(data) {
  return { code: 0, message: "ok", data };
}

function getHealthConsentStatus(data, token, context = {}) {
  const user = requireUser(data, token);
  return response(privacyConsent.getHealthConsentStatus(data, user.root_user_id || user.user_id, context));
}

function getPrivacyNotice(context = {}) {
  return response({
    ...privacyConsent.getPublicPrivacyNotice(context),
    ...(context.runtimeMetadata || {}),
  });
}

function recordHealthConsentDecision(data, token, body = {}, context = {}) {
  const user = requireUser(data, token);
  const rootUserId = user.root_user_id || user.user_id;
  const result = privacyConsent.recordHealthConsentDecision(data, rootUserId, body, {
    ...context,
    sourceChannel: "MINIPROGRAM_HEALTH_CONSENT",
  });
  if (result.recorded && result.record) {
    recordLifecycleEvent(data, rootUserId, "HEALTH_CONSENT_DECISION_RECORDED", {
      sourceChannel: result.record.sourceChannel,
      appCode: user.app_code || "MYROOT",
      metadata: {
        consentType: result.record.consentType,
        policyVersion: result.record.policyVersion,
        decision: result.record.decision,
        consentRecordId: result.record.consentRecordId,
      },
    });
  }
  return response(result);
}

function clone(value) {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function businessError(code, message, status = 200) {
  return createClientError(code, message, status);
}

function readCloudbaseAccessToken() {
  try {
    if (!fs.existsSync(CLOUDBASE_ACCESS_TOKEN_FILE)) return "";
    return fs.readFileSync(CLOUDBASE_ACCESS_TOKEN_FILE, "utf8").trim();
  } catch (error) {
    return "";
  }
}

function getHeader(headers = {}, name) {
  const lowerName = name.toLowerCase();
  const value = headers[name] || headers[lowerName];
  return Array.isArray(value) ? value[0] : value || "";
}

function normalizeWechatContext(context) {
  if (context && context.env) {
    return {
      env: context.env,
      headers: context.headers || {},
      trustedWechatIdentity: context.trustedWechatIdentity || null,
      trustedPhoneNumber: context.trustedPhoneNumber || "",
    };
  }
  return {
    env: context || process.env,
    headers: {},
    trustedWechatIdentity: null,
    trustedPhoneNumber: "",
  };
}

function shouldUseCloudbaseOpenApi(identity) {
  return Boolean(identity && identity.openid && identity.source === "CLOUDBASE");
}

async function fetchCloudbaseWechatJson(pathname, options, env = process.env) {
  const url = resolveWechatOpenApiUrl(pathname, env);
  const cloudbaseAccessToken = readCloudbaseAccessToken();
  if (cloudbaseAccessToken) url.searchParams.set("cloudbase_access_token", cloudbaseAccessToken);
  return fetchWechatJson(url, options);
}

async function getWechatPhoneNumber(config, phoneCode) {
  const accessToken = await resolveWechatAccessToken(config);
  const url = new URL("https://api.weixin.qq.com/wxa/business/getuserphonenumber");
  url.searchParams.set("access_token", accessToken);
  const payload = await fetchWechatJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: phoneCode }),
  });
  const phoneInfo = payload.phone_info || {};
  return normalizePhone(phoneInfo.phoneNumber || phoneInfo.purePhoneNumber);
}

async function getCloudbaseWechatPhoneNumber(phoneCode, env) {
  const payload = await fetchCloudbaseWechatJson("/wxa/business/getuserphonenumber", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: phoneCode }),
  }, env);
  const phoneInfo = payload.phone_info || {};
  return normalizePhone(phoneInfo.phoneNumber || phoneInfo.purePhoneNumber);
}

async function getWechatSession(config, wxCode, env = process.env) {
  if (!wxCode) return {};
  const url = resolveWechatOpenApiUrl("/sns/jscode2session", env);
  url.searchParams.set("appid", config.appid);
  url.searchParams.set("secret", config.secret);
  url.searchParams.set("js_code", wxCode);
  url.searchParams.set("grant_type", "authorization_code");
  return fetchWechatJson(url);
}

function resolveWechatLoginAppCode(body, runtime, trustedWechatIdentity = null) {
  const env = runtime.env;
  const requestedAppCodeValue = body.appCode
    || body.app_code
    || getHeader(runtime.headers, "x-root-app-code");
  const requestedAppCode = requestedAppCodeValue
    ? normalizeAppCode(requestedAppCodeValue)
    : "";
  const deploymentAppCode = isProtectedRuntime(env)
    ? normalizeAppCode(env.ROOT_WECHAT_APP_CODE || "MYROOT")
    : "";
  if (
    trustedWechatIdentity
    && deploymentAppCode
    && trustedWechatIdentity.appCode !== deploymentAppCode
  ) {
    throw businessError(
      "TRUSTED_WECHAT_DEPLOYMENT_APP_CODE_MISMATCH",
      "可信微信身份与当前部署应用不一致",
      401
    );
  }
  if (
    trustedWechatIdentity
    && requestedAppCode
    && requestedAppCode !== trustedWechatIdentity.appCode
  ) {
    throw businessError(
      "TRUSTED_WECHAT_APP_CODE_MISMATCH",
      "请求应用与可信微信身份所属应用不一致",
      401
    );
  }
  if (
    !trustedWechatIdentity
    && deploymentAppCode
    && requestedAppCode
    && requestedAppCode !== deploymentAppCode
  ) {
    throw businessError(
      "WECHAT_DEPLOYMENT_APP_CODE_MISMATCH",
      "请求应用与当前微信部署应用不一致",
      401
    );
  }
  return trustedWechatIdentity
    ? trustedWechatIdentity.appCode
    : deploymentAppCode || normalizeAppCode(requestedAppCodeValue);
}

async function prepareWechatLoginExternalInputs(body = {}, context = process.env) {
  const runtime = normalizeWechatContext(context);
  const env = runtime.env;
  let trustedWechatIdentity = runtime.trustedWechatIdentity
    ? normalizeVerifiedAssertion(runtime.trustedWechatIdentity)
    : null;
  const appCode = resolveWechatLoginAppCode(body, runtime, trustedWechatIdentity);
  const shouldUseWechatPhone = !body.phone && body.phoneCode;

  if (!trustedWechatIdentity && body.wxCode) {
    const config = getWechatConfig(env);
    if (!config.appid || !config.secret) {
      throw businessError(1006, "服务端未配置微信登录密钥");
    }
    trustedWechatIdentity = normalizeWechatSessionIdentity(
      await getWechatSession(config, body.wxCode, env),
      appCode
    );
  }

  let trustedPhoneNumber = "";
  if (shouldUseWechatPhone) {
    if (shouldUseCloudbaseOpenApi(trustedWechatIdentity)) {
      trustedPhoneNumber = await getCloudbaseWechatPhoneNumber(body.phoneCode, env);
    } else {
      const config = getWechatConfig(env);
      if (!config.appid || !config.secret) {
        throw businessError(1006, "服务端未配置微信登录密钥");
      }
      trustedPhoneNumber = await getWechatPhoneNumber(config, body.phoneCode);
    }
  }

  return Object.freeze({
    trustedWechatIdentity,
    trustedPhoneNumber,
  });
}

function currentSessionForUser(data, userId) {
  return data.checkinSessions.find((session) => {
    return session.user_id === userId && ["ACTIVE", "COMPLETED", "FAILED", "REFUNDED"].includes(session.status);
  }) || null;
}

function currentActiveSession(data, userId) {
  return data.checkinSessions.find((session) => session.user_id === userId && session.status === "ACTIVE") || null;
}

function getRecords(data, sessionId) {
  return data.checkinRecords
    .filter((record) => record.session_id === sessionId)
    .sort((left, right) => left.day_index - right.day_index);
}

function toSessionPayload(data, session, dateText = todayISO()) {
  if (!session) return null;
  const records = Array.from({ length: 7 }, (_, index) => {
    const dayIndex = index + 1;
    const record = data.checkinRecords.find((item) => item.session_id === session.session_id && item.day_index === dayIndex);
    return {
      dayIndex,
      checkedIn: Boolean(record),
      date: addDays(session.start_date, index),
      isMakeup: Boolean(record && record.is_makeup),
      recordId: record ? record.record_id : "",
    };
  });
  return {
    sessionId: session.session_id,
    userId: session.user_id,
    startDate: session.start_date,
    endDate: session.end_date,
    currentDayIndex: Math.min(7, Math.max(1, daysBetween(session.start_date, dateText) + 1)),
    todayChecked: records.some((record) => record.date === dateText && record.checkedIn),
    status: session.status,
    missCount: session.miss_count,
    refundStatus: session.refund_status || null,
    orderId: session.order_id || null,
    records,
  };
}

function loginByPhone(data, body, phone, identityContext = {}) {
  if (!phone) throw businessError(1002, "手机号必填");

  const identityResult = resolveByWechatLogin(data, {
    ...body,
    appCode: body.appCode || body.app_code,
    openid: body.openid || "",
    unionid: body.unionid || "",
    phone,
    nickname: normalizeNickname(body.nickname || body.nickName) || "ROOT体验官",
    avatarUrl: normalizeAvatarUrl(body.avatarUrl || body.avatar_url),
  }, {
    sourceChannel: body.sourceChannel || body.source_channel || "LOGIN",
    env: body.env || process.env,
    unionidTrusted: identityContext.unionidTrusted === true,
    identitySource: identityContext.identitySource || "",
  });
  const user = identityResult.user;
  applyUserDisplayProfile(user, body);
  const formalSession = body.flowVersion === "FORMAL_LAUNCH_V1"
    ? sessionModule.present({ data, user, created: identityResult.created })
    : null;

  const autoMatch = formalSession
    ? null
    : orderFulfillment.autoMatchOrdersForUser(data, user, { source: "AUTO_WECHAT_PHONE" });
  const session = issueToken(data, user.user_id);
  return response({
    token: session.token,
    session: {
      expiresAt: session.expires_at,
    },
    autoMatch,
    user: publicUser(user, data, { env: body.env || process.env }),
    nextRoute: formalSession ? formalSession.nextRoute : routeForUser(user, body.env || process.env),
    ...(formalSession || {}),
    features: {
      myRootRebuildEnabled: isMyRootRebuildEnabled(body.env || process.env),
    },
    identity: {
      rootUserId: user.root_user_id || user.user_id,
      unionidStatus: identityResult.unionidStatus,
      appCode: user.app_code || normalizeAppCode(body.appCode || body.app_code),
    },
  });
}

function login(data, body = {}) {
  const phone = normalizePhone(body.phone);
  return loginByPhone(data, body, phone);
}

function updateDisplayProfile(data, token, body = {}) {
  const user = requireUser(data, token);
  const nickname = normalizeNickname(body.nickname || body.nickName);
  const avatarUrl = normalizeAvatarUrl(body.avatarUrl || body.avatar_url);
  if (!nickname && !avatarUrl) throw businessError(2002, "请填写昵称或选择头像");
  if (nickname) user.nickname = nickname;
  if (avatarUrl) user.avatar_url = avatarUrl;
  return response({ success: true, user: publicUser(user, data) });
}

async function loginWithWechat(data, body = {}, context = process.env) {
  const runtime = normalizeWechatContext(context);
  const env = runtime.env;
  const trustedWechatIdentity = runtime.trustedWechatIdentity
    ? normalizeVerifiedAssertion(runtime.trustedWechatIdentity)
    : null;
  const appCode = resolveWechatLoginAppCode(body, runtime, trustedWechatIdentity);
  const shouldUseWechatPhone = !body.phone && body.phoneCode;

  function loginByWechatIdentity(input, identityContext = {}) {
    const identityResult = resolveByWechatLogin(data, {
      ...body,
      ...input,
      appCode,
      nickname: normalizeNickname(body.nickname || body.nickName) || "ROOT体验官",
      avatarUrl: normalizeAvatarUrl(body.avatarUrl || body.avatar_url),
    }, {
      sourceChannel: body.sourceChannel || body.source_channel || "WECHAT_LOGIN",
      appCode,
      env,
      unionidTrusted: identityContext.unionidTrusted === true,
      identitySource: identityContext.identitySource || "",
    });
    const user = identityResult.user;
    applyUserDisplayProfile(user, body);
    const formalSession = body.flowVersion === "FORMAL_LAUNCH_V1"
      ? sessionModule.present({ data, user, created: identityResult.created })
      : null;
    const session = issueToken(data, user.user_id);
    return response({
      token: session.token,
      session: {
        expiresAt: session.expires_at,
      },
      autoMatch: null,
      user: publicUser(user, data, { env }),
      nextRoute: formalSession ? formalSession.nextRoute : routeForUser(user, env),
      ...(formalSession || {}),
      features: {
        myRootRebuildEnabled: isMyRootRebuildEnabled(env),
      },
      identity: {
        rootUserId: user.root_user_id || user.user_id,
        unionidStatus: identityResult.unionidStatus,
        appCode,
      },
    });
  }

  if (!shouldUseWechatPhone && !body.phone) {
    if (trustedWechatIdentity && trustedWechatIdentity.openid) {
      return loginByWechatIdentity({
        openid: trustedWechatIdentity.openid,
        unionid: trustedWechatIdentity.unionid || "",
      }, { unionidTrusted: true, identitySource: trustedWechatIdentity.source });
    }
    if (body.openid && isOpenidLoginAllowed(env)) {
      return loginByWechatIdentity({ openid: body.openid, unionid: body.unionid || "" });
    }
    if (body.wxCode) {
      const config = getWechatConfig(env);
      if (!config.appid || !config.secret) throw businessError(1006, "服务端未配置微信登录密钥");
      const session = normalizeWechatSessionIdentity(
        await getWechatSession(config, body.wxCode, env),
        appCode
      );
      return loginByWechatIdentity(
        { openid: session.openid, unionid: session.unionid || "" },
        { unionidTrusted: true, identitySource: session.source }
      );
    }
  }

  if (!shouldUseWechatPhone) {
    if (!isDirectPhoneLoginAllowed(env)) throw businessError(1007, "请使用微信手机号授权登录");
    return login(data, { ...body, env });
  }

  if (shouldUseCloudbaseOpenApi(trustedWechatIdentity)) {
    const phone = runtime.trustedPhoneNumber
      || await getCloudbaseWechatPhoneNumber(body.phoneCode, env);
    return loginByPhone(data, {
      ...body,
      env,
      appCode,
      openid: trustedWechatIdentity.openid,
      unionid: trustedWechatIdentity.unionid || "",
    }, phone, { unionidTrusted: true, identitySource: trustedWechatIdentity.source });
  }

  const config = getWechatConfig(env);
  if (!config.appid || !config.secret) throw businessError(1006, "服务端未配置微信登录密钥");

  const [sessionIdentity, phone] = await Promise.all([
    trustedWechatIdentity
      ? Promise.resolve(trustedWechatIdentity)
      : getWechatSession(config, body.wxCode, env)
        .then((session) => normalizeWechatSessionIdentity(session, appCode)),
    runtime.trustedPhoneNumber
      ? Promise.resolve(runtime.trustedPhoneNumber)
      : getWechatPhoneNumber(config, body.phoneCode),
  ]);
  return loginByPhone(
    data,
    { ...body, env, appCode, openid: sessionIdentity.openid, unionid: sessionIdentity.unionid },
    phone,
    { unionidTrusted: true, identitySource: sessionIdentity.source }
  );
}

function getUserState(data, token, context = {}) {
  const user = requireUser(data, token);
  const env = context.env || context || process.env;
  const identitySummary = verifiedUnionIdSummary(data, user, { env });
  const homeView = getHomeViewModel(data, user.user_id, todayISO());
  return response({
    user: publicUser(user, data, { env }),
    identity: {
      rootUserId: user.root_user_id || user.user_id,
      unionidStatus: identitySummary.unionidStatus,
      appCode: user.app_code || "MYROOT",
    },
    flowView: homeView.flowView,
    allowedActions: homeView.allowedActions,
    homeView,
    route: routeForUser(user, env),
    features: {
      myRootRebuildEnabled: isMyRootRebuildEnabled(env),
    },
    routePermissions: ROUTE_PERMISSIONS,
  });
}

function getProfile(data, token) {
  const user = requireUser(data, token);
  const profile = data.profiles.find((item) => item.user_id === user.user_id) || null;
  return response({ profile, questions: profileQuestions });
}

function getFormalProfile(data, token) {
  const user = requireUser(data, token);
  return response(profileModule.read(data, user));
}

function listFormalHomeContent(data, context = {}) {
  return response(contentModule.listHome(data, context));
}

function getFormalContentDetail(data, contentId, context = {}) {
  return response(contentModule.getDetail(data, contentId, context));
}

function formalHealthContext(data, user, context = {}) {
  const profile = profileModule.read(data, user).profile;
  const consentStatus = privacyConsent.getHealthConsentStatus(data, user.root_user_id || user.user_id, context);
  return { profile, consentStatus };
}

function getFormalHealthBootstrap(data, token, context = {}) {
  const user = requireUser(data, token);
  const { profile, consentStatus } = formalHealthContext(data, user, context);
  return response(formalHealthModule.bootstrap(data, user, profile, consentStatus, context));
}

function getFormalHealthInitialAssessment(data, token, context = {}) {
  const user = requireUser(data, token);
  const { profile } = formalHealthContext(data, user, context);
  privacyConsent.requireHealthConsent(data, user.root_user_id || user.user_id, context);
  return response(formalHealthModule.getDefinition(profile, context));
}

function submitFormalHealthInitialAssessment(data, token, body = {}, context = {}) {
  const user = requireUser(data, token);
  const { profile } = formalHealthContext(data, user, context);
  privacyConsent.requireHealthConsent(data, user.root_user_id || user.user_id, context);
  const result = formalHealthModule.submit(data, user, profile, body, context);
  recordLifecycleEvent(data, user.root_user_id || user.user_id, "ROOT4U_INITIAL_ASSESSMENT_COMPLETED", {
    sourceChannel: "MYROOT_ROOT4U",
    appCode: user.app_code || "MYROOT",
    metadata: {
      answerId: result.answerId,
      questionnaireId: formalHealthModule.QUESTIONNAIRE_ID,
      questionnaireVersion: formalHealthModule.QUESTIONNAIRE_VERSION,
    },
  });
  return response(result);
}

function submitFormalProfile(data, token, body = {}) {
  const user = requireUser(data, token);
  const result = profileModule.save(data, user, body);
  syncRootLifecycle(data, user, "FORMAL_PROFILE_COMPLETED", {
    sourceChannel: "MYROOT_FORMAL_PROFILE",
    appCode: user.app_code || "MYROOT",
  });
  return response(result);
}

function getUserOrders(data, token) {
  const user = requireUser(data, token);
  const orders = data.youzanOrders.filter((order) => order.user_id === user.user_id).map((order) => orderFulfillment.toOrderPayload(data, order));
  return response({ orders });
}

function getActiveCampaign(data, token, query = {}, context = {}) {
  const user = requireUser(data, token);
  const activeCampaign = campaign.getActiveCampaign(data, { ...context, ...query });
  const participant = campaign.findParticipant(data, user.root_user_id || user.user_id, activeCampaign.campaign_id);
  return response({ campaign: campaign.toCampaignPayload(activeCampaign, participant) });
}

function joinCampaign(data, token, body = {}, context = {}) {
  const user = requireUser(data, token);
  const rootUserId = user.root_user_id || user.user_id;
  const result = campaign.joinCampaign(data, user.root_user_id || user.user_id, body.campaignId || body.campaign_id, {
    ...context,
    sourceChannel: body.sourceChannel || body.source_channel || "MINIPROGRAM_CAMPAIGN",
    metadata: body.metadata || {},
  });
  recordLifecycleEvent(data, rootUserId, "CAMPAIGN_JOINED", {
    sourceChannel: body.sourceChannel || body.source_channel || "MINIPROGRAM_CAMPAIGN",
    appCode: user.app_code || "MYROOT",
    metadata: {
      campaignId: result.campaign.campaign_id,
      created: result.created,
    },
  });
  return response({
    campaign: campaign.toCampaignPayload(result.campaign, result.participant),
    created: result.created,
  });
}

function listActivities(data, token, query = {}, context = {}) {
  const rootUserId = stableRootUserIdForToken(data, token);
  const result = activityModule.listVisiblePage(data, query, context, rootUserId);
  return response({ activities: result.items, pagination: result.pagination, filters: result.filters });
}

function listAdminActivityDefinitions(data, query = {}, context = {}) {
  const result = activityModule.listAdminDefinitions(data, query, context);
  return response({ activities: result.items, pagination: result.pagination });
}

function listAdminActivitySessions(data, query = {}, context = {}) {
  const result = activityModule.listAdminSessions(data, query, context);
  return response({ sessions: result.items, pagination: result.pagination });
}

function listAdminActivityEnrollments(data, query = {}, context = {}) {
  const result = activityModule.listAdminEnrollments(data, query, context);
  return response({ enrollments: result.items, pagination: result.pagination });
}

function listAdminActivityReviewQueue(data, query = {}, context = {}) {
  const result = activityModule.listAdminReviewQueue(data, query, context);
  return response({ reviewQueue: result.items, pagination: result.pagination });
}

function getActivityDetail(data, token, query = {}, context = {}) {
  const rootUserId = stableRootUserIdForToken(data, token);
  return response({ activity: activityModule.getDetail(data, query, rootUserId, context) });
}

function getActivityEnrollments(data, token, query = {}, context = {}) {
  const user = requireUser(data, token);
  const rootUserId = user.root_user_id || user.user_id;
  const result = activityModule.getMyEnrollmentsPage(data, rootUserId, query, context);
  return response({ enrollments: result.items, pagination: result.pagination });
}

function activityAuditSummary(value = {}) {
  return {
    activityVersionId: value.activityVersionId || "",
    activityId: value.activityId || "",
    version: value.version || null,
    status: value.status || "",
    title: value.title || "",
    contentApprovalRef: value.contentApprovalRef || "",
    sessionId: value.sessionId || "",
    enrollmentId: value.enrollmentId || "",
    attemptGeneration: value.attemptGeneration || null,
    reasonCode: value.reasonCode || "",
  };
}

function appendActivityAudit(data, action, targetType, targetId, body, after, options = {}) {
  return auditLog.appendAuditLog(data, {
    action,
    targetType,
    targetId,
    operatorId: options.operatorId || body.operatorId || body.operator_id || "",
    reason: options.reason || body.reason || "",
    before: options.before || null,
    after: activityAuditSummary(after),
    metadata: {
      requestId: body.requestId || body.request_id || "",
      idempotencyKey: body.idempotencyKey || body.idempotency_key || "",
      source: options.source || "ACTIVITY_MODULE",
    },
  });
}

function enrollActivity(data, token, body = {}, context = {}) {
  const user = requireUser(data, token);
  const rootUserId = user.root_user_id || user.user_id;
  // Member Identity is not yet a production authority in this branch. A
  // member-only activity therefore fails closed unless the caller supplies a
  // trusted, server-derived summary through the runtime context.
  const memberStatus = context.memberIdentitySummary && context.memberIdentitySummary.status;
  const result = activityModule.enroll(data, rootUserId, body, { ...context, memberStatus });
  appendActivityAudit(
    data,
    "ACTIVITY_ENROLLMENT_ENROLL",
    "ACTIVITY_ENROLLMENT",
    result.enrollment.enrollmentId,
    body,
    result.enrollment,
    { operatorId: rootUserId, source: "MINIPROGRAM" }
  );
  return response(result);
}

function cancelActivityEnrollment(data, token, body = {}, context = {}) {
  const user = requireUser(data, token);
  const rootUserId = user.root_user_id || user.user_id;
  const result = activityModule.cancelEnrollment(
    data,
    rootUserId,
    body,
    context
  );
  appendActivityAudit(
    data,
    "ACTIVITY_ENROLLMENT_CANCEL",
    "ACTIVITY_ENROLLMENT",
    result.enrollment.enrollmentId,
    body,
    result.enrollment,
    { operatorId: rootUserId, reason: result.enrollment.reasonCode, source: "MINIPROGRAM" }
  );
  return response(result);
}

function upsertActivityDraft(data, body = {}, context = {}) {
  const activity = activityModule.upsertDraft(data, body, context);
  const audit = appendActivityAudit(data, "ACTIVITY_DRAFT_UPSERT", "ACTIVITY_DEFINITION", activity.activityVersionId, body, activity);
  return response({ activity, audit });
}

function submitActivityForReview(data, body = {}, context = {}) {
  const activity = activityModule.submitForReview(
    data,
    body.activityVersionId || body.activity_version_id,
    context
  );
  const audit = appendActivityAudit(data, "ACTIVITY_SUBMIT_REVIEW", "ACTIVITY_DEFINITION", activity.activityVersionId, body, activity);
  return response({ activity, audit });
}

function requestActivityChanges(data, body = {}, context = {}) {
  const activity = activityModule.requestChanges(
    data,
    body.activityVersionId || body.activity_version_id,
    body,
    context
  );
  const audit = appendActivityAudit(data, "ACTIVITY_REQUEST_CHANGES", "ACTIVITY_DEFINITION", activity.activityVersionId, body, activity);
  return response({ activity, audit });
}

function publishActivity(data, body = {}, context = {}) {
  const activity = activityModule.publish(
    data,
    body.activityVersionId || body.activity_version_id,
    body,
    context
  );
  const audit = appendActivityAudit(data, "ACTIVITY_PUBLISH", "ACTIVITY_DEFINITION", activity.activityVersionId, body, activity);
  return response({ activity, audit });
}

function unpublishActivity(data, body = {}, context = {}) {
  const activity = activityModule.unpublish(
    data,
    body.activityVersionId || body.activity_version_id,
    body,
    context
  );
  const audit = appendActivityAudit(data, "ACTIVITY_UNPUBLISH", "ACTIVITY_DEFINITION", activity.activityVersionId, body, activity);
  return response({ activity, audit });
}

function archiveActivity(data, body = {}, context = {}) {
  const activity = activityModule.archive(
    data,
    body.activityVersionId || body.activity_version_id,
    body,
    context
  );
  const audit = appendActivityAudit(data, "ACTIVITY_ARCHIVE", "ACTIVITY_DEFINITION", activity.activityVersionId, body, activity);
  return response({ activity, audit });
}

function createActivitySession(data, body = {}, context = {}) {
  const session = activityModule.createSession(data, body, context);
  const audit = appendActivityAudit(data, "ACTIVITY_SESSION_CREATE", "ACTIVITY_SESSION", session.sessionId, body, session);
  return response({ session, audit });
}

function updateActivitySessionState(data, body = {}, context = {}) {
  const session = activityModule.setSessionState(
    data,
    body.sessionId || body.activity_session_id,
    body.nextStatus || body.next_status,
    context
  );
  const audit = appendActivityAudit(data, "ACTIVITY_SESSION_STATE", "ACTIVITY_SESSION", session.sessionId, body, session);
  return response({ session, audit });
}

function reviewActivityEnrollment(data, body = {}, context = {}) {
  const result = activityModule.reviewEnrollment(data, body, context);
  const audit = appendActivityAudit(data, "ACTIVITY_ENROLLMENT_REVIEW", "ACTIVITY_ENROLLMENT", result.enrollment.enrollmentId, body, result.enrollment);
  return response({ ...result, audit });
}

function expireActivityEnrollmentReviews(data, body = {}, context = {}) {
  const result = activityModule.expirePendingReviews(data, body, context);
  const audit = appendActivityAudit(data, "ACTIVITY_ENROLLMENT_REVIEW_TIMEOUT", "ACTIVITY_REVIEW_TIMEOUT_JOB", body.requestId || body.request_id, body, {}, {
    reason: `processed=${result.processedCount}`,
  });
  return response({ ...result, audit });
}

function cancelActivitySession(data, body = {}, context = {}) {
  const session = activityModule.cancelSession(
    data,
    body.sessionId || body.activity_session_id,
    body,
    context
  );
  const audit = appendActivityAudit(data, "ACTIVITY_SESSION_CANCEL", "ACTIVITY_SESSION", session.sessionId, body, session);
  return response({ session, audit });
}

function recordUserConsultation(data, token, body = {}) {
  const user = requireUser(data, token);
  const rootUserId = user.root_user_id || user.user_id;
  const result = consultationFollowup.recordConsultation(data, user, body);
  if (result.created) {
    recordLifecycleEvent(data, rootUserId, "CONSULTATION_FOLLOW_CREATED", {
      sourceChannel: result.item.sourceChannel,
      appCode: user.app_code || "MYROOT",
      metadata: {
        consultationId: result.item.consultationId,
        operationTaskId: result.task.task_id,
        consultationType: result.item.consultationType,
      },
    });
  }
  return response(result);
}

function getUserConsultations(data, token) {
  const user = requireUser(data, token);
  return response(consultationFollowup.buildUserView(data, user));
}

function listWeWorkTouchJobs(data, query = {}) {
  return response({ jobs: weworkTouch.listWeWorkTouchJobs(data, query) });
}

function listOrderAfterSalesRecords(data, query = {}) {
  return response({ records: orderAfterSales.listOrderAfterSalesRecords(data, query) });
}

function upsertOrderAfterSalesRecord(data, body = {}, context = {}) {
  return response(orderAfterSales.upsertOrderAfterSalesRecord(data, body, context));
}

function syncOrderAfterSalesBatch(data, body = {}, context = {}) {
  return response(orderAfterSales.syncOrderAfterSalesBatch(data, body, context));
}

function planWeWorkTouches(data, body = {}, context = {}) {
  return response(weworkTouch.planWeWorkTouches(data, body, context));
}

async function runDueWeWorkTouches(data, body = {}, context = {}) {
  return response(await weworkTouch.runDueWeWorkTouches(data, body, context));
}

function getAdminLifecycleWorkbench(data, query = {}, context = {}) {
  return response(adminLifecyclePresenter.buildLifecycleWorkbench(data, query, context));
}

function exportAdminLifecycleUsersCsv(data, query = {}, context = {}) {
  return adminLifecyclePresenter.buildLifecycleUsersCsv(data, query, context);
}

function listAdminLifecycleUserExports(data, query = {}, context = {}) {
  return response(adminLifecycleUserExports.listLifecycleUserExports(data, query, context));
}

function getAdminLifecycleExportDeliveryHealth(data, query = {}, context = {}) {
  return response(adminLifecycleUserExports.getLifecycleExportDeliveryHealth(data, query, context));
}

function createAdminLifecycleUserExport(data, body = {}, context = {}) {
  return response(adminLifecycleUserExports.runLifecycleUserExport(data, body, context));
}

function runAdminLifecycleUserExportJob(data, body = {}, context = {}) {
  return response(adminLifecycleUserExports.runLifecycleUserExport(data, body, context));
}

function downloadAdminLifecycleUserExport(data, exportId, context = {}) {
  return adminLifecycleUserExports.downloadLifecycleUserExport(data, exportId, context);
}

function downloadSignedAdminLifecycleUserExport(data, exportId, query = {}, context = {}) {
  return adminLifecycleUserExports.downloadLifecycleUserExportBySignature(data, exportId, query, context);
}

function reviewAdminLifecycleUserExportApproval(data, body = {}, context = {}) {
  return response(adminLifecycleUserExports.reviewLifecycleUserExportApproval(data, body, context));
}

async function deliverAdminLifecycleUserExport(data, body = {}, context = {}) {
  return response(await adminLifecycleUserExports.deliverLifecycleUserExport(data, body, context));
}

async function runDueAdminLifecycleExportDeliveries(data, body = {}, context = {}) {
  return response(await adminLifecycleUserExports.runDueLifecycleExportDeliveries(data, body, context));
}

async function cleanupAdminLifecycleUserExports(data, body = {}, context = {}) {
  return response(await adminLifecycleUserExports.cleanupLifecycleUserExports(data, body, context));
}

async function runHealthDataRetentionCleanup(data, body = {}, context = {}) {
  return response(await healthDataRetention.cleanupExpiredHealthData(data, body, context));
}

function listAdminLifecycleFilterPresets(data, query = {}) {
  return response({
    presets: adminLifecycleFilterPresets.listPresets(data, query),
  });
}

function upsertAdminLifecycleFilterPreset(data, body = {}) {
  const result = adminLifecycleFilterPresets.upsertPreset(data, body);
  const audit = auditLog.appendAuditLog(data, {
    action: "ADMIN_LIFECYCLE_FILTER_PRESET_UPSERT",
    targetType: "ADMIN_LIFECYCLE_FILTER_PRESET",
    targetId: result.preset.presetId,
    operatorId: body.operatorId || body.operator_id || "",
    reason: body.reason || "保存用户生命周期常用筛选",
    before: result.before,
    after: result.preset,
    metadata: {
      requestId: body.requestId || body.request_id || "",
      created: result.created,
    },
  });
  return response({
    preset: result.preset,
    presets: adminLifecycleFilterPresets.listPresets(data, body),
    created: result.created,
    audit,
  });
}

function copyAdminLifecycleFilterPreset(data, body = {}) {
  const result = adminLifecycleFilterPresets.copyPreset(data, body);
  const audit = auditLog.appendAuditLog(data, {
    action: "ADMIN_LIFECYCLE_FILTER_PRESET_COPY",
    targetType: "ADMIN_LIFECYCLE_FILTER_PRESET",
    targetId: result.preset.presetId,
    operatorId: body.operatorId || body.operator_id || "",
    reason: body.reason || "复制用户生命周期常用筛选",
    before: result.sourcePreset,
    after: result.preset,
    metadata: {
      requestId: body.requestId || body.request_id || "",
      sourcePresetId: result.sourcePreset.presetId,
      scope: result.preset.scope,
    },
  });
  return response({
    sourcePreset: result.sourcePreset,
    preset: result.preset,
    presets: adminLifecycleFilterPresets.listPresets(data, body),
    created: true,
    audit,
  });
}

function deleteAdminLifecycleFilterPreset(data, body = {}) {
  const result = adminLifecycleFilterPresets.archivePreset(data, body);
  const audit = auditLog.appendAuditLog(data, {
    action: "ADMIN_LIFECYCLE_FILTER_PRESET_DELETE",
    targetType: "ADMIN_LIFECYCLE_FILTER_PRESET",
    targetId: result.preset.presetId,
    operatorId: body.operatorId || body.operator_id || "",
    reason: body.reason || "删除用户生命周期常用筛选",
    before: result.before,
    after: result.preset,
    metadata: {
      requestId: body.requestId || body.request_id || "",
    },
  });
  return response({
    preset: result.preset,
    presets: adminLifecycleFilterPresets.listPresets(data, body),
    deleted: true,
    audit,
  });
}

function getAdminOperationalAnalytics(data, query = {}) {
  return response(adminAnalyticsPresenter.buildOperationalAnalytics(data, query));
}

function exportAdminOperationalAnalyticsCsv(data, query = {}) {
  return adminAnalyticsPresenter.buildOperationalAnalyticsCsv(data, query);
}

function upsertAdminOperationalAlertRule(data, body = {}) {
  const alertRuleId = body.alertRuleId || body.alert_rule_id || "";
  const before = alertRuleId
    ? operationalAlerts.listEffectiveAlertRules(data, { campaignId: body.campaignId || body.campaign_id })
      .find((rule) => rule.alert_rule_id === alertRuleId) || null
    : null;
  const result = operationalAlerts.upsertAlertRule(data, body);
  const audit = auditLog.appendAuditLog(data, {
    action: "OPERATIONAL_ALERT_RULE_UPSERT",
    targetType: "OPERATIONAL_ALERT_RULE",
    targetId: result.rule.alertRuleId,
    operatorId: body.operatorId || body.operator_id || "",
    reason: body.reason || "配置运营预警阈值",
    before,
    after: result.rule,
    metadata: {
      requestId: body.requestId || body.request_id || "",
      created: result.created,
    },
  });
  return response({ ...result, audit });
}

async function runAdminOperationalAlertJob(data, body = {}, context = {}) {
  const dryRun = body.dryRun === true || body.dry_run === true;
  const requestId = body.requestId || body.request_id || context.requestId || "";
  if (!dryRun && !requestId) throw businessError(8020, "运营预警 Job 执行必须提供 request_id");
  const analytics = adminAnalyticsPresenter.buildOperationalAnalytics(data, body);
  const result = await operationalAlerts.runOperationalAlertJob(data, analytics, {
    ...body,
    requestId,
  }, context);
  const audit = auditLog.appendAuditLog(data, {
    action: dryRun ? "OPERATIONAL_ALERT_JOB_PREVIEW" : "OPERATIONAL_ALERT_JOB_EXECUTE",
    targetType: "OPERATIONAL_ALERT_JOB",
    targetId: result.run.operational_alert_run_id,
    operatorId: body.operatorId || body.operator_id || "",
    reason: body.reason || (dryRun ? "预览运营预警" : "执行运营预警"),
    before: null,
    after: {
      requestId,
      summary: result.summary,
      alerts: result.alerts.map((alert) => ({ key: alert.key, severity: alert.severity, message: alert.message })),
    },
    metadata: {
      requestId,
      dryRun,
      campaignId: result.run.campaign_id,
    },
  });
  return response({ ...result, audit });
}

function listProducts(data, token, query = {}, context = {}) {
  requireUser(data, token);
  const campaignId = query.campaignId || query.campaign_id || productMirror.DEFAULT_CAMPAIGN_ID;
  return response(productMirror.listDisplayProducts(data, campaignId, context));
}

function getProduct(data, token, productId, context = {}) {
  requireUser(data, token);
  return response({ product: productMirror.getDisplayProduct(data, productId, context) });
}

function recordProductJump(data, token, body = {}, context = {}) {
  const user = requireUser(data, token);
  const productId = body.productId || body.product_id || body.youzanProductId || body.youzan_product_id;
  const result = productMirror.recordProductJump(data, user.root_user_id || user.user_id, productId, {
    ...context,
    campaignId: body.campaignId || body.campaign_id || productMirror.DEFAULT_CAMPAIGN_ID,
    sourceChannel: body.sourceChannel || body.source_channel || "MINIPROGRAM_PRODUCT",
    metadata: body.metadata || {},
  });
  recordLifecycleEvent(data, user.root_user_id || user.user_id, "PRODUCT_JUMP", {
    sourceChannel: body.sourceChannel || body.source_channel || "MINIPROGRAM_PRODUCT",
    appCode: user.app_code || "MYROOT",
    metadata: {
      productId: result.product.productId,
      jumpLogId: result.jumpLogId,
    },
  });
  return response(result);
}

function upsertProduct(data, body = {}, context = {}) {
  return response(productMirror.upsertDisplayProduct(data, body, context));
}

async function previewAdminProductSync(data, body = {}, context = {}) {
  return response(await adminProductSync.previewProductSync(data, body, context));
}

async function executeAdminProductSync(data, body = {}, context = {}) {
  return response(await adminProductSync.executeProductSync(data, body, context));
}

async function previewAdminOrderIncrementSync(data, body = {}, context = {}) {
  return response(await adminOrderIncrementSync.previewOrderIncrement(data, body, context));
}

async function executeAdminOrderIncrementSync(data, body = {}, context = {}) {
  return response(await adminOrderIncrementSync.executeOrderIncrement(data, body, context));
}

function listAdminYouzanCustomers(data, query = {}) {
  return response(youzanCustomerMirror.listCustomers(data, query));
}

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function fulfillmentForOrder(data, orderId) {
  return ensureList(data, "orderFulfillments").find((item) => item.order_id === orderId) || null;
}

function ensureFulfillment(data, order) {
  let fulfillment = fulfillmentForOrder(data, order.order_id);
  if (fulfillment) return fulfillment;
  fulfillment = {
    fulfillment_id: createId("ful"),
    order_id: order.order_id,
    receiver_name: order.receiver_name || "",
    receiver_phone: order.receiver_phone || order.phone || "",
    carrier: "",
    tracking_no: "",
    delivery_status: order.delivery_status || "NOT_SHIPPED",
    shipped_at: "",
    delivered_at: "",
    last_event_text: "",
    updated_at: nowISO(),
  };
  ensureList(data, "orderFulfillments").push(fulfillment);
  return fulfillment;
}

function getOrderDeliveryStatus(data, order) {
  const fulfillment = fulfillmentForOrder(data, order.order_id);
  return (fulfillment && fulfillment.delivery_status) || order.delivery_status || "NOT_SHIPPED";
}

function toOrderPayload(data, order) {
  const fulfillment = ensureFulfillment(data, order);
  const deliveryStatus = getOrderDeliveryStatus(data, order);
  return {
    orderId: order.order_id,
    youzanOrderNo: order.youzan_order_no,
    productName: order.product_name || order.product_id,
    orderStatus: order.order_status || "PAID",
    deliveryStatus,
    receiverPhone: maskPhone(order.receiver_phone || order.phone),
    receiverName: order.receiver_name || "",
    amount: order.amount,
    matchedAt: order.matched_at || "",
    fulfillment: {
      carrier: fulfillment.carrier || "",
      trackingNo: fulfillment.tracking_no || "",
      shippedAt: fulfillment.shipped_at || "",
      deliveredAt: fulfillment.delivered_at || "",
      lastEventText: fulfillment.last_event_text || "",
    },
  };
}

function validateProfile(body) {
  const listFields = ["joinReasons", "improvementMethods"];
  listFields.forEach((field) => {
    if (!Array.isArray(body[field]) || body[field].length === 0) {
      throw businessError(2001, "注册问卷信息不完整");
    }
  });
  if (!body.gutHealthStatus || !body.stoolType) {
    throw businessError(2001, "注册问卷信息不完整");
  }
}

function submitProfile(data, token, body, context = {}) {
  const user = requireUser(data, token);
  privacyConsent.requireHealthConsent(data, user.root_user_id || user.user_id, context);
  validateProfile(body);
  const existing = data.profiles.find((item) => item.user_id === user.user_id);
  const profile = {
    profile_id: existing ? existing.profile_id : createId("pro"),
    user_id: user.user_id,
    join_reasons: body.joinReasons,
    gut_health_status: body.gutHealthStatus,
    improvement_methods: body.improvementMethods,
    stool_type: body.stoolType,
    submitted_at: nowISO(),
  };
  if (existing) Object.assign(existing, profile);
  else data.profiles.push(profile);

  if (user.state === STATES.UNREGISTERED) {
    user.state = STATES.REGISTERED_IDLE;
    user.lifecycle_status = user.state;
    user.registered_at = profile.submitted_at;
    syncRootLifecycle(data, user, "PROFILE_SUBMITTED", { sourceChannel: "MINIPROGRAM_PROFILE" });
  }
  return response({ success: true, user: publicUser(user, data), profile });
}

function ensureCanActivate(user) {
  if (user.state !== STATES.REGISTERED_IDLE) {
    throw businessError(403, "当前状态不可启动打卡", 403);
  }
}

function createCheckinSession(data, user, orderId, source, dateText = todayISO()) {
  const active = currentActiveSession(data, user.user_id);
  if (active) return active;
  const session = {
    session_id: createId("ses"),
    user_id: user.user_id,
    order_id: orderId || "",
    start_date: dateText,
    end_date: addDays(dateText, 6),
    status: "ACTIVE",
    miss_count: 0,
    audited_miss_days: [],
    refund_status: null,
    created_at: nowISO(),
    source,
  };
  data.checkinSessions.push(session);
  user.state = STATES.CHECKIN_ACTIVE;
  user.activated_at = nowISO();
  return session;
}

function createManualReviewTask(data, user, reason, dateText = todayISO(), orderId = "") {
  return operationTask.createOperationTaskOnce(data, {
    task_type: "MANUAL_REVIEW_REQUIRED",
    user_id: user.user_id,
    order_id: orderId,
    task_date: dateText,
    reason,
    suggested_action: "通过企业微信确认订单、物流或启动资格",
  }).task;
}

function matchOrder(data, token, body, dateText = todayISO()) {
  const user = requireUser(data, token);
  ensureCanActivate(user);
  const phone = normalizePhone(body.phone);
  if (!phone) throw businessError(1002, "手机号必填");
  const identity = identifyUser(data, user, { phone, leadHint: body.leadHint });

  const order = data.youzanOrders.find((item) => normalizePhone(item.receiver_phone || item.phone) === phone);
  if (!order) {
    createManualReviewTask(data, user, "未匹配到收货手机号对应的订单", dateText);
    throw businessError(3001, "未匹配到订单，已进入人工确认");
  }
  if (order.user_id && order.user_id !== user.user_id) {
    createManualReviewTask(data, user, "订单已被其他用户绑定", dateText, order.order_id);
    throw businessError(3002, "订单已被其他用户绑定，已进入人工确认");
  }

  order.user_id = user.user_id;
  order.matched_at = nowISO();
  order.match_source = "AUTO_PHONE";
  order.receiver_phone = order.receiver_phone || phone;
  orderFulfillment.ensureFulfillment(data, order);
  const deliveryStatus = orderFulfillment.getOrderDeliveryStatus(data, order);
  const nextAction = deliveryStatus === "DELIVERED" ? "READY_TO_START" : "WAITING_DELIVERY";
  return response({
    success: true,
    order: orderFulfillment.toOrderPayload(data, order),
    identityWarnings: identity.warnings,
    nextAction,
    canStartCheckin: deliveryStatus === "DELIVERED",
    session: null,
    user: publicUser(user, data),
  });
}

function startCheckin(data, token, body, dateText = todayISO()) {
  const user = requireUser(data, token);
  ensureCanActivate(user);
  if (!body.confirmReceived) throw businessError(4003, "请先确认已收到产品");
  const matchedOrders = data.youzanOrders.filter((order) => order.user_id === user.user_id);
  const orderId = body.orderId || body.order_id || "";
  const order = orderId
    ? matchedOrders.find((item) => item.order_id === orderId)
    : matchedOrders.find((item) => orderFulfillment.getOrderDeliveryStatus(data, item) === "DELIVERED") || matchedOrders[0];
  if (!order) {
    createManualReviewTask(data, user, "用户未匹配订单但尝试开始打卡", dateText);
    throw businessError(4004, "请先匹配收货手机号对应的订单，已进入人工确认");
  }
  const deliveryStatus = orderFulfillment.getOrderDeliveryStatus(data, order);
  if (deliveryStatus !== "DELIVERED") {
    if (deliveryStatus === "EXCEPTION") createManualReviewTask(data, user, "物流异常，需要人工确认", dateText, order.order_id);
    throw businessError(4005, "物流送达后才能开始打卡");
  }
  const session = createCheckinSession(data, user, order.order_id, "order_delivered", dateText);
  return response({ success: true, session: toSessionPayload(data, session, dateText), user: publicUser(user, data) });
}

function getSession(data, token, dateText = todayISO()) {
  const user = requireUser(data, token);
  const session = currentSessionForUser(data, user.user_id);
  if (!session) throw businessError(4001, "暂无打卡周期");
  return response({ session: toSessionPayload(data, session, dateText), user: publicUser(user, data) });
}

function submitCheckin(data, token, body, dateText = todayISO(), context = {}) {
  const user = requireUser(data, token);
  privacyConsent.requireHealthConsent(data, user.root_user_id || user.user_id, context);
  const session = currentActiveSession(data, user.user_id);
  if (!session) throw businessError(4001, "无打卡中的周期");

  const currentDayIndex = Math.min(7, Math.max(1, daysBetween(session.start_date, dateText) + 1));
  const dayIndex = Number(body.dayIndex || currentDayIndex);
  if (dayIndex < 1 || dayIndex > 7) throw businessError(4003, "不在打卡时间窗");
  if (dayIndex > currentDayIndex) throw businessError(4003, "还未到这一天");
  if (currentDayIndex - dayIndex > 1) throw businessError(4003, "仅支持次日23:59前补卡");

  if (body.tookProduct === false) {
    return response({
      success: true,
      accepted: false,
      message: "今天先完成服用，再回来打卡。",
      session: toSessionPayload(data, session, dateText),
    });
  }

  const duplicated = data.checkinRecords.some((record) => record.session_id === session.session_id && record.day_index === dayIndex);
  if (duplicated) throw businessError(4002, "今日已打卡");

  const record = {
    record_id: createId("rec"),
    session_id: session.session_id,
    user_id: user.user_id,
    day_index: dayIndex,
    checkin_date: dateText,
    took_product: Boolean(body.tookProduct),
    had_stool: Boolean(body.hadStool),
    stool_type: body.hadStool ? body.stoolType || "" : "",
    feedback: body.feedback || "",
    image_urls: normalizeMediaRefs(body.imageUrls),
    checked_in_at: nowISO(),
    is_makeup: dayIndex < currentDayIndex,
  };
  data.checkinRecords.push(record);
  let nextAction = "";
  let couponStatus = null;

  if (dayIndex === 4 && !questionnaire.getResponse(data, user.user_id, session.session_id, "DAY4_MIDPOINT")) {
    nextAction = "DAY4_QUESTIONNAIRE";
    operationTask.createOperationTaskOnce(data, {
      task_type: "DAY4_QUESTIONNAIRE_PENDING",
      user_id: user.user_id,
      order_id: session.order_id || "",
      task_date: dateText,
      reason: "Day4 中期问卷待完成",
      suggested_action: "提醒用户完成中期问卷",
    });
  }

  if (dayIndex === 6) {
    const couponResult = coupon.triggerCoupon(data, user, session, "DAY6_CHECKIN", dateText);
    couponStatus = coupon.toCouponPayload(couponResult.coupon);
  }

  const complete = [1, 2, 3, 4, 5, 6, 7].every((day) => {
    return data.checkinRecords.some((item) => item.session_id === session.session_id && item.day_index === day);
  });
  if (complete) {
    session.status = "COMPLETED";
    user.state = STATES.CHECKIN_COMPLETED;
    user.completed_at = nowISO();
    user.total_checkin_days = Math.max(user.total_checkin_days || 0, 7);
    user.current_streak = Math.max(user.current_streak || 0, 7);
    user.longest_streak = Math.max(user.longest_streak || 0, user.current_streak || 7);
    user.last_checkin_date = record.checkin_date;
    nextAction = "DAY8_QUESTIONNAIRE";
    operationTask.createOperationTaskOnce(data, {
      task_type: "DAY8_QUESTIONNAIRE_PENDING",
      user_id: user.user_id,
      order_id: session.order_id || "",
      task_date: dateText,
      reason: "Day8 收尾问卷待完成",
      suggested_action: "提醒用户完成收尾问卷后进入人工退款",
    });
  }

  return response({ success: true, record, nextAction, coupon: couponStatus, session: toSessionPayload(data, session, dateText), user: publicUser(user, data) });
}

function continueAsDailyUser(data, token) {
  requireUser(data, token);
  throw businessError(403, "每日任务已完成，当前版本不支持继续打卡", 403);
}

function getDailyRecord(data, userId, dateText) {
  return data.dailyCheckinRecords.find((record) => record.user_id === userId && record.checkin_date === dateText) || null;
}

function dailyStats(data, token, dateText = todayISO()) {
  const user = requireUser(data, token);
  if (user.state !== STATES.DAILY_USER) throw businessError(403, "当前不是日常打卡用户", 403);
  return response({
    totalDays: user.total_checkin_days || 0,
    currentStreak: user.current_streak || 0,
    longestStreak: user.longest_streak || 0,
    todayChecked: Boolean(getDailyRecord(data, user.user_id, dateText)),
    lastCheckinDate: user.last_checkin_date || "",
  });
}

function submitDailyCheckin(data, token, body, dateText = todayISO()) {
  const user = requireUser(data, token);
  if (user.state !== STATES.DAILY_USER) throw businessError(403, "当前不是日常打卡用户", 403);
  throw businessError(403, "每日任务已完成，当前版本不支持继续打卡", 403);
}

function dailyHistory(data, token, query = {}) {
  const user = requireUser(data, token);
  if (user.state !== STATES.DAILY_USER) throw businessError(403, "当前不是日常打卡用户", 403);
  const limit = Math.max(1, Math.min(100, Number(query.limit || 30)));
  const records = data.dailyCheckinRecords
    .filter((record) => record.user_id === user.user_id)
    .sort((left, right) => right.checkin_date.localeCompare(left.checkin_date))
    .slice(0, limit);
  return response({ records });
}

function dailyTrend(data, token, range = "7d", dateText = todayISO()) {
  const user = requireUser(data, token);
  if (user.state !== STATES.DAILY_USER) throw businessError(403, "当前不是日常打卡用户", 403);
  const days = range === "30d" ? 30 : 7;
  const points = Array.from({ length: days }, (_, index) => {
    const day = addDays(dateText, index - days + 1);
    const record = getDailyRecord(data, user.user_id, day);
    return {
      date: day,
      checked: Boolean(record),
      stoolType: record ? record.stool_type : "",
    };
  });
  return response({ range, points });
}

function trackEvent(data, token, body = {}) {
  const user = requireUser(data, token);
  const event = {
    event_id: createId("trk"),
    user_id: user.user_id,
    event_name: body.eventName || "unknown_event",
    payload: body.payload || {},
    created_at: nowISO(),
  };
  data.eventsTrack.push(event);
  return response({ success: true, eventId: event.event_id });
}

function getRecordList(data, token) {
  const user = requireUser(data, token);
  const session = currentSessionForUser(data, user.user_id);
  if (!session) throw businessError(4001, "暂无打卡周期");
  return response({ records: getRecords(data, session.session_id), session: toSessionPayload(data, session) });
}

function getRecordDetail(data, token, dayIndex) {
  const user = requireUser(data, token);
  const session = currentSessionForUser(data, user.user_id);
  if (!session) throw businessError(4001, "暂无打卡周期");
  const record = data.checkinRecords.find((item) => item.session_id === session.session_id && item.day_index === Number(dayIndex));
  return response({ record: record || null });
}

function getQuestionnaire(data, token, type) {
  requireUser(data, token);
  return response({ questionnaire: questionnaire.getQuestionnaire(data, type) });
}

function getQuestionnaireStatus(data, token) {
  const user = requireUser(data, token);
  const session = currentSessionForUser(data, user.user_id);
  if (!session) throw businessError(4001, "暂无打卡周期");
  return response(questionnaire.getQuestionnaireStatus(data, user.user_id, session.session_id));
}

function submitQuestionnaire(data, token, body, dateText = todayISO(), context = {}) {
  const user = requireUser(data, token);
  privacyConsent.requireHealthConsent(data, user.root_user_id || user.user_id, context);
  const session = currentSessionForUser(data, user.user_id);
  const result = questionnaire.submitQuestionnaire(data, user, session, body);
  if (result.response.needs_follow) {
    operationTask.createOperationTaskOnce(data, {
      task_type: "QUESTIONNAIRE_FOLLOW",
      user_id: user.user_id,
      order_id: session.order_id || "",
      task_date: dateText,
      reason: `${result.response.questionnaire_type} 反馈需要跟进`,
      suggested_action: "通过企业微信联系用户确认反馈",
    });
  }
  const pendingTaskType = result.response.questionnaire_type === "DAY4_MIDPOINT"
    ? "DAY4_QUESTIONNAIRE_PENDING"
    : result.response.questionnaire_type === "DAY8_SUMMARY"
      ? "DAY8_QUESTIONNAIRE_PENDING"
      : "";
  if (pendingTaskType) {
    operationTask.listOpenOperationTasks(data, { userId: user.user_id, taskType: pendingTaskType }).forEach((task) => {
      operationTask.completeOperationTask(data, task.task_id, { result: "QUESTIONNAIRE_SUBMITTED" });
    });
  }
  let refund = null;
  if (result.response.questionnaire_type === "DAY8_SUMMARY") {
    try {
      refund = refundWorkItem.createRefundWorkItem(data, user.user_id, session.session_id).item;
    } catch (error) {
      operationTask.createOperationTaskOnce(data, {
        task_type: "MANUAL_REVIEW_REQUIRED",
        user_id: user.user_id,
        order_id: session.order_id || "",
        task_date: dateText,
        reason: error.message,
        suggested_action: "确认退款资格异常原因",
      });
    }
  }
  return response({ success: true, response: result.response, created: result.created, refundWorkItem: refund });
}

function questionnaireAnswerPayload(answer) {
  return {
    questionnaireAnswerId: answer.questionnaire_answer_id,
    rootUserId: answer.root_user_id,
    campaignId: answer.campaign_id,
    questionnaireId: answer.questionnaire_id,
    questionnaireType: answer.questionnaire_type || answer.questionnaire_id,
    version: answer.version,
    answers: answer.answers_json || {},
    submittedAt: answer.submitted_at,
    needsFollow: Boolean(answer.needs_follow),
  };
}

function getQuestionnaireAnswerStatus(data, token, query = {}) {
  const user = requireUser(data, token);
  const status = questionnaire.getQuestionnaireAnswerStatus(
    data,
    user.root_user_id || user.user_id,
    query.campaignId || query.campaign_id || ""
  );
  return response({
    ...status,
    answers: status.answers.map(questionnaireAnswerPayload),
  });
}

function submitQuestionnaireAnswer(data, token, body = {}, dateText = todayISO(), context = {}) {
  const user = requireUser(data, token);
  privacyConsent.requireHealthConsent(data, user.root_user_id || user.user_id, context);
  const result = questionnaire.submitQuestionnaireAnswer(data, {
    ...body,
    rootUserId: user.root_user_id || user.user_id,
  }, {
    ...context,
    sourceChannel: body.sourceChannel || body.source_channel || "MINIPROGRAM_QUESTIONNAIRE",
  });
  const answer = result.answer;
  const taskDate = body.taskDate || body.task_date || dateText;
  recordLifecycleEvent(data, user.root_user_id || user.user_id, "QUESTIONNAIRE_ANSWER_SUBMITTED", {
    sourceChannel: body.sourceChannel || body.source_channel || "MINIPROGRAM_QUESTIONNAIRE",
    appCode: user.app_code || "MYROOT",
    metadata: {
      campaignId: answer.campaign_id,
      questionnaireId: answer.questionnaire_id,
      questionnaireAnswerId: answer.questionnaire_answer_id,
      created: result.created,
    },
  });
  let followUp = null;
  if (answer.needs_follow) {
    followUp = operationTask.createOperationTaskOnce(data, {
      task_type: "QUESTIONNAIRE_FOLLOW",
      user_id: user.user_id,
      task_date: taskDate,
      dedupe_key: `questionnaire-answer:${answer.questionnaire_answer_id}`,
      reason: `${answer.questionnaire_id} 反馈需要跟进`,
      suggested_action: "通过企业微信联系用户确认反馈",
      metadata: {
        campaignId: answer.campaign_id,
        questionnaireId: answer.questionnaire_id,
        questionnaireAnswerId: answer.questionnaire_answer_id,
      },
    });
  }
  return response({
    success: true,
    answer: questionnaireAnswerPayload(answer),
    created: result.created,
    followUp: followUp ? { task: followUp.task, created: followUp.created } : null,
    user: publicUser(user, data),
  });
}

function applyRefund(data, token) {
  const user = requireUser(data, token);
  const session = currentSessionForUser(data, user.user_id);
  if (!session || user.state !== STATES.CHECKIN_COMPLETED) throw businessError(5001, "尚未完成有效7天打卡");
  const result = refundWorkItem.createRefundWorkItem(data, user.user_id, session.session_id);
  return response({ success: true, refundWorkItem: result.item, refund: result.item, created: result.created });
}

function getRefundStatus(data, token) {
  const user = requireUser(data, token);
  const session = currentSessionForUser(data, user.user_id);
  const status = refundWorkItem.getRefundStatus(data, user.user_id, session ? session.session_id : "");
  return response({
    refundStatus: status.refundStatus || (session ? session.refund_status : null),
    refund: status.refundWorkItem,
    refundWorkItem: status.refundWorkItem,
    eligibility: status.eligibility,
  });
}

function getCouponStatus(data, token) {
  const user = requireUser(data, token);
  const session = currentSessionForUser(data, user.user_id);
  return response(coupon.getCouponStatus(data, user, session));
}

function claimCoupon(data, token, body = {}) {
  const user = requireUser(data, token);
  const session = currentSessionForUser(data, user.user_id);
  const status = coupon.getCouponStatus(data, user, session);
  const couponId = body.couponId || body.coupon_id || (status.coupon ? status.coupon.couponId : "");
  const claimed = coupon.claimCoupon(data, user.user_id, couponId);
  return response({ success: true, coupon: coupon.toCouponPayload(claimed) });
}

function recordCouponRepurchaseClick(data, token, body = {}, dateText = todayISO()) {
  const user = requireUser(data, token);
  const session = currentSessionForUser(data, user.user_id);
  const status = coupon.getCouponStatus(data, user, session);
  const couponId = body.couponId || body.coupon_id || (status.coupon ? status.coupon.couponId : "");
  const clicked = coupon.markRepurchaseClick(data, user.user_id, couponId);
  const task = operationTask.createOperationTaskOnce(data, {
    task_type: "REPURCHASE_INTENT",
    user_id: user.user_id,
    order_id: session ? session.order_id || "" : "",
    task_date: dateText,
    dedupe_key: clicked.coupon_id,
    reason: "用户点击复购入口",
    suggested_action: "企业微信轻触达，确认是否需要购买建议或使用优惠券",
    suggested_script: "看到你刚刚点了复购入口，如果需要我可以帮你确认优惠券和使用方式。",
    metadata: { couponId: clicked.coupon_id },
  }).task;
  return response({ success: true, coupon: coupon.toCouponPayload(clicked), task: toOperationTaskPayload(data, task) });
}

function uploadImage(data, token, body, context = {}) {
  const user = requireUser(data, token);
  privacyConsent.requireHealthConsent(data, user.root_user_id || user.user_id, context);
  const [url] = normalizeMediaRefs([body.url]);
  if (!url) throw businessError(400, "请选择需要上传的图片", 400);
  const item = {
    upload_id: createId("upl"),
    user_id: user.user_id,
    url,
    created_at: nowISO(),
  };
  data.uploads.push(item);
  return response({ url: item.url });
}

function normalizeMediaRefs(values) {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values)) throw businessError(400, "图片引用格式错误", 400);
  if (values.length > 3) throw businessError(400, "最多提交 3 张图片", 400);
  return values.map((value) => {
    const url = String(value || "").trim();
    if (!url || url.length > 2048 || !/^(cloud:\/\/|https:\/\/)/i.test(url)) {
      throw businessError(400, "图片必须先上传到受信任的云存储", 400);
    }
    return url;
  });
}

function ensureDailySummaries(data) {
  if (!Array.isArray(data.dailySummaries)) data.dailySummaries = [];
  return data.dailySummaries;
}

function expectedDayIndex(session, dateText) {
  return daysBetween(session.start_date, dateText) + 1;
}

function hasCheckinRecord(data, session, dayIndex) {
  return data.checkinRecords.some((record) => {
    return record.session_id === session.session_id && record.day_index === dayIndex;
  });
}

function addAuditTask(data, task, createdTasks) {
  const result = operationTask.createOperationTaskOnce(data, task);
  if (result.created) createdTasks.push(result.task);
  return result.task;
}

function generateOperationTasks(data, dateText = todayISO()) {
  const createdTasks = [];
  const yesterday = addDays(dateText, -1);

  data.checkinSessions.filter((session) => session.status === "ACTIVE").forEach((session) => {
    const dayIndex = expectedDayIndex(session, yesterday);
    if (dayIndex < 1 || dayIndex > 7) return;
    if (hasCheckinRecord(data, session, dayIndex)) return;

    const auditedMissDays = Array.isArray(session.audited_miss_days) ? session.audited_miss_days : [];
    if (auditedMissDays.includes(yesterday)) return;
    session.audited_miss_days = auditedMissDays.concat(yesterday);
    session.miss_count += 1;

    addAuditTask(data, {
      task_type: "MISSED_CHECKIN",
      user_id: session.user_id,
      order_id: session.order_id || "",
      task_date: dateText,
      reason: `Day${dayIndex} 未打卡`,
      suggested_action: "通过企业微信提醒用户补卡或确认是否继续参与",
      suggested_script: "今天还能补昨天的记录，如果已经服用过，可以现在进入小程序补一下。",
      metadata: { sessionId: session.session_id, missedDate: yesterday, dayIndex },
    }, createdTasks);

    if (session.miss_count >= 2) {
      addAuditTask(data, {
        task_type: "TWO_DAY_INACTIVE",
        user_id: session.user_id,
        order_id: session.order_id || "",
        task_date: dateText,
        reason: `连续未打卡风险，累计断卡 ${session.miss_count} 次`,
        suggested_action: "人工确认用户是否还要继续试饮，并记录原因",
        suggested_script: "这两天还没看到你的记录，我来确认一下是否还在继续服用，方便我们帮你保留参与资格。",
        metadata: { sessionId: session.session_id, missCount: session.miss_count },
      }, createdTasks);
    }

    if (session.miss_count >= 3) {
      session.status = "FAILED";
      const user = data.users.find((item) => item.user_id === session.user_id);
      if (user) user.state = STATES.CHECKIN_FAILED;
    }
  });

  data.checkinSessions
    .filter((session) => ["ACTIVE", "COMPLETED"].includes(session.status))
    .forEach((session) => {
      if (!hasCheckinRecord(data, session, 4)) return;
      if (questionnaire.getResponse(data, session.user_id, session.session_id, "DAY4_MIDPOINT")) return;
      addAuditTask(data, {
        task_type: "DAY4_QUESTIONNAIRE_PENDING",
        user_id: session.user_id,
        order_id: session.order_id || "",
        task_date: dateText,
        reason: "Day4 中期问卷待完成",
        suggested_action: "提醒用户补充中期反馈，便于后续观察效果",
        suggested_script: "第4天的小问卷还差一步，填完后我们能更准确地跟进你的体验。",
        metadata: { sessionId: session.session_id, questionnaireType: "DAY4_MIDPOINT" },
      }, createdTasks);
    });

  data.checkinSessions.filter((session) => session.status === "COMPLETED").forEach((session) => {
    if (questionnaire.getResponse(data, session.user_id, session.session_id, "DAY8_SUMMARY")) return;
    addAuditTask(data, {
      task_type: "DAY8_QUESTIONNAIRE_PENDING",
      user_id: session.user_id,
      order_id: session.order_id || "",
      task_date: dateText,
      reason: "Day8 收尾问卷待完成",
      suggested_action: "提醒用户完成收尾问卷后进入人工退款",
      suggested_script: "7天记录已经完成了，最后补一下收尾问卷，我们就可以进入免单审核。",
      metadata: { sessionId: session.session_id, questionnaireType: "DAY8_SUMMARY" },
    }, createdTasks);
  });

  data.refundWorkItems.filter((item) => item.status === "PENDING").forEach((item) => {
    addAuditTask(data, {
      task_type: "REFUND_PENDING",
      user_id: item.user_id,
      order_id: item.order_id || "",
      task_date: dateText,
      reason: "免单退款待人工处理",
      suggested_action: "核对订单、Day8 问卷和打卡记录后标记退款完成",
      suggested_script: "你的免单申请已经进入人工审核，我们核对完成后会同步处理结果。",
      metadata: { refundWorkItemId: item.refund_work_item_id, sessionId: item.session_id },
    }, createdTasks);
  });

  data.couponEvents.filter((item) => item.status === "CLAIMED").forEach((item) => {
    addAuditTask(data, {
      task_type: "COUPON_UNUSED",
      user_id: item.user_id,
      order_id: item.order_id || "",
      task_date: dateText,
      dedupe_key: item.coupon_id,
      reason: "优惠券已领取但未核销",
      suggested_action: "轻触达确认用户是否需要复购帮助",
      suggested_script: "你领取的复购礼还没有使用，如果需要我可以帮你确认使用方式。",
      metadata: { couponId: item.coupon_id, sessionId: item.session_id },
    }, createdTasks);
  });

  return { tasks: createdTasks, createdCount: createdTasks.length };
}

function buildDailySummary(data, dateText = todayISO(), generatedTasks = 0) {
  const activeSessions = data.checkinSessions.filter((session) => session.status === "ACTIVE");
  const completedSessions = data.checkinSessions.filter((session) => session.status === "COMPLETED");
  const dueSessions = activeSessions.filter((session) => {
    const dayIndex = expectedDayIndex(session, dateText);
    return dayIndex >= 1 && dayIndex <= 7;
  });
  const checkedToday = dueSessions.filter((session) => {
    return hasCheckinRecord(data, session, expectedDayIndex(session, dateText));
  }).length;
  const day4Pending = data.checkinSessions.filter((session) => {
    if (!["ACTIVE", "COMPLETED"].includes(session.status)) return false;
    if (!hasCheckinRecord(data, session, 4)) return false;
    return !questionnaire.getResponse(data, session.user_id, session.session_id, "DAY4_MIDPOINT");
  }).length;
  const day8Pending = completedSessions.filter((session) => {
    return !questionnaire.getResponse(data, session.user_id, session.session_id, "DAY8_SUMMARY");
  }).length;
  const refundPending = data.refundWorkItems.filter((item) => item.status === "PENDING").length;
  const couponUnused = data.couponEvents.filter((item) => item.status === "CLAIMED").length;
  return {
    date: dateText,
    activeSessions: activeSessions.length,
    completedSessions: completedSessions.length,
    failedSessions: data.checkinSessions.filter((session) => session.status === "FAILED").length,
    dueToday: dueSessions.length,
    checkedToday,
    missedToday: Math.max(0, dueSessions.length - checkedToday),
    day4Pending,
    day8Pending,
    refundPending,
    couponUnused,
    openTasks: operationTask.listOpenOperationTasks(data).length,
    generatedTasks,
    auditedAt: nowISO(),
  };
}

function upsertDailySummary(data, summary) {
  const summaries = ensureDailySummaries(data);
  const existing = summaries.find((item) => item.date === summary.date);
  if (existing) Object.assign(existing, summary);
  else summaries.push(summary);
  return summary;
}

function latestDailySummary(data, dateText = todayISO()) {
  const summaries = ensureDailySummaries(data);
  const exact = summaries.find((item) => item.date === dateText);
  if (exact) return exact;
  return summaries.slice().sort((left, right) => right.date.localeCompare(left.date))[0] || buildDailySummary(data, dateText, 0);
}

function runDailyAudit(data, dateText = todayISO()) {
  const generated = generateOperationTasks(data, dateText);
  const summary = upsertDailySummary(data, buildDailySummary(data, dateText, generated.createdCount));
  return response({ success: true, auditedAt: dateText, summary, tasks: generated.tasks });
}

function updateOrderFulfillment(data, body, dateText = todayISO()) {
  const result = orderFulfillment.updateOrderFulfillment(data, body, dateText);
  return response({
    success: true,
    order: orderFulfillment.toOrderPayload(data, result.order),
    fulfillment: result.fulfillment,
    task: result.task,
  });
}

function syncManualOrder(data, body, context = {}) {
  const order = orderFulfillment.syncManualOrder(data, body, context);
  return response({ success: true, order: orderFulfillment.toOrderPayload(data, order) });
}

function searchAdminOrderMatching(data, query = {}) {
  return response(adminOrderMatching.searchOrderMatchingCandidates(data, query));
}

function previewAdminOrderMatch(data, body = {}) {
  return response(adminOrderMatching.previewOrderMatch(data, body));
}

function confirmAdminOrderMatch(data, body = {}, dateText = todayISO()) {
  return response(adminOrderMatching.confirmOrderMatch(data, body, dateText));
}

function sampleInputFromBody(body = {}) {
  return body.samples !== undefined ? body.samples : body.text;
}

function previewExternalSamples(data, body = {}) {
  const result = externalAdapterSamples.previewExternalSamples(data, body.sourceType, sampleInputFromBody(body) || []);
  const review = externalAdapterSamples.recordExternalSampleReview(data, "PREVIEW", result);
  return response({ ...result, review });
}

function importExternalSamples(data, body = {}, dateText = todayISO(), context = {}) {
  const result = externalAdapterSamples.importExternalSamples(
    data,
    body.sourceType,
    sampleInputFromBody(body) || [],
    dateText,
    context
  );
  const review = externalAdapterSamples.recordExternalSampleReview(data, "IMPORT", result);
  return response({ ...result, review });
}

function previewImport(data, body = {}) {
  return response(csvImport.previewImport(data, body));
}

function confirmImport(data, batchId, body = {}, dateText = todayISO(), context = {}) {
  return response(csvImport.confirmImport(data, batchId, {
    dateText,
    operatorId: body.operatorId || body.operator_id || "",
    env: context.env,
  }));
}

function getImportBatch(data, batchId) {
  return response(csvImport.getImportBatch(data, batchId));
}

function listImportBatches(data, query = {}) {
  return response({ batches: csvImport.listImportBatches(data, query) });
}

function exportImportFailuresCsv(data, batchId) {
  return csvImport.exportFailureRowsCsv(data, batchId);
}

function upsertExternalStatusMapping(data, body = {}) {
  const mapping = externalAdapterSamples.upsertStatusMapping(data, body);
  return response({ success: true, mapping, mappings: externalAdapterSamples.listStatusMappings(data) });
}

function getExternalSampleTemplate(sourceType) {
  if (sourceType) return response(externalAdapterSamples.sampleTemplateFor(sourceType));
  return response({ templates: externalAdapterSamples.listSampleTemplates() });
}

function listExternalSampleReviews(data, query = {}) {
  const reviews = externalAdapterSamples.listExternalSampleReviews(data, query);
  const reviewId = query.reviewId || query.review_id || "";
  return response({
    reviews,
    review: reviewId ? externalAdapterSamples.getExternalSampleReview(data, reviewId) : null,
  });
}

function getExternalAdapters(data, context = {}) {
  return response({
    catalog: externalPlatformAdapters.buildAdapterCatalog(context.env || process.env, {
      data,
      adapterImplementations: context.adapterImplementations || {},
    }),
    runs: externalPlatformAdapters.listAdapterRuns(data),
    cursors: externalPlatformAdapters.listAdapterCursors(data),
    readiness: externalAdapterSamples.buildAdapterReadiness(data),
    reviews: externalAdapterSamples.listExternalSampleReviews(data, { limit: 20 }),
    retryScheduler: adapterRetryScheduler.planDueAdapterRetries(data, { now: context.now || nowISO() }),
  });
}

function getAdapterCalibration(data, context = {}) {
  return response(adapterCalibration.buildAdapterCalibration(data, {
    env: context.env || process.env,
    adapterImplementations: context.adapterImplementations || {},
    fetchImpl: context.fetchImpl,
  }));
}

function getActionAdapterCalibration(data, context = {}) {
  return response(actionAdapterCalibration.buildActionAdapterCalibration(data, {
    env: context.env || process.env,
    target: context.target || "production",
  }));
}

function getReleaseRecord(data, context = {}) {
  return response(releaseRecord.buildReleaseRecord(data, {
    ...context,
    env: context.env || process.env,
    adapterImplementations: context.adapterImplementations || {},
    fetchImpl: context.fetchImpl,
    target: context.target || "production",
  }));
}

function getReleaseEvidencePack(data, context = {}) {
  const env = context.env || process.env;
  const target = context.target || "production";
  const baseUrl = context.baseUrl || env.ROOT_RELEASE_EVIDENCE_BASE_URL || env.ROOT_PUBLIC_BASE_URL || env.ROOT_JOB_BASE_URL || "";
  const release = releaseRecord.buildReleaseRecord(data, {
    ...context,
    env,
    adapterImplementations: context.adapterImplementations || {},
    fetchImpl: context.fetchImpl,
    target,
  });
  const calibration = adapterCalibration.buildAdapterCalibration(data, {
    env,
    adapterImplementations: context.adapterImplementations || {},
    fetchImpl: context.fetchImpl,
  });
  const actionCalibration = actionAdapterCalibration.buildActionAdapterCalibration(data, {
    env,
    target,
  });
  const productionEnvMatrix = buildProductionEnvMatrix(env, { target });
  const cloudbaseJobManifest = buildCloudbaseJobManifest({ baseUrl, env });
  const cloudbaseJobValidation = validateCloudbaseJobManifest(cloudbaseJobManifest, { strict: Boolean(context.strict) });
  const pack = releaseEvidencePack.buildReleaseEvidencePack({
    target,
    baseUrl,
    releaseRecord: release,
    adapterCalibration: calibration,
    actionAdapterCalibration: actionCalibration,
    productionEnvMatrix,
    cloudbaseJobManifest,
    cloudbaseJobValidation,
  });
  return response({
    pack,
    validation: releaseEvidencePack.validateReleaseEvidencePack(pack),
    archives: releaseEvidenceArchive.listReleaseEvidenceArchives(data, { target }),
  });
}

function archiveReleaseEvidencePack(data, input = {}, context = {}) {
  const bundle = getReleaseEvidencePack(data, context).data;
  const result = releaseEvidenceArchive.saveReleaseEvidenceArchive(data, {
    pack: bundle.pack,
    validation: bundle.validation,
    requestId: input.requestId || input.request_id,
    operatorId: input.operatorId || input.operator_id,
    note: input.note,
  });
  return response(result);
}

function getReleaseEvidenceArchive(data, archiveId) {
  const archive = releaseEvidenceArchive.getReleaseEvidenceArchive(data, archiveId);
  if (!archive) {
    const error = new Error("发布证据包留档不存在");
    error.code = 404;
    error.status = 404;
    throw error;
  }
  return response({
    archive: releaseEvidenceArchive.archiveSummary(archive),
    pack: archive.pack,
    validation: archive.validation || {},
  });
}

function signReleaseRecord(data, input = {}) {
  return response(releaseSignoff.createReleaseSignoff(data, input));
}

function listAdminLegacyDeprecationDecisions(data, query = {}) {
  return response({
    decisions: adminLegacyDeprecationDecision.listAdminLegacyDeprecationDecisions(data, query),
    latest: adminLegacyDeprecationDecision.latestAdminLegacyDeprecationDecisions(data, query),
  });
}

function recordAdminLegacyDeprecationDecision(data, input = {}) {
  return response(adminLegacyDeprecationDecision.createAdminLegacyDeprecationDecision(data, input));
}

function listProductionCutoverProofs(data, query = {}) {
  return response({
    proofs: productionCutoverProof.listProductionCutoverProofs(data, query),
    latest: productionCutoverProof.latestProductionCutoverProofs(data, query),
  });
}

function recordProductionCutoverProof(data, input = {}) {
  return response(productionCutoverProof.createProductionCutoverProof(data, input));
}

function listRootMemberCenterJumpProofs(data, query = {}) {
  return response({
    proofs: rootMemberCenterJumpProof.listRootMemberCenterJumpProofs(data, query),
    latest: rootMemberCenterJumpProof.latestRootMemberCenterJumpProofs(data, query),
  });
}

function recordRootMemberCenterJumpProof(data, input = {}) {
  return response(rootMemberCenterJumpProof.createRootMemberCenterJumpProof(data, input));
}

function getCloudbaseIdentityProbe(context = {}) {
  return response(cloudbaseIdentityProbe.buildCloudbaseIdentityProbe(context));
}

async function runExternalAdapter(data, body = {}, context = {}, dateText = todayISO()) {
  const result = await externalPlatformAdapters.runAdapter(data, body, {
    env: context.env || process.env,
    dateText,
    adapterImplementations: context.adapterImplementations || {},
    fetchImpl: context.fetchImpl,
  });
  return response({ success: true, ...result });
}

async function runDueExternalAdapterRetries(data, body = {}, context = {}) {
  const result = await adapterRetryScheduler.runDueAdapterRetries(data, body, {
    env: context.env || process.env,
    dateText: context.dateText || todayISO(),
    adapterImplementations: context.adapterImplementations || {},
    fetchImpl: context.fetchImpl,
  });
  return response({ success: true, ...result });
}

function rollbackExternalAdapterRun(data, body = {}) {
  const before = clone(externalPlatformAdapters.listAdapterRuns(data, 100)
    .find((run) => run.run_id === (body.runId || body.run_id || "")) || null);
  const result = externalPlatformAdapters.rollbackAdapterRun(data, body);
  const audit = auditLog.appendAuditLog(data, {
    action: "EXTERNAL_ADAPTER_RUN_ROLLBACK",
    targetType: "EXTERNAL_ADAPTER_RUN",
    targetId: result.run.run_id,
    operatorId: body.operatorId || body.operator_id || "",
    reason: body.reason || "",
    before,
    after: clone(result.run),
    metadata: {
      requestId: body.requestId || body.request_id || "",
      summary: result.summary,
      cursor: result.cursor,
    },
  });
  return response({ success: true, ...result, audit });
}

function getReadyToStartUsers(data, dateText = todayISO()) {
  return response({ users: orderFulfillment.getReadyToStartUsers(data, dateText) });
}

function listOperationTasks(data, query = {}) {
  const hasStatusFilter = Boolean(query.status || query.taskStatus || query.task_status);
  const effectiveQuery = hasStatusFilter ? query : { ...query, status: "OPEN" };
  return response({ tasks: operationTask.listOperationTasks(data, effectiveQuery).map((task) => toOperationTaskPayload(data, task)) });
}

function completeOperationTask(data, taskId, body = {}) {
  const before = clone(operationTask.listOperationTasks(data).find((item) => item.task_id === taskId) || null);
  const task = operationTask.completeOperationTask(data, taskId, body);
  const audit = auditLog.appendAuditLog(data, {
    action: "OPERATION_TASK_COMPLETE",
    targetType: "OPERATION_TASK",
    targetId: taskId,
    operatorId: body.operatorId || body.operator_id || "",
    reason: body.reason || body.note || "",
    before,
    after: clone(task),
    metadata: {
      requestId: body.requestId || body.request_id || "",
      status: task.status,
      result: task.result || "",
    },
  });
  return response({ success: true, task: toOperationTaskPayload(data, task), audit });
}

function listConsultationWeworkWritebacks(data, query = {}) {
  return response({ writebacks: consultationWeworkWriteback.listConsultationWeworkWritebacks(data, query) });
}

function listConsultationAdvisorAssignments(data, query = {}) {
  return response({ assignments: consultationAdvisorAssignment.listConsultationAdvisorAssignments(data, query) });
}

function getConsultationSla(data, query = {}, context = {}) {
  return response(consultationSla.listConsultationSlaItems(data, query, {
    env: context.env || process.env,
    now: query.now || context.now || "",
  }));
}

function getConsultationAdvisorWorkbench(data, query = {}, context = {}) {
  return response(consultationAdvisorWorkbench.advisorWorkbench(data, query, {
    env: context.env || process.env,
    now: query.now || context.now || "",
  }));
}

function getConsultationSlaEscalations(data, query = {}, context = {}) {
  return response(consultationSlaEscalation.listConsultationSlaEscalations(data, query, {
    env: context.env || process.env,
    now: query.now || context.now || "",
  }));
}

function recordConsultationAdvisorAssignment(data, body = {}, context = {}) {
  const result = consultationAdvisorAssignment.recordConsultationAdvisorAssignment(data, body, {
    env: context.env || process.env,
    operatorId: body.operatorId || body.operator_id || context.operatorId || "",
    requestId: body.requestId || body.request_id || context.requestId || "",
  });
  return response({
    ...result,
    task: result.task ? toOperationTaskPayload(data, result.task) : null,
  });
}

async function recordConsultationWeworkWriteback(data, body = {}, context = {}) {
  const result = await consultationWeworkWriteback.recordConsultationWeworkWriteback(data, body, {
    env: context.env || process.env,
    fetchImpl: context.fetchImpl,
    operatorId: body.operatorId || body.operator_id || context.operatorId || "",
    requestId: body.requestId || body.request_id || context.requestId || "",
    consultationWritebackAdapters: context.consultationWritebackAdapters || {},
  });
  return response({
    ...result,
    task: result.task ? toOperationTaskPayload(data, result.task) : null,
  });
}

function previewCorrection(data, body = {}) {
  return response(manualCorrection.previewCorrection(data, body));
}

function applyCorrection(data, body = {}, context = {}, dateText = todayISO()) {
  return response(manualCorrection.applyCorrection(data, body, {
    operatorId: body.operatorId || body.operator_id || context.operatorId || "",
  }, dateText));
}

function listAuditLogs(data, query = {}) {
  return response({ auditLogs: auditLog.listAuditLogs(data, query) });
}

function feedbackTextFromAnswers(answers = {}) {
  return answers.feedback || answers.note || answers.other || "";
}

function buildFeedbackItems(data, userId) {
  const checkinItems = data.checkinRecords
    .filter((record) => record.user_id === userId)
    .filter((record) => record.feedback || (Array.isArray(record.image_urls) && record.image_urls.length))
    .map((record) => ({
      feedbackId: record.record_id,
      sourceType: "CHECKIN_RECORD",
      sourceId: record.record_id,
      date: record.checkin_date,
      title: `Day${record.day_index} 打卡反馈`,
      text: record.feedback || "",
      imageUrls: Array.isArray(record.image_urls) ? record.image_urls : [],
      severity: ["type1", "type6", "type7"].includes(record.stool_type) ? "HIGH" : "NORMAL",
      metadata: { dayIndex: record.day_index, stoolType: record.stool_type || "", hadStool: record.had_stool },
    }));

  const questionnaireItems = data.questionnaireResponses
    .filter((item) => item.user_id === userId)
    .filter((item) => item.needs_follow || feedbackTextFromAnswers(item.answers))
    .map((item) => ({
      feedbackId: item.response_id,
      sourceType: "QUESTIONNAIRE_RESPONSE",
      sourceId: item.response_id,
      date: item.submitted_at,
      title: item.questionnaire_type,
      text: feedbackTextFromAnswers(item.answers),
      imageUrls: [],
      severity: item.needs_follow ? "HIGH" : "NORMAL",
      metadata: { questionnaireType: item.questionnaire_type, answers: item.answers || {} },
    }));

  const dailyItems = data.dailyCheckinRecords
    .filter((record) => record.user_id === userId && record.feedback)
    .map((record) => ({
      feedbackId: record.record_id,
      sourceType: "DAILY_CHECKIN_RECORD",
      sourceId: record.record_id,
      date: record.checkin_date,
      title: "日常打卡反馈",
      text: record.feedback || "",
      imageUrls: [],
      severity: ["type1", "type6", "type7"].includes(record.stool_type) ? "HIGH" : "NORMAL",
      metadata: { stoolType: record.stool_type || "", streakCount: record.streak_count || 0 },
    }));

  return checkinItems.concat(questionnaireItems, dailyItems).sort((left, right) => String(right.date).localeCompare(String(left.date)));
}

function buildRefundDetail(data, userId, session) {
  const items = data.refundWorkItems.filter((item) => item.user_id === userId);
  const compatibilityItems = data.refunds.filter((item) => item.user_id === userId);
  const eligibility = session
    ? refundWorkItem.evaluateRefundEligibility(data, userId, session.session_id)
    : { eligible: false, reason: "暂无打卡周期" };
  return {
    eligibility,
    workItems: items,
    compatibilityItems,
    latest: items[0] || compatibilityItems[0] || null,
  };
}

function getAdminUserDetail(data, userId) {
  const user = data.users.find((item) => item.user_id === userId);
  if (!user) throw businessError(404, "用户不存在", 404);
  const sessions = data.checkinSessions.filter((session) => session.user_id === userId);
  const latestSession = sessions.slice().sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))[0] || null;
  const orders = data.youzanOrders.filter((order) => order.user_id === userId).map((order) => orderFulfillment.toOrderPayload(data, order));
  const records = data.checkinRecords
    .filter((record) => record.user_id === userId)
    .sort((left, right) => left.day_index - right.day_index);
  const dailyRecords = data.dailyCheckinRecords
    .filter((record) => record.user_id === userId)
    .sort((left, right) => String(right.checkin_date).localeCompare(String(left.checkin_date)));
  const responses = data.questionnaireResponses
    .filter((item) => item.user_id === userId)
    .sort((left, right) => String(right.submitted_at).localeCompare(String(left.submitted_at)));
  const tasks = operationTask.listOperationTasks(data, { userId }).map((task) => toOperationTaskPayload(data, task));

  return response({
    user: publicUser(user, data),
    leadProfiles: data.leadProfiles.filter((item) => item.user_id === userId),
    identityLinks: data.identityLinks.filter((item) => item.user_id === userId),
    profile: data.profiles.find((item) => item.user_id === userId) || null,
    opsSummary: adminUserPresenter.buildAdminUserDetailSummary(data, userId),
    orders,
    sessions: sessions.map((session) => toSessionPayload(data, session)),
    records,
    dailyRecords,
    questionnaireResponses: responses,
    feedbacks: buildFeedbackItems(data, userId),
    refund: buildRefundDetail(data, userId, latestSession),
    coupons: data.couponEvents.filter((item) => item.user_id === userId).map((item) => toCouponAdminPayload(data, item)),
    operationTasks: tasks,
  });
}

function createFeedbackFollowTask(data, userId, body = {}, dateText = todayISO()) {
  const user = data.users.find((item) => item.user_id === userId);
  if (!user) throw businessError(404, "用户不存在", 404);
  const session = currentSessionForUser(data, userId);
  const sourceType = body.sourceType || body.source_type || "";
  const sourceId = body.sourceId || body.source_id || "";
  const reason = body.reason || body.text || "用户反馈需要跟进";
  const result = operationTask.createOperationTaskOnce(data, {
    task_type: "FEEDBACK_FOLLOW",
    user_id: userId,
    order_id: session ? session.order_id || "" : "",
    task_date: dateText,
    dedupe_key: sourceType && sourceId ? `${sourceType}:${sourceId}` : "",
    reason,
    suggested_action: "通过企业微信联系用户，确认反馈背景并记录处理结果",
    suggested_script: "看到你的反馈了，我来确认一下具体情况，方便我们继续跟进体验。",
    metadata: { sourceType, sourceId },
  });
  return response({ success: true, task: toOperationTaskPayload(data, result.task), created: result.created });
}

function resolveManualReview(data, taskId, body = {}, dateText = todayISO()) {
  const tasks = operationTask.listOpenOperationTasks(data, { taskType: "MANUAL_REVIEW_REQUIRED" });
  const task = tasks.find((item) => item.task_id === taskId);
  if (!task) throw businessError(404, "人工确认待办不存在", 404);
  const before = clone(task);
  const user = data.users.find((item) => item.user_id === task.user_id);
  if (!user) throw businessError(404, "用户不存在", 404);

  let session = null;
  let result = body.result || "RESOLVED";
  if (body.action === "ALLOW_START") {
    const order = data.youzanOrders.find((item) => item.order_id === (body.orderId || task.order_id));
    if (order && order.user_id !== user.user_id) order.user_id = user.user_id;
    if (order && orderFulfillment.getOrderDeliveryStatus(data, order) !== "DELIVERED") {
      orderFulfillment.updateOrderFulfillment(data, { orderId: order.order_id, deliveryStatus: "DELIVERED" }, dateText);
    }
    session = createCheckinSession(data, user, order ? order.order_id : "", "manual_review", dateText);
    result = "ALLOWED_START";
  } else if (body.action === "COMPLETE_ORDER_AND_START") {
    const order = orderFulfillment.syncManualOrder(data, { ...(body.order || {}), userId: user.user_id, deliveryStatus: "DELIVERED" });
    order.user_id = user.user_id;
    order.matched_at = order.matched_at || nowISO();
    order.match_source = "MANUAL_REVIEW";
    session = createCheckinSession(data, user, order.order_id, "manual_review_order", dateText);
    result = "ORDER_COMPLETED_AND_STARTED";
  } else if (body.action === "REJECT") {
    result = "REJECTED";
  }

  const completed = operationTask.completeOperationTask(data, taskId, { result, note: body.note || "" });
  const audit = auditLog.appendAuditLog(data, {
    action: "OPERATION_TASK_RESOLVE",
    targetType: "OPERATION_TASK",
    targetId: taskId,
    operatorId: body.operatorId || body.operator_id || "",
    reason: body.reason || body.note || "",
    before,
    after: clone(completed),
    metadata: {
      requestId: body.requestId || body.request_id || "",
      action: body.action || "",
      result,
    },
  });
  return response({ success: true, task: completed, session: session ? toSessionPayload(data, session, dateText) : null, user: publicUser(user, data), audit });
}

function toOperationTaskPayload(data, task) {
  const user = data.users.find((item) => item.user_id === task.user_id);
  const order = data.youzanOrders.find((item) => item.order_id === task.order_id);
  const priority = adminOpsPresenter.buildTaskPriority(task);
  return {
    ...task,
    taskId: task.task_id,
    taskType: task.task_type,
    taskDate: task.task_date,
    label: priority.label,
    priorityLevel: priority.level,
    priorityRank: priority.rank,
    tone: priority.tone,
    suggestedAction: task.suggested_action || "",
    suggestedScript: task.suggested_script || "",
    user: user ? publicUser(user, data) : null,
    order: order ? orderFulfillment.toOrderPayload(data, order) : null,
  };
}

function toCouponAdminPayload(data, couponEvent) {
  const user = data.users.find((item) => item.user_id === couponEvent.user_id);
  return {
    ...coupon.toCouponPayload(couponEvent),
    user: user ? publicUser(user, data) : null,
    orderId: couponEvent.order_id || "",
    sessionId: couponEvent.session_id || "",
  };
}

function adminLaunchReadiness(data, context = {}) {
  return response(launchReadiness.buildLaunchReadiness(data, context));
}

function buildDailyOpsSummary(data, dateText) {
  const importBatches = csvImport.listImportBatches(data, { date: dateText, limit: 100 });
  const importedBySource = importBatches.reduce((acc, batch) => {
    const result = batch.result || {};
    const key = batch.sourceType || "UNKNOWN";
    acc[key] = (acc[key] || 0) + (result.importedCount || 0);
    return acc;
  }, {});
  const deliveredToday = data.orderFulfillments.filter((item) => {
    return item.delivery_status === "DELIVERED" && String(item.delivered_at || item.updated_at || "").startsWith(dateText);
  }).length;
  const autoMatchedToday = data.youzanOrders.filter((order) => {
    return String(order.matched_at || "").startsWith(dateText) && String(order.match_source || "").startsWith("AUTO");
  }).length;
  const manualHandledToday = data.auditLogs.filter((log) => String(log.created_at || "").startsWith(dateText)).length;
  const openConflicts = ["ORDER_PHONE_MATCH_CONFLICT", "ORDER_IDENTITY_MATCH_CONFLICT", "YOUZAN_IDENTITY_REVIEW_REQUIRED"]
    .reduce((count, taskType) => count + operationTask.listOpenOperationTasks(data, { taskType }).length, 0);
  const readyToStart = orderFulfillment.getReadyToStartUsers(data, dateText).length;

  return {
    date: dateText,
    importedOrders: importedBySource.YOUZAN_ORDER || 0,
    importedFulfillments: importedBySource.FULFILLMENT || 0,
    deliveredToday,
    autoMatchedToday,
    manualHandledToday,
    openConflicts,
    readyToStart,
    importBatchCount: importBatches.length,
  };
}

function adminDashboard(data, context = {}) {
  const active = data.checkinSessions.filter((item) => item.status === "ACTIVE").length;
  const completed = data.checkinSessions.filter((item) => item.status === "COMPLETED").length;
  const pendingRefunds = data.refundWorkItems.filter((item) => item.status === "PENDING").length;
  const matchedOrders = data.youzanOrders.filter((item) => item.user_id).length;
  const summary = latestDailySummary(data);
  return response({
    metrics: {
      users: data.users.length,
      registered: data.users.filter((item) => item.state !== STATES.UNREGISTERED).length,
      active,
      completed,
      matchedOrders,
      pendingRefunds,
    },
    summary,
    dailyOpsSummary: buildDailyOpsSummary(data, summary.date),
    opsDashboard: adminOpsPresenter.buildOpsDashboard(data, summary),
    users: data.users.map(publicUser),
    opsUsers: adminUserPresenter.buildAdminUserRows(data),
    orders: data.youzanOrders.map((order) => orderFulfillment.toOrderPayload(data, order)),
    sessions: data.checkinSessions.map((session) => toSessionPayload(data, session)),
    operationTasks: operationTask.listOpenOperationTasks(data).map((task) => toOperationTaskPayload(data, task)),
    readyToStartUsers: orderFulfillment.getReadyToStartUsers(data),
    refunds: data.refundWorkItems,
    couponSummary: coupon.buildCouponSummary(data),
    coupons: data.couponEvents.map((item) => toCouponAdminPayload(data, item)),
    externalSampleReviews: externalAdapterSamples.listExternalSampleReviews(data),
    importBatches: csvImport.listImportBatches(data, { limit: 10 }),
    auditLogs: auditLog.listAuditLogs(data, { limit: 10 }),
    externalStatusMappings: externalAdapterSamples.listStatusMappings(data),
    externalAdapterReadiness: externalAdapterSamples.buildAdapterReadiness(data),
    externalSampleTemplates: externalAdapterSamples.listSampleTemplates(),
    externalAdapterCatalog: externalPlatformAdapters.buildAdapterCatalog(context.env || process.env, {
      data,
      adapterImplementations: context.adapterImplementations || {},
    }),
    externalAdapterRuns: externalPlatformAdapters.listAdapterRuns(data),
    externalAdapterCursors: externalPlatformAdapters.listAdapterCursors(data),
    orderAfterSalesRecords: orderAfterSales.listOrderAfterSalesRecords(data),
    adapterCalibration: adapterCalibration.buildAdapterCalibration(data, {
      env: context.env || process.env,
      adapterImplementations: context.adapterImplementations || {},
      fetchImpl: context.fetchImpl,
    }),
    actionAdapterCalibration: actionAdapterCalibration.buildActionAdapterCalibration(data, {
      env: context.env || process.env,
      target: context.target || "production",
    }),
    launchReadiness: launchReadiness.buildLaunchReadiness(data, { ...context, target: context.target || "production" }),
    releaseRecord: releaseRecord.buildReleaseRecord(data, { ...context, target: context.target || "production" }),
  });
}

function approveRefund(data, refundId, body = {}) {
  const workItem = data.refundWorkItems.find((item) => item.refund_work_item_id === refundId);
  if (workItem) {
    const before = clone(workItem);
    const paid = refundWorkItem.markRefundPaid(data, refundId);
    const audit = auditLog.appendAuditLog(data, {
      action: "REFUND_APPROVE",
      targetType: "REFUND_WORK_ITEM",
      targetId: refundId,
      operatorId: body.operatorId || body.operator_id || "",
      reason: body.reason || "",
      before,
      after: clone(paid),
      metadata: { requestId: body.requestId || body.request_id || "" },
    });
    return response({ success: true, refund: paid, refundWorkItem: paid, audit });
  }
  const refund = data.refunds.find((item) => item.refund_id === refundId);
  if (!refund) throw businessError(404, "退款单不存在", 404);
  const before = clone(refund);
  refund.status = "PAID";
  refund.paid_at = nowISO();
  const session = data.checkinSessions.find((item) => item.session_id === refund.session_id);
  if (session) {
    session.status = "REFUNDED";
    session.refund_status = "PAID";
    const user = data.users.find((item) => item.user_id === session.user_id);
  }
  const audit = auditLog.appendAuditLog(data, {
    action: "REFUND_APPROVE",
    targetType: "REFUND",
    targetId: refundId,
    operatorId: body.operatorId || body.operator_id || "",
    reason: body.reason || "",
    before,
    after: clone(refund),
    metadata: { requestId: body.requestId || body.request_id || "" },
  });
  return response({ success: true, refund, audit });
}

function markCouponUsed(data, couponId, body = {}) {
  const before = clone(data.couponEvents.find((item) => item.coupon_id === couponId) || null);
  const used = coupon.markCouponUsed(data, couponId);
  operationTask.listOpenOperationTasks(data, { userId: used.user_id, taskType: "COUPON_UNUSED" }).forEach((task) => {
    const matchesCoupon = task.metadata && task.metadata.couponId === used.coupon_id;
    if (matchesCoupon) operationTask.completeOperationTask(data, task.task_id, { result: "COUPON_USED" });
  });
  const audit = auditLog.appendAuditLog(data, {
    action: "COUPON_USE",
    targetType: "COUPON",
    targetId: couponId,
    operatorId: body.operatorId || body.operator_id || "",
    reason: body.reason || "",
    before,
    after: clone(used),
    metadata: { requestId: body.requestId || body.request_id || "" },
  });
  return response({ success: true, coupon: toCouponAdminPayload(data, used), audit });
}

module.exports = {
  ROUTE_PERMISSIONS,
  ROUTES_BY_STATE,
  STATES,
  adminLaunchReadiness,
  adminDashboard,
  applyCorrection,
  applyRefund,
  archiveActivity,
  archiveReleaseEvidencePack,
  approveRefund,
  claimCoupon,
  completeOperationTask,
  continueAsDailyUser,
  cancelActivityEnrollment,
  cancelActivitySession,
  copyAdminLifecycleFilterPreset,
  createActivitySession,
  createFeedbackFollowTask,
  createStore,
  dailyHistory,
  dailyStats,
  dailyTrend,
  executeAdminOrderIncrementSync,
  executeAdminProductSync,
  enrollActivity,
  expireActivityEnrollmentReviews,
  deleteAdminLifecycleFilterPreset,
  createAdminLifecycleUserExport,
  cleanupAdminLifecycleUserExports,
  deliverAdminLifecycleUserExport,
  downloadAdminLifecycleUserExport,
  downloadSignedAdminLifecycleUserExport,
  exportAdminLifecycleUsersCsv,
  exportAdminOperationalAnalyticsCsv,
  getAdminLifecycleExportDeliveryHealth,
  listAdminLifecycleFilterPresets,
  listAdminLifecycleUserExports,
  reviewAdminLifecycleUserExportApproval,
  runDueAdminLifecycleExportDeliveries,
  upsertAdminOperationalAlertRule,
  upsertAdminLifecycleFilterPreset,
  runAdminOperationalAlertJob,
  runAdminLifecycleUserExportJob,
  runHealthDataRetentionCleanup,
  getActiveCampaign,
  getActivityDetail,
  getActivityEnrollments,
  getActionAdapterCalibration,
  getAdminLifecycleWorkbench,
  getAdminOperationalAnalytics,
  getCloudbaseIdentityProbe,
  getHealthConsentStatus,
  getFormalHealthBootstrap,
  getFormalHealthInitialAssessment,
  getFormalContentDetail,
  getFormalProfile,
  getPrivacyNotice,
  getProfile,
  getAdminUserDetail,
  getAdapterCalibration,
  getCouponStatus,
  getProduct,
  getReleaseEvidenceArchive,
  getReleaseEvidencePack,
  getReleaseRecord,
  getQuestionnaire,
  getQuestionnaireAnswerStatus,
  getQuestionnaireStatus,
  getReadyToStartUsers,
  getExternalSampleTemplate,
  getImportBatch,
  getExternalAdapters,
  generateOperationTasks,
  getUserOrders,
  getUserConsultations,
  getConsultationSla,
  getConsultationSlaEscalations,
  getConsultationAdvisorWorkbench,
  listProducts,
  listAdminLegacyDeprecationDecisions,
  listProductionCutoverProofs,
  listRootMemberCenterJumpProofs,
  getRecordDetail,
  getRecordList,
  getRefundStatus,
  getSession,
  getUserState,
  login,
  loginWithWechat,
  prepareWechatLoginExternalInputs,
  joinCampaign,
  listActivities,
  listAdminActivityDefinitions,
  listAdminActivityEnrollments,
  listAdminActivityReviewQueue,
  listAdminActivitySessions,
  listConsultationAdvisorAssignments,
  listConsultationWeworkWritebacks,
  listOrderAfterSalesRecords,
  listWeWorkTouchJobs,
  listOperationTasks,
  listAdminYouzanCustomers,
  listExternalSampleReviews,
  listFormalHomeContent,
  listImportBatches,
  listAuditLogs,
  exportImportFailuresCsv,
  markCouponUsed,
  matchOrder,
  searchAdminOrderMatching,
  publicUser,
  previewAdminOrderMatch,
  previewAdminOrderIncrementSync,
  previewAdminProductSync,
  planWeWorkTouches,
  previewCorrection,
  previewImport,
  publishActivity,
  confirmAdminOrderMatch,
  confirmImport,
  previewExternalSamples,
  importExternalSamples,
  upsertExternalStatusMapping,
  resolveManualReview,
  response,
  runDailyAudit,
  startCheckin,
  syncManualOrder,
  submitCheckin,
  submitDailyCheckin,
  submitFormalProfile,
  submitFormalHealthInitialAssessment,
  submitProfile,
  submitQuestionnaireAnswer,
  submitQuestionnaire,
  recordCouponRepurchaseClick,
  recordConsultationAdvisorAssignment,
  recordConsultationWeworkWriteback,
  recordAdminLegacyDeprecationDecision,
  recordProductionCutoverProof,
  recordRootMemberCenterJumpProof,
  recordProductJump,
  recordHealthConsentDecision,
  recordUserConsultation,
  requestActivityChanges,
  reviewActivityEnrollment,
  rollbackExternalAdapterRun,
  runDueExternalAdapterRetries,
  runDueWeWorkTouches,
  runExternalAdapter,
  signReleaseRecord,
  stableRootUserIdForToken,
  syncOrderAfterSalesBatch,
  trackEvent,
  toSessionPayload,
  updateDisplayProfile,
  updateOrderFulfillment,
  upsertOrderAfterSalesRecord,
  upsertActivityDraft,
  submitActivityForReview,
  unpublishActivity,
  updateActivitySessionState,
  upsertProduct,
  uploadImage,
};
