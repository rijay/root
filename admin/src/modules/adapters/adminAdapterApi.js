import { adminRequest, postAdminJson } from "@/api/client";

export function fetchExternalAdapters() {
  return adminRequest("/api/v1/admin/external-adapters");
}

export function fetchExternalSampleReviews(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      params.set(key, String(value).trim());
    }
  });
  const query = params.toString();
  return adminRequest(`/api/v1/admin/external-sample-reviews${query ? `?${query}` : ""}`);
}

export function fetchYouzanCustomers(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      params.set(key, String(value).trim());
    }
  });
  const query = params.toString();
  return adminRequest(`/api/v1/admin/youzan-customers${query ? `?${query}` : ""}`);
}

export function previewOrderIncrement(payload) {
  return postAdminJson("/api/v1/admin/orders/increment-preview", payload);
}

export function executeOrderIncrement(payload, requestId) {
  return postAdminJson("/api/v1/admin/orders/increment-execute", payload, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function runExternalAdapter(payload, requestId = "") {
  return postAdminJson("/api/v1/admin/external-adapters/run", payload, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function runDueExternalAdapterRetries(payload, requestId = "") {
  return postAdminJson("/api/v1/admin/external-adapters/retry-due", payload, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function rollbackExternalAdapterRun(payload, requestId = "") {
  return postAdminJson("/api/v1/admin/external-adapters/rollback", payload, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}
