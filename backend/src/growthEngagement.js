const crypto = require("node:crypto");

const { nowISO } = require("./dates");
const { createId } = require("./seed");

const CHANNEL_SIGNATURE_SCHEME = "HMAC-SHA256-V1";
const SAFE_POPUP_ACTIONS = new Set(["NONE", "OPEN_PAGE", "OPEN_PRODUCT"]);
const SAFE_POPUP_PAGES = new Set([
  "/pages/home/index",
  "/pages/products/index",
  "/pages/health/index",
  "/pages/activities/index",
]);
const SAFE_CHANNEL_TARGET_PAGES = new Set([
  "/pages/home/index",
  "/pages/products/index",
  "/pages/product-detail/index",
  "/pages/health/index",
  "/pages/activities/index",
  "/subpkg/activity/pages/detail/index",
]);
const SAFE_TARGET_QUERY_KEYS = Object.freeze({
  "/pages/products/index": new Set(["productId"]),
  "/pages/product-detail/index": new Set(["productId"]),
  "/subpkg/activity/pages/detail/index": new Set(["sessionId"]),
});
const OFFICIAL_PRODUCT_CAMPAIGN = Object.freeze({
  campaign_id: "ROOT_PRODUCTS_V060",
  title: "ROOT 产品探索",
  status: "ACTIVE",
  start_at: "2026-08-01T00:00:00+08:00",
  end_at: "2099-01-01T00:00:00+08:00",
  config_json: Object.freeze({
    sessionPopup: Object.freeze({
      popupId: "root-products-v060",
      version: 1,
      status: "ACTIVE",
      approvalStatus: "APPROVED",
      priority: 10,
      eyebrow: "ROOT 日常补给",
      title: "探索适合你的日常补给",
      body: "登录后每个会话仅展示一次，可随时关闭。",
      secondaryLabel: "暂时关闭",
      action: Object.freeze({
        type: "OPEN_PRODUCT",
        target: "4749049439",
        label: "立即探索",
      }),
    }),
  }),
});

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function time(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function activeDuring(row, now) {
  const current = time(now) || Date.now();
  const start = time(row.start_at || row.startAt);
  const end = time(row.end_at || row.endAt);
  return (!start || start <= current) && (!end || end >= current);
}

function campaignDefinitions(data) {
  const persisted = ensureList(data, "campaignDefinitions");
  const hasConfiguredPopup = persisted.some((item) => {
    const config = item && (item.config_json || item.config) || {};
    return Boolean(config.sessionPopup || config.session_popup);
  });
  if (hasConfiguredPopup
    || persisted.some((item) => item && item.campaign_id === OFFICIAL_PRODUCT_CAMPAIGN.campaign_id)) {
    return persisted;
  }
  return [...persisted, OFFICIAL_PRODUCT_CAMPAIGN];
}

function activeCampaign(data, campaignId, now) {
  return campaignDefinitions(data).find((item) => (
    item.campaign_id === campaignId
    && text(item.status).toUpperCase() === "ACTIVE"
    && activeDuring(item, now)
  )) || null;
}

function campaignPopupConfig(campaign) {
  const config = campaign && (campaign.config_json || campaign.config) || {};
  const popup = config.sessionPopup || config.session_popup || null;
  if (!popup || text(popup.status).toUpperCase() !== "ACTIVE") return null;
  if (text(popup.approvalStatus || popup.approval_status).toUpperCase() !== "APPROVED") return null;
  const popupId = text(popup.popupId || popup.popup_id);
  const version = Number(popup.version || 0);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(popupId) || !Number.isInteger(version) || version < 1) return null;
  if (!text(popup.title) || !text(popup.body)) return null;
  return popup;
}

function popupAction(popup) {
  const source = popup.action && typeof popup.action === "object" ? popup.action : {};
  const type = text(source.type, "NONE").toUpperCase();
  if (!SAFE_POPUP_ACTIONS.has(type)) return { type: "NONE", label: "知道了", target: "" };
  if (type === "OPEN_PAGE") {
    const target = text(source.target).split("?")[0];
    if (!SAFE_POPUP_PAGES.has(target)) return { type: "NONE", label: "知道了", target: "" };
    return { type, label: text(source.label, "去看看").slice(0, 16), target };
  }
  if (type === "OPEN_PRODUCT") {
    const target = text(source.target);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(target)) return { type: "NONE", label: "知道了", target: "" };
    return { type, label: text(source.label, "查看产品").slice(0, 16), target };
  }
  return { type: "NONE", label: text(source.label, "知道了").slice(0, 16), target: "" };
}

