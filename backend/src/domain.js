const crypto = require("node:crypto");
const fs = require("node:fs");
const { createClientError } = require("./clientError");
const { resolveWechatOpenApiUrl } = require("./wechatOpenApiEndpoint");
const { nowISO } = require("./dates");
const auditLog = require("./auditLog");
const activityModule = require("./activityModule");
const {
  VERIFIED_UNIONID_RESOLUTION,
  listVerifiedWechatUnionIdAuthorities,
  resolveVerifiedWechatUnionIdOwnership,
} = require("./wechatUnionIdAuthority");
const cloudbaseIdentityProbe = require("./cloudbaseIdentityProbe");
const contentModule = require("./contentModule");
const formalHealthModule = require("./formalHealthModule");
const formalHealthAccessPolicy = require("./formalHealthAccessPolicy");
const healthScaleAssessmentModule = require("./healthScaleAssessmentModule");
const healthOperationsModule = require("./healthOperationsModule");
const {
  findRootUser,
  identifyUser,
  normalizeAppCode,
  normalizePhone,
  recordLifecycleEvent,
  resolveByWechatLogin,
} = require("./identity");
const healthDataRetention = require("./healthDataRetention");
const privacyConsent = require("./privacyConsent");
const profileModule = require("./profileModule");
const sessionModule = require("./sessionModule");
const { fetchWechatJson } = require("./wechatHttp");
const { resolveWechatAccessToken } = require("./wechatAccessToken");
const { createId, createSeedData } = require("./seed");
const { isProtectedRuntime, sessionTokenDigest } = require("./credentialProtection");
const {
  normalizeVerifiedAssertion,
  normalizeWechatSessionIdentity,
} = require("./trustedWechatIdentity");

const CLOUDBASE_ACCESS_TOKEN_FILE = "/.tencentcloudbase/wx/cloudbase_access_token";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function createStore() {
  return createSeedData();
}

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
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
  if (!user) return { state: "GUEST" };
  const identity = verifiedUnionIdSummary(data, user, context);
  return {
    userId: user.user_id,
    rootUserId: user.root_user_id || user.user_id,
    phone: maskPhone(user.phone),
    state: user.state,
    unionidStatus: identity.unionidStatus,
    appCode: user.app_code || "MYROOT",
    nickname: user.nickname || "ROOT体验官",
    avatarUrl: user.avatar_url || "",
  };
}

