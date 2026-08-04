#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const budgets = require("../admin/config/performance-budgets.json");
const { createApp } = require("../backend/src/app");
const { createMemoryStore } = require("../backend/src/store");
const { FIXTURE_VERSION } = require("../backend/tests/fixtures/adminPerformanceFixture");
const { createRehearsalStore } = require("./admin-query-performance-rehearsal");

const LOCAL_ENVIRONMENT = "local-fixed-fixture";
const DEFAULT_VERSION = "local-0.5.13";
const BARRIER_TIMEOUT_MS = 2000;

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

function withTimeout(promise, timeoutMs, message) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeout));
}

function createTrackedStoreAdapter(store) {
  const base = createMemoryStore(store, { seedSampleData: false });
  let activeReads = 0;
  let maximumConcurrentReads = 0;
  let barrier = null;

  return {
    adapter: {
      ...base,
      async runRequest(options, execute) {
        if (options.write) return execute(base.data);
        activeReads += 1;
        maximumConcurrentReads = Math.max(maximumConcurrentReads, activeReads);
        const currentBarrier = barrier;
        try {
          if (currentBarrier) {
            currentBarrier.arrivals += 1;
            if (currentBarrier.arrivals === currentBarrier.expected) {
              barrier = null;
              currentBarrier.release();
            }
            await withTimeout(
              currentBarrier.promise,
              BARRIER_TIMEOUT_MS,
              `read barrier received ${currentBarrier.arrivals}/${currentBarrier.expected} requests`,
            );
          }
          return await execute(base.data);
        } finally {
          activeReads -= 1;
        }
      },
    },
    armReadBarrier(expected) {
      assert.equal(barrier, null, "read barrier is already armed");
      let release;
      const promise = new Promise((resolve) => { release = resolve; });
      barrier = { expected, arrivals: 0, promise, release };
    },
    metrics() {
      return { activeReads, maximumConcurrentReads };
    },
  };
}

function createSessions() {
  return Array.from({ length: budgets.capacity.maximumSessions }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return {
      id: `session-${number}`,
      operatorId: `rehearsal-operator-${number}`,
      token: `local-capacity-${number}-secret`,
      activeReads: 0,
      maximumConcurrentReads: 0,
    };
  });
}

function adminTokens(sessions) {
  return Object.fromEntries(sessions.map((session) => [session.operatorId, {
    token: session.token,
    role: "admin",
  }]));
}

async function request(baseUrl, session, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Token": session.token,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch (_) {
    throw new Error(`${route} returned non-JSON response`);
  }
  return { status: response.status, body };
}

function requireSuccess(result, label) {
  assert.equal(result.status, 200, `${label} HTTP status`);
  assert.equal(result.body.code, 0, `${label} response code`);
  return result.body.data;
}

async function trackedRead(baseUrl, session, route) {
  session.activeReads += 1;
  session.maximumConcurrentReads = Math.max(session.maximumConcurrentReads, session.activeReads);
  try {
    return await request(baseUrl, session, route);
  } finally {
    session.activeReads -= 1;
  }
}

function commandOptions(id, body) {
  return {
    method: "POST",
    headers: {
      "X-Request-Id": id,
      "X-Idempotency-Key": `${id}-intent`,
    },
    body: JSON.stringify(body),
  };
}

function homeDraftInput(overrides = {}) {
  return {
    order: 1,
    internalName: "本地并发预演首页",
    copy: "理解身体\n保持节奏",
    assetId: "perf-asset-home",
    lineCount: 2,
    fontSize: "LARGE",
    alignment: "CENTER",
    sharedDetailVersionId: "local-rehearsal-detail",
    scheduleRange: ["2026-08-04T00:00:00.000Z", "2099-01-01T00:00:00.000Z"],
    ...overrides,
  };
}

function scaleDraftInput(overrides = {}) {
  return {
    name: "Root 本地节律评测",
    questionSummary: "1 道单选题；预计 1 分钟完成",
    scoringSummary: "总分 0–1；分为两层",
    audience: "ADULT_18_PLUS",
    questions: [{
      id: "rhythm",
      title: "过去一周，你的日常节律是否稳定？",
      type: "SINGLE",
      required: true,
      options: [
        { value: "steady", label: "大多稳定", score: 0 },
        { value: "variable", label: "波动较多", score: 1 },
      ],
    }],
    resultLevels: [
      { id: "steady", minScore: 0, maxScore: 0, title: "节律较稳", summary: "当前节律相对稳定。", tips: ["继续保持固定起床时间"] },
      { id: "variable", minScore: 1, maxScore: 1, title: "留意波动", summary: "近期节律有一些波动。", tips: ["先记录一周作息时间"] },
    ],
    adviceVersionId: "ROOT4U_FIXED_CONTENT_V1",
    approver: "本地预演",
    effectiveAt: "2026-08-05T00:00:00.000Z",
    ...overrides,
  };
}

