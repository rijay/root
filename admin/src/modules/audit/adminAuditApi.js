import { adminRequest } from "@/api/client";

export function fetchAuditLogs(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      params.set(key, String(value).trim());
    }
  });
  const query = params.toString();
  return adminRequest(`/api/v1/admin/audit-logs${query ? `?${query}` : ""}`);
}
