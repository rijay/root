import { adminRequest, postAdminJson } from "@/api/client";

export function fetchConfigWorkbench() {
  return adminRequest("/api/v1/admin/config-workbench");
}

export function saveCampaign(payload) {
  return postAdminJson("/api/v1/admin/campaigns/upsert", payload);
}

export function saveTaskDefinition(payload) {
  return postAdminJson("/api/v1/admin/task-definitions/upsert", payload);
}

export function saveProduct(payload) {
  return postAdminJson("/api/v1/admin/products/upsert", payload);
}

export function previewProductSync(payload) {
  return postAdminJson("/api/v1/admin/products/sync-preview", payload);
}

export function executeProductSync(payload, requestId) {
  return postAdminJson("/api/v1/admin/products/sync-execute", payload, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function publishRuleVersion(payload) {
  return postAdminJson("/api/v1/admin/campaign-rules/publish", payload);
}

export function previewSettlement(payload) {
  return postAdminJson("/api/v1/admin/settlement/preview", payload);
}

export function previewSettlementBatch(payload) {
  return postAdminJson("/api/v1/admin/settlement/batch-preview", payload);
}

export function executeSettlementBatch(payload, requestId) {
  return postAdminJson("/api/v1/admin/settlement/batch-execute", payload, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function executeRewardDelivery(payload, requestId) {
  return postAdminJson("/api/v1/admin/reward-delivery/execute", payload, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function queryRewardDeliveryStatus(payload, requestId) {
  return postAdminJson("/api/v1/admin/reward-delivery/status-query", payload, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function resolveManualReview(reviewId, payload, requestId = "") {
  return postAdminJson(`/api/v1/admin/manual-reviews/${encodeURIComponent(reviewId)}/resolve`, payload, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function resolveManualReviewBatch(payload, requestId) {
  return postAdminJson("/api/v1/admin/manual-reviews/batch-resolve", payload, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}