function findVersion(data, versionId) {
  return (data.items || []).find((item) => item.versionId === versionId);
}

async function rehearseCapacity(baseUrl, sessions, tracker) {
  const total = budgets.capacity.maximumConcurrentReadsAcrossSessions;
  assert.equal(total % sessions.length, 0, "approved concurrent read budget must divide across sessions");
  const readsPerSession = total / sessions.length;
  assert.ok(readsPerSession <= budgets.network.maxConcurrentReadsPerBrowser, "session read plan exceeds browser limit");
  const routes = [
    "/api/v1/admin/content/home-carousel?page=1&pageSize=20",
    "/api/v1/admin/audit-logs?page=1&pageSize=20",
  ];
  assert.equal(readsPerSession, routes.length, "capacity rehearsal route count must match approved budget");

  tracker.armReadBarrier(total);
  const responses = await Promise.all(sessions.flatMap((session) => routes.map((route) => trackedRead(baseUrl, session, route))));
  responses.forEach((response, index) => requireSuccess(response, `capacity read ${index + 1}`));
  const observed = tracker.metrics();
  assert.equal(observed.activeReads, 0);
  assert.equal(observed.maximumConcurrentReads, total);
  sessions.forEach((session) => {
    assert.ok(session.maximumConcurrentReads <= budgets.network.maxConcurrentReadsPerBrowser);
  });
  return {
    sessionCount: sessions.length,
    readsPerSession,
    requestedConcurrentReads: total,
    observedMaximumConcurrentReads: observed.maximumConcurrentReads,
    maximumConcurrentReadsPerSession: Object.fromEntries(sessions.map((session) => [session.id, session.maximumConcurrentReads])),
    perSessionLimit: budgets.network.maxConcurrentReadsPerBrowser,
    aggregateLimit: total,
    successfulResponses: responses.length,
    status: "PASS",
  };
}

async function rehearseHomeConflict(baseUrl, firstOperator, secondOperator) {
  const created = requireSuccess(await request(
    baseUrl,
    firstOperator,
    "/api/v1/admin/content/home-carousel/draft",
    commandOptions("capacity-content-create", homeDraftInput()),
  ), "content draft create").version;
  const [firstRead, secondRead] = await Promise.all([
    trackedRead(baseUrl, firstOperator, "/api/v1/admin/content/home-carousel?page=1&pageSize=50"),
    trackedRead(baseUrl, secondOperator, "/api/v1/admin/content/home-carousel?page=1&pageSize=50"),
  ]);
  const firstSnapshot = findVersion(requireSuccess(firstRead, "content first operator read"), created.versionId);
  const secondSnapshot = findVersion(requireSuccess(secondRead, "content second operator read"), created.versionId);
  assert.equal(firstSnapshot.revision, secondSnapshot.revision);

  const winnerName = "本地并发预演首页 · 运营甲";
  const staleName = "本地并发预演首页 · 运营乙";
  const firstWrite = await request(
    baseUrl,
    firstOperator,
    "/api/v1/admin/content/home-carousel/draft",
    commandOptions("capacity-content-first-write", homeDraftInput({
      versionId: created.versionId,
      expectedRevision: firstSnapshot.revision,
      internalName: winnerName,
    })),
  );
  const winningVersion = requireSuccess(firstWrite, "content first write").version;
  const staleWrite = await request(
    baseUrl,
    secondOperator,
    "/api/v1/admin/content/home-carousel/draft",
    commandOptions("capacity-content-stale-write", homeDraftInput({
      versionId: created.versionId,
      expectedRevision: secondSnapshot.revision,
      internalName: staleName,
    })),
  );
  assert.equal(staleWrite.status, 409);
  assert.equal(staleWrite.body.code, "CONTENT_REVISION_CONFLICT");

  const authority = findVersion(requireSuccess(await trackedRead(
    baseUrl,
    firstOperator,
    "/api/v1/admin/content/home-carousel?page=1&pageSize=50",
  ), "content authoritative read"), created.versionId);
  assert.equal(authority.revision, winningVersion.revision);
  assert.equal(authority.internalName, winnerName);
  assert.notEqual(authority.internalName, staleName);
  return {
    scenario: "HOME_CAROUSEL_DRAFT",
    operatorCount: 2,
    startingRevision: firstSnapshot.revision,
    winningRevision: authority.revision,
    staleWriteHttpStatus: staleWrite.status,
    staleWriteErrorCode: staleWrite.body.code,
    refreshInstruction: staleWrite.body.message,
    authoritativeWinnerPreserved: true,
    status: "PASS",
  };
}

