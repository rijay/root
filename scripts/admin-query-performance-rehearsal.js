#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const { createApp } = require("../backend/src/app");
const { createStore } = require("../backend/src/domain");
const {
  FIXTURE_COUNTS,
  FIXTURE_VERSION,
  createAdminPerformanceFixture,
} = require("../backend/tests/fixtures/adminPerformanceFixture");

const DEFAULT_SAMPLES = 20;
const LOCAL_ENVIRONMENT = "local-fixed-fixture";
const ADMIN_TOKEN = "local-performance-rehearsal-token";
const ASSET_ID = "perf-asset-home";

function rows(count, create) {
  return Array.from({ length: count }, (_, index) => create(index + 1));
}

function createRehearsalStore() {
  const approved = createAdminPerformanceFixture();
  const store = createStore();
  store.users = approved.users.map((user, index) => ({
    ...user,
    user_id: `perf-user-row-${String(index + 1).padStart(5, "0")}`,
    nickname: "Root用户",
    created_at: "2026-08-04T00:00:00.000Z",
  }));
  store.formalProfiles = [];
  store.activityEnrollments = approved.activityEnrollments;
  store.auditLogs = approved.auditLogs.map((entry) => ({
    ...entry,
    target_type: "ADMIN_PERFORMANCE_FIXTURE",
    target_id: entry.audit_log_id,
    operator_id: "fixture-operator",
    metadata: {},
  }));
  store.contentAssets = [{
    content_asset_id: ASSET_ID,
    scope: "home-carousel",
    name: "performance-fixture.png",
    mime_type: "image/png",
    byte_size: 68,
    width: 1,
    height: 1,
    data_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    state: "AUTHORIZED",
    created_at: "2026-08-04T00:00:00.000Z",
    created_by: "fixture-operator",
  }];
  store.contentVersions = rows(FIXTURE_COUNTS.contentVersions, (number) => ({
    content_version_id: `perf-content-${String(number).padStart(4, "0")}`,
    versionId: `perf-content-${String(number).padStart(4, "0")}`,
    logicalId: `PERF_HOME_${String(number).padStart(4, "0")}`,
    type: "HOME_CAROUSEL",
    version: 1,
    revision: 1,
    status: number % 5 ? "PUBLISHED" : "DRAFT",
    sourceVersionId: "",
    content: {
      order: number,
      internalName: `性能样本 ${number}`,
      copy: "保持节奏\n理解身体",
      assetId: ASSET_ID,
      lineCount: 2,
      fontSize: "LARGE",
      alignment: "CENTER",
      sharedDetailVersionId: "",
      startsAt: "2026-08-01T00:00:00.000Z",
      endsAt: "2099-01-01T00:00:00.000Z",
    },
    validation: { status: "PASS", issues: [] },
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
    createdBy: "fixture-operator",
    updatedBy: "fixture-operator",
  }));
  store.healthContentVersions = rows(FIXTURE_COUNTS.scaleQuestions, (number) => ({
    health_content_version_id: `perf-scale-question-${String(number).padStart(3, "0")}`,
    type: "SCALE_QUESTION",
    status: "PUBLISHED",
  }));
  return store;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    if (!server.listening) return resolve();
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function measuredRequest(baseUrl, version, scenario, route, options = {}) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${route}`, options);
  const text = await response.text();
  const durationMs = Number((performance.now() - startedAt).toFixed(3));
  let body;
  try {
    body = JSON.parse(text);
  } catch (error) {
    throw new Error(`${scenario} returned non-JSON response`);
  }
  if (!response.ok || (body && body.code !== undefined && body.code !== 0)) {
    throw new Error(`${scenario} failed with HTTP ${response.status} / code ${body && body.code}`);
  }
  return {
    version,
    environment: LOCAL_ENVIRONMENT,
    datasetVersion: FIXTURE_VERSION,
    scenario,
    durationMs,
    responseBytes: Buffer.byteLength(text),
  };
}

function requestHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    "X-Admin-Token": ADMIN_TOKEN,
    ...extra,
  };
}

async function collectAdminQueryRehearsal(options = {}) {
  const samples = Number(options.samples || DEFAULT_SAMPLES);
  if (!Number.isInteger(samples) || samples < 1 || samples > 100) {
    throw new Error("samples must be an integer between 1 and 100");
  }
  const version = String(options.version || "local-0.5.13").trim();
  if (!version) throw new Error("version is required");
  const store = createRehearsalStore();
  const server = createApp({
    store,
    env: {
      NODE_ENV: "test",
      ROOT_REQUIRE_ADMIN_TOKEN: "true",
      ROOT_ADMIN_TOKENS: JSON.stringify({ rehearsal: { token: ADMIN_TOKEN, role: "admin" } }),
    },
  });
  const baseUrl = await listen(server);
  const events = [];
  const scenarios = [
    {
      name: "list",
      route: "/api/v1/admin/content/home-carousel?page=1&pageSize=20",
      options: { headers: requestHeaders() },
    },
    {
      name: "detail",
      route: "/api/v1/admin/formal-users/query",
      options: {
        method: "POST",
        headers: requestHeaders(),
        body: JSON.stringify({ phone: approvedPhone(store) }),
      },
    },
    {
      name: "audit",
      route: "/api/v1/admin/audit-logs?page=1&pageSize=20",
      options: { headers: requestHeaders() },
    },
  ];
  try {
    for (const scenario of scenarios) {
      for (let index = 0; index < samples; index += 1) {
        events.push(await measuredRequest(baseUrl, version, scenario.name, scenario.route, scenario.options));
      }
    }
    for (let index = 0; index < samples; index += 1) {
      const requestId = `perf-write-${String(index + 1).padStart(3, "0")}`;
      const existingDraft = store.contentVersions.find((row) => row.type === "WELCOME"
        && row.status === "DRAFT"
        && row.content.slot === 1);
      events.push(await measuredRequest(
        baseUrl,
        version,
        "write",
        "/api/v1/admin/content/welcome/draft",
        {
          method: "POST",
          headers: requestHeaders({
            "X-Request-Id": requestId,
            "X-Idempotency-Key": `${requestId}-intent`,
          }),
          body: JSON.stringify({
            ...(existingDraft ? { id: existingDraft.versionId, expectedRevision: existingDraft.revision } : {}),
            slot: 1,
            copy: "欢迎加入 Root Member Club",
            assetId: ASSET_ID,
          }),
        }
      ));
    }
  } finally {
    await close(server);
  }
  return events;
}

function approvedPhone(store) {
  const phone = store.users && store.users[0] && store.users[0].phone;
  if (!/^1\d{10}$/.test(String(phone || ""))) throw new Error("approved fixture phone missing");
  return phone;
}

function parseArgs(argv) {
  const options = { outputPath: "", samples: DEFAULT_SAMPLES, version: "local-0.5.13" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--output") options.outputPath = argv[++index];
    else if (value === "--samples") options.samples = Number(argv[++index]);
    else if (value === "--version") options.version = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const events = await collectAdminQueryRehearsal(options);
  const output = `${JSON.stringify(events, null, 2)}\n`;
  if (options.outputPath) {
    const target = path.resolve(options.outputPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, output, "utf8");
  } else {
    process.stdout.write(output);
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`Admin query rehearsal failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  collectAdminQueryRehearsal,
  createRehearsalStore,
  measuredRequest,
  parseArgs,
};