function isOpenidLoginAllowed(env = process.env) {
  return !isProtectedRuntime(env) && String(env.ROOT_ALLOW_OPENID_LOGIN || "").toLowerCase() === "true";
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
  const formalSession = sessionModule.present({ data, user, created: identityResult.created });
  const session = issueToken(data, user.user_id);
  return response({
    token: session.token,
    session: {
      expiresAt: session.expires_at,
    },
    autoMatch: null,
    user: publicUser(user, data, { env: body.env || process.env }),
    nextRoute: formalSession.nextRoute,
    ...formalSession,
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
    const formalSession = sessionModule.present({ data, user, created: identityResult.created });
    const session = issueToken(data, user.user_id);
    return response({
      token: session.token,
      session: {
        expiresAt: session.expires_at,
      },
      autoMatch: null,
      user: publicUser(user, data, { env }),
      nextRoute: formalSession.nextRoute,
      ...formalSession,
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
  const formalSession = sessionModule.present({ data, user, created: false });
  return response({
    user: publicUser(user, data, { env }),
    identity: {
      rootUserId: user.root_user_id || user.user_id,
      unionidStatus: identitySummary.unionidStatus,
      appCode: user.app_code || "MYROOT",
    },
    route: formalSession.nextRoute,
    sessionOutcome: formalSession.sessionOutcome,
    profile: formalSession.profile,
  });
}

function getFormalProfile(data, token) {
  const user = requireUser(data, token);
  return response(profileModule.read(data, user));
}

function listFormalHomeContent(data, context = {}) {
  return response(contentModule.listHome(data, context));
}

function listFormalWelcomeContent(data, context = {}) {
  return response(contentModule.listWelcome(data, context));
}

function getFormalContentDetail(data, contentId, context = {}) {
  return response(contentModule.getDetail(data, contentId, context));
}

function getFormalContentAsset(data, assetId) {
  return contentModule.getAsset(data, assetId);
}

function getFormalContentAction(data, actionId) {
  return response(contentModule.getAction(data, actionId));
}

function listAdminContentWelcome(data) {
  return response(contentModule.listAdminWelcome(data));
}

function listAdminContentHomeCarousel(data, query = {}) {
  return response(contentModule.listAdminHomeCarousel(data, query));
}

function listAdminContentSharedDetails(data, query = {}) {
  return response(contentModule.listAdminSharedDetails(data, query));
}

function contentOperationAudit(data, action, targetType, targetId, body, after) {
  return auditLog.appendAuditLog(data, {
    action,
    targetType,
    targetId,
    operatorId: body.operatorId || body.operator_id || "",
    reason: body.reason || (action.includes("PUBLISH") ? "发布候选内容版本" : "维护正式内容草稿"),
    before: null,
    after,
    metadata: {
      requestId: body.requestId || body.request_id || "",
      releaseStage: "CONTENT",
    },
  });
}

function saveAdminContentVersion(data, body, context, operation, action, targetType) {
  const result = operation(data, body, { ...context, operatorId: body.operatorId || "" });
  const version = result.version;
  const audit = contentOperationAudit(data, action, targetType, version.versionId, body, {
    versionId: version.versionId,
    logicalId: version.logicalId,
    version: version.version,
    revision: version.revision,
    status: version.status,
  });
  return response({ ...result, audit });
}

function saveAdminContentWelcomeDraft(data, body = {}, context = {}) {
  return saveAdminContentVersion(data, body, context, contentModule.saveWelcomeDraft, "CONTENT_WELCOME_DRAFT_SAVE", "CONTENT_WELCOME_VERSION");
}

function saveAdminContentHomeCarouselDraft(data, body = {}, context = {}) {
  return saveAdminContentVersion(data, body, context, contentModule.saveHomeCarouselDraft, "CONTENT_HOME_DRAFT_SAVE", "CONTENT_HOME_VERSION");
}

function saveAdminContentSharedDetailDraft(data, body = {}, context = {}) {
  return saveAdminContentVersion(data, body, context, contentModule.saveSharedDetailDraft, "CONTENT_DETAIL_DRAFT_SAVE", "CONTENT_DETAIL_VERSION");
}

async function uploadAdminContentAsset(data, body = {}, context = {}) {
  const uploadContext = { ...context, operatorId: body.operatorId || "" };
  const prepared = contentModule.prepareAssetUpload(body, uploadContext);
  const storage = context.objectStorageAdapter;
  if (!storage || typeof storage.putObject !== "function") {
    throw createClientError("CONTENT_ASSET_STORAGE_UNAVAILABLE", "图片存储服务暂不可用", 503);
  }
  const uploaded = await storage.putObject({
    objectKey: prepared.objectKey,
    body: prepared.buffer,
    contentType: prepared.record.mime_type,
    metadata: {
      assetId: prepared.assetId,
      scope: prepared.record.scope,
    },
  });
  const result = contentModule.recordUploadedAsset(data, prepared, uploaded);
  const audit = contentOperationAudit(data, "CONTENT_ASSET_UPLOAD", "CONTENT_ASSET", result.asset.assetId, body, {
    assetId: result.asset.assetId,
    mimeType: result.asset.mimeType,
    byteSize: result.asset.byteSize,
    width: result.asset.width,
    height: result.asset.height,
  });
  return response({ ...result, audit });
}

function validateAdminContentTarget(data, body = {}, context = {}) {
  return response(contentModule.validateTarget(body, context));
}

function markAdminContentPreviewCompleted(data, body = {}, context = {}) {
  const result = contentModule.markPreviewCompleted(data, body, { ...context, operatorId: body.operatorId || "" });
  const audit = contentOperationAudit(data, "CONTENT_PREVIEW_COMPLETE", "CONTENT_CANDIDATE", body.version, body, result.preview);
  return response({ ...result, audit });
}

function publishAdminContentCandidate(data, body = {}, context = {}) {
  const result = contentModule.publishCandidate(data, body, { ...context, operatorId: body.operatorId || "" });
  const audit = contentOperationAudit(data, "CONTENT_RELEASE_PUBLISH", "CONTENT_RELEASE", result.releaseVersion, body, result);
  return response({ ...result, audit });
}

function unpublishAdminContentVersion(data, body = {}, context = {}) {
  const result = contentModule.unpublishVersion(data, body, { ...context, operatorId: body.operatorId || "" });
  const audit = contentOperationAudit(data, "CONTENT_VERSION_UNPUBLISH", "CONTENT_VERSION", result.version.versionId, body, {
    versionId: result.version.versionId,
    status: result.version.status,
  });
  return response({ ...result, audit });
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
  return response(formalHealthModule.getDefinition(data, profile, context));
}

function getFormalHealthScale(data, token, scaleVersionId, query = {}, context = {}) {
  const user = requireUser(data, token);
  const { profile } = formalHealthContext(data, user, context);
  privacyConsent.requireHealthConsent(data, user.root_user_id || user.user_id, context);
  return response(healthScaleAssessmentModule.getDefinition(data, scaleVersionId, profile, query, context));
}

function getLatestFormalHealthScaleResult(data, token, scaleVersionId, context = {}) {
  const user = requireUser(data, token);
  const { profile } = formalHealthContext(data, user, context);
  privacyConsent.requireHealthConsent(data, user.root_user_id || user.user_id, context);
  formalHealthAccessPolicy.assertEligible(profile, context);
  return response({ result: healthScaleAssessmentModule.latestResult(data, user, scaleVersionId) });
}

function listAdminFormalHealthInitialization(data, query = {}) {
  return response(healthOperationsModule.listInitialization(data, query));
}

function listAdminFormalHealthScales(data, query = {}) {
  return response(healthOperationsModule.listScales(data, query));
}

function listAdminFormalHealthRecommendationRules(data, query = {}) {
  return response(healthOperationsModule.listRecommendationRules(data, query));
}

function listAdminFormalHealthLifestyleAdvice(data, query = {}) {
  return response(healthOperationsModule.listLifestyleAdvice(data, query));
}

function healthOperationContext(body = {}, context = {}) {
  return {
    ...context,
    operatorId: body.operatorId || body.operator_id || "",
  };
}

function healthOperationAudit(data, action, targetType, result, body = {}) {
  const version = result.version;
  return auditLog.appendAuditLog(data, {
    action,
    targetType,
    targetId: version.versionId,
    operatorId: body.operatorId || body.operator_id || "",
    reason: body.reason || (action.endsWith("PUBLISH") ? "发布健康运营内容候选版本" : "保存健康运营内容草稿"),
    before: null,
    after: {
      versionId: version.versionId,
      logicalId: version.logicalId,
      version: version.version,
      revision: version.revision,
      status: version.status,
    },
    metadata: {
      requestId: body.requestId || body.request_id || "",
      releaseStage: "CANDIDATE",
    },
  });
}

function healthOperationWrite(data, body, context, operation, action, targetType) {
  const result = operation(data, body, healthOperationContext(body, context));
  const audit = healthOperationAudit(data, action, targetType, result, body);
  return response({ ...result, audit });
}

function saveAdminFormalHealthInitializationDraft(data, body = {}, context = {}) {
  return healthOperationWrite(data, body, context, healthOperationsModule.saveInitializationDraft, "HEALTH_INITIALIZATION_DRAFT_SAVE", "HEALTH_INITIALIZATION_VERSION");
}

function publishAdminFormalHealthInitialization(data, body = {}, context = {}) {
  return healthOperationWrite(data, body, context, healthOperationsModule.publishInitialization, "HEALTH_INITIALIZATION_PUBLISH", "HEALTH_INITIALIZATION_VERSION");
}

function saveAdminFormalHealthScaleDraft(data, body = {}, context = {}) {
  return healthOperationWrite(data, body, context, healthOperationsModule.saveScaleDraft, "HEALTH_SCALE_DRAFT_SAVE", "HEALTH_SCALE_VERSION");
}

function publishAdminFormalHealthScale(data, body = {}, context = {}) {
  return healthOperationWrite(data, body, context, healthOperationsModule.publishScale, "HEALTH_SCALE_PUBLISH", "HEALTH_SCALE_VERSION");
}

function saveAdminFormalHealthRecommendationRuleDraft(data, body = {}, context = {}) {
  return healthOperationWrite(data, body, context, healthOperationsModule.saveRecommendationRuleDraft, "HEALTH_RECOMMENDATION_DRAFT_SAVE", "HEALTH_RECOMMENDATION_VERSION");
}

function publishAdminFormalHealthRecommendationRule(data, body = {}, context = {}) {
  return healthOperationWrite(data, body, context, healthOperationsModule.publishRecommendationRule, "HEALTH_RECOMMENDATION_PUBLISH", "HEALTH_RECOMMENDATION_VERSION");
}

function saveAdminFormalHealthLifestyleAdviceDraft(data, body = {}, context = {}) {
  return healthOperationWrite(data, body, context, healthOperationsModule.saveLifestyleAdviceDraft, "HEALTH_LIFESTYLE_DRAFT_SAVE", "HEALTH_LIFESTYLE_VERSION");
}

function publishAdminFormalHealthLifestyleAdvice(data, body = {}, context = {}) {
  return healthOperationWrite(data, body, context, healthOperationsModule.publishLifestyleAdvice, "HEALTH_LIFESTYLE_PUBLISH", "HEALTH_LIFESTYLE_VERSION");
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
      questionnaireVersion: result.questionnaireVersion,
    },
  });
  return response(result);
}

function submitFormalHealthScale(data, token, scaleVersionId, body = {}, context = {}) {
  const user = requireUser(data, token);
  const { profile } = formalHealthContext(data, user, context);
  privacyConsent.requireHealthConsent(data, user.root_user_id || user.user_id, context);
  const result = healthScaleAssessmentModule.submit(data, user, profile, scaleVersionId, body, context);
  recordLifecycleEvent(data, user.root_user_id || user.user_id, "ROOT4U_SCALE_ASSESSMENT_COMPLETED", {
    sourceChannel: "MYROOT_ROOT4U",
    appCode: user.app_code || "MYROOT",
    metadata: {
      responseId: result.result.responseId,
      scaleVersionId: result.result.scaleVersionId,
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

async function runHealthDataRetentionCleanup(data, body = {}, context = {}) {
  return response(await healthDataRetention.cleanupExpiredHealthData(data, body, context));
}

function getReleaseRecord(data, context = {}) {
  const contentRelease = contentModule.buildReleaseSummary(data, context);
  const status = contentRelease.blockerCount > 0
    ? "BLOCKED"
    : contentRelease.status === "EMPTY" || (contentRelease.draftCount > 0 && contentRelease.previewStatus !== "COMPLETED")
      ? "NEEDS_REVIEW"
      : "READY";
  return response({
    title: "myRoot 内容发布记录",
    status,
    target: context.target || "production",
    generatedAt: nowISO(),
    contentRelease,
  });
}

function getCloudbaseIdentityProbe(context = {}) {
  return response(cloudbaseIdentityProbe.buildCloudbaseIdentityProbe(context));
}

function listAuditLogs(data, query = {}) {
  const page = auditLog.listAuditLogPage(data, query);
  return response({ auditLogs: page.items, pagination: page.pagination });
}

module.exports = {
  archiveActivity,
  cancelActivityEnrollment,
  cancelActivitySession,
  createActivitySession,
  createStore,
  enrollActivity,
  expireActivityEnrollmentReviews,
  getActivityDetail,
  getActivityEnrollments,
  getCloudbaseIdentityProbe,
  getHealthConsentStatus,
  getFormalHealthBootstrap,
  getFormalHealthInitialAssessment,
  getFormalHealthScale,
  getLatestFormalHealthScaleResult,
  getFormalContentDetail,
  getFormalContentAsset,
  getFormalContentAction,
  getFormalProfile,
  getPrivacyNotice,
  getReleaseRecord,
  getUserState,
  listActivities,
  listAdminActivityDefinitions,
  listAdminActivityEnrollments,
  listAdminActivityReviewQueue,
  listAdminActivitySessions,
  listAdminContentHomeCarousel,
  listAdminContentSharedDetails,
  listAdminContentWelcome,
  listAdminFormalHealthInitialization,
  listAdminFormalHealthLifestyleAdvice,
  listAdminFormalHealthRecommendationRules,
  listAdminFormalHealthScales,
  listAuditLogs,
  listFormalHomeContent,
  listFormalWelcomeContent,
  login,
  loginWithWechat,
  markAdminContentPreviewCompleted,
  prepareWechatLoginExternalInputs,
  publicUser,
  publishActivity,
  publishAdminContentCandidate,
  publishAdminFormalHealthInitialization,
  publishAdminFormalHealthLifestyleAdvice,
  publishAdminFormalHealthRecommendationRule,
  publishAdminFormalHealthScale,
  recordHealthConsentDecision,
  requestActivityChanges,
  response,
  reviewActivityEnrollment,
  runHealthDataRetentionCleanup,
  saveAdminContentHomeCarouselDraft,
  saveAdminContentSharedDetailDraft,
  saveAdminContentWelcomeDraft,
  saveAdminFormalHealthInitializationDraft,
  saveAdminFormalHealthLifestyleAdviceDraft,
  saveAdminFormalHealthRecommendationRuleDraft,
  saveAdminFormalHealthScaleDraft,
  stableRootUserIdForToken,
  submitActivityForReview,
  submitFormalHealthInitialAssessment,
  submitFormalHealthScale,
  submitFormalProfile,
  unpublishActivity,
  unpublishAdminContentVersion,
  updateActivitySessionState,
  uploadAdminContentAsset,
  upsertActivityDraft,
  validateAdminContentTarget,
};
