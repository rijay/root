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

export function fetchReleaseEvidencePack(target = "production") {
  const baseUrl = typeof window !== "undefined" && window.location ? window.location.origin : "";
  return adminRequest(`/api/v1/admin/release-evidence-pack${queryString({ target, baseUrl, strict: "true" })}`);
}

export function fetchActionAdapterCalibration(target = "production") {
  return adminRequest(`/api/v1/admin/action-adapter-calibration${queryString({ target })}`);
}

export function fetchReleaseEvidenceArchive(archiveId = "") {
  return adminRequest(`/api/v1/admin/release-evidence-pack/archive${queryString({ archiveId })}`);
}

export function archiveReleaseEvidencePack(input = {}, requestId = "") {
  return postAdminJson("/api/v1/admin/release-evidence-pack/archive", input, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function signReleaseRecord(input = {}, requestId = "") {
  return postAdminJson("/api/v1/admin/release-signoffs", input, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function recordProductionCutoverProof(input = {}, requestId = "") {
  return postAdminJson("/api/v1/admin/production-cutover-proofs", input, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function recordRootMemberCenterJumpProof(input = {}, requestId = "") {
  return postAdminJson("/api/v1/admin/root-member-center-jump-proofs", input, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function recordAdminLegacyDeprecationDecision(input = {}, requestId = "") {
  return postAdminJson("/api/v1/admin/admin-legacy-deprecation-decisions", input, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function recordLegacyDataMigrationDecision(input = {}, requestId = "") {
  return postAdminJson("/api/v1/admin/legacy-data-migration-decisions", input, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function recordLegacyDataMigrationExecution(input = {}, requestId = "") {
  return postAdminJson("/api/v1/admin/legacy-data-migration-executions", input, {
    headers: requestId ? { "X-Request-Id": requestId } : {},
  });
}

export function fetchLaunchReadiness(target = "production") {
  return adminRequest(`/api/v1/admin/launch-readiness${queryString({ target })}`);
}

export function fetchCloudbaseIdentityProbe(input = {}) {
  const headers = {};
  if (input.openid) headers["X-WX-OPENID"] = input.openid;
  if (input.unionid) headers["X-WX-UNIONID"] = input.unionid;
  if (input.appCode) headers["X-ROOT-APP-CODE"] = input.appCode;
  return adminRequest(`/api/v1/admin/cloudbase-identity-probe${queryString({ appCode: input.appCode || "" })}`, {
    headers,
  });
}
