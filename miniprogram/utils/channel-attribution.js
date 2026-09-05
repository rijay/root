const marketing = require("../config/marketing");
const attributionConfig = require("../config/channel-attribution");
const { request } = require("./request");
const { track } = require("./analytics");

const PENDING_STORAGE_KEY = "ROOT_PENDING_CHANNEL_V2";
const ATTRIBUTED_STORAGE_KEY = "ROOT_FIRST_CHANNEL_CONFIRMED_V2";
const ACTIVE_VISIT_STORAGE_KEY = "ROOT_ACTIVE_CHANNEL_VISIT_V1";
const LEGACY_PENDING_STORAGE_KEY = "ROOT_PENDING_CHANNEL_V1";
const LEGACY_FIRST_STORAGE_KEY = "ROOT_FIRST_CHANNEL_V1";
const CHANNEL_SCENE_PREFIX = "root_channel:";
const GUT_INTRO_PATH = "subpkg/campaign/pages/root-with-you/index";
const LEGACY_GUT_ASSESSMENT_PATH = "subpkg/health/pages/assessment/index";
const ACTIVE_VISIT_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const QR_ENTRY_SCENES = new Set(attributionConfig.qrEntryScenes);
let scanVisitEntry = null;
let latestVisitRequest = null;
const SAFE_TARGET_PAGES = new Set([
  "/pages/home/index",
  "/pages/products/index",
  "/pages/product-detail/index",
  "/pages/health/index",
  "/pages/activities/index",
  "/subpkg/activity/pages/detail/index",
  `/${GUT_INTRO_PATH}`,
]);

function safeRead(key) {
  try { return wx.getStorageSync(key) || null; } catch (_) { return null; }
}

function safeWrite(key, value) {
  try { wx.setStorageSync(key, value); return true; } catch (_) { return false; }
}

function safeRemove(key) {
  try { wx.removeStorageSync(key); } catch (_) { /* no-op */ }
}

function decode(value) {
  try { return decodeURIComponent(String(value || "")); } catch (_) { return ""; }
}

function shortCode(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9]{4,16}$/.test(normalized) ? normalized : "";
}