function publicPopup(campaign, popup) {
  return {
    popupId: text(popup.popupId || popup.popup_id),
    campaignId: campaign.campaign_id,
    version: Number(popup.version),
    eyebrow: text(popup.eyebrow).slice(0, 24),
    title: text(popup.title).slice(0, 80),
    body: text(popup.body).slice(0, 240),
    secondaryLabel: text(popup.secondaryLabel || popup.secondary_label, "暂时关闭").slice(0, 16),
    action: popupAction(popup),
  };
}

function popupCandidate(data, userState, now = nowISO()) {
  return campaignDefinitions(data)
    .filter((campaign) => text(campaign.status).toUpperCase() === "ACTIVE" && activeDuring(campaign, now))
    .map((campaign) => ({ campaign, popup: campaignPopupConfig(campaign) }))
    .filter(({ popup }) => {
      if (!popup) return false;
      const states = popup.audienceStates || popup.audience_states;
      return !Array.isArray(states) || !states.length || states.includes(userState);
    })
    .sort((left, right) => Number(right.popup.priority || 0) - Number(left.popup.priority || 0))[0] || null;
}

function claimSessionPopup(data, rootUserId, loginSessionId, userState, context = {}) {
  const sessionId = text(loginSessionId);
  if (!rootUserId || !sessionId) return { loginSessionId: sessionId, popup: null, reason: "SESSION_UNAVAILABLE" };
  const receipts = ensureList(data, "campaignPopupReceipts");
  if (receipts.some((item) => item.login_session_id === sessionId)) {
    return { loginSessionId: sessionId, popup: null, reason: "ALREADY_CLAIMED" };
  }
  const candidate = popupCandidate(data, userState, context.now || nowISO());
  if (!candidate) return { loginSessionId: sessionId, popup: null, reason: "NO_ACTIVE_POPUP" };
  const popup = publicPopup(candidate.campaign, candidate.popup);
  const claimedAt = context.now || nowISO();
  const receipt = {
    campaign_popup_receipt_id: createId("cpr"),
    root_user_id: rootUserId,
    login_session_id: sessionId,
    campaign_id: popup.campaignId,
    popup_id: popup.popupId,
    popup_version: popup.version,
    status: "CLAIMED",
    action_type: "",
    claimed_at: claimedAt,
    viewed_at: "",
    acted_at: "",
    created_at: claimedAt,
    updated_at: claimedAt,
  };
  receipts.push(receipt);
  return { loginSessionId: sessionId, popup, reason: "", receiptId: receipt.campaign_popup_receipt_id };
}

function popupReceiptPayload(receipt) {
  return {
    receiptId: receipt.campaign_popup_receipt_id,
    loginSessionId: receipt.login_session_id,
    campaignId: receipt.campaign_id,
    popupId: receipt.popup_id,
    popupVersion: Number(receipt.popup_version || 0),
    status: receipt.status,
    actionType: receipt.action_type || "",
    claimedAt: receipt.claimed_at,
    viewedAt: receipt.viewed_at || "",
    actedAt: receipt.acted_at || "",
  };
}

function recordPopupEvent(data, rootUserId, receipt, action, occurredAt) {
  const eventName = action === "VIEW" ? "campaign_popup_view" : "campaign_popup_action";
  const events = ensureList(data, "analyticsEvents");
  events.push({
    analytics_event_id: createId("ane"),
    root_user_id: rootUserId,
    event_name: eventName,
    payload_json: {
      campaignId: receipt.campaign_id,
      popupId: receipt.popup_id,
      popupVersion: Number(receipt.popup_version || 0),
      actionType: action,
    },
    source: "MINIPROGRAM",
    occurred_at: occurredAt,
    created_at: occurredAt,
  });
}

function recordSessionPopupAction(data, rootUserId, loginSessionId, input = {}, context = {}) {
  const action = text(input.actionType || input.action_type).toUpperCase();
  if (!new Set(["VIEW", "DISMISS", "PRIMARY"]).has(action)) {
    const error = new Error("运营弹窗操作无效");
    error.code = 6201;
    error.status = 400;
    throw error;
  }
  const receipt = ensureList(data, "campaignPopupReceipts").find((item) => (
    item.root_user_id === rootUserId
    && item.login_session_id === loginSessionId
    && item.popup_id === text(input.popupId || input.popup_id)
  ));
  if (!receipt) {
    const error = new Error("运营弹窗记录不存在");
    error.code = 6202;
    error.status = 404;
    throw error;
  }
  const occurredAt = context.now || nowISO();
  let applied = false;
  if (action === "VIEW") {
    if (!receipt.viewed_at) {
      receipt.viewed_at = occurredAt;
      if (receipt.status === "CLAIMED") receipt.status = "VIEWED";
      applied = true;
    }
  } else if (!receipt.acted_at) {
    receipt.action_type = action;
    receipt.acted_at = occurredAt;
    receipt.status = action === "PRIMARY" ? "ACTED" : "DISMISSED";
    applied = true;
  }
  receipt.updated_at = occurredAt;
  if (applied) recordPopupEvent(data, context.userId || rootUserId, receipt, action, occurredAt);
  return { receipt: popupReceiptPayload(receipt) };
}

