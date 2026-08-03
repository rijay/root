import { adminRequest, postAdminJson } from "@/api/client";

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

export function fetchReleaseRecord(target = "production") {
  return adminRequest(`/api/v1/admin/release-record${queryString({ target })}`);
}

export function publishContentVersion(input = {}) {
  const requestId = `content-publish-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  return postAdminJson("/api/v1/admin/content-release/publish", {
    ...input,
    requestId,
  }, {
    headers: { "X-Request-Id": requestId },
  });
}
