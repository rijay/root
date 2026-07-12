const { nowISO } = require("./dates");
const { createId } = require("./seed");
const manualReview = require("./manualReview");
const rewardInventory = require("./rewardInventory");

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function arrayValue(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value.split(/[\s,，;；]+/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function boolValue(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return !["false", "0", "no", "off"].includes(String(value).trim().toLowerCase());
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function rootUserIdForUser(data, input = {}) {
  const rootUserId = text(input.rootUserId || input.root_user_id);
  if (rootUserId) return rootUserId;
  const userId = text(input.userId || input.user_id);
  if (!userId) return "";
  const user = ensureList(data, "users").find((item) => item.user_id === userId);
  return text(user && user.root_user_id, userId);
}

function sourceKey(input = {}, grantId = "") {
  return [
    text(input.sourceType || input.source_type, "AFTER_SALES"),
    text(input.sourceId || input.source_id),
    grantId,
  ].join(":");
}

function hasExternalValue(grant) {
  return Boolean(
    text(grant.external_ref)
      || text(grant.external_status).toUpperCase() === "USED"
      || text(grant.status).toUpperCase() === "DELIVERED"
      || text(grant.delivered_at)
      || text(grant.used_at)
  );
}

function recoverableGrant(grant) {
  const status = text(grant && grant.status).toUpperCase();
  return Boolean(grant)
    && !["REVOKED", "RECOVERED", "RECOVERY_PENDING", "CANCELLED", "CANCELED"].includes(status);
}

function valueList(...values) {
  return values.flatMap((value) => arrayValue(value)).map((value) => text(value)).filter(Boolean);
}

function payloadForGrant(grant) {
  return objectValue(grant && (grant.payload_json || grant.payload));
}

function metadataForInput(input = {}) {
  return objectValue(input.metadata || input.metadata_json);
}

function includesText(values, expected) {
  const normalized = text(expected);
  return Boolean(normalized) && valueList(...values).includes(normalized);
}

function rewardGrantIdsFor(input = {}) {
  return valueList(input.rewardGrantIds, input.reward_grant_ids, input.grantIds, input.grant_ids);
}

function scopeForInput(input = {}) {
  const metadata = metadataForInput(input);
  return {
    orderId: text(input.orderId || input.order_id || metadata.orderId || metadata.order_id),
    youzanOrderNo: text(input.youzanOrderNo || input.youzan_order_no || metadata.youzanOrderNo || metadata.youzan_order_no),
    sessionId: text(input.sessionId || input.session_id || metadata.sessionId || metadata.session_id || metadata.legacySessionId),
    settlementRecordId: text(input.settlementRecordId || input.settlement_record_id || metadata.settlementRecordId || metadata.settlement_record_id),
    rewardGrantIds: rewardGrantIdsFor(input),
  };
}

function hasRecoveryScope(scope) {
  return Boolean(scope.orderId || scope.youzanOrderNo || scope.sessionId || scope.settlementRecordId || scope.rewardGrantIds.length);
}

function grantMatchesScope(grant, scope) {
  if (!grant) return false;
  if (scope.rewardGrantIds.length && !scope.rewardGrantIds.includes(grant.reward_grant_id)) return false;
  if (scope.rewardGrantIds.length && scope.rewardGrantIds.includes(grant.reward_grant_id)) return true;

  const payload = payloadForGrant(grant);
  if (scope.orderId && (
    text(grant.order_id) === scope.orderId ||
    includesText([payload.orderId, payload.order_id, payload.orderIds, payload.order_ids], scope.orderId)
  )) return true;
  if (scope.youzanOrderNo && includesText([
    payload.youzanOrderNo,
    payload.youzan_order_no,
    payload.orderNo,
    payload.order_no,
    payload.youzanOrderNos,
    payload.youzan_order_nos,
  ], scope.youzanOrderNo)) return true;
  if (scope.sessionId && includesText([
    payload.sessionId,
    payload.session_id,
    payload.legacySessionId,
    payload.legacy_session_id,
    payload.sessionIds,
    payload.session_ids,
  ], scope.sessionId)) return true;
  if (scope.settlementRecordId && (
    text(grant.settlement_record_id) === scope.settlementRecordId ||
    includesText([payload.settlementRecordId, payload.settlement_record_id], scope.settlementRecordId)
  )) return true;
  return false;
}

function grantHasConflictingScopeEvidence(grant, scope) {
  const payload = payloadForGrant(grant);
  if (scope.orderId && (
    text(grant.order_id) ||
    valueList(payload.orderId, payload.order_id, payload.orderIds, payload.order_ids).length
  )) return true;
  if (scope.youzanOrderNo && valueList(
    payload.youzanOrderNo,
    payload.youzan_order_no,
    payload.orderNo,
    payload.order_no,
    payload.youzanOrderNos,
    payload.youzan_order_nos,
  ).length) return true;
  if (scope.sessionId && valueList(
    payload.sessionId,
    payload.session_id,
    payload.legacySessionId,
    payload.legacy_session_id,
    payload.sessionIds,
    payload.session_ids,
  ).length) return true;
  if (scope.settlementRecordId && (
    text(grant.settlement_record_id) ||
    valueList(payload.settlementRecordId, payload.settlement_record_id).length
  )) return true;
  return false;
}

function scopedRecoverableGrants(grants, input = {}) {
  const scope = scopeForInput(input);
  if (boolValue(input.recoverAllUserRewards || input.recover_all_user_rewards, false)) return grants;
  if (!hasRecoveryScope(scope)) return grants;
  const matched = grants.filter((grant) => grantMatchesScope(grant, scope));
  if (matched.length) return matched;
  if (grants.length === 1 && !grantHasConflictingScopeEvidence(grants[0], scope)) return grants;
  return [];
}

function findExistingRecovery(data, idempotencyKey, sourceType, sourceId, grantId) {
  return ensureList(data, "rewardRecoveryRecords").find((item) => {
    if (idempotencyKey && item.idempotency_key === idempotencyKey) return true;
    return item.source_type === sourceType
      && item.source_id === sourceId
      && item.reward_grant_id === grantId;
  }) || null;
}

function cancelPendingDeliveryJobs(data, grant, reason) {
  return ensureList(data, "rewardDeliveryJobs")
    .filter((job) => job.reward_grant_id === grant.reward_grant_id)
    .filter((job) => !["DELIVERED", "CANCELLED", "CANCELED"].includes(text(job.status).toUpperCase()))
    .map((job) => {
      job.status = "CANCELLED";
      job.last_error = reason;
      job.updated_at = nowISO();
      return job;
    });
}

function closeOpenManualReviews(data, grant, reason, operatorId) {
  return ensureList(data, "manualReviewItems")
    .filter((item) => item.source_type === "REWARD_GRANT")
    .filter((item) => item.source_id === grant.reward_grant_id)
    .filter((item) => item.status === "OPEN")
    .map((item) => manualReview.resolveManualReviewItem(data, item.manual_review_item_id, {
      operatorId,
      resolution: "REVOKED",
      reason,
      publicNote: "关联订单已进入售后或退款，本次奖励已撤销。",
    }));
}

function recoverRewardGrant(data, grant, input = {}) {
  if (!recoverableGrant(grant)) {
    return { created: false, skipped: true, skippedReason: "奖励已处于追回或撤销状态", grant, record: null };
  }
  const sourceType = text(input.sourceType || input.source_type, "AFTER_SALES").toUpperCase();
  const sourceId = text(input.sourceId || input.source_id);
  const idempotencyKey = text(input.idempotencyKey || input.idempotency_key, sourceKey({ sourceType, sourceId }, grant.reward_grant_id));
  const existing = findExistingRecovery(data, idempotencyKey, sourceType, sourceId, grant.reward_grant_id);
  if (existing) return { created: false, record: existing, grant };

  const reason = text(input.reason, "关联订单售后或退款，追回奖励");
  const operatorId = text(input.operatorId || input.operator_id);
  const externalRecovery = hasExternalValue(grant);
  const inventoryRelease = boolValue(firstPresent(input.replenishInventory, input.replenish_inventory), true)
    ? rewardInventory.releaseForRewardGrant(data, grant, reason)
    : { released: false, reservation: null };
  const cancelledJobs = externalRecovery ? [] : cancelPendingDeliveryJobs(data, grant, reason);
  const resolvedReviews = closeOpenManualReviews(data, grant, reason, operatorId);
  const now = nowISO();
  const record = {
    reward_recovery_record_id: createId("rrr"),
    reward_grant_id: grant.reward_grant_id,
    root_user_id: grant.root_user_id,
    campaign_id: grant.campaign_id,
    order_id: text(input.orderId || input.order_id),
    source_type: sourceType,
    source_id: sourceId,
    recovery_type: externalRecovery ? "RECOVER_AFTER_DELIVERY" : "REVOKE_BEFORE_DELIVERY",
    status: externalRecovery ? "PENDING_EXTERNAL_ACTION" : "COMPLETED",
    inventory_released: Boolean(inventoryRelease.released),
    reason,
    metadata_json: {
      ...objectValue(input.metadata || input.metadata_json),
      previousStatus: text(grant.status),
      cancelledDeliveryJobIds: cancelledJobs.map((job) => job.reward_delivery_job_id),
      resolvedManualReviewIds: resolvedReviews.map((item) => item.manual_review_item_id),
      inventoryReservationId: inventoryRelease.reservation ? inventoryRelease.reservation.reward_inventory_reservation_id : "",
    },
    idempotency_key: idempotencyKey,
    created_at: now,
    updated_at: now,
  };
  ensureList(data, "rewardRecoveryRecords").push(record);
  grant.status = externalRecovery ? "RECOVERY_PENDING" : "REVOKED";
  grant.recovery_status = record.status;
  grant.recovery_reason = reason;
  grant.recovery_record_id = record.reward_recovery_record_id;
  grant.recovered_at = now;
  grant.updated_at = now;
  return { created: true, record, grant, inventoryRelease, cancelledJobs, resolvedReviews };
}

function recoverRewardsForAfterSales(data, input = {}) {
  const rootUserId = rootUserIdForUser(data, input);
  if (!rootUserId) {
    return {
      rootUserId: "",
      campaignId: text(input.campaignId || input.campaign_id),
      sourceType: text(input.sourceType || input.source_type, "AFTER_SALES").toUpperCase(),
      sourceId: text(input.sourceId || input.source_id),
      processedCount: 0,
      createdCount: 0,
      inventoryReleasedCount: 0,
      results: [],
    };
  }
  const campaignId = text(input.campaignId || input.campaign_id);
  const grants = ensureList(data, "rewardGrants")
    .filter((grant) => !rootUserId || grant.root_user_id === rootUserId)
    .filter((grant) => !campaignId || grant.campaign_id === campaignId)
    .filter(recoverableGrant);
  const scopedGrants = scopedRecoverableGrants(grants, input);
  const results = scopedGrants.map((grant) => recoverRewardGrant(data, grant, {
    ...input,
    idempotencyKey: sourceKey(input, grant.reward_grant_id),
  }));
  return {
    rootUserId,
    campaignId,
    sourceType: text(input.sourceType || input.source_type, "AFTER_SALES").toUpperCase(),
    sourceId: text(input.sourceId || input.source_id),
    processedCount: results.length,
    createdCount: results.filter((item) => item.created).length,
    inventoryReleasedCount: results.filter((item) => item.inventoryRelease && item.inventoryRelease.released).length,
    results,
  };
}

function listRewardRecoveryRecords(data, query = {}) {
  const rootUserId = text(query.rootUserId || query.root_user_id);
  const campaignId = text(query.campaignId || query.campaign_id);
  const rewardGrantId = text(query.rewardGrantId || query.reward_grant_id);
  return ensureList(data, "rewardRecoveryRecords")
    .filter((record) => !rootUserId || record.root_user_id === rootUserId)
    .filter((record) => !campaignId || record.campaign_id === campaignId)
    .filter((record) => !rewardGrantId || record.reward_grant_id === rewardGrantId)
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
}

function toRewardRecoveryPayload(record) {
  if (!record) return null;
  return {
    rewardRecoveryRecordId: record.reward_recovery_record_id,
    rewardGrantId: record.reward_grant_id,
    rootUserId: record.root_user_id,
    campaignId: record.campaign_id,
    orderId: record.order_id || "",
    sourceType: record.source_type,
    sourceId: record.source_id,
    recoveryType: record.recovery_type,
    status: record.status,
    inventoryReleased: Boolean(record.inventory_released),
    reason: record.reason,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

module.exports = {
  listRewardRecoveryRecords,
  recoverRewardGrant,
  recoverRewardsForAfterSales,
  toRewardRecoveryPayload,
};
