const { nowISO } = require("./dates");
const auditLog = require("./auditLog");
const manualReview = require("./manualReview");
const rewardInventory = require("./rewardInventory");

function businessError(code, message, status = 200) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function clone(value) {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function bool(value) {
  if (value === true) return true;
  const textValue = String(value || "").trim().toLowerCase();
  return ["true", "1", "yes", "y", "confirmed"].includes(textValue);
}

function reviewIdsFromBody(body = {}) {
  const value = body.reviewItemIds || body.review_item_ids || body.manualReviewItemIds || body.ids || [];
  const list = Array.isArray(value) ? value : String(value || "").split(/[\s,，;；]+/);
  return Array.from(new Set(list.map((item) => String(item || "").trim()).filter(Boolean)));
}

function rewardReviewStatusFromBody(body = {}) {
  const decision = String(body.decision || body.resolution || body.result || "APPROVED").trim().toUpperCase();
  if (["APPROVED", "GRANTED", "RESOLVED"].includes(decision)) return "APPROVED";
  if (["REJECTED", "DENIED", "CANCELLED"].includes(decision)) return "REJECTED";
  return decision || "RESOLVED";
}

function resolveReviewItem(data, reviewItemId, body = {}) {
  const beforeReviewItem = (data.manualReviewItems || []).find((item) => item.manual_review_item_id === reviewItemId);
  if (!beforeReviewItem) throw businessError(404, "复核项不存在", 404);
  const beforeReview = clone(beforeReviewItem);
  const beforeReward = beforeReviewItem.source_type === "REWARD_GRANT"
    ? clone((data.rewardGrants || []).find((item) => item.reward_grant_id === beforeReviewItem.source_id) || null)
    : null;
  const resolution = rewardReviewStatusFromBody(body);
  const item = manualReview.resolveManualReviewItem(data, reviewItemId, {
    ...body,
    resolution,
  });
  let reward = null;
  if (item.source_type === "REWARD_GRANT") {
    reward = (data.rewardGrants || []).find((candidate) => candidate.reward_grant_id === item.source_id) || null;
    if (reward && reward.status === "PENDING_REVIEW") {
      reward.status = resolution === "REJECTED" ? "REJECTED" : "APPROVED";
      reward.updated_at = nowISO();
      if (resolution === "REJECTED") {
        rewardInventory.releaseForRewardGrant(data, reward, "人工复核拒绝释放奖励库存");
      }
    }
  }
  const audit = auditLog.appendAuditLog(data, {
    action: "RESOLVE_MANUAL_REVIEW",
    targetType: "MANUAL_REVIEW_ITEM",
    targetId: reviewItemId,
    operatorId: body.operatorId || body.operator_id || "",
    reason: body.reason || body.note || "处理人工复核",
    before: { review: beforeReview, reward: beforeReward },
    after: { review: item, reward },
    metadata: {
      resolution,
      requestId: body.requestId || body.request_id || "",
      batchRequestId: body.batchRequestId || body.batch_request_id || "",
    },
  });
  return {
    success: true,
    review: manualReview.toManualReviewPayload(item),
    reward,
    audit,
  };
}

function resolveReviewBatch(data, body = {}) {
  const reviewItemIds = reviewIdsFromBody(body);
  const requestId = text(body.requestId || body.request_id);
  if (!reviewItemIds.length) throw businessError(8013, "请选择要批量复核的记录");
  if (!requestId) throw businessError(8014, "批量复核必须提供 request_id");
  if (!bool(body.confirmRisk || body.confirm_risk || body.confirmed)) {
    throw businessError(8015, "批量复核需要二次确认");
  }
  const items = reviewItemIds.map((reviewItemId) => resolveReviewItem(data, reviewItemId, {
    ...body,
    requestId,
    batchRequestId: requestId,
  }));
  const summary = items.reduce((result, item) => {
    result.total += 1;
    if (item.review.status === "RESOLVED") result.resolved += 1;
    if (item.reward && item.reward.status === "APPROVED") result.approved += 1;
    if (item.reward && item.reward.status === "REJECTED") result.rejected += 1;
    return result;
  }, { total: 0, resolved: 0, approved: 0, rejected: 0 });
  const audit = auditLog.appendAuditLog(data, {
    action: "BATCH_MANUAL_REVIEW_RESOLVE",
    targetType: "MANUAL_REVIEW_BATCH",
    targetId: requestId,
    operatorId: body.operatorId || body.operator_id || "",
    reason: body.reason || body.note || "批量处理人工复核",
    before: null,
    after: {
      reviewItemIds,
      summary,
    },
    metadata: {
      requestId,
      decision: rewardReviewStatusFromBody(body),
    },
  });
  return {
    requestId,
    summary,
    items,
    audit,
  };
}

module.exports = {
  resolveReviewBatch,
  resolveReviewItem,
  reviewIdsFromBody,
  rewardReviewStatusFromBody,
};
