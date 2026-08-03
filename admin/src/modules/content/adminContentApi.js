import { adminRequest, postAdminForm, postAdminJson } from "@/api/client";

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
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function fetchWelcomeContent() {
  return adminRequest("/api/v1/admin/content/welcome");
}

export function saveWelcomeDraft(input = {}) {
  const id = requestId("welcome-draft");
  return postAdminJson("/api/v1/admin/content/welcome/draft", { ...input, requestId: id }, {
    headers: { "X-Request-Id": id },
  });
}

export function fetchHomeCarousel(filters = {}, options = {}) {
  return adminRequest(`/api/v1/admin/content/home-carousel${queryString(filters)}`, options);
}

export function saveHomeCarouselDraft(input = {}) {
  const id = requestId("home-carousel-draft");
  return postAdminJson("/api/v1/admin/content/home-carousel/draft", { ...input, requestId: id }, {
    headers: { "X-Request-Id": id },
  });
}

export function fetchSharedDetails(filters = {}, options = {}) {
  return adminRequest(`/api/v1/admin/content/shared-details${queryString(filters)}`, options);
}

export function saveSharedDetailDraft(input = {}) {
  const id = requestId("shared-detail-draft");
  return postAdminJson("/api/v1/admin/content/shared-details/draft", { ...input, requestId: id }, {
    headers: { "X-Request-Id": id },
  });
}

export function validateContentTarget(input = {}) {
  return postAdminJson("/api/v1/admin/content/targets/validate", input);
}

export function uploadContentAsset(file, scope = "content") {
  const id = requestId("content-asset");
  const form = new FormData();
  form.set("file", file);
  form.set("scope", scope);
  form.set("requestId", id);
  return postAdminForm("/api/v1/admin/content/assets", form, {
    headers: { "X-Request-Id": id },
  });
}
