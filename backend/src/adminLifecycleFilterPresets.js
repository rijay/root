const { nowISO } = require("./dates");
const { createId } = require("./seed");

const FILTER_KEYS = [
  "keyword",
  "unionidStatus",
  "state",
  "consultationStatus",
  "activityStatus",
  "openTasks",
  "severity",
  "blockage",
  "limit",
];

const FILTER_ALIASES = {
  unionid_status: "unionidStatus",
  consultation_status: "consultationStatus",
  activity_status: "activityStatus",
  open_tasks: "openTasks",
  current_blockage: "blockage",
};

function ensureList(data) {
  if (!Array.isArray(data.adminLifecycleFilterPresets)) data.adminLifecycleFilterPresets = [];
  return data.adminLifecycleFilterPresets;
}

function businessError(code, message, status = 200) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function normalizeOperatorId(value) {
  return String(value || "admin").trim() || "admin";
}

function normalizeTitle(value) {
  return String(value || "").trim().slice(0, 40);
}

function normalizeScope(value) {
  return String(value || "").trim().toUpperCase() === "TEAM" ? "TEAM" : "PERSONAL";
}

function normalizePinned(value) {
  return value === true || String(value || "").toLowerCase() === "true";
}

function normalizeSortOrder(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 100;
  return Math.max(0, Math.min(999, Math.floor(numeric)));
}

function normalizeFilters(input = {}) {
  const source = input.filters && typeof input.filters === "object" ? input.filters : input;
  const normalized = {};
  Object.entries(FILTER_ALIASES).forEach(([alias, key]) => {
    if (source[key] === undefined && source[alias] !== undefined) source[key] = source[alias];
  });
  FILTER_KEYS.forEach((key) => {
    if (source[key] === undefined || source[key] === null) return;
    if (key === "limit") {
      const limit = Math.max(20, Math.min(200, Number(source[key] || 100)));
      normalized.limit = limit;
      return;
    }
    const value = String(source[key]).trim();
    if (value) normalized[key] = value;
  });
  return normalized;
}

function recordScope(record) {
  return normalizeScope(record.scope);
}

function recordPinned(record) {
  return normalizePinned(record.pinned);
}

function recordSortOrder(record) {
  return normalizeSortOrder(record.sort_order);
}

