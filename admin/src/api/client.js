const ADMIN_TOKEN_KEY = "ROOT_ADMIN_TOKEN";

export function getAdminToken() {
  return window.localStorage.getItem(ADMIN_TOKEN_KEY) || "";
}

export function setAdminToken(token) {
  const value = String(token || "").trim();
  if (value) {
    window.localStorage.setItem(ADMIN_TOKEN_KEY, value);
  } else {
    window.localStorage.removeItem(ADMIN_TOKEN_KEY);
  }
}

export async function adminRequest(path, options = {}) {
  const adminToken = getAdminToken();
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(adminToken ? { "X-Admin-Token": adminToken, "X-ROOT-ADMIN-TOKEN": adminToken } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json();
  if (payload.code !== 0) {
    throw new Error(payload.message || "后台 Interface 返回异常");
  }
  return payload.data;
}

export function fetchAdminProfile() {
  return adminRequest("/api/v1/admin/me");
}

export function postAdminJson(path, body, options = {}) {
  return adminRequest(path, {
    ...options,
    method: "POST",
    headers: options.headers || {},
    body: JSON.stringify(body || {}),
  });
}
