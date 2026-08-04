import { adminRequest, postAdminJson, postAdminRead } from "@/api/client";

function queryString(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      params.set(key, String(value).trim());
    }
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}

function requestId(prefix) {
  const entropy = globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${entropy}`;
}

export function fetchFormalActivities(filters = {}, options = {}) {
  return adminRequest(`/api/v1/admin/formal-activities${queryString(filters)}`, options);
}

export function saveFormalActivityDraft(input = {}) {
  const id = requestId("formal-activity-draft");
  return postAdminJson("/api/v1/admin/formal-activities/draft", { ...input, requestId: id }, {
    headers: {
      "X-Request-Id": id,
      "X-Idempotency-Key": id,
    },
  });
}

export async function fetchActivityEnrollments(filters = {}, options = {}) {
  const data = await postAdminRead("/api/v1/admin/activity-enrollments/query", filters, options);
  return { ...data, items: data?.items || data?.enrollments || [] };
}

export async function fetchActivityOptions(options = {}) {
  const data = await adminRequest("/api/v1/admin/activities?status=PUBLISHED&page=1&pageSize=50", options);
  return { ...data, items: data?.items || data?.activities || [] };
}

export function exportActivityEnrollments(filters = {}) {
  const id = requestId("activity-enrollment-export");
  return postAdminJson("/api/v1/admin/activity-enrollments/export", { ...filters, requestId: id }, {
    headers: {
      "X-Request-Id": id,
      "X-Idempotency-Key": id,
    },
  });
}
