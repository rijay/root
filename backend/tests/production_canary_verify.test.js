const assert = require("node:assert/strict");
const test = require("node:test");
const {
  determineExitCode,
  parseArgs,
  runCanaryVerification,
} = require("../../scripts/production-canary-verify");

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

function privacyNoticeResponse(version = "0.5.5", overrides = {}) {
  return jsonResponse(200, { code: 0, data: {
    service: "root-checkin",
    version,
    releaseId: version,
    configured: true,
    controllerName: "ROOT 测试主体",
    contact: "privacy@example.com",
    retentionDays: 180,
    policyVersion: "health-sensitive-2026-07-11-v1",
    ...overrides,
  } });
}

test("canary verifier attributes candidate health and executes the candidate-only object probe", async () => {
  const counts = { health: 0, ready: 0, object: 0 };
  const fetchImpl = async (url) => {
    const parsedUrl = new URL(url);
    const path = parsedUrl.pathname;
    assert.equal(parsedUrl.searchParams.get("myroot_candidate"), "v0.5.6");
    if (path === "/health") {
      counts.health += 1;
      if (counts.health === 1) return jsonResponse(200, { code: 0, data: { service: "root-checkin" } });
      return jsonResponse(200, { code: 0, data: { service: "root-checkin", version: "0.5.5", releaseId: "0.5.5" } });
    }
    if (path === "/ready") {
      counts.ready += 1;
      if (counts.ready === 1) return jsonResponse(200, { code: 0, data: { service: "root-checkin" } });
      return jsonResponse(200, { code: 0, data: { service: "root-checkin", version: "0.5.5", releaseId: "0.5.5", store: {
        kind: "mysql",
        connected: true,
        migrationVersion: "068_formal_launch_confirmed_prelaunch_cleanup.sql",
        leastPrivilegeReady: true,
        privilegeScope: "SCHEMA",
        privilegePolicyEnforced: true,
      } } });
    }
    if (path === "/api/v1/privacy/notice") return privacyNoticeResponse("0.5.5");
    counts.object += 1;
    if (counts.object === 1) return jsonResponse(404, { code: 404, message: "Not Found" });
    return jsonResponse(200, { code: 0, data: { probe: {
      status: "VERIFIED",
      provider: "CLOUDBASE",
      objectKey: "release-probes/2026-07-11/canary-object-1.json",
      uploadConfirmed: true,
      deleteConfirmed: true,
      residualObjectPossible: false,
      version: "0.5.5",
      releaseId: "0.5.5",
      requestId: "canary-object-1",
      checkedAt: "2026-07-11T21:00:00+08:00",
      error: "",
    } } });
  };
  const options = parseArgs([
    "--base-url", "https://root.example.com",
    "--expected-version", "0.5.5",
    "--attempts", "3",
    "--interval-ms", "0",
    "--execute-object-probe",
    "--object-probe-attempts", "3",
    "--request-id", "canary-object-1",
    "--route-query", "myroot_candidate=v0.5.6",
  ], { ROOT_ADMIN_TOKEN: "do-not-print" });
  const report = await runCanaryVerification(options, { fetchImpl });
  assert.equal(report.status, "PASS");
  assert.equal(report.trafficChanged, false);
  assert.equal(report.routeQueryConfigured, true);
  assert.equal(report.health.observedVersions.UNVERSIONED, 1);
  assert.equal(report.health.version, "0.5.5");
  assert.equal(report.ready.store.connected, true);
  assert.equal(report.ready.store.leastPrivilegeReady, true);
  assert.equal(report.ready.store.privilegeScope, "SCHEMA");
  assert.equal(report.privacyNotice.status, "PASS");
  assert.equal(report.privacyNotice.privacyNotice.contactValid, true);
  assert.equal(report.objectProbe.status, "PASS");
  assert.equal(report.objectProbe.stableNotFoundCount, 1);
  assert.equal(JSON.stringify(report).includes("do-not-print"), false);
  assert.equal(determineExitCode(report), 0);
});

