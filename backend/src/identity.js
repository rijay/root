const { nowISO } = require("./dates");
const { createId } = require("./seed");
const { phoneFingerprint } = require("./credentialProtection");
const {
  WECHAT_UNIONID_TRUST_STATUS,
  assertVerifiedWechatUnionIdAuthority,
  markWechatUnionIdUnverified,
  stampVerifiedWechatUnionId,
} = require("./wechatIdentityAuthority");

const DEFAULT_APP_CODE = "MYROOT";
const UNIONID_STATUS = {
  PENDING: "PENDING",
  LINKED: "LINKED",
};

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function normalizeAppCode(value) {
  const text = String(value || DEFAULT_APP_CODE).trim().toUpperCase();
  if (["MYROOT", "ROOT_MEMBER_CENTER", "YOUZAN_ROOT"].includes(text)) return text;
  return text.replace(/[^A-Z0-9_]/g, "_").slice(0, 32) || DEFAULT_APP_CODE;
}

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function identityError(code, message, status = 200) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function lifecycleStatusFromUser(user) {
  if (!user) return "UNREGISTERED";
  return user.state || user.lifecycle_status || "UNREGISTERED";
}

function recordLifecycleEvent(data, rootUserId, eventType, context = {}) {
  if (!rootUserId || !eventType) return null;
  const events = ensureList(data, "userLifecycleEvents");
  const event = {
    lifecycle_event_id: createId("ule"),
    root_user_id: rootUserId,
    event_type: eventType,
    source_channel: context.sourceChannel || context.source_channel || "",
    app_code: normalizeAppCode(context.appCode || context.app_code || DEFAULT_APP_CODE),
    metadata: context.metadata || {},
    occurred_at: context.occurredAt || context.occurred_at || nowISO(),
  };
  events.push(event);
  return event;
}

function findRootUser(data, rootUserId) {
  return ensureList(data, "rootUsers").find((item) => item.root_user_id === rootUserId) || null;
}

function findLegacyUser(data, rootUserId) {
  return ensureList(data, "users").find((item) => item.user_id === rootUserId) || null;
}

function legacyAppCode(user) {
  return normalizeAppCode(user && user.app_code || DEFAULT_APP_CODE);
}

function explicitIdentityAppCode(identity) {
  const raw = String(identity && identity.app_code || "").trim();
  return raw ? normalizeAppCode(raw) : "";
}

function resolveWechatOpenidForApp(data, rootUserId, appCode) {
  const normalizedRootUserId = String(rootUserId || "").trim();
  const normalizedAppCode = normalizeAppCode(appCode);
  if (!normalizedRootUserId) return "";
  const matches = ensureList(data, "wechatIdentities")
    .filter((item) => item.root_user_id === normalizedRootUserId
      && explicitIdentityAppCode(item) === normalizedAppCode
      && String(item.openid || "").trim());
  if (matches.length > 1) {
    throw identityError(
      "WECHAT_APP_IDENTITY_AMBIGUOUS",
      "同一 ROOT 账号存在多个同应用微信身份，禁止静默选择",
      409
    );
  }
  return matches[0] ? String(matches[0].openid).trim() : "";
}

