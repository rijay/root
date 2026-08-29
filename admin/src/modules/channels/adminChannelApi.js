import { adminRequest, downloadAdminFile, postAdminJson } from "@/api/client";

function queryString(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) params.set(key, String(value).trim());
  });
  return params.toString();
}

function commandHeaders(prefix) {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return {
    "X-Request-Id": `${prefix}-request-${nonce}`,
    "X-Idempotency-Key": `${prefix}-intent-${nonce}`,
  };
}

export function fetchChannelConfiguration(filters = {}, options = {}) {
  const query = queryString(filters);
  return adminRequest(`/api/v1/admin/channels${query ? `?${query}` : ""}`, options);
}

export function fetchChannelFunnel(filters = {}, options = {}) {
  const query = queryString(filters);
  return adminRequest(`/api/v1/admin/channel-funnel${query ? `?${query}` : ""}`, options);
}

export function saveChannel(input) {
  return postAdminJson("/api/v1/admin/channels", input, { headers: commandHeaders("channel-upsert") });
}

export function createChannelCode(input) {
  return postAdminJson("/api/v1/admin/channel-codes", input, { headers: commandHeaders("channel-code-create") });
}

export function changeChannelCodeStatus(codeId, status) {
  return postAdminJson(`/api/v1/admin/channel-codes/${encodeURIComponent(codeId)}/status`, { status }, {
    headers: commandHeaders("channel-code-status"),
  });
}

export function downloadChannelCode(codeId) {
  return downloadAdminFile(`/api/v1/admin/channel-codes/${encodeURIComponent(codeId)}/image`);
}
