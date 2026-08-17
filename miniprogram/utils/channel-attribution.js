const { getToken, request } = require("./request");

const PENDING_STORAGE_KEY = "ROOT_PENDING_CHANNEL_ATTRIBUTION_V1";
const ATTRIBUTED_STORAGE_KEY = "ROOT_CHANNEL_FIRST_TOUCH_CONFIRMED_V1";
const SAFE_TARGET_PAGES = new Set([
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
const FIELD_ALIASES = Object.freeze({
  channelId: ["channelId", "channel_id", "cid"],
  campaignId: ["campaignId", "campaign_id", "campaign", "camp"],
  targetPage: ["targetPage", "target_page", "target"],
  expiresAt: ["expiresAt", "expires_at", "exp"],
  keyId: ["keyId", "key_id", "kid"],
  signature: ["signature", "sig"],
});

function safeDecode(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch (error) {
    return "";
  }
}

function parseQueryText(value) {
  const text = String(value || "").replace(/^\?/, "");
  if (!text) return {};
  return text.split("&").filter(Boolean).reduce((result, pair) => {
    const separator = pair.indexOf("=");
    const key = safeDecode(separator < 0 ? pair : pair.slice(0, separator));
    const item = safeDecode(separator < 0 ? "" : pair.slice(separator + 1));
    if (key && !Object.prototype.hasOwnProperty.call(result, key)) result[key] = item;
    return result;
  }, {});
}

function parseScene(value) {
  const decoded = safeDecode(value);
  if (!decoded) return {};
  if (decoded.startsWith("{")) {
    try {
      const parsed = JSON.parse(decoded);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      return {};
    }
  }
  return parseQueryText(decoded);
}

function field(source, name) {
  const aliases = FIELD_ALIASES[name] || [name];
  const alias = aliases.find((key) => source[key] !== undefined && source[key] !== null);
  return alias ? String(source[alias]).trim() : "";
}

function normalizeTargetPage(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 240) return "";
  const normalized = raw.startsWith("/") ? raw : `/${raw}`;
  const [pathname, queryText = ""] = normalized.split("?", 2);
  if (!SAFE_TARGET_PAGES.has(pathname)) return "";
  if (!queryText) return pathname;
  const allowed = SAFE_TARGET_QUERY_KEYS[pathname];
  if (!allowed) return "";
  const query = parseQueryText(queryText);
  const entries = Object.entries(query);
  if (!entries.length || entries.some(([key, item]) => (
    !allowed.has(key) || !/^[A-Za-z0-9_-]{1,64}$/.test(item)
  ))) return "";
  if (entries.length !== queryText.split("&").filter(Boolean).length) return "";
  return `${pathname}?${entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${encodeURIComponent(key)}=${encodeURIComponent(item)}`)
    .join("&")}`;
}

function hasChannelSignal(source = {}) {
  return Object.values(FIELD_ALIASES).some((aliases) => aliases.some((key) => source[key] !== undefined));
}

function parseAttributionPayload(source = {}) {
  const merged = {
    ...parseScene(source.scene),
    ...source,
  };
  if (!hasChannelSignal(merged)) return { present: false, payload: null, reason: "" };
  const payload = {
    channelId: field(merged, "channelId"),
    campaignId: field(merged, "campaignId"),
    targetPage: normalizeTargetPage(field(merged, "targetPage")),
    expiresAt: Number(field(merged, "expiresAt")),
    keyId: field(merged, "keyId"),
    signature: field(merged, "signature").toLowerCase(),
  };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(payload.channelId)
    || !/^[A-Za-z0-9_-]{1,64}$/.test(payload.campaignId)
    || !payload.targetPage
    || !Number.isSafeInteger(payload.expiresAt)
    || !/^[A-Za-z0-9_-]{1,48}$/.test(payload.keyId)
    || !/^[a-f0-9]{64}$/.test(payload.signature)) {
    return { present: true, payload: null, reason: "PAYLOAD_INVALID" };
  }
  return { present: true, payload, reason: "" };
}

function readPending() {
  const value = wx.getStorageSync(PENDING_STORAGE_KEY);
  return value && typeof value === "object" ? value : null;
}

function writePending(payload) {
  wx.setStorageSync(PENDING_STORAGE_KEY, payload);
}

function clearPending() {
  wx.removeStorageSync(PENDING_STORAGE_KEY);
}

function captureLaunchAttribution(options = {}) {
  if (wx.getStorageSync(ATTRIBUTED_STORAGE_KEY)) {
    return { captured: false, pending: null, targetPage: "", reason: "FIRST_TOUCH_ALREADY_SET" };
  }
  const parsed = parseAttributionPayload(options.query || {});
  if (!parsed.present) return { captured: false, pending: readPending(), targetPage: "", reason: "" };
  if (!parsed.payload) return { captured: false, pending: readPending(), targetPage: "", reason: parsed.reason };
  const existing = readPending();
  if (existing) {
    return { captured: false, pending: existing, targetPage: existing.targetPage || "", reason: "PENDING_FIRST_TOUCH_KEPT" };
  }
  writePending(parsed.payload);
  return { captured: true, pending: parsed.payload, targetPage: parsed.payload.targetPage, reason: "" };
}

function deterministicResult(result) {
  return result && ["ATTRIBUTED", "EXISTING_KEPT", "REJECTED"].includes(result.result);
}

async function confirmPendingAttribution() {
  const pending = readPending();
  if (!pending) return { state: "NONE", result: "", reason: "", attribution: null };
  if (!getToken()) return { state: "PENDING_LOGIN", result: "", reason: "", attribution: null };
  try {
    const result = await request({
      url: "/api/v1/channels/attribution",
      method: "POST",
      idempotencyKey: `channel-attribution:${pending.channelId}:${pending.expiresAt}`,
      data: pending,
    });
    if (deterministicResult(result)) clearPending();
    if (result && ["ATTRIBUTED", "EXISTING_KEPT"].includes(result.result)) {
      wx.setStorageSync(ATTRIBUTED_STORAGE_KEY, true);
      return { state: "CONFIRMED", ...result };
    }
    if (result && result.result === "REJECTED") return { state: "REJECTED", ...result };
    return { state: "RETRY", result: "", reason: "SERVER_RESULT_UNKNOWN", attribution: null };
  } catch (error) {
    return {
      state: "RETRY",
      result: "",
      reason: "NETWORK_UNAVAILABLE",
      attribution: null,
    };
  }
}

function parseScannedAttribution(result = {}) {
  const path = String(result.path || "");
  const pathQuery = path.includes("?") ? parseQueryText(path.split("?").slice(1).join("?")) : {};
  const raw = String(result.result || "");
  const resultQuery = raw.includes("?")
    ? parseQueryText(raw.split("?").slice(1).join("?"))
    : parseQueryText(raw);
  return parseAttributionPayload({ ...resultQuery, ...pathQuery });
}

function storeScannedAttribution(payload) {
  if (!payload || readPending() || wx.getStorageSync(ATTRIBUTED_STORAGE_KEY)) return false;
  writePending(payload);
  return true;
}

function channelErrorUrl(reason = "PAYLOAD_INVALID") {
  const safeReason = /^[A-Z0-9_]{1,64}$/.test(reason) ? reason : "PAYLOAD_INVALID";
  return `/pages/channel-error/index?reason=${safeReason}`;
}

module.exports = {
  ATTRIBUTED_STORAGE_KEY,
  PENDING_STORAGE_KEY,
  captureLaunchAttribution,
  channelErrorUrl,
  clearPending,
  confirmPendingAttribution,
  normalizeTargetPage,
  parseAttributionPayload,
  parseQueryText,
  parseScannedAttribution,
  readPending,
  storeScannedAttribution,
};