function ensureRootUser(data, input = {}) {
  const rootUsers = ensureList(data, "rootUsers");
  const users = ensureList(data, "users");
  const phone = normalizePhone(input.phone);
  const appCode = normalizeAppCode(input.appCode || input.app_code);
  let legacyUser = input.rootUserId ? users.find((item) => item.user_id === input.rootUserId) : null;

  if (!legacyUser && input.openid) {
    legacyUser = users.find((item) => item.openid === input.openid && legacyAppCode(item) === appCode);
  }
  if (!legacyUser && phone) legacyUser = users.find((item) => normalizePhone(item.phone) === phone);

  let rootUser = null;
  if (legacyUser) {
    rootUser = rootUsers.find((item) => item.root_user_id === legacyUser.user_id) || null;
  }
  if (!rootUser && input.rootUserId) rootUser = rootUsers.find((item) => item.root_user_id === input.rootUserId) || null;

  const now = nowISO();
  let created = false;
  if (!rootUser) {
    const rootUserId = legacyUser ? legacyUser.user_id : createId("usr");
    rootUser = {
      root_user_id: rootUserId,
      lifecycle_status: legacyUser ? lifecycleStatusFromUser(legacyUser) : "UNREGISTERED",
      source_channel: input.sourceChannel || input.source_channel || "",
      unionid_status: input.unionidVerified === true ? UNIONID_STATUS.LINKED : UNIONID_STATUS.PENDING,
      created_at: legacyUser ? legacyUser.created_at || now : now,
      updated_at: now,
    };
    rootUsers.push(rootUser);
    created = true;
  }

  if (!legacyUser) {
    legacyUser = {
      user_id: rootUser.root_user_id,
      root_user_id: rootUser.root_user_id,
      openid: input.openid || "",
      unionid: input.unionidVerified === true ? input.unionid || "" : "",
      phone,
      nickname: input.nickname || "ROOT体验官",
      avatar_url: input.avatarUrl || input.avatar_url || "",
      state: rootUser.lifecycle_status || "UNREGISTERED",
      created_at: now,
      registered_at: "",
      activated_at: "",
      completed_at: "",
      total_checkin_days: 0,
      current_streak: 0,
      longest_streak: 0,
      last_checkin_date: "",
      unionid_status: input.unionidVerified === true ? UNIONID_STATUS.LINKED : UNIONID_STATUS.PENDING,
      app_code: appCode,
    };
    users.push(legacyUser);
  }

  legacyUser.root_user_id = rootUser.root_user_id;
  if (input.openid && !legacyUser.openid) {
    legacyUser.openid = input.openid;
    legacyUser.app_code = appCode;
  }
  if (input.unionidVerified === true && input.unionid && !legacyUser.unionid) legacyUser.unionid = input.unionid;
  if (phone && !legacyUser.phone) legacyUser.phone = phone;
  legacyUser.unionid_status = input.unionidVerified === true && (input.unionid || legacyUser.unionid)
    ? UNIONID_STATUS.LINKED
    : UNIONID_STATUS.PENDING;
  legacyUser.app_code = legacyAppCode(legacyUser);

  rootUser.lifecycle_status = lifecycleStatusFromUser(legacyUser);
  rootUser.unionid_status = legacyUser.unionid_status === UNIONID_STATUS.LINKED
    ? UNIONID_STATUS.LINKED
    : UNIONID_STATUS.PENDING;
  rootUser.updated_at = now;

  if (created) recordLifecycleEvent(data, rootUser.root_user_id, "ROOT_USER_CREATED", input);

  return { rootUser, user: legacyUser, created };
}

function upsertWechatIdentity(data, rootUserId, input = {}) {
  const openid = String(input.openid || "").trim();
  if (!openid) return null;
  const appCode = normalizeAppCode(input.appCode || input.app_code);
  const identities = ensureList(data, "wechatIdentities");
  const exactMatches = identities.filter((item) => explicitIdentityAppCode(item) === appCode && item.openid === openid);
  if (exactMatches.length > 1) {
    throw identityError("WECHAT_APP_OPENID_AMBIGUOUS", "应用 OpenID 对应多个身份，禁止登录", 409);
  }
  let identity = exactMatches[0] || null;
  const now = nowISO();
  if (!identity) {
    if (identities.some((item) => item.root_user_id === rootUserId && explicitIdentityAppCode(item) === appCode)) {
      throw identityError("WECHAT_APP_IDENTITY_AMBIGUOUS", "同一 ROOT 账号已绑定该应用的其他微信身份", 409);
    }
    identity = {
      wechat_identity_id: createId("wxi"),
      root_user_id: rootUserId,
      app_code: appCode,
      openid,
      unionid: "",
      unionid_status: UNIONID_STATUS.PENDING,
      unionid_trust_status: WECHAT_UNIONID_TRUST_STATUS.UNVERIFIED,
      unionid_provenance_source: "",
      unionid_verified_at: "",
      unionid_provenance_canonical_version: "",
      unionid_provenance_digest: "",
      unionid_provenance_digest_scheme: "",
      unionid_provenance_key_id: "",
      created_at: now,
      updated_at: now,
      last_seen_at: now,
    };
    identities.push(identity);
  }
  identity.app_code = appCode;
  identity.root_user_id = rootUserId;
  if (input.unionidVerified === true && input.unionid) {
    if (identity.unionid_trust_status === WECHAT_UNIONID_TRUST_STATUS.VERIFIED
      && identity.unionid && identity.unionid !== input.unionid) {
      throw identityError("WECHAT_IDENTITY_BINDING_CONFLICT", "可信 OpenID 的 UnionID 发生冲突", 409);
    }
    stampVerifiedWechatUnionId(identity, {
      rootUserId,
      appCode,
      openid,
      unionid: input.unionid,
      source: input.identitySource,
      verifiedAt: now,
    }, { env: input.env || process.env });
  } else if (identity.unionid_trust_status !== WECHAT_UNIONID_TRUST_STATUS.VERIFIED) {
    markWechatUnionIdUnverified(identity);
  }
  identity.updated_at = now;
  identity.last_seen_at = now;
  return identity;
}

