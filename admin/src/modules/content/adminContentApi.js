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
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function write(path, input, prefix) {
  const attemptId = requestId(`${prefix}-attempt`);
  const idempotencyKey = requestId(`${prefix}-intent`);
  return postAdminJson(path, { ...input, requestId: attemptId }, {
    headers: {
      "X-Request-Id": attemptId,
      "X-Idempotency-Key": idempotencyKey,
    },
  });
}

export function fetchWelcomeContent() {
  return adminRequest("/api/v1/admin/content/welcome");
}

export function saveWelcomeDraft(input = {}) {
  return write("/api/v1/admin/content/welcome/draft", input, "welcome-draft");
}

export function fetchHomeCarousel(filters = {}, options = {}) {
  return adminRequest(`/api/v1/admin/content/home-carousel${queryString(filters)}`, options);
}

export function saveHomeCarouselDraft(input = {}) {
  return write("/api/v1/admin/content/home-carousel/draft", input, "home-carousel-draft");
}

export function fetchSharedDetails(filters = {}, options = {}) {
  return adminRequest(`/api/v1/admin/content/shared-details${queryString(filters)}`, options);
}

export function saveSharedDetailDraft(input = {}) {
  return write("/api/v1/admin/content/shared-details/draft", input, "shared-detail-draft");
}

export function validateContentTarget(input = {}) {
  return postAdminRead("/api/v1/admin/content/targets/validate", input);
}

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export async function uploadContentAsset(file, scope = "content") {
  if (!file || typeof file.arrayBuffer !== "function") throw new Error("请选择有效图片");
  const dataBase64 = bytesToBase64(await file.arrayBuffer());
  const result = await write("/api/v1/admin/content/assets", {
    scope,
    name: file.name,
    mimeType: file.type,
    dataBase64,
  }, "content-asset");
  return result.asset || result;
}

export function unpublishContentVersion(versionId) {
  return write("/api/v1/admin/content-release/unpublish", { versionId }, "content-unpublish");
}
