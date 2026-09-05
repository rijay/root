import { adminRequest, postAdminRead, postAdminJson } from "@/api/client";

export const queryUserLabels = (body) => postAdminRead("/api/v1/admin/user-labels/query", body);
export const fetchLabelConfiguration = () => adminRequest("/api/v1/admin/user-labels/config");
export const previewLabelSync = (userIds) => postAdminRead("/api/v1/admin/user-labels/sync/preview", { userIds }, { timeoutMs: 60000 });
export const reconcileLabelSync = (userIds) => postAdminJson("/api/v1/admin/user-labels/sync/reconcile", { userIds }, { timeoutMs: 60000 });
function headers(prefix) {
  const id = crypto.randomUUID();
  return { "X-Request-Id": `${prefix}-${id}`, "X-Idempotency-Key": `${prefix}-${id}` };
}
export const saveLabelMapping = (body) => postAdminJson("/api/v1/admin/user-labels/mappings", body, { headers: headers("label-mapping") });
export const executeLabelSync = (plan) => postAdminJson("/api/v1/admin/user-labels/sync/execute", {
  userIds: plan.userIds, planHash: plan.planHash,
}, { headers: headers("label-sync"), timeoutMs: 120000 });