function parseKeyMap(env = process.env) {
  try {
    const value = JSON.parse(env.ROOT_CHANNEL_ATTRIBUTION_KEYS || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([key, secret]) => (
      /^[A-Za-z0-9_-]{1,48}$/.test(key) && typeof secret === "string" && secret.length >= 32
    )));
  } catch (error) {
    return {};
  }
}

function normalizeTargetPage(value) {
  const raw = text(value);
  if (!raw || raw.length > 240 || !raw.startsWith("/")) return "";
  const [pathname, queryText = ""] = raw.split("?", 2);
  if (!SAFE_CHANNEL_TARGET_PAGES.has(pathname)) return "";
  if (!queryText) return pathname;
  const allowed = SAFE_TARGET_QUERY_KEYS[pathname];
  if (!allowed) return "";
  let pairs = [];
  try {
    pairs = queryText.split("&").filter(Boolean).map((pair) => {
      const [key, value = ""] = pair.split("=", 2).map((item) => decodeURIComponent(item));
      return [key, value];
    });
  } catch (error) {
    return "";
  }
  if (!pairs.length || pairs.some(([key, value]) => (
    !allowed.has(key) || !/^[A-Za-z0-9_-]{1,64}$/.test(value)
  ))) return "";
  const unique = new Map(pairs);
  if (unique.size !== pairs.length) return "";
  return `${pathname}?${[...unique.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&")}`;
}

function channelCanonicalPayload(input = {}) {
  return [
    text(input.channelId || input.channel_id),
    text(input.campaignId || input.campaign_id),
    normalizeTargetPage(input.targetPage || input.target_page),
    String(Number(input.expiresAt || input.expires_at || 0)),
    text(input.keyId || input.key_id),
  ].join("\n");
}

function signChannelAttribution(input, secret) {
  return crypto.createHmac("sha256", secret).update(channelCanonicalPayload(input), "utf8").digest("hex");
}

function safeEqualHex(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left.toLowerCase(), "hex"), Buffer.from(right.toLowerCase(), "hex"));
}

function channelDefinition(data, channelId) {
  return ensureList(data, "channelDefinitions").find((item) => item.channel_id === channelId) || null;
}

function publicAttribution(row) {
  if (!row) return null;
  return {
    attributionId: row.channel_attribution_id,
    channelId: row.channel_id,
    campaignId: row.campaign_id,
    targetPage: row.target_page,
    attributedAt: row.attributed_at,
  };
}

function recordAttributionAttempt(data, rootUserId, input, result, reason, occurredAt, eventUserId = rootUserId) {
  const attempt = {
    channel_attribution_attempt_id: createId("caa"),
    root_user_id: rootUserId,
    requested_channel_id: text(input.channelId || input.channel_id).slice(0, 64),
    requested_campaign_id: text(input.campaignId || input.campaign_id).slice(0, 64),
    requested_target_page: normalizeTargetPage(input.targetPage || input.target_page).slice(0, 240),
    result,
    reason,
    occurred_at: occurredAt,
    created_at: occurredAt,
  };
  ensureList(data, "channelAttributionAttempts").push(attempt);
  ensureList(data, "analyticsEvents").push({
    analytics_event_id: createId("ane"),
    root_user_id: eventUserId,
    event_name: "channel_attribution_attempt",
    payload_json: {
      channelId: attempt.requested_channel_id,
      result,
      reason,
    },
    source: "MINIPROGRAM",
    occurred_at: occurredAt,
    created_at: occurredAt,
  });
  return attempt;
}

function rejectAttribution(data, rootUserId, input, reason, occurredAt, eventUserId = rootUserId) {
  recordAttributionAttempt(data, rootUserId, input, "REJECTED", reason, occurredAt, eventUserId);
  return { accepted: false, result: "REJECTED", reason, attribution: null };
}

