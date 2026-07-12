import { adminRequest, getAdminToken, postAdminJson } from "@/api/client";

function buildQuery(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) params.set(key, String(value).trim());
  });
  return params.toString();
}

export function fetchLifecycleUsers(filters = {}) {
  const query = buildQuery(filters);
  return adminRequest(`/api/v1/admin/lifecycle-users${query ? `?${query}` : ""}`);
}

export function fetchLifecycleFilterPresets() {
  return adminRequest("/api/v1/admin/lifecycle-filter-presets");
}

export function fetchLifecycleUserExports(filters = {}) {
  const query = buildQuery(filters);
  return adminRequest(`/api/v1/admin/lifecycle-user-exports${query ? `?${query}` : ""}`);
}

export function fetchLifecycleExportDeliveryHealth(filters = {}) {
  const query = buildQuery(filters);
  return adminRequest(`/api/v1/admin/lifecycle-user-exports/delivery-health${query ? `?${query}` : ""}`);
}

export async function exportLifecycleUsersCsv(filters = {}) {
  const query = buildQuery(filters);
  const adminToken = getAdminToken();
  const response = await fetch(`/api/v1/admin/lifecycle-users/export${query ? `?${query}` : ""}`, {
    headers: adminToken ? { "X-Admin-Token": adminToken, "X-ROOT-ADMIN-TOKEN": adminToken } : {},
  });
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const payload = await response.json();
    if (payload.code !== 0) throw new Error(payload.message || "用户生命周期导出失败");
  }
  if (!response.ok) throw new Error("用户生命周期导出失败");
  return response.text();
}

export function createLifecycleUserExport(payload = {}, requestId = "") {
  return postAdminJson("/api/v1/admin/lifecycle-user-exports/create", payload, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function reviewLifecycleUserExport(payload = {}, requestId = "") {
  return postAdminJson("/api/v1/admin/lifecycle-user-exports/review", payload, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function deliverLifecycleUserExport(payload = {}, requestId = "") {
  return postAdminJson("/api/v1/admin/lifecycle-user-exports/deliver", payload, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function recordConsultationWeworkWriteback(payload = {}, requestId = "") {
  return postAdminJson("/api/v1/admin/consultation-wework-writebacks", payload, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function assignConsultationAdvisor(payload = {}, requestId = "") {
  return postAdminJson("/api/v1/admin/consultation-advisor-assignments", payload, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function fetchConsultationSla(filters = {}) {
  const query = buildQuery(filters);
  return adminRequest(`/api/v1/admin/consultation-sla${query ? `?${query}` : ""}`);
}

export function fetchConsultationSlaEscalations(filters = {}) {
  const query = buildQuery(filters);
  return adminRequest(`/api/v1/admin/consultation-sla-escalations${query ? `?${query}` : ""}`);
}

export function fetchConsultationAdvisorWorkbench(filters = {}) {
  const query = buildQuery(filters);
  return adminRequest(`/api/v1/admin/consultation-advisor-workbench${query ? `?${query}` : ""}`);
}

export async function downloadLifecycleUserExportCsv(exportId) {
  const adminToken = getAdminToken();
  const response = await fetch(`/api/v1/admin/lifecycle-user-exports/${exportId}/download`, {
    headers: adminToken ? { "X-Admin-Token": adminToken, "X-ROOT-ADMIN-TOKEN": adminToken } : {},
  });
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const payload = await response.json();
    if (payload.code !== 0) throw new Error(payload.message || "用户生命周期导出记录下载失败");
  }
  if (!response.ok) throw new Error("用户生命周期导出记录下载失败");
  return {
    csv: await response.text(),
    filename: (response.headers.get("content-disposition") || "").match(/filename="([^"]+)"/)?.[1] || `root-lifecycle-users-${exportId}.csv`,
  };
}

export function previewLifecycleSettlementBatch(payload = {}) {
  return postAdminJson("/api/v1/admin/settlement/batch-preview", payload);
}

export function executeLifecycleSettlementBatch(payload = {}, requestId = "") {
  return postAdminJson("/api/v1/admin/settlement/batch-execute", payload, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function previewLifecycleFilterSettlementBatch(payload = {}) {
  return postAdminJson("/api/v1/admin/lifecycle-users/settlement-batch-preview", payload);
}

export function executeLifecycleFilterSettlementBatch(payload = {}, requestId = "") {
  return postAdminJson("/api/v1/admin/lifecycle-users/settlement-batch-execute", payload, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function fetchLifecycleSettlementJobs(filters = {}) {
  const query = buildQuery(filters);
  return adminRequest(`/api/v1/admin/lifecycle-settlement-jobs${query ? `?${query}` : ""}`);
}

export function createLifecycleSettlementJob(payload = {}, requestId = "") {
  return postAdminJson("/api/v1/admin/lifecycle-settlement-jobs/create", payload, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function runLifecycleSettlementJob(payload = {}, requestId = "") {
  return postAdminJson("/api/v1/admin/lifecycle-settlement-jobs/run", payload, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function cancelLifecycleSettlementJob(payload = {}, requestId = "") {
  return postAdminJson("/api/v1/admin/lifecycle-settlement-jobs/cancel", payload, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function retryFailedLifecycleSettlementJob(payload = {}, requestId = "") {
  return postAdminJson("/api/v1/admin/lifecycle-settlement-jobs/retry-failed", payload, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function runLifecycleSettlementScheduler(payload = {}, requestId = "") {
  return postAdminJson("/api/v1/jobs/lifecycle-settlement-due", payload, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function runLifecycleSettlementCleanup(payload = {}, requestId = "") {
  return postAdminJson("/api/v1/jobs/lifecycle-settlement-cleanup", payload, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function runLifecycleUserExportsCleanup(payload = {}, requestId = "") {
  return postAdminJson("/api/v1/jobs/lifecycle-user-exports-cleanup", payload, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function upsertLifecycleFilterPreset(payload = {}, requestId = "") {
  return postAdminJson("/api/v1/admin/lifecycle-filter-presets/upsert", payload, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function copyLifecycleFilterPreset(payload = {}, requestId = "") {
  return postAdminJson("/api/v1/admin/lifecycle-filter-presets/copy", payload, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function deleteLifecycleFilterPreset(presetId, requestId = "") {
  return postAdminJson("/api/v1/admin/lifecycle-filter-presets/delete", { presetId, requestId }, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}