function normalizeTargetPage(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 240 || !raw.startsWith("/")) return "";
  const [pathname, queryText = ""] = raw.split("?", 2);
  if (!SAFE_TARGET_PAGES.has(pathname)) return "";
  if (!queryText) return pathname;
  try {
    const pairs = queryText.split("&").filter(Boolean).map((pair) => {
      const [key, entryValue = ""] = pair.split("=", 2);
      return [decodeURIComponent(key), decodeURIComponent(entryValue)];
    });
    if (!pairs.length || pairs.some(([key, entryValue]) => (
      !["productId", "sessionId"].includes(key) || !/^[A-Za-z0-9_-]{1,64}$/.test(entryValue)
    ))) return "";
    return `${pathname}?${pairs
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${encodeURIComponent(key)}=${encodeURIComponent(entryValue)}`)
      .join("&")}`;
  } catch (_) {
    return "";
  }
}

function parseQueryText(value) {
  const raw = String(value || "").replace(/^\?/, "");
  return raw.split("&").filter(Boolean).reduce((result, pair) => {
    const [key, entryValue = ""] = pair.split("=", 2);
    const normalizedKey = decode(key);
    if (normalizedKey) result[normalizedKey] = decode(entryValue);
    return result;
  }, {});
}

function parseScene(scene) {
  const decoded = decode(scene);
  if (decoded.startsWith(CHANNEL_SCENE_PREFIX)) {
    return decoded.slice(CHANNEL_SCENE_PREFIX.length).split("&").reduce((result, pair) => {
      const [key, value = ""] = pair.split("=", 2);
      if (["channelId", "signature"].includes(key)) result[key] = decode(value);
      return result;
    }, {});
  }
  return parseQueryText(decoded);
}

function parseAttributionPayload(source = {}) {
  const payload = {
    channelId: String(source.channelId || source.channel_id || source.cid || "").trim(),
    campaignId: String(source.campaignId || source.campaign_id || source.camp || "").trim(),
    targetPage: normalizeTargetPage(source.targetPage || source.target_page || source.target),
    expiresAt: String(source.expiresAt || source.expires_at || source.exp || "").trim(),
    keyId: String(source.keyId || source.key_id || source.kid || "").trim(),
    signature: String(source.signature || source.sig || "").trim().toLowerCase(),
  };
  const present = Boolean(payload.channelId || payload.campaignId || payload.signature);
  if (!present) return { present: false, payload: null, reason: "" };
  const valid = /^[A-Za-z0-9_-]{1,64}$/.test(payload.channelId)
    && /^[A-Za-z0-9_-]{1,64}$/.test(payload.campaignId)
    && Boolean(payload.targetPage)
    && /^\d{10}$/.test(payload.expiresAt)
    && /^[A-Za-z0-9_-]{1,48}$/.test(payload.keyId)
    && /^[a-f0-9]{64}$/.test(payload.signature);
  return { present: true, payload: valid ? payload : null, reason: valid ? "" : "PAYLOAD_INVALID" };
}

function normalizeEntryPath(value) {
  return String(value || "").split("?", 1)[0].replace(/^\//, "").trim();
}

function isGeneralGutQrEntry(options = {}) {
  const scene = Number(options.scene);
  if (!Number.isInteger(scene) || !QR_ENTRY_SCENES.has(scene)) return false;
  const path = String(options.path || "");
  const entryPath = normalizeEntryPath(path);
  if (entryPath === GUT_INTRO_PATH) return true;
  if (entryPath !== LEGACY_GUT_ASSESSMENT_PATH) return false;
  const pathQuery = path.includes("?") ? parseQueryText(path.slice(path.indexOf("?") + 1)) : {};
  const query = { ...pathQuery, ...(options.query || {}) };
  const allowedQueryKeys = new Set(["assessmentType", "assessment_type"]);
  if (Object.keys(query).some((key) => !allowedQueryKeys.has(key))) return false;
  const declaredTypes = [query.assessmentType, query.assessment_type]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return declaredTypes.every((value) => value === "GUT_REGULARITY");
}

function parseScannedAttribution(options = {}) {
  const query = options.query || {};
  const path = String(options.path || "");
  const pathQuery = path.includes("?") ? parseQueryText(path.slice(path.indexOf("?") + 1)) : {};
  const scene = parseScene(query.scene || options.scene || options.scenePayload || "");
  const source = { ...pathQuery, ...scene, ...query };
  const code = shortCode(source.q || source.shortCode || source.short_code);
  if (code) return { present: true, kind: "SHORT_CODE", shortCode: code, payload: { shortCode: code }, reason: "" };
  if (isGeneralGutQrEntry(options)) {
    const generalCode = shortCode(attributionConfig.generalGutShortCode);
    if (generalCode) {
      return {
        present: true,
        kind: "SHORT_CODE",
        shortCode: generalCode,
        inferred: true,
        payload: { shortCode: generalCode },
        reason: "",
      };
    }
  }
  const parsed = parseAttributionPayload(source);
  return { ...parsed, kind: parsed.present ? "SIGNED_LEGACY" : "" };
}

function captureLaunchAttribution(options = {}) {
  if (safeRead(ATTRIBUTED_STORAGE_KEY) === true) {
    return { captured: false, reason: "FIRST_TOUCH_ALREADY_SET", pending: null };
  }
  const parsed = parseScannedAttribution(options);
  if (!parsed.present || (!parsed.payload && !parsed.shortCode)) {
    return { captured: false, reason: parsed.reason || "NO_CHANNEL", pending: null };
  }
  const existing = safeRead(PENDING_STORAGE_KEY);
  if (existing) return { captured: false, reason: "PENDING_FIRST_TOUCH_KEPT", pending: existing };
  const pending = parsed.kind === "SHORT_CODE"
    ? { shortCode: parsed.shortCode, capturedAt: new Date().toISOString() }
    : { ...parsed.payload, capturedAt: new Date().toISOString() };
  safeWrite(PENDING_STORAGE_KEY, pending);
  return { captured: true, reason: "", pending };
}

function createClientVisitId() {
  return `scan_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
}

