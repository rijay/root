const marketing = require("../config/marketing");
const { track } = require("./analytics");

const PENDING_CHANNEL_KEY = "ROOT_PENDING_CHANNEL_V1";
const FIRST_CHANNEL_KEY = "ROOT_FIRST_CHANNEL_V1";
const CHANNEL_SCENE_PREFIX = "root_channel:";

function safeRead(key) {
  try { return wx.getStorageSync(key) || null; } catch (_) { return null; }
}

function safeWrite(key, value) {
  try { wx.setStorageSync(key, value); return true; } catch (_) { return false; }
}

function decode(value) {
  try { return decodeURIComponent(String(value || "")); } catch (_) { return ""; }
}

function parseScene(scene) {
  const decoded = decode(scene);
  if (!decoded.startsWith(CHANNEL_SCENE_PREFIX)) return {};
  return decoded.slice(CHANNEL_SCENE_PREFIX.length).split("&").reduce((result, pair) => {
    const [key, value = ""] = pair.split("=");
    if (["channelId", "signature"].includes(key)) result[key] = decode(value);
    return result;
  }, {});
}

function channelCandidate(options = {}) {
  const query = options.query || {};
  const scene = parseScene(query.scene || options.scenePayload || "");
  return {
    channelId: String(query.channelId || query.channel_id || scene.channelId || "").trim(),
    signature: String(query.signature || scene.signature || "").trim(),
  };
}

function resolveChannel(options = {}, now = Date.now(), channels = marketing.channels) {
  const candidate = channelCandidate(options);
  if (!candidate.channelId) return { result: "NO_CHANNEL", channelId: "" };
  const config = channels.find((item) => item.channelId === candidate.channelId);
  if (!config || config.enabled !== true || config.signature !== candidate.signature) {
    return {
      result: "INVALID_CHANNEL",
      channelId: candidate.channelId,
      failureReason: "CHANNEL_NOT_ALLOWED_OR_SIGNATURE_MISMATCH",
    };
  }
  const startsAt = config.startsAt ? Date.parse(config.startsAt) : 0;
  const endsAt = config.endsAt ? Date.parse(config.endsAt) : 0;
  if ((startsAt && now < startsAt) || (endsAt && now > endsAt)) {
    return { result: "EXPIRED_CHANNEL", channelId: candidate.channelId, failureReason: "CHANNEL_EXPIRED" };
  }
  return {
    result: "VALID_CHANNEL",
    channelId: candidate.channelId,
    target: config.target || { type: "HOME" },
    capturedAt: new Date(now).toISOString(),
  };
}

function captureFirstChannel(options = {}, now = Date.now()) {
  const resolved = resolveChannel(options, now);
  if (resolved.result === "NO_CHANNEL") return resolved;
  const first = safeRead(FIRST_CHANNEL_KEY);
  if (first && first.channelId && resolved.result === "VALID_CHANNEL") {
    return { ...resolved, result: "ALREADY_ATTRIBUTED", attributedChannelId: first.channelId };
  }
  const pending = safeRead(PENDING_CHANNEL_KEY);
  if (pending && pending.channelId && resolved.result === "VALID_CHANNEL") {
    return { ...resolved, result: "PENDING_EXISTS", pendingChannelId: pending.channelId };
  }
  if (resolved.result === "VALID_CHANNEL") safeWrite(PENDING_CHANNEL_KEY, resolved);
  track("channel_attribution_attempt", {
    channelId: resolved.channelId,
    result: resolved.result,
    failureReason: resolved.failureReason || "",
  });
  return resolved;
}

function channelEntryOptions(channel = {}, fallback = {}) {
  if (["INVALID_CHANNEL", "EXPIRED_CHANNEL"].includes(channel.result)) {
    return { ...fallback, __rootChannelEntry: true, path: "pages/channel-error/index", query: { reason: channel.result } };
  }
  const target = channel.target || {};
  if (!["VALID_CHANNEL", "ALREADY_ATTRIBUTED", "PENDING_EXISTS"].includes(channel.result)) return fallback;
  if (target.type === "PRODUCT") {
    return { ...fallback, __rootChannelEntry: true, path: "pages/products/index", query: { productId: String(target.productId || "") } };
  }
  if (target.type === "HEALTH") return { ...fallback, __rootChannelEntry: true, path: "pages/health/index", query: {} };
  if (target.type === "ACTIVITIES") return { ...fallback, __rootChannelEntry: true, path: "pages/activities/index", query: {} };
  if (target.type === "HOME") return { ...fallback, __rootChannelEntry: true, path: "pages/home/index", query: {} };
  return fallback;
}

function pendingSourceChannel() {
  const pending = safeRead(PENDING_CHANNEL_KEY);
  return pending && pending.channelId ? String(pending.channelId) : "";
}

function commitPendingFirstChannel() {
  const first = safeRead(FIRST_CHANNEL_KEY);
  if (first && first.channelId) return first;
  const pending = safeRead(PENDING_CHANNEL_KEY);
  if (!pending || !pending.channelId) return null;
  const committed = { ...pending, committedAt: new Date().toISOString() };
  if (!safeWrite(FIRST_CHANNEL_KEY, committed)) return null;
  try { wx.removeStorageSync(PENDING_CHANNEL_KEY); } catch (_) { /* no-op */ }
  return committed;
}

module.exports = Object.freeze({
  CHANNEL_SCENE_PREFIX,
  FIRST_CHANNEL_KEY,
  PENDING_CHANNEL_KEY,
  captureFirstChannel,
  channelEntryOptions,
  channelCandidate,
  commitPendingFirstChannel,
  parseScene,
  pendingSourceChannel,
  resolveChannel,
});
