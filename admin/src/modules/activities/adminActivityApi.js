import { adminRequest, postAdminJson } from "@/api/client";

function withQuery(path, filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      params.set(key, String(value).trim());
    }
  });
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}`;
}

function createAttemptRequestId() {
  const entropy = globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
  return `activity-attempt-${entropy}`;
}

function write(path, payload, idempotencyKey) {
  if (!idempotencyKey) throw new Error("ACTIVITY_IDEMPOTENCY_KEY_REQUIRED");
  return postAdminJson(path, payload, {
    headers: {
      "X-Request-Id": createAttemptRequestId(),
      "X-Idempotency-Key": idempotencyKey,
    },
  });
}

export function fetchActivities(filters = {}) {
  return adminRequest(withQuery("/api/v1/admin/activities", filters));
}

export function fetchActivitySessions(filters = {}) {
  return adminRequest(withQuery("/api/v1/admin/activity-sessions", filters));
}

export function fetchActivityEnrollments(filters = {}) {
  return adminRequest(withQuery("/api/v1/admin/activity-enrollments", filters));
}

export function saveActivityDraft(payload, idempotencyKey) {
  return write("/api/v1/admin/activities/draft", payload, idempotencyKey);
}

export function submitActivityReview(payload, idempotencyKey) {
  return write("/api/v1/admin/activities/submit-review", payload, idempotencyKey);
}

export function requestActivityChanges(payload, idempotencyKey) {
  return write("/api/v1/admin/activities/request-changes", payload, idempotencyKey);
}

export function publishActivity(payload, idempotencyKey) {
  return write("/api/v1/admin/activities/publish", payload, idempotencyKey);
}

export function unpublishActivity(payload, idempotencyKey) {
  return write("/api/v1/admin/activities/unpublish", payload, idempotencyKey);
}

export function archiveActivity(payload, idempotencyKey) {
  return write("/api/v1/admin/activities/archive", payload, idempotencyKey);
}

export function createActivitySession(payload, idempotencyKey) {
  return write("/api/v1/admin/activity-sessions/create", payload, idempotencyKey);
}

export function updateActivitySessionState(payload, idempotencyKey) {
  return write("/api/v1/admin/activity-sessions/state", payload, idempotencyKey);
}

export function cancelActivitySession(payload, idempotencyKey) {
  return write("/api/v1/admin/activity-sessions/cancel", payload, idempotencyKey);
}

export function reviewActivityEnrollment(payload, idempotencyKey) {
  return write("/api/v1/admin/activity-enrollments/review", payload, idempotencyKey);
}