test("canary verifier is read-only unless the object probe flag is explicit", async () => {
  const options = parseArgs([
    "--base-url", "https://root.example.com",
    "--expected-version", "0.5.5",
    "--attempts", "1",
    "--interval-ms", "0",
  ], {});
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    if (path === "/api/v1/privacy/notice") return privacyNoticeResponse("0.5.5");
    return jsonResponse(200, { code: 0, data: {
      service: "root-checkin",
      version: "0.5.5",
      releaseId: "0.5.5",
      ...(path === "/ready" ? { store: {
        kind: "mysql",
        connected: true,
        migrationVersion: "068_formal_launch_confirmed_prelaunch_cleanup.sql",
        leastPrivilegeReady: true,
        privilegeScope: "SCHEMA",
        privilegePolicyEnforced: true,
      } } : {}),
    } });
  };
  const report = await runCanaryVerification(options, { fetchImpl });
  assert.equal(report.status, "PASS");
  assert.equal(report.executeObjectProbe, false);
  assert.equal(report.privacyNotice.status, "PASS");
  assert.equal(report.objectProbe.status, "NOT_REQUESTED");
});

test("canary verifier blocks a candidate that has not applied the latest migration", async () => {
  const options = parseArgs([
    "--base-url", "https://root.example.com",
    "--expected-version", "0.5.6",
    "--attempts", "1",
    "--interval-ms", "0",
  ], {});
  const fetchImpl = async (url) => {
    const isReady = new URL(url).pathname === "/ready";
    return jsonResponse(200, { code: 0, data: {
      service: "root-checkin",
      version: "0.5.6",
      releaseId: "0.5.6",
      ...(isReady ? { store: {
        kind: "mysql",
        connected: true,
        migrationVersion: "003_privacy_consent.sql",
        leastPrivilegeReady: true,
        privilegeScope: "SCHEMA",
        privilegePolicyEnforced: true,
      } } : {}),
    } });
  };

  const report = await runCanaryVerification(options, { fetchImpl });

  assert.equal(report.status, "FAIL");
  assert.equal(report.ready.status, "FAIL");
  assert.match(report.ready.reason, /068_formal_launch_confirmed_prelaunch_cleanup\.sql/);
  assert.equal(determineExitCode(report), 3);
});

test("canary verifier blocks a MySQL candidate without enforced schema-scoped privilege proof", async () => {
  const options = parseArgs([
    "--base-url", "https://root.example.com",
    "--expected-version", "0.5.6",
    "--attempts", "1",
    "--interval-ms", "0",
  ], {});
  const fetchImpl = async (url) => {
    const isReady = new URL(url).pathname === "/ready";
    return jsonResponse(200, { code: 0, data: {
      service: "root-checkin",
      version: "0.5.6",
      releaseId: "0.5.6",
      ...(isReady ? { store: {
        kind: "mysql",
        connected: true,
        migrationVersion: "068_formal_launch_confirmed_prelaunch_cleanup.sql",
        leastPrivilegeReady: false,
        privilegeScope: "GLOBAL",
        privilegePolicyEnforced: false,
      } } : {}),
    } });
  };

  const report = await runCanaryVerification(options, { fetchImpl });

  assert.equal(report.status, "FAIL");
  assert.equal(report.ready.status, "FAIL");
  assert.match(report.ready.reason, /least-privilege/);
  assert.equal(determineExitCode(report), 3);
});

test("canary verifier blocks an incomplete public privacy notice", async () => {
  const options = parseArgs([
    "--base-url", "https://root.example.com",
    "--expected-version", "0.5.6",
    "--attempts", "1",
    "--interval-ms", "0",
  ], {});
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    if (path === "/api/v1/privacy/notice") {
      return privacyNoticeResponse("0.5.6", { configured: false, contact: "待确认", retentionDays: 0 });
    }
    return jsonResponse(200, { code: 0, data: {
      service: "root-checkin",
      version: "0.5.6",
      releaseId: "0.5.6",
      ...(path === "/ready" ? { store: {
        kind: "mysql",
        connected: true,
        migrationVersion: "068_formal_launch_confirmed_prelaunch_cleanup.sql",
        leastPrivilegeReady: true,
        privilegeScope: "SCHEMA",
        privilegePolicyEnforced: true,
      } } : {}),
    } });
  };

  const report = await runCanaryVerification(options, { fetchImpl });

  assert.equal(report.status, "FAIL");
  assert.equal(report.privacyNotice.status, "FAIL");
  assert.match(report.privacyNotice.reason, /incomplete/);
  assert.equal(determineExitCode(report), 5);
});