async function rehearseHealthConflict(baseUrl, firstOperator, secondOperator) {
  const created = requireSuccess(await request(
    baseUrl,
    firstOperator,
    "/api/v1/admin/formal-health/scales/draft",
    commandOptions("capacity-health-create", scaleDraftInput()),
  ), "health draft create").version;
  const [firstRead, secondRead] = await Promise.all([
    trackedRead(baseUrl, firstOperator, "/api/v1/admin/formal-health/scales?page=1&pageSize=50"),
    trackedRead(baseUrl, secondOperator, "/api/v1/admin/formal-health/scales?page=1&pageSize=50"),
  ]);
  const firstSnapshot = findVersion(requireSuccess(firstRead, "health first operator read"), created.versionId);
  const secondSnapshot = findVersion(requireSuccess(secondRead, "health second operator read"), created.versionId);
  assert.equal(firstSnapshot.revision, secondSnapshot.revision);

  const winnerName = "Root 本地节律评测 · 运营甲";
  const staleName = "Root 本地节律评测 · 运营乙";
  const firstWrite = await request(
    baseUrl,
    firstOperator,
    "/api/v1/admin/formal-health/scales/draft",
    commandOptions("capacity-health-first-write", scaleDraftInput({
      versionId: created.versionId,
      expectedRevision: firstSnapshot.revision,
      name: winnerName,
    })),
  );
  const winningVersion = requireSuccess(firstWrite, "health first write").version;
  const staleWrite = await request(
    baseUrl,
    secondOperator,
    "/api/v1/admin/formal-health/scales/draft",
    commandOptions("capacity-health-stale-write", scaleDraftInput({
      versionId: created.versionId,
      expectedRevision: secondSnapshot.revision,
      name: staleName,
    })),
  );
  assert.equal(staleWrite.status, 409);
  assert.equal(staleWrite.body.code, "HEALTH_CONTENT_REVISION_CONFLICT");

  const authority = findVersion(requireSuccess(await trackedRead(
    baseUrl,
    firstOperator,
    "/api/v1/admin/formal-health/scales?page=1&pageSize=50",
  ), "health authoritative read"), created.versionId);
  assert.equal(authority.revision, winningVersion.revision);
  assert.equal(authority.name, winnerName);
  assert.notEqual(authority.name, staleName);
  return {
    scenario: "HEALTH_SCALE_DRAFT",
    operatorCount: 2,
    startingRevision: firstSnapshot.revision,
    winningRevision: authority.revision,
    staleWriteHttpStatus: staleWrite.status,
    staleWriteErrorCode: staleWrite.body.code,
    refreshInstruction: staleWrite.body.message,
    authoritativeWinnerPreserved: true,
    status: "PASS",
  };
}

async function collectAdminCapacityConflictRehearsal(options = {}) {
  const version = String(options.version || DEFAULT_VERSION).trim();
  if (!version) throw new Error("version is required");
  const store = createRehearsalStore();
  const sessions = createSessions();
  const tracker = createTrackedStoreAdapter(store);
  const server = createApp({
    storeAdapter: tracker.adapter,
    env: {
      NODE_ENV: "test",
      ROOT_REQUIRE_ADMIN_TOKEN: "true",
      ROOT_ADMIN_TOKENS: JSON.stringify(adminTokens(sessions)),
    },
  });
  const baseUrl = await listen(server);
  try {
    const capacity = await rehearseCapacity(baseUrl, sessions, tracker);
    const conflicts = [
      await rehearseHomeConflict(baseUrl, sessions[0], sessions[1]),
      await rehearseHealthConflict(baseUrl, sessions[0], sessions[1]),
    ];
    assert.equal(conflicts.filter((item) => item.status === "PASS").length, 2);
    return {
      schemaVersion: 1,
      evidenceClass: "LOCAL_REHEARSAL",
      version,
      environment: LOCAL_ENVIRONMENT,
      datasetVersion: FIXTURE_VERSION,
      capacity,
      conflicts,
      summary: {
        conflictScenarios: conflicts.length,
        status: "PASS",
      },
      limitations: [
        "LOCAL_HTTP_ONLY",
        "NOT_BROWSER_SESSION_EVIDENCE",
        "NOT_CANDIDATE_GATE_EVIDENCE",
        "NOT_PRODUCTION_EVIDENCE",
      ],
    };
  } finally {
    await close(server);
  }
}

function parseArgs(argv) {
  const options = { outputPath: "", version: DEFAULT_VERSION };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--output") options.outputPath = argv[++index];
    else if (value === "--version") options.version = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const evidence = await collectAdminCapacityConflictRehearsal(options);
  const output = `${JSON.stringify(evidence, null, 2)}\n`;
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
    process.stderr.write(`Admin capacity/conflict rehearsal failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  collectAdminCapacityConflictRehearsal,
  createSessions,
  createTrackedStoreAdapter,
  parseArgs,
};
