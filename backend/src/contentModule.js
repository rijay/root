const { createClientError } = require("./clientError");

const FORMAL_INTERNAL_PATHS = new Set([
  "/pages/home/index",
  "/pages/health/index",
  "/pages/activities/index",
  "/pages/profile/index",
  "/subpkg/activity/pages/detail/index",
  "/subpkg/profile/pages/about/index",
  "/subpkg/profile/pages/support/index",
]);
const ACTION_TYPES = new Set(["MINIPROGRAM_PAGE", "ROOT_MEMBER_CENTER", "BUSINESS_WEBVIEW"]);

function rows(data) {
  return Array.isArray(data && data.formalContentItems) ? data.formalContentItems : [];
}

function safeId(value) {
  const id = String(value || "").trim();
  return /^[A-Za-z0-9_-]{3,80}$/.test(id) ? id : "";
}

function safeHttpsOrCloudUrl(value) {
  const url = String(value || "").trim();
  return /^(https:\/\/|cloud:\/\/)/i.test(url) && url.length <= 1024 ? url : "";
}

function safeText(value, maxLength) {
  const text = String(value || "").trim();
  return text && text.length <= maxLength ? text : "";
}

function allowedBusinessHosts(env = {}) {
  try {
    const parsed = JSON.parse(env.ROOT_CONTENT_WEBVIEW_HOSTS || "[]");
    return new Set((Array.isArray(parsed) ? parsed : []).map((host) => String(host || "").trim().toLowerCase()).filter(Boolean));
  } catch (error) {
    return new Set();
  }
}

function normalizeAction(value, env = {}) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || !ACTION_TYPES.has(value.type)) return undefined;
  if (value.type === "MINIPROGRAM_PAGE") {
    const path = String(value.path || "").trim();
    const pathOnly = path.split("?")[0];
    return FORMAL_INTERNAL_PATHS.has(pathOnly) ? { type: value.type, path } : undefined;
  }
  if (value.type === "ROOT_MEMBER_CENTER") {
    const configuredAppId = String(env.ROOT_MEMBER_CENTER_APPID || "").trim();
    const appId = String(value.appId || "").trim();
    const path = String(value.path || "").trim();
    if (!configuredAppId || appId !== configuredAppId || !/^pages\/[A-Za-z0-9_/?=&.-]{1,240}$/.test(path)) return undefined;
    return { type: value.type, appId, path };
  }
  try {
    const url = new URL(String(value.url || ""));
    if (url.protocol !== "https:" || !allowedBusinessHosts(env).has(url.hostname.toLowerCase())) return undefined;
    return { type: value.type, url: url.toString() };
  } catch (error) {
    return undefined;
  }
}

function active(row, context = {}) {
  if (!row || row.status !== "PUBLISHED" || row.placement !== "HOME") return false;
  if (context.env && context.env.NODE_ENV === "production" && row.assetState === "DEVELOPMENT_PLACEHOLDER") return false;
  const now = Date.parse(context.now || new Date().toISOString());
  const startsAt = row.startsAt ? Date.parse(row.startsAt) : Number.NEGATIVE_INFINITY;
  const endsAt = row.endsAt ? Date.parse(row.endsAt) : Number.POSITIVE_INFINITY;
  return Number.isFinite(now) && now >= startsAt && now < endsAt;
}

function present(row, context = {}) {
  const contentId = safeId(row.contentId);
  const kicker = safeText(row.kicker, 40);
  const lines = Array.isArray(row.lines) ? row.lines.map((line) => safeText(line, 40)) : [];
  const action = normalizeAction(row.action, context.env || {});
  const placeholder = row.assetState === "DEVELOPMENT_PLACEHOLDER";
  const coverAssetUrl = safeHttpsOrCloudUrl(row.coverAssetUrl);
  const detailImages = Array.isArray(row.detailImages)
    ? row.detailImages.map(safeHttpsOrCloudUrl).filter(Boolean).slice(0, 10)
    : [];
  if (!contentId || !kicker || ![2, 3].includes(lines.length) || lines.some((line) => !line)) return null;
  if (!placeholder && (!coverAssetUrl || detailImages.length === 0)) return null;
  if (row.action !== null && row.action !== undefined && action === undefined) return null;
  return {
    contentId,
    version: Number.isInteger(row.version) && row.version > 0 ? row.version : 1,
    assetState: placeholder ? "DEVELOPMENT_PLACEHOLDER" : "AUTHORIZED",
    kicker,
    lines,
    coverAssetUrl,
    detailImages,
    detailPath: `/subpkg/content/pages/detail/index?contentId=${encodeURIComponent(contentId)}`,
    action: action || null,
  };
}

function listHome(data, context = {}) {
  const items = rows(data)
    .filter((row) => active(row, context))
    .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0))
    .map((row) => present(row, context))
    .filter(Boolean);
  return { publicationState: items.length ? "PUBLISHED" : "NOT_PUBLISHED", items };
}

function getDetail(data, contentId, context = {}) {
  const id = safeId(contentId);
  const row = rows(data).find((candidate) => candidate.contentId === id && active(candidate, context));
  const item = row && present(row, context);
  if (!item) throw createClientError("FORMAL_CONTENT_NOT_FOUND", "内容暂未发布", 404);
  return { item };
}

module.exports = { getDetail, listHome, normalizeAction };