function toPresetPayload(record, operatorId = "") {
  const normalizedOperatorId = normalizeOperatorId(operatorId);
  return {
    presetId: record.preset_id,
    title: record.title,
    filters: record.filters || {},
    operatorId: record.operator_id,
    scope: recordScope(record),
    pinned: recordPinned(record),
    sortOrder: recordSortOrder(record),
    canModify: record.operator_id === normalizedOperatorId,
    status: record.status,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function comparePresets(left, right) {
  const pinnedDelta = Number(recordPinned(right)) - Number(recordPinned(left));
  if (pinnedDelta) return pinnedDelta;
  const sortDelta = recordSortOrder(left) - recordSortOrder(right);
  if (sortDelta) return sortDelta;
  const updatedDelta = String(right.updated_at || "").localeCompare(String(left.updated_at || ""));
  if (updatedDelta) return updatedDelta;
  return String(left.title || "").localeCompare(String(right.title || ""));
}

function listPresets(data, query = {}) {
  const operatorId = normalizeOperatorId(query.operatorId || query.operator_id);
  return ensureList(data)
    .filter((item) => item.status !== "ARCHIVED")
    .filter((item) => item.operator_id === operatorId || recordScope(item) === "TEAM")
    .sort(comparePresets)
    .map((item) => toPresetPayload(item, operatorId));
}

function defaultCopyTitle(title) {
  const normalized = normalizeTitle(title || "常用筛选");
  const suffix = " 副本";
  if (normalized.length + suffix.length <= 40) return `${normalized}${suffix}`;
  return `${normalized.slice(0, 40 - suffix.length)}${suffix}`;
}

function upsertPreset(data, input = {}) {
  const operatorId = normalizeOperatorId(input.operatorId || input.operator_id);
  const presetId = String(input.presetId || input.preset_id || "").trim();
  const title = normalizeTitle(input.title || input.name);
  if (!title) throw businessError(8030, "常用筛选名称必填");
  const filters = normalizeFilters(input.filters || input);
  if (!Object.keys(filters).length) throw businessError(8031, "常用筛选至少需要一个条件");
  const presets = ensureList(data);
  const existing = presetId
    ? presets.find((item) => item.preset_id === presetId && item.status !== "ARCHIVED")
    : null;
  if (existing && existing.operator_id !== operatorId) throw businessError(8032, "不能修改其他操作人的常用筛选");
  const now = nowISO();
  const before = existing ? toPresetPayload(existing, operatorId) : null;
  const scope = normalizeScope(input.scope);
  const pinned = normalizePinned(input.pinned);
  const sortOrder = normalizeSortOrder(input.sortOrder !== undefined ? input.sortOrder : input.sort_order);
  if (existing) {
    existing.title = title;
    existing.filters = filters;
    existing.scope = scope;
    existing.pinned = pinned;
    existing.sort_order = sortOrder;
    existing.updated_at = now;
    return { preset: toPresetPayload(existing, operatorId), before, created: false };
  }
  const record = {
    preset_id: createId("lfp"),
    operator_id: operatorId,
    title,
    filters,
    scope,
    pinned,
    sort_order: sortOrder,
    status: "ACTIVE",
    created_at: now,
    updated_at: now,
  };
  presets.unshift(record);
  return { preset: toPresetPayload(record, operatorId), before: null, created: true };
}

function copyPreset(data, input = {}) {
  const operatorId = normalizeOperatorId(input.operatorId || input.operator_id);
  const sourcePresetId = String(input.sourcePresetId || input.source_preset_id || input.presetId || input.preset_id || "").trim();
  if (!sourcePresetId) throw businessError(8035, "来源常用筛选 ID 必填");
  const source = ensureList(data).find((item) => item.preset_id === sourcePresetId && item.status !== "ARCHIVED");
  if (!source || (source.operator_id !== operatorId && recordScope(source) !== "TEAM")) {
    throw businessError(8036, "常用筛选不存在或不可复制");
  }
  const now = nowISO();
  const record = {
    preset_id: createId("lfp"),
    operator_id: operatorId,
    title: normalizeTitle(input.title || input.name || defaultCopyTitle(source.title)),
    filters: normalizeFilters(source.filters || {}),
    scope: normalizeScope(input.scope || "PERSONAL"),
    pinned: normalizePinned(input.pinned),
    sort_order: normalizeSortOrder(input.sortOrder !== undefined ? input.sortOrder : input.sort_order),
    status: "ACTIVE",
    created_at: now,
    updated_at: now,
  };
  ensureList(data).unshift(record);
  return {
    sourcePreset: toPresetPayload(source, operatorId),
    preset: toPresetPayload(record, operatorId),
    created: true,
  };
}

function archivePreset(data, input = {}) {
  const operatorId = normalizeOperatorId(input.operatorId || input.operator_id);
  const presetId = String(input.presetId || input.preset_id || "").trim();
  if (!presetId) throw businessError(8033, "常用筛选 ID 必填");
  const record = ensureList(data).find((item) => item.preset_id === presetId && item.status !== "ARCHIVED");
  if (!record) throw businessError(8034, "常用筛选不存在");
  if (record.operator_id !== operatorId) throw businessError(8032, "不能删除其他操作人的常用筛选");
  const before = toPresetPayload(record, operatorId);
  record.status = "ARCHIVED";
  record.updated_at = nowISO();
  return { preset: toPresetPayload(record, operatorId), before, deleted: true };
}

module.exports = {
  archivePreset,
  copyPreset,
  listPresets,
  normalizeFilters,
  upsertPreset,
};
