const { verifyWechatUnionIdAuthority } = require("./wechatIdentityAuthority");

const VERIFIED_UNIONID_RESOLUTION = Object.freeze({
  VERIFIED: "VERIFIED",
  NOT_VERIFIED: "NOT_VERIFIED",
  AMBIGUOUS: "AMBIGUOUS",
});

function text(value) {
  return String(value || "").trim();
}

function verifiedAuthority(identity, options = {}) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) return null;
  const rootUserId = text(identity.root_user_id || identity.rootUserId);
  const unionid = text(identity.unionid || identity.unionId || identity.union_id);
  if (!rootUserId || !unionid) return null;
  try {
    if (!verifyWechatUnionIdAuthority(identity, options)) return null;
  } catch {
    return null;
  }
  return { identity, rootUserId, unionid };
}

function listVerifiedWechatUnionIdAuthorities(identities, options = {}) {
  return (Array.isArray(identities) ? identities : [])
    .map((identity) => verifiedAuthority(identity, options))
    .filter(Boolean);
}

function resolveVerifiedWechatUnionIdOwnership(identities, unionid, options = {}) {
  const value = text(unionid);
  if (!value) {
    return { status: VERIFIED_UNIONID_RESOLUTION.NOT_VERIFIED, rootUserId: "", rootUserIds: [] };
  }
  const matches = listVerifiedWechatUnionIdAuthorities(identities, options)
    .filter((authority) => authority.unionid === value);
  const rootUserIds = [...new Set(matches.map((authority) => authority.rootUserId))].sort();
  if (rootUserIds.length > 1) {
    return { status: VERIFIED_UNIONID_RESOLUTION.AMBIGUOUS, rootUserId: "", rootUserIds };
  }
  if (rootUserIds.length !== 1) {
    return { status: VERIFIED_UNIONID_RESOLUTION.NOT_VERIFIED, rootUserId: "", rootUserIds: [] };
  }
  return {
    status: VERIFIED_UNIONID_RESOLUTION.VERIFIED,
    rootUserId: rootUserIds[0],
    rootUserIds,
  };
}

module.exports = Object.freeze({
  VERIFIED_UNIONID_RESOLUTION,
  listVerifiedWechatUnionIdAuthorities,
  resolveVerifiedWechatUnionIdOwnership,
});