// 每次真实渠道入口单独建上下文；同一次入口的原生加载与主动导航共用请求。
// 普通回前台只结束复用范围，不清除已有访问，也不取消尚未完成的有效请求。
function prepareChannelVisitEntry(code = "") {
  const normalized = shortCode(code);
  scanVisitEntry = normalized
    ? { shortCode: normalized, clientVisitId: createClientVisitId(), promise: null }
    : null;
  if (scanVisitEntry) {
    latestVisitRequest = scanVisitEntry;
    safeRemove(ACTIVE_VISIT_STORAGE_KEY);
  }
}

function supersededVisit() {
  return { active: false, reason: "SCAN_ENTRY_SUPERSEDED", visit: null };
}

async function resolveChannelVisit(entry, requestImpl) {
  const clientVisitId = entry.clientVisitId;
  const visit = await requestImpl({
    url: "/api/v1/channels/resolve",
    method: "POST",
    idempotencyKey: `channel-resolve:${clientVisitId}`,
    data: { shortCode: entry.shortCode, clientVisitId },
  });
  if (latestVisitRequest !== entry) return supersededVisit();
  const activatedVisit = { ...visit, activatedAt: new Date().toISOString() };
  safeWrite(ACTIVE_VISIT_STORAGE_KEY, activatedVisit);
  safeWrite(PENDING_STORAGE_KEY, { visitId: visit.visitId, shortCode: visit.shortCode, capturedAt: new Date().toISOString() });
  try {
    await confirmPendingAttribution({ request: requestImpl });
  } catch (_) {
    // 未登录时保留待确认记录；完成登录后会再次提交，不能阻断扫码入口。
  }
  if (latestVisitRequest !== entry) return supersededVisit();
  return { active: true, reason: "", visit: activatedVisit };
}

async function beginChannelVisit(options = {}, requestImpl = request) {
  const parsed = parseScannedAttribution(options);
  const code = parsed.shortCode || shortCode(options.q || options.shortCode || options.short_code);
  if (scanVisitEntry && code !== scanVisitEntry.shortCode) return supersededVisit();
  if (!code) {
    latestVisitRequest = null;
    safeRemove(ACTIVE_VISIT_STORAGE_KEY);
    return { active: false, reason: "NO_SHORT_CODE", visit: null };
  }
  const entry = scanVisitEntry || { shortCode: code, clientVisitId: createClientVisitId(), promise: null };
  latestVisitRequest = entry;
  if (!entry.promise) {
    entry.promise = resolveChannelVisit(entry, requestImpl).catch((error) => {
      // 响应不确定时允许重试，仍使用本次入口的幂等键，不额外创建访问。
      entry.promise = null;
      throw error;
    });
  }
  return entry.promise;
}

async function beginGeneralGutVisit(options = {}, requestImpl = request) {
  const query = options.query || {};
  const scene = parseScene(query.scene || options.scene || options.scenePayload || "");
  const hasExplicitCode = ["q", "shortCode", "short_code"]
    .some((key) => [options, query, scene].some((source) => Object.prototype.hasOwnProperty.call(source, key)));
  if (hasExplicitCode) return beginChannelVisit(options, requestImpl);
  const generalCode = shortCode(attributionConfig.generalGutShortCode);
  if (!generalCode) {
    safeRemove(ACTIVE_VISIT_STORAGE_KEY);
    return { active: false, reason: "GENERAL_SHORT_CODE_NOT_CONFIGURED", visit: null };
  }
  // 无参数的站内介绍页仍按原规则归入通用入口。
  if (scanVisitEntry && scanVisitEntry.shortCode !== generalCode) prepareChannelVisitEntry();
  return beginChannelVisit({ ...options, q: generalCode }, requestImpl);
}

