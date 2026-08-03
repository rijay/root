import test from "node:test";
import assert from "node:assert/strict";

const storage = new Map();
globalThis.window = {
  sessionStorage: {
    getItem(key) { return storage.get(key) || null; },
    setItem(key, value) { storage.set(key, value); },
    removeItem(key) { storage.delete(key); },
  },
};

const { adminRequest, getAdminToken, postAdminRead, setAdminToken } = await import("../src/api/client.js");

function response(payload, { status = 200, ok = status >= 200 && status < 300 } = {}) {
  return { status, ok, async json() { return payload; } };
}

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
