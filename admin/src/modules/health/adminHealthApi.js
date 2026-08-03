import { adminRequest, postAdminJson } from "@/api/client";

function queryString(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) params.set(key, String(value).trim());
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

function saveDraft(path, prefix, input = {}) {
  const id = requestId(prefix);
  return postAdminJson(path, { ...input, requestId: id }, {
    headers: { "X-Request-Id": id, "X-Idempotency-Key": id },
  });
}

export function fetchInitializationQuestions(filters = {}, options = {}) {
  return adminRequest(`/api/v1/admin/formal-health/initialization${queryString(filters)}`, options);
}

export function saveInitializationDraft(input = {}) {
  return saveDraft("/api/v1/admin/formal-health/initialization/draft", "health-initialization-draft", input);
}

export function fetchHealthScales(filters = {}, options = {}) {
  return adminRequest(`/api/v1/admin/formal-health/scales${queryString(filters)}`, options);
}

export function saveHealthScaleDraft(input = {}) {
  return saveDraft("/api/v1/admin/formal-health/scales/draft", "health-scale-draft", input);
}

export function fetchRecommendationRules(filters = {}, options = {}) {
  return adminRequest(`/api/v1/admin/formal-health/recommendation-rules${queryString(filters)}`, options);
}

export function saveRecommendationRuleDraft(input = {}) {
  return saveDraft("/api/v1/admin/formal-health/recommendation-rules/draft", "health-recommendation-draft", input);
}

export function fetchLifestyleAdvicePolicies(filters = {}, options = {}) {
  return adminRequest(`/api/v1/admin/formal-health/lifestyle-advice${queryString(filters)}`, options);
}

export function saveLifestyleAdviceDraft(input = {}) {
  return saveDraft("/api/v1/admin/formal-health/lifestyle-advice/draft", "health-lifestyle-draft", input);
}