function activeChannelVisit(now = Date.now()) {
  const value = safeRead(ACTIVE_VISIT_STORAGE_KEY);
  if (!value || !value.visitId) return null;
  const activatedAt = Date.parse(value.activatedAt || "");
  if (!Number.isFinite(activatedAt)
    || activatedAt > now + MAX_CLOCK_SKEW_MS
    || now - activatedAt > ACTIVE_VISIT_TTL_MS) {
    safeRemove(ACTIVE_VISIT_STORAGE_KEY);
    return null;
  }
  return value;
}

function assessmentChannelContext() {
  const visit = activeChannelVisit();
  return visit ? { channelVisitId: visit.visitId } : {};
}

async function recordFunnelStage(stage, input = {}, requestImpl = request) {
  const visit = input.visitId ? { visitId: input.visitId } : activeChannelVisit();
  if (!visit || !visit.visitId) return { recorded: false, reason: "NO_CHANNEL_VISIT" };
  return requestImpl({
    url: "/api/v1/channels/funnel",
    method: "POST",
    idempotencyKey: `channel-funnel:${visit.visitId}:${stage}:${input.assessmentId || "none"}`,
    data: {
      visitId: visit.visitId,
      stage,
      ...(input.assessmentId ? { assessmentId: input.assessmentId } : {}),
    },
  });
}

async function confirmPendingAttribution(options = {}) {
  const pending = safeRead(PENDING_STORAGE_KEY);
  if (!pending && safeRead(ATTRIBUTED_STORAGE_KEY) === true) return { state: "CONFIRMED", reason: "ALREADY_CONFIRMED" };
  if (!pending) return { state: "EMPTY", reason: "NO_PENDING_ATTRIBUTION" };
  const requestImpl = options.request || request;
  const result = await requestImpl({
    url: "/api/v1/channels/attribution",
    method: "POST",
    idempotencyKey: `channel-attribution:${pending.visitId || pending.channelId}`,
    data: pending,
  });
  if (result && result.accepted === true) {
    safeWrite(ATTRIBUTED_STORAGE_KEY, true);
    const current = safeRead(PENDING_STORAGE_KEY);
    if (current && current.visitId === pending.visitId && current.channelId === pending.channelId) {
      safeRemove(PENDING_STORAGE_KEY);
    }
    return { state: "CONFIRMED", result };
  }
  return { state: "REJECTED", result };
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
  const scanned = parseScannedAttribution(options);
  if (scanned.kind === "SHORT_CODE") {
    return { result: "VALID_SHORT_CODE", shortCode: scanned.shortCode, inferred: scanned.inferred === true, target: { type: "GUT_INTRO" }, capturedAt: new Date(now).toISOString() };
  }
  const candidate = channelCandidate(options);
  if (!candidate.channelId) return { result: "NO_CHANNEL", channelId: "" };
  const config = channels.find((item) => item.channelId === candidate.channelId);
  if (!config || config.enabled !== true || config.signature !== candidate.signature) {
    return { result: "INVALID_CHANNEL", channelId: candidate.channelId, failureReason: "CHANNEL_NOT_ALLOWED_OR_SIGNATURE_MISMATCH" };
  }
  const startsAt = config.startsAt ? Date.parse(config.startsAt) : 0;
  const endsAt = config.endsAt ? Date.parse(config.endsAt) : 0;
  if ((startsAt && now < startsAt) || (endsAt && now > endsAt)) {
    return { result: "EXPIRED_CHANNEL", channelId: candidate.channelId, failureReason: "CHANNEL_EXPIRED" };
  }
  return { result: "VALID_CHANNEL", channelId: candidate.channelId, target: config.target || { type: "HOME" }, capturedAt: new Date(now).toISOString() };
}

