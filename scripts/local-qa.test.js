const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLocalServer } = require("./dev-local");

test("mini-program request and assessment Modules complete a persistent local journey", { timeout: 20000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "myroot-local-qa-"));
  let server;
  const start = async () => {
    server = createLocalServer({ directory });
    await server.readyPromise;
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    return `http://127.0.0.1:${server.address().port}`;
  };
  const stop = async () => {
    if (!server) return;
    await new Promise((resolve) => { server.close(resolve); server.closeIdleConnections(); });
    server.storeAdapter.close();
    server = null;
  };
  t.after(async () => { await stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  let baseUrl = await start();
  const storage = new Map();
  const oldWx = global.wx;
  const oldGetApp = global.getApp;
  const app = { globalData: {} };
  global.getApp = () => app;
  global.wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }),
    getDeviceInfo: () => ({ platform: "devtools" }),
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    request(options) {
      const url = new URL(options.url);
      assert.equal(url.origin, "http://127.0.0.1:8787");
      // The wx transport is replaced; the mini-program Modules, HTTP API and SQLite are real.
      const controller = new AbortController();
      fetch(`${baseUrl}${url.pathname}${url.search}`, {
        method: options.method, headers: options.header,
        body: ["GET", "HEAD"].includes(options.method) ? undefined : JSON.stringify(options.data),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(options.timeout)]),
      }).then(async (response) => options.success({ statusCode: response.status, data: await response.json() }))
        .catch((error) => options.fail(error));
      return { abort: () => controller.abort() };
    },
  };
  const transport = require("../miniprogram/utils/request");
  const assessment = require("../miniprogram/utils/health-assessment");
  t.after(() => { transport.resetRequestStateForTests(); global.wx = oldWx; global.getApp = oldGetApp; });
  const request = transport.request;
  const post = (url, data) => request({ url, method: "POST", data });

  const ready = await request({ url: "/ready" });
  assert.equal(ready.store.connected, true);
  assert.equal(ready.store.kind, "sqlite");
  const login = await post("/api/v1/auth/login", { openid: "local-qa-synthetic-user", appCode: "MYROOT" });
  transport.setToken(login.token);
  await assert.rejects(assessment.startAssessment("GUT_REGULARITY"), (error) => error.code === 45101);
  const consent = await request({ url: "/api/v1/privacy/health-consent" });
  await post("/api/v1/privacy/health-consent", { decision: "GRANTED", policyVersion: consent.notice.policyVersion });
  const started = await assessment.startAssessment("GUT_REGULARITY");
  const id = started.assessment.assessmentId;
  const answers = { Q1: "A", Q2: "B", Q3: ["A"], Q4: ["A"], Q5: ["A"] };
  await assessment.saveDraft(id, answers);
  const completed = await assessment.completeAssessment(id, answers);
  assert.equal(completed.assessment.status, "COMPLETED");
  assert.equal(completed.assessment.result.resultCode, "HEALTHY");
  assert.equal((await assessment.completeAssessment(id, answers)).assessment.assessmentId, id);

  await stop();
  baseUrl = await start();
  transport.resetRequestStateForTests();
  const history = await assessment.getHistory("GUT_REGULARITY");
  assert.equal(history.total, 1);
  assert.equal(history.assessments[0].assessmentId, id);
  const labels = await post("/api/v1/admin/user-labels/query", { userId: login.identity.rootUserId, includeHealth: true });
  assert.equal(labels.total, 1);
  assert.equal(labels.rows[0].health.status, "已完成");
  assert.equal(labels.rows[0].health.baseline.assessmentId, id);
  assert.equal(labels.healthExternalSyncAllowed, false);
  await post("/api/v1/privacy/health-consent", { decision: "WITHDRAWN", policyVersion: consent.notice.policyVersion });
  await assert.rejects(assessment.startAssessment("GUT_REGULARITY"), (error) => error.code === 45101);
  const after = await post("/api/v1/admin/user-labels/query", { userId: login.identity.rootUserId, includeHealth: true });
  assert.equal(after.rows[0].health.status, "已撤回");
  assert.equal(after.rows[0].health.baseline, null);
});