function linkUnionId(data, rootUserId, unionid, evidence = {}) {
  const value = String(unionid || "").trim();
  if (!rootUserId || !value || evidence.unionidVerified !== true) {
    throw identityError("WECHAT_UNIONID_PROVENANCE_REQUIRED", "UnionID 只能由可信 provenance 建立关联", 409);
  }
  const rootUser = findRootUser(data, rootUserId);
  const user = findLegacyUser(data, rootUserId);
  if (rootUser) {
    rootUser.unionid = value;
    rootUser.unionid_status = UNIONID_STATUS.LINKED;
    rootUser.updated_at = nowISO();
  }
  if (user) {
    user.unionid = value;
    user.unionid_status = UNIONID_STATUS.LINKED;
  }
  return recordLifecycleEvent(data, rootUserId, "UNIONID_LINKED", {
    ...evidence,
    metadata: { unionidLinked: true },
  });
}

function attachContactMethod(data, rootUserId, contact = {}, evidence = {}, options = {}) {
  const phone = normalizePhone(contact.phone || contact.receiverPhone || contact.receiver_phone);
  if (!rootUserId || !phone) return null;
  const contactMethods = ensureList(data, "userContactMethods");
  let method = contactMethods.find((item) => item.root_user_id === rootUserId && item.contact_type === "PHONE");
  const now = nowISO();
  if (!method) {
    method = {
      contact_method_id: createId("ucm"),
      root_user_id: rootUserId,
      contact_type: "PHONE",
      phone_masked: "",
      phone_hash: "",
      verified: false,
      evidence: {},
      created_at: now,
      updated_at: now,
    };
    contactMethods.push(method);
  }
  method.phone_masked = phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone;
  method.phone_hash = phoneFingerprint(phone, options.env || process.env);
  method.verified = Boolean(contact.verified);
  method.evidence = evidence;
  method.updated_at = now;
  return method;
}

function resolveByWechatLogin(data, input = {}, context = {}) {
  const appCode = normalizeAppCode(input.appCode || input.app_code || context.appCode || context.app_code);
  const phone = normalizePhone(input.phone);
  if (phone) phoneFingerprint(phone, context.env || process.env);
  const identities = ensureList(data, "wechatIdentities");
  const exactMatches = input.openid
    ? identities.filter((item) => explicitIdentityAppCode(item) === appCode && item.openid === input.openid)
    : [];
  if (exactMatches.length > 1) {
    throw identityError("WECHAT_APP_OPENID_AMBIGUOUS", "应用 OpenID 对应多个身份，禁止登录", 409);
  }
  const identity = exactMatches[0] || null;
  const unionidTrusted = context.unionidTrusted === true || context.allowCrossAppUnionLink === true;
  const unionIdentities = input.unionid
    ? identities.filter((item) => item.unionid === input.unionid
      && item.unionid_trust_status === WECHAT_UNIONID_TRUST_STATUS.VERIFIED)
    : [];
  if (unionidTrusted) {
    unionIdentities.forEach((item) => assertVerifiedWechatUnionIdAuthority(item, {
      env: context.env || process.env,
    }));
  }
  const unionRootUserIds = new Set(unionIdentities.map((item) => item.root_user_id).filter(Boolean));
  if (unionidTrusted && unionRootUserIds.size > 1) {
    throw identityError(
      "WECHAT_UNIONID_BINDING_AMBIGUOUS",
      "可信 UnionID 对应多个 ROOT 账号，禁止自动归并",
      409
    );
  }
  const unionIdentity = !identity && unionidTrusted ? unionIdentities[0] || null : null;
  const existingUnionOwner = unionidTrusted ? unionIdentities[0] || null : null;
  if (unionidTrusted && identity && existingUnionOwner
    && existingUnionOwner.root_user_id !== identity.root_user_id) {
    throw identityError(
      "WECHAT_IDENTITY_BINDING_CONFLICT",
      "当前应用 OpenID 与可信 UnionID 绑定到不同 ROOT 账号，禁止自动改绑",
      409
    );
  }
  const effectiveUnionid = unionidTrusted && input.unionid ? input.unionid : "";
  const existingRootUserId = (identity && identity.root_user_id) || (unionIdentity && unionIdentity.root_user_id) || "";
  const result = ensureRootUser(data, {
    ...input,
    ...context,
    appCode,
    phone,
    unionid: effectiveUnionid,
    unionidVerified: Boolean(effectiveUnionid),
    rootUserId: existingRootUserId,
  });

  const wechatIdentity = upsertWechatIdentity(data, result.rootUser.root_user_id, {
    ...input,
    appCode,
    unionid: effectiveUnionid,
    unionidVerified: Boolean(effectiveUnionid),
    identitySource: context.identitySource,
    env: context.env || process.env,
  });
  if (effectiveUnionid) {
    linkUnionId(data, result.rootUser.root_user_id, effectiveUnionid, {
      ...context,
      appCode,
      unionidVerified: true,
    });
  }
  if (phone) {
    const { env, ...safeContext } = context || {};
    attachContactMethod(
      data,
      result.rootUser.root_user_id,
      { phone, verified: true },
      { ...safeContext, appCode, source: "WECHAT_PHONE" },
      { env: env || process.env }
    );
  }
  recordLifecycleEvent(data, result.rootUser.root_user_id, "WECHAT_LOGIN", { ...context, appCode });

  return {
    ...result,
    wechatIdentity,
    unionidStatus: result.user.unionid_status || result.rootUser.unionid_status || UNIONID_STATUS.PENDING,
  };
}