function captureFirstChannel(options = {}, now = Date.now()) {
  const resolved = resolveChannel(options, now);
  if (resolved.result === "VALID_SHORT_CODE") captureLaunchAttribution(options);
  if (resolved.result === "NO_CHANNEL") return resolved;
  const first = safeRead(LEGACY_FIRST_STORAGE_KEY);
  if (first && first.channelId && resolved.result === "VALID_CHANNEL") return { ...resolved, result: "ALREADY_ATTRIBUTED", attributedChannelId: first.channelId };
  const pending = safeRead(LEGACY_PENDING_STORAGE_KEY);
  if (pending && pending.channelId && resolved.result === "VALID_CHANNEL") return { ...resolved, result: "PENDING_EXISTS", pendingChannelId: pending.channelId };
  if (resolved.result === "VALID_CHANNEL") safeWrite(LEGACY_PENDING_STORAGE_KEY, resolved);
  track("channel_attribution_attempt", { channelId: resolved.channelId || resolved.shortCode, result: resolved.result, failureReason: resolved.failureReason || "" });
  return resolved;
}

function channelEntryOptions(channel = {}, fallback = {}) {
  if (["INVALID_CHANNEL", "EXPIRED_CHANNEL"].includes(channel.result)) {
    return { ...fallback, __rootChannelEntry: true, path: "pages/channel-error/index", query: { reason: channel.result } };
  }
  if (channel.result === "VALID_SHORT_CODE") {
    return { ...fallback, __rootChannelEntry: true, path: GUT_INTRO_PATH, query: { q: channel.shortCode } };
  }
  const target = channel.target || {};
  if (!["VALID_CHANNEL", "ALREADY_ATTRIBUTED", "PENDING_EXISTS"].includes(channel.result)) return fallback;
  if (target.type === "PRODUCT") return { ...fallback, __rootChannelEntry: true, path: "pages/products/index", query: { productId: String(target.productId || "") } };
  if (target.type === "HEALTH") return { ...fallback, __rootChannelEntry: true, path: "pages/health/index", query: {} };
  if (target.type === "ACTIVITIES") return { ...fallback, __rootChannelEntry: true, path: "pages/activities/index", query: {} };
  if (target.type === "HOME") return { ...fallback, __rootChannelEntry: true, path: "pages/home/index", query: {} };
  return fallback;
}

function pendingSourceChannel() {
  const pending = safeRead(LEGACY_PENDING_STORAGE_KEY) || safeRead(PENDING_STORAGE_KEY);
  return pending && (pending.channelId || pending.shortCode) ? String(pending.channelId || pending.shortCode) : "";
}

function commitPendingFirstChannel() {
  const first = safeRead(LEGACY_FIRST_STORAGE_KEY);
  if (first && first.channelId) return first;
  const pending = safeRead(LEGACY_PENDING_STORAGE_KEY);
  if (!pending || !pending.channelId) return null;
  const committed = { ...pending, committedAt: new Date().toISOString() };
  if (!safeWrite(LEGACY_FIRST_STORAGE_KEY, committed)) return null;
  safeRemove(LEGACY_PENDING_STORAGE_KEY);
  return committed;
}

module.exports = Object.freeze({
  ACTIVE_VISIT_STORAGE_KEY,
  ATTRIBUTED_STORAGE_KEY,
  CHANNEL_SCENE_PREFIX,
  FIRST_CHANNEL_KEY: LEGACY_FIRST_STORAGE_KEY,
  PENDING_CHANNEL_KEY: LEGACY_PENDING_STORAGE_KEY,
  PENDING_STORAGE_KEY,
  activeChannelVisit,
  assessmentChannelContext,
  beginChannelVisit,
  beginGeneralGutVisit,
  captureFirstChannel,
  captureLaunchAttribution,
  channelCandidate,
  channelEntryOptions,
  commitPendingFirstChannel,
  confirmPendingAttribution,
  normalizeTargetPage,
  parseAttributionPayload,
  parseScannedAttribution,
  parseScene,
  isGeneralGutQrEntry,
  pendingSourceChannel,
  prepareChannelVisitEntry,
  recordFunnelStage,
  resolveChannel,
});
