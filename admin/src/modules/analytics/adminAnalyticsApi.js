import { adminRequest, getAdminToken } from "@/api/client";

function buildQuery(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      params.set(key, String(value).trim());
    }
  });
  return params.toString();
}

export function fetchOperationalAnalytics(filters = {}) {
  const query = buildQuery(filters);
  return adminRequest(`/api/v1/admin/operational-analytics${query ? `?${query}` : ""}`);
}

export function upsertOperationalAlertRule(payload = {}, requestId = "") {
  return adminRequest("/api/v1/admin/operational-alert-rules/upsert", {
    method: "POST",
    headers: requestId ? { "X-Request-Id": requestId } : {},
    body: JSON.stringify({ ...payload, requestId }),
  });
}

export function runOperationalAlertJob(payload = {}, requestId = "") {
  return adminRequest("/api/v1/jobs/operational-alerts", {
    method: "POST",
    headers: requestId ? { "X-Request-Id": requestId } : {},
    body: JSON.stringify({ ...payload, requestId }),
  });
}

export async function exportOperationalAnalyticsCsv(filters = {}) {
  const query = buildQuery(filters);
  const adminToken = getAdminToken();
  const response = await fetch(`/api/v1/admin/operational-analytics/export${query ? `?${query}` : ""}`, {
    headers: adminToken ? { "X-Admin-Token": adminToken, "X-ROOT-ADMIN-TOKEN": adminToken } : {},
  });
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const payload = await response.json();
    if (payload.code !== 0) throw new Error(payload.message || "运营数据导出失败");
  }
  if (!response.ok) throw new Error("运营数据导出失败");
  return response.text();
}
