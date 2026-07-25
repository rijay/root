const { createCommandRequestDigestCodec } = require("./commandRequestDigest");

const RECIPIENT_BINDING_STATUS = Object.freeze({
  VERIFIED: "VERIFIED",
  UNVERIFIED: "UNVERIFIED",
});
const RECIPIENT_BINDING_OPERATION = "WECHAT_NOTIFICATION_RECIPIENT:v1";
const MYROOT_APP_CODE = "MYROOT";
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function text(value) {
  return String(value || "").trim();
}

function bindingError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function exactMyRootIdentity(data, rootUserId) {
  const root = text(rootUserId);
  const matches = (Array.isArray(data && data.wechatIdentities) ? data.wechatIdentities : [])
    .filter((identity) => text(identity.root_user_id) === root
      && text(identity.app_code).toUpperCase() === MYROOT_APP_CODE
      && IDENTIFIER_PATTERN.test(text(identity.openid)));
  if (!matches.length) {
    throw bindingError("CHECKIN_REMINDER_RECIPIENT_IDENTITY_REQUIRED", "订阅授权缺少 MYROOT 微信身份");
  }
  if (matches.length !== 1) {
    throw bindingError(
      "CHECKIN_REMINDER_RECIPIENT_IDENTITY_AMBIGUOUS",
      "同一 ROOT 账号存在多个 MYROOT 微信身份，禁止选择最近身份"
    );
  }
  return matches[0];
}

function normalizeScope(input = {}) {
  const rootUserId = text(input.rootUserId || input.root_user_id);
  const grantRequestId = text(input.grantRequestId || input.grant_request_id);
  const templateKey = text(input.templateKey || input.template_key);
  const templateId = text(input.templateId || input.template_id);
  const templateVersion = text(input.templateVersion || input.template_version);
  if (!rootUserId || rootUserId.length > 32
    || !grantRequestId || grantRequestId.length > 96
    || !templateKey || templateKey.length > 64
    || !templateId || templateId.length > 128
    || !templateVersion || templateVersion.length > 32) {
    throw bindingError("CHECKIN_REMINDER_RECIPIENT_BINDING_INPUT_INVALID", "订阅收件人绑定范围无效", 400);
  }
  return { rootUserId, grantRequestId, templateKey, templateId, templateVersion };
}

function descriptor(identity, scope) {
  return {
    commandName: RECIPIENT_BINDING_OPERATION,
    actorId: scope.rootUserId,
    idempotencyKey: scope.grantRequestId,
    request: {
      appCode: MYROOT_APP_CODE,
      openid: text(identity.openid),
      templateId: scope.templateId,
      templateKey: scope.templateKey,
      templateVersion: scope.templateVersion,
      wechatIdentityId: text(identity.wechat_identity_id),
    },
  };
}

function freezeWechatRecipientBinding(data, input = {}, options = {}) {
  const scope = normalizeScope(input);
  const identity = exactMyRootIdentity(data, scope.rootUserId);
  const identityId = text(identity.wechat_identity_id);
  if (!identityId || identityId.length > 32) {
    throw bindingError("CHECKIN_REMINDER_RECIPIENT_IDENTITY_INVALID", "MYROOT 微信身份标识无效");
  }
  const digest = createCommandRequestDigestCodec(options.env || process.env)
    .digest(descriptor(identity, scope));
  return Object.freeze({
    recipient_binding_status: RECIPIENT_BINDING_STATUS.VERIFIED,
    recipient_wechat_identity_id: identityId,
    recipient_app_code: MYROOT_APP_CODE,
    recipient_binding_canonical_version: digest.canonicalVersion,
    recipient_binding_digest: digest.digest,
    recipient_binding_digest_scheme: digest.digestVersion,
    recipient_binding_key_id: digest.keyId,
  });
}

function storedDigest(record = {}) {
  return {
    canonicalVersion: text(record.recipient_binding_canonical_version),
    digest: text(record.recipient_binding_digest),
    digestVersion: text(record.recipient_binding_digest_scheme),
    keyId: text(record.recipient_binding_key_id),
  };
}

