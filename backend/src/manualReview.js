const { nowISO } = require("./dates");
const { createId } = require("./seed");
const manualReviewExplanation = require("./manualReviewExplanation");

const CN_OFFSET_MS = 8 * 60 * 60 * 1000;
const DEFAULT_SLA_HOURS = {
  HIGH: 12,
  NORMAL: 24,
  LOW: 48,
};

function ensureList(data) {
  if (!Array.isArray(data.manualReviewItems)) data.manualReviewItems = [];
  return data.manualReviewItems;
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function numberValue(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function formatChinaIso(timeMs) {
  const text = new Date(timeMs + CN_OFFSET_MS).toISOString();
  return `${text.slice(0, 19)}+08:00`;
}

function addHours(isoText, hours) {
  const timeMs = Date.parse(isoText);
  if (!Number.isFinite(timeMs)) return "";
  return formatChinaIso(timeMs + hours * 60 * 60 * 1000);
}

function slaHoursFor(priority, metadata = {}) {
  return numberValue(
    metadata.slaHours || metadata.sla_hours || metadata.reviewSlaHours || metadata.review_sla_hours,
    DEFAULT_SLA_HOURS[priority] || DEFAULT_SLA_HOURS.NORMAL
  );
}

function expectedResolutionAt(item) {
  const metadata = objectValue(item.metadata);
  return text(metadata.expectedResolutionAt || metadata.expected_resolution_at, addHours(item.created_at, slaHoursFor(item.priority, metadata)));
}

function publicNoteFromBody(body = {}) {
  return text(
    body.publicNote ||
      body.public_note ||
      body.userVisibleNote ||
      body.user_visible_note ||
      body.note ||
      body.reason
  );
}

function publicNoteFor(item) {
  const metadata = objectValue(item.metadata);
  return text(metadata.publicNote || metadata.public_note || metadata.userVisibleNote || metadata.user_visible_note);
}

function isOverdue(item) {
  if (item.status !== "OPEN") return false;
  const expected = Date.parse(expectedResolutionAt(item));
  const now = Date.parse(nowISO());
  return Number.isFinite(expected) && Number.isFinite(now) && now > expected;
}

function explanationFor(item, context = {}) {
  if (!item) return null;
  const metadata = objectValue(item.metadata);
  return manualReviewExplanation.explainManualReview(item, {
    ...context,
    slaHours: slaHoursFor(item.priority, metadata),
    expectedResolutionAt: expectedResolutionAt(item),
    overdue: isOverdue(item),
    publicNote: publicNoteFor(item),
  });
}

function statusCopy(item, context = {}) {
  const explanation = explanationFor(item, context);
  return explanation && explanation.statusCopy ? explanation.statusCopy : "运营会根据活动规则、奖励库存和外部订单证据确认。";
}

function createManualReviewItem(data, input = {}, context = {}) {
  const rootUserId = text(input.rootUserId || input.root_user_id);
  const campaignId = text(input.campaignId || input.campaign_id);
  const reviewType = text(input.reviewType || input.review_type, "MANUAL_REVIEW").toUpperCase();
  const sourceId = text(input.sourceId || input.source_id);
  const idempotencyKey = text(input.idempotencyKey || input.idempotency_key, [rootUserId, campaignId, reviewType, sourceId].join(":"));
  const list = ensureList(data);
  const existing = list.find((item) => item.idempotency_key === idempotencyKey);
  if (existing) return { item: existing, created: false };
  const now = nowISO();
  const priority = text(input.priority, "NORMAL").toUpperCase();
  const metadata = objectValue(input.metadata);
  const slaHours = slaHoursFor(priority, metadata);
  const item = {
    manual_review_item_id: createId("mri"),
    root_user_id: rootUserId,
    campaign_id: campaignId,
    review_type: reviewType,
    source_type: text(input.sourceType || input.source_type, "SETTLEMENT"),
    source_id: sourceId,
    reason: text(input.reason, "需要人工复核"),
    status: "OPEN",
    priority,
    metadata: {
      ...metadata,
      slaHours,
      expectedResolutionAt: text(metadata.expectedResolutionAt || metadata.expected_resolution_at, addHours(now, slaHours)),
    },
    idempotency_key: idempotencyKey,
    operator_id: "",
    resolved_at: "",
    resolution: "",
    created_at: now,
    updated_at: now,
  };
  list.push(item);
  return { item, created: true };
}

function resolveManualReviewItem(data, reviewItemId, body = {}) {
  const item = ensureList(data).find((candidate) => candidate.manual_review_item_id === reviewItemId);
  if (!item) {
    const error = new Error("复核项不存在");
    error.code = 404;
    error.status = 404;
    throw error;
  }
  if (item.status !== "RESOLVED") {
    const metadata = objectValue(item.metadata);
    const publicNote = publicNoteFromBody(body);
    item.status = "RESOLVED";
    item.operator_id = text(body.operatorId || body.operator_id);
    item.resolution = text(body.resolution || body.result, "RESOLVED");
    item.metadata = {
      ...metadata,
      ...(publicNote ? { publicNote } : {}),
      resolutionNote: text(body.note || body.reason || metadata.resolutionNote || metadata.resolution_note),
    };
    item.resolved_at = nowISO();
    item.updated_at = item.resolved_at;
  }
  return item;
}

function listManualReviewItems(data, query = {}) {
  const rootUserId = query.rootUserId || query.root_user_id || "";
  const campaignId = query.campaignId || query.campaign_id || "";
  const status = query.status || "";
  return ensureList(data)
    .filter((item) => !rootUserId || item.root_user_id === rootUserId)
    .filter((item) => !campaignId || item.campaign_id === campaignId)
    .filter((item) => !status || item.status === status)
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
}

function toManualReviewPayload(item, context = {}) {
  if (!item) return null;
  const metadata = objectValue(item.metadata);
  const slaHours = slaHoursFor(item.priority, metadata);
  const expectedAt = expectedResolutionAt(item);
  const explanation = explanationFor(item, context);
  const publicExplanation = explanation
    ? {
      ...explanation,
      operatorGuidance: context.audience === "admin" || context.includeOperatorGuidance ? explanation.operatorGuidance : "",
    }
    : null;
  return {
    reviewItemId: item.manual_review_item_id,
    rootUserId: item.root_user_id,
    campaignId: item.campaign_id,
    reviewType: item.review_type,
    reason: item.reason,
    status: item.status,
    priority: item.priority,
    slaHours,
    expectedResolutionAt: expectedAt,
    overdue: isOverdue(item),
    statusCopy: publicExplanation ? publicExplanation.statusCopy : statusCopy(item, context),
    publicNote: publicNoteFor(item),
    explanation: publicExplanation,
    explanationTitle: publicExplanation ? publicExplanation.title : "",
    pendingReason: publicExplanation ? publicExplanation.pendingReason : "",
    evidenceRequired: publicExplanation ? publicExplanation.evidenceRequired : [],
    nextAction: publicExplanation ? publicExplanation.nextAction : "",
    operatorGuidance: publicExplanation ? publicExplanation.operatorGuidance : "",
    operatorId: item.operator_id || "",
    resolution: item.resolution || "",
    createdAt: item.created_at,
    resolvedAt: item.resolved_at || "",
  };
}

module.exports = {
  createManualReviewItem,
  listManualReviewItems,
  resolveManualReviewItem,
  toManualReviewPayload,
};
