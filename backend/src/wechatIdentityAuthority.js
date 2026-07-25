const { nowISO } = require("./dates");
const { createCommandRequestDigestCodec } = require("./commandRequestDigest");

const WECHAT_UNIONID_TRUST_STATUS = Object.freeze({
  VERIFIED: "VERIFIED",
  UNVERIFIED: "UNVERIFIED",
});
const WECHAT_UNIONID_PROVENANCE_OPERATION = "VERIFY_WECHAT_UNIONID:v1";
const VERIFIED_PROVENANCE_SOURCES = new Set([
  "CLOUDBASE",
  "WECHAT_GATEWAY",
  "WECHAT_CODE2SESSION",
]);
const APP_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,31}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function text(value) {
  return String(value || "").trim();
}

function authorityError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function normalizeFacts(input = {}) {
  const rootUserId = text(input.rootUserId || input.root_user_id);
  const appCode = text(input.appCode || input.app_code).toUpperCase();
  const openid = text(input.openid);
  const unionid = text(input.unionid);
  const source = text(input.source || input.unionid_provenance_source).toUpperCase();
  const verifiedAt = text(input.verifiedAt || input.unionid_verified_at);
  if (!rootUserId || rootUserId.length > 32
    || !APP_CODE_PATTERN.test(appCode)
    || !IDENTIFIER_PATTERN.test(openid)
    || !IDENTIFIER_PATTERN.test(unionid)
    || !VERIFIED_PROVENANCE_SOURCES.has(source)
    || !Number.isFinite(Date.parse(verifiedAt))) {
    throw authorityError(
      "WECHAT_UNIONID_PROVENANCE_INPUT_INVALID",
      "可信微信 UnionID provenance 输入不完整",
      400
    );
  }
  return { rootUserId, appCode, openid, unionid, source, verifiedAt };
}

function descriptor(input) {
  const facts = normalizeFacts(input);
  return {
    commandName: WECHAT_UNIONID_PROVENANCE_OPERATION,
    actorId: facts.rootUserId,
    idempotencyKey: `${facts.appCode}:${facts.openid}`,
    request: {
      appCode: facts.appCode,
      openid: facts.openid,
      source: facts.source,
      unionid: facts.unionid,
      verifiedAt: facts.verifiedAt,
    },
  };
}

function storedDigest(identity = {}) {
  return {
    canonicalVersion: text(identity.unionid_provenance_canonical_version),
    digest: text(identity.unionid_provenance_digest),
    digestVersion: text(identity.unionid_provenance_digest_scheme),
    keyId: text(identity.unionid_provenance_key_id),
  };
}

function stampVerifiedWechatUnionId(identity, input = {}, options = {}) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
    throw authorityError("WECHAT_UNIONID_PROVENANCE_INPUT_INVALID", "微信身份记录无效", 400);
  }
  const facts = normalizeFacts({
    ...input,
    rootUserId: input.rootUserId || identity.root_user_id,
    appCode: input.appCode || identity.app_code,
    openid: input.openid || identity.openid,
    unionid: input.unionid || identity.unionid,
    verifiedAt: input.verifiedAt || nowISO(),
  });
  const digest = createCommandRequestDigestCodec(options.env || process.env).digest(descriptor(facts));
  Object.assign(identity, {
    unionid: facts.unionid,
    unionid_status: "LINKED",
    unionid_trust_status: WECHAT_UNIONID_TRUST_STATUS.VERIFIED,
    unionid_provenance_source: facts.source,
    unionid_verified_at: facts.verifiedAt,
    unionid_provenance_canonical_version: digest.canonicalVersion,
    unionid_provenance_digest: digest.digest,
    unionid_provenance_digest_scheme: digest.digestVersion,
    unionid_provenance_key_id: digest.keyId,
  });
  return identity;
}

function markWechatUnionIdUnverified(identity) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) return identity;
  Object.assign(identity, {
    unionid_status: "PENDING",
    unionid_trust_status: WECHAT_UNIONID_TRUST_STATUS.UNVERIFIED,
    unionid_provenance_source: "",
    unionid_verified_at: "",
    unionid_provenance_canonical_version: "",
    unionid_provenance_digest: "",
    unionid_provenance_digest_scheme: "",
    unionid_provenance_key_id: "",
  });
  return identity;
}