function verifyWechatRecipientBinding(data, record = {}, options = {}) {
  const scope = normalizeScope(record);
  if (text(record.recipient_binding_status).toUpperCase() !== RECIPIENT_BINDING_STATUS.VERIFIED
    || text(record.recipient_app_code).toUpperCase() !== MYROOT_APP_CODE) {
    throw bindingError(
      "CHECKIN_REMINDER_RECIPIENT_BINDING_UNVERIFIED",
      "订阅授权没有可验证的固定收件人"
    );
  }
  const identity = exactMyRootIdentity(data, scope.rootUserId);
  if (text(identity.wechat_identity_id) !== text(record.recipient_wechat_identity_id)) {
    throw bindingError(
      "CHECKIN_REMINDER_RECIPIENT_BINDING_CHANGED",
      "订阅授权对应的 MYROOT 微信身份已变化"
    );
  }
  const valid = createCommandRequestDigestCodec(options.env || process.env)
    .verify(storedDigest(record), descriptor(identity, scope));
  if (!valid) {
    throw bindingError(
      "CHECKIN_REMINDER_RECIPIENT_BINDING_INVALID",
      "订阅授权收件人 digest 无法验证",
      503
    );
  }
  return { identity, openid: text(identity.openid) };
}

function markRecipientBindingUnverified(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return record;
  Object.assign(record, {
    recipient_binding_status: RECIPIENT_BINDING_STATUS.UNVERIFIED,
    recipient_wechat_identity_id: "",
    recipient_app_code: "",
    recipient_binding_canonical_version: "",
    recipient_binding_digest: "",
    recipient_binding_digest_scheme: "",
    recipient_binding_key_id: "",
  });
  return record;
}

function hasCompleteRecipientBinding(record = {}) {
  return text(record.recipient_binding_status).toUpperCase() === RECIPIENT_BINDING_STATUS.VERIFIED
    && Boolean(text(record.recipient_wechat_identity_id))
    && text(record.recipient_app_code).toUpperCase() === MYROOT_APP_CODE
    && text(record.recipient_binding_canonical_version) === "canonical-json:v1"
    && /^[a-f0-9]{64}$/.test(text(record.recipient_binding_digest))
    && text(record.recipient_binding_digest_scheme) === "hmac-sha256:v1"
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(text(record.recipient_binding_key_id));
}

function validateRecipientBindingCollection(grants, options = {}) {
  const errors = [];
  (Array.isArray(grants) ? grants : []).forEach((grant) => {
    const status = text(grant && grant.recipient_binding_status).toUpperCase()
      || RECIPIENT_BINDING_STATUS.UNVERIFIED;
    if (status === RECIPIENT_BINDING_STATUS.VERIFIED) {
      if (!hasCompleteRecipientBinding(grant)) {
        errors.push(`invalid recipient binding: ${text(grant.notification_subscription_grant_id) || "unknown"}`);
      }
    } else if (status !== RECIPIENT_BINDING_STATUS.UNVERIFIED) {
      errors.push(`invalid recipient binding status: ${text(grant.notification_subscription_grant_id) || "unknown"}`);
    } else if ([
      grant.recipient_wechat_identity_id,
      grant.recipient_app_code,
      grant.recipient_binding_canonical_version,
      grant.recipient_binding_digest,
      grant.recipient_binding_digest_scheme,
      grant.recipient_binding_key_id,
    ].some((value) => text(value))) {
      errors.push(`unverified recipient binding has metadata: ${text(grant.notification_subscription_grant_id) || "unknown"}`);
    }
    if (status === RECIPIENT_BINDING_STATUS.UNVERIFIED
      && text(grant && grant.status) !== "REVIEW_REQUIRED") {
      errors.push(`unverified recipient must require review: ${text(grant.notification_subscription_grant_id) || "unknown"}`);
    }
  });
  return { valid: errors.length === 0, errors };
}

module.exports = Object.freeze({
  MYROOT_APP_CODE,
  RECIPIENT_BINDING_OPERATION,
  RECIPIENT_BINDING_STATUS,
  exactMyRootIdentity,
  freezeWechatRecipientBinding,
  hasCompleteRecipientBinding,
  markRecipientBindingUnverified,
  validateRecipientBindingCollection,
  verifyWechatRecipientBinding,
});
