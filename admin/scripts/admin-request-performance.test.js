import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = {
  location: {
    origin: "https://admin.example.com",
    search: "",
  },
  sessionStorage: {
    getItem() { return null; },
    setItem() {},
    removeItem() {},
  },
};

const {
  ADMIN_READ_TIMEOUT_MS,
  ADMIN_WRITE_TIMEOUT_MS,
  MAX_CONCURRENT_ADMIN_READS,
  adminRequest,
  postAdminRead,
} = await import("../src/api/client.js");

function ok(data = {}) {
  return { status: 200, ok: true, async json() { return { code: 0, data }; } };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("approved read/write timeouts and per-browser read concurrency are fixed", () => {
  assert.equal(ADMIN_READ_TIMEOUT_MS, 8000);
  assert.equal(ADMIN_WRITE_TIMEOUT_MS, 15000);
  assert.equal(MAX_CONCURRENT_ADMIN_READS, 4);
});

test("at most four distinct admin reads execute concurrently", async () => {
  let active = 0;
  let maximumActive = 0;
  const releases = [];
  globalThis.fetch = async () => new Promise((resolve) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    releases.push(() => {
      active -= 1;
      resolve(ok());
    });
  });

  const requests = Array.from({ length: 6 }, (_, index) => adminRequest(`/read/${index}`));
  await nextTurn();
  assert.equal(releases.length, 4);
  assert.equal(maximumActive, 4);
  releases.splice(0, 2).forEach((release) => release());
  await nextTurn();
  assert.equal(releases.length, 4);
  releases.splice(0).forEach((release) => release());
  await Promise.all(requests);
  assert.equal(maximumActive, 4);
});

test("identical GET and read-only POST calls share one in-flight request", async () => {
  let calls = 0;
  let release;
  globalThis.fetch = async () => {
    calls += 1;
    return new Promise((resolve) => { release = () => resolve(ok({ shared: true })); });
  };
  const first = postAdminRead("/query", { page: 1, pageSize: 20 });
  const second = postAdminRead("/query", { page: 1, pageSize: 20 });
  await nextTurn();
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await Promise.all([first, second]), [{ shared: true }, { shared: true }]);
});

test("cancelling one duplicate read does not cancel the remaining subscriber", async () => {
  let release;
  let underlyingSignal;
  globalThis.fetch = async (_path, options) => {
    underlyingSignal = options.signal;
    return new Promise((resolve) => { release = () => resolve(ok({ retained: true })); });
  };
  const controller = new AbortController();
  const cancelled = adminRequest("/shared-cancel", { signal: controller.signal });
  const retained = adminRequest("/shared-cancel");
  await nextTurn();
  controller.abort();
  await assert.rejects(cancelled, (error) => error.code === "ADMIN_ABORTED" && !error.outcomeUnknown);
  assert.equal(underlyingSignal.aborted, false);
  release();
  assert.deepEqual(await retained, { retained: true });
});

test("writes are never automatically deduplicated", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return ok({ saved: true });
  };
  await Promise.all([
    adminRequest("/write", { method: "POST", body: "{}" }),
    adminRequest("/write", { method: "POST", body: "{}" }),
  ]);
  assert.equal(calls, 2);
});