function normalizeWechatIdentityAuthority(identity) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) return identity;
  if (text(identity.unionid_trust_status).toUpperCase() !== WECHAT_UNIONID_TRUST_STATUS.VERIFIED) {
    markWechatUnionIdUnverified(identity);
  }
  return identity;
}

function verifyWechatUnionIdAuthority(identity, options = {}) {
  if (!identity || text(identity.unionid_trust_status).toUpperCase() !== WECHAT_UNIONID_TRUST_STATUS.VERIFIED) {
    return false;
  }
  let facts;
  try {
    facts = normalizeFacts(identity);
  } catch {
    return false;
  }
  return createCommandRequestDigestCodec(options.env || process.env)
    .verify(storedDigest(identity), descriptor(facts));
}

function assertVerifiedWechatUnionIdAuthority(identity, options = {}) {
  if (!verifyWechatUnionIdAuthority(identity, options)) {
    throw authorityError(
      "WECHAT_UNIONID_PROVENANCE_INVALID",
      "已存微信 UnionID provenance 无法验证，禁止归并",
      503
    );
  }
  return identity;
}

function validateWechatIdentityCollection(identities, options = {}) {
  const errors = [];
  const appOpenids = new Set();
  const rootApps = new Set();
  (Array.isArray(identities) ? identities : []).forEach((identity) => {
    if (!identity || typeof identity !== "object") {
      errors.push("wechat identity must be an object");
      return;
    }
    const appCode = text(identity.app_code).toUpperCase();
    const openid = text(identity.openid);
    const rootUserId = text(identity.root_user_id);
    const appOpenid = `${appCode}:${openid}`;
    const rootApp = `${rootUserId}:${appCode}`;
    if (!rootUserId || !APP_CODE_PATTERN.test(appCode) || !IDENTIFIER_PATTERN.test(openid)) {
      errors.push(`invalid wechat identity scope: ${text(identity.wechat_identity_id) || "unknown"}`);
    }
    if (appOpenids.has(appOpenid)) errors.push(`duplicate wechat identity app/openid: ${appOpenid}`);
    if (rootApps.has(rootApp)) errors.push(`duplicate wechat identity root/app: ${rootApp}`);
    appOpenids.add(appOpenid);
    rootApps.add(rootApp);
    const trustStatus = text(identity.unionid_trust_status).toUpperCase()
      || WECHAT_UNIONID_TRUST_STATUS.UNVERIFIED;
    if (trustStatus === WECHAT_UNIONID_TRUST_STATUS.VERIFIED) {
      if (!verifyWechatUnionIdAuthority(identity, options)) {
        errors.push(`invalid verified wechat unionid provenance: ${text(identity.wechat_identity_id) || "unknown"}`);
      }
    } else if (trustStatus !== WECHAT_UNIONID_TRUST_STATUS.UNVERIFIED) {
      errors.push(`invalid wechat unionid trust status: ${text(identity.wechat_identity_id) || "unknown"}`);
    } else if ([
      identity.unionid_provenance_source,
      identity.unionid_verified_at,
      identity.unionid_provenance_canonical_version,
      identity.unionid_provenance_digest,
      identity.unionid_provenance_digest_scheme,
      identity.unionid_provenance_key_id,
    ].some((value) => text(value))) {
      errors.push(`unverified wechat unionid has provenance metadata: ${text(identity.wechat_identity_id) || "unknown"}`);
    }
  });
  return { valid: errors.length === 0, errors };
}

module.exports = Object.freeze({
  VERIFIED_PROVENANCE_SOURCES,
  WECHAT_UNIONID_PROVENANCE_OPERATION,
  WECHAT_UNIONID_TRUST_STATUS,
  assertVerifiedWechatUnionIdAuthority,
  markWechatUnionIdUnverified,
  normalizeWechatIdentityAuthority,
  stampVerifiedWechatUnionId,
  validateWechatIdentityCollection,
  verifyWechatUnionIdAuthority,
});