function bindReceiverPhone(data, user, receiverPhone) {
  const phone = normalizePhone(receiverPhone);
  if (!phone) throw identityError(1002, "手机号必填");

  const identityLinks = ensureList(data, "identityLinks");
  const conflicts = identityLinks.filter((item) => item.receiver_phone === phone && item.user_id !== user.user_id);
  let link = identityLinks.find((item) => item.user_id === user.user_id && item.receiver_phone === phone);

  if (!link) {
    link = {
      identity_link_id: createId("idn"),
      user_id: user.user_id,
      receiver_phone: phone,
      external_contact_id: "",
      wechat_remark_name: "",
      match_confidence: "HIGH",
      warnings: [],
      link_type: "RECEIVER_PHONE",
      evidence: { source: "ORDER_MATCH" },
      created_at: nowISO(),
      updated_at: nowISO(),
    };
    identityLinks.push(link);
  }

  link.receiver_phone = phone;
  link.match_confidence = conflicts.length ? "WARNING" : "HIGH";
  link.warnings = conflicts.length ? ["PHONE_BOUND_TO_OTHER_USER"] : [];
  link.link_type = link.link_type || "RECEIVER_PHONE";
  link.evidence = link.evidence || { source: "ORDER_MATCH" };
  link.updated_at = nowISO();
  attachContactMethod(data, user.root_user_id || user.user_id, { phone, verified: true }, { source: "ORDER_MATCH" });
  return link;
}

function linkWechatLead(data, user, leadHint = {}) {
  const leadProfiles = ensureList(data, "leadProfiles");
  if (!leadHint.externalContactId && !leadHint.remarkName && !leadHint.sourceChannel) return null;

  let lead = leadProfiles.find((item) => item.user_id === user.user_id);
  if (!lead) {
    lead = {
      lead_id: createId("lead"),
      user_id: user.user_id,
      source_channel: "",
      offline_event_name: "",
      corp_wechat_status: "UNKNOWN",
      rule_sent_at: "",
      operator_note: "",
      created_at: nowISO(),
      updated_at: nowISO(),
    };
    leadProfiles.push(lead);
  }

  lead.external_contact_id = leadHint.externalContactId || lead.external_contact_id || "";
  lead.wechat_remark_name = leadHint.remarkName || lead.wechat_remark_name || "";
  lead.source_channel = leadHint.sourceChannel || lead.source_channel || "";
  lead.offline_event_name = leadHint.offlineEventName || lead.offline_event_name || "";
  lead.corp_wechat_status = leadHint.corpWechatStatus || lead.corp_wechat_status || "UNKNOWN";
  lead.operator_note = leadHint.operatorNote || lead.operator_note || "";
  lead.updated_at = nowISO();
  return lead;
}

function getIdentityWarnings(data, userId) {
  return ensureList(data, "identityLinks")
    .filter((item) => item.user_id === userId)
    .flatMap((item) => item.warnings || []);
}

function identifyUser(data, user, body = {}) {
  const identityLink = body.phone ? bindReceiverPhone(data, user, body.phone) : null;
  const leadProfile = linkWechatLead(data, user, body.leadHint || {});
  return {
    identityLink,
    leadProfile,
    warnings: getIdentityWarnings(data, user.user_id),
  };
}

module.exports = {
  UNIONID_STATUS,
  attachContactMethod,
  bindReceiverPhone,
  findRootUser,
  getIdentityWarnings,
  identifyUser,
  linkUnionId,
  linkWechatLead,
  normalizeAppCode,
  normalizePhone,
  recordLifecycleEvent,
  resolveWechatOpenidForApp,
  resolveByWechatLogin,
};