function attributeFirstChannel(data, rootUserId, input = {}, context = {}) {
  const occurredAt = context.now || nowISO();
  const eventUserId = context.userId || rootUserId;
  const channelId = text(input.channelId || input.channel_id);
  const campaignId = text(input.campaignId || input.campaign_id);
  const targetPage = normalizeTargetPage(input.targetPage || input.target_page);
  const keyId = text(input.keyId || input.key_id);
  const expiresAt = Number(input.expiresAt || input.expires_at || 0);
  const signature = text(input.signature).toLowerCase();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(channelId)
    || !/^[A-Za-z0-9_-]{1,64}$/.test(campaignId)
    || !/^[A-Za-z0-9_-]{1,48}$/.test(keyId)
    || !Number.isSafeInteger(expiresAt)
    || !targetPage
    || !/^[a-f0-9]{64}$/.test(signature)) {
    return rejectAttribution(data, rootUserId, input, "PAYLOAD_INVALID", occurredAt, eventUserId);
  }
  const definition = channelDefinition(data, channelId);
  if (!definition || text(definition.status).toUpperCase() !== "ACTIVE" || !activeDuring(definition, occurredAt)) {
    return rejectAttribution(data, rootUserId, input, "CHANNEL_INACTIVE", occurredAt, eventUserId);
  }
  if (definition.campaign_id !== campaignId || !activeCampaign(data, campaignId, occurredAt)) {
    return rejectAttribution(data, rootUserId, input, "CAMPAIGN_UNAVAILABLE", occurredAt, eventUserId);
  }
  const allowedTargets = definition.allowed_target_pages_json || definition.allowed_target_pages || [];
  if (!Array.isArray(allowedTargets) || !allowedTargets.includes(targetPage.split("?")[0])) {
    return rejectAttribution(data, rootUserId, input, "TARGET_NOT_ALLOWED", occurredAt, eventUserId);
  }
  const nowSeconds = Math.floor((time(occurredAt) || Date.now()) / 1000);
  if (expiresAt < nowSeconds) return rejectAttribution(data, rootUserId, input, "QR_EXPIRED", occurredAt, eventUserId);
  if (definition.signature_key_id !== keyId) {
    return rejectAttribution(data, rootUserId, input, "SIGNATURE_KEY_MISMATCH", occurredAt, eventUserId);
  }
  const secret = parseKeyMap(context.env || process.env)[keyId];
  if (!secret) return rejectAttribution(data, rootUserId, input, "SIGNATURE_KEY_UNAVAILABLE", occurredAt, eventUserId);
  const expected = signChannelAttribution({ channelId, campaignId, targetPage, expiresAt, keyId }, secret);
  if (!safeEqualHex(expected, signature)) {
    return rejectAttribution(data, rootUserId, input, "SIGNATURE_INVALID", occurredAt, eventUserId);
  }
  const existing = ensureList(data, "channelAttributions").find((item) => item.root_user_id === rootUserId);
  if (existing) {
    recordAttributionAttempt(data, rootUserId, input, "EXISTING_KEPT", "FIRST_TOUCH_ALREADY_SET", occurredAt, eventUserId);
    return { accepted: true, result: "EXISTING_KEPT", reason: "FIRST_TOUCH_ALREADY_SET", attribution: publicAttribution(existing) };
  }
  const attribution = {
    channel_attribution_id: createId("cat"),
    root_user_id: rootUserId,
    channel_definition_id: definition.channel_definition_id,
    channel_id: channelId,
    campaign_id: campaignId,
    target_page: targetPage,
    signature_key_id: keyId,
    signature_scheme: CHANNEL_SIGNATURE_SCHEME,
    attributed_at: occurredAt,
    created_at: occurredAt,
  };
  ensureList(data, "channelAttributions").push(attribution);
  recordAttributionAttempt(data, rootUserId, input, "ATTRIBUTED", "", occurredAt, eventUserId);
  return { accepted: true, result: "ATTRIBUTED", reason: "", attribution: publicAttribution(attribution) };
}

function getFirstChannelAttribution(data, rootUserId) {
  const row = ensureList(data, "channelAttributions").find((item) => item.root_user_id === rootUserId) || null;
  return { attribution: publicAttribution(row) };
}

module.exports = {
  CHANNEL_SIGNATURE_SCHEME,
  OFFICIAL_PRODUCT_CAMPAIGN,
  SAFE_CHANNEL_TARGET_PAGES,
  attributeFirstChannel,
  campaignPopupConfig,
  channelCanonicalPayload,
  claimSessionPopup,
  getFirstChannelAttribution,
  normalizeTargetPage,
  popupCandidate,
  recordSessionPopupAction,
  signChannelAttribution,
};
