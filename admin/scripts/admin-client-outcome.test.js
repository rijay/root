import test from "node:test";
import assert from "node:assert/strict";

const storage = new Map();
globalThis.window = {
  location: {
    origin: "https://admin.example.com",
    search: "",
  },
  sessionStorage: {
    getItem(key) { return storage.get(key) || null; },
    setItem(key, value) { storage.set(key, value); },
    removeItem(key) { storage.delete(key); },
  },
};

const {
  adminRequest,
  candidateAdminRequestPath,
  getAdminToken,
  postAdminForm,
  postAdminRead,
  setAdminToken,
} = await import("../src/api/client.js");

function response(payload, { status = 200, ok = status >= 200 && status < 300 } = {}) {
  return { status, ok, async json() { return payload; } };
}

test("candidate admin requests preserve the private candidate route on every API call", () => {
  globalThis.window.location.search = "?module=welcome&myroot_canary=candidateRoute42";
  assert.equal(
    candidateAdminRequestPath("/api/v1/admin/content/home-carousel?page=1&pageSize=20"),
    "/api/v1/admin/content/home-carousel?page=1&pageSize=20&myroot_canary=candidateRoute42",
  );
  globalThis.window.location.search = "";
});

test("invalid candidate route values are not forwarded", () => {
  globalThis.window.location.search = "?myroot_canary=invalid%20route";
  assert.equal(candidateAdminRequestPath("/api/v1/admin/me"), "/api/v1/admin/me");
  globalThis.window.location.search = "";
});

for (const payload of [{}, [], { code: "0", data: {} }]) {
  test(`a parseable invalid POST envelope remains outcome-unknown: ${JSON.stringify(payload)}`, async () => {
    globalThis.fetch = async () => response(payload);
    await assert.rejects(
      adminRequest("/write", { method: "POST" }),
      (error) => error.code === "ADMIN_RESPONSE_INVALID" && error.outcomeUnknown === true,
    );
  });
}

test("a structured 4xx business rejection is definitive", async () => {
  globalThis.fetch = async () => response({ code: 40001, message: "invalid" }, { status: 400, ok: false });
  await assert.rejects(
    adminRequest("/write", { method: "POST" }),
    (error) => error.code === 40001 && error.outcomeUnknown === false,
  );
});

test("a stable string 409 business code remains definitive", async () => {
  globalThis.fetch = async () => response({
    code: "CONTENT_REVISION_CONFLICT",
    message: "内容已被其他运营更新，请刷新后重试",
  }, { status: 409, ok: false });
  await assert.rejects(
    adminRequest("/write", { method: "POST" }),
    (error) => error.code === "CONTENT_REVISION_CONFLICT"
      && error.message === "内容已被其他运营更新，请刷新后重试"
      && error.outcomeUnknown === false,
  );
});

test("a structured 5xx write response remains outcome-unknown", async () => {
  globalThis.fetch = async () => response({ code: 50001, message: "failed" }, { status: 503, ok: false });
  await assert.rejects(
    adminRequest("/write", { method: "POST" }),
    (error) => error.code === 50001 && error.outcomeUnknown === true,
  );
});

test("a POST read failure is definitive and does not leak its body into the URL", async () => {
  let requestedPath = "";
  globalThis.fetch = async (path) => {
    requestedPath = path;
    throw new Error("network failed");
  };
  await assert.rejects(
    postAdminRead("/api/v1/admin/formal-users/query", { phone: "13800138000" }),
    (error) => error.code === "ADMIN_NETWORK_ERROR" && error.outcomeUnknown === false,
  );
  assert.equal(requestedPath, "/api/v1/admin/formal-users/query");
  assert.equal(requestedPath.includes("13800138000"), false);
});

test("multipart upload lets the runtime supply its content boundary", async () => {
  let requestOptions;
  globalThis.fetch = async (_path, options) => {
    requestOptions = options;
    return response({ code: 0, data: { assetId: "asset-1" } });
  };
  const form = new FormData();
  form.set("scope", "content");
  const result = await postAdminForm("/api/v1/admin/content/assets", form);
  assert.equal(result.assetId, "asset-1");
  assert.equal(Object.hasOwn(requestOptions.headers, "Content-Type"), false);
});

test("a stalled POST response body times out as outcome-unknown", async () => {
  globalThis.fetch = async (_path, options) => ({
    status: 200,
    ok: true,
    json() {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    },
  });
  await assert.rejects(
    adminRequest("/write", { method: "POST", timeoutMs: 5 }),
    (error) => error.code === "ADMIN_RESPONSE_INVALID" && error.outcomeUnknown === true,
  );
});

test("a caller-cancelled read is definitive and distinguishable from a network failure", async () => {
  globalThis.fetch = async (_path, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  const controller = new AbortController();
  const request = adminRequest("/api/v1/admin/content/home-carousel", { signal: controller.signal });
  controller.abort();
  await assert.rejects(
    request,
    (error) => error.code === "ADMIN_ABORTED" && error.outcomeUnknown === false,
  );
});

test("admin token falls back to session memory when storage is blocked", () => {
  Object.defineProperty(globalThis.window, "sessionStorage", {
    configurable: true,
    get() { throw new Error("storage blocked"); },
  });
  assert.doesNotThrow(() => setAdminToken("token-in-session"));
  assert.equal(getAdminToken(), "token-in-session");
});

test("a readable cross-tab token deletion does not reuse stale session memory", () => {
  Object.defineProperty(globalThis.window, "sessionStorage", {
    configurable: true,
    value: {
      getItem() { return null; },
      setItem() {},
      removeItem() {},
    },
  });
  assert.equal(getAdminToken(), "");
});
