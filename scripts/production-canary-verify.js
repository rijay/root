#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { isValidPrivacyContact } = require("../backend/src/privacyConfig");

function latestMigrationVersion() {
  const migrationsDir = path.join(__dirname, "..", "backend", "db", "migrations");
  return fs.readdirSync(migrationsDir)
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/i.test(name))
    .sort()
    .at(-1) || "";
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const args = {
    baseUrl: text(env.ROOT_PUBLIC_BASE_URL),
    expectedVersion: text(env.ROOT_CANARY_EXPECTED_VERSION),
    expectedReleaseId: text(env.ROOT_CANARY_EXPECTED_RELEASE_ID),
    stableReleaseId: text(env.ROOT_CANARY_STABLE_RELEASE_ID),
    expectedStoreKind: text(env.ROOT_CANARY_EXPECTED_STORE_KIND, "mysql").toLowerCase(),
    expectedMigrationVersion: text(env.ROOT_CANARY_EXPECTED_MIGRATION_VERSION, latestMigrationVersion()),
    attempts: 120,
    defaultProtectionAttempts: 15,
    intervalMs: 100,
    timeoutMs: 5000,
    executeObjectProbe: false,
    objectProbeAttempts: 120,
    requestId: "",
    adminToken: text(env.ROOT_ADMIN_TOKEN),
    routeQuery: text(env.ROOT_CANARY_ROUTE_QUERY),
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    const next = () => argv[++index];
    if (item === "--base-url") args.baseUrl = text(next());
    else if (item === "--expected-version") args.expectedVersion = text(next());
    else if (item === "--expected-release-id") args.expectedReleaseId = text(next());
    else if (item === "--stable-release-id") args.stableReleaseId = text(next());
    else if (item === "--expected-store-kind") args.expectedStoreKind = text(next()).toLowerCase();
    else if (item === "--expected-migration-version") args.expectedMigrationVersion = text(next());
    else if (item === "--attempts") args.attempts = clampNumber(next(), 120, 1, 1000);
    else if (item === "--default-protection-attempts") {
      args.defaultProtectionAttempts = clampNumber(next(), 15, 1, 100);
    }
    else if (item === "--interval-ms") args.intervalMs = clampNumber(next(), 100, 0, 10000);
    else if (item === "--timeout-ms") args.timeoutMs = clampNumber(next(), 5000, 500, 30000);
    else if (item === "--execute-object-probe") args.executeObjectProbe = true;
    else if (item === "--object-probe-attempts") args.objectProbeAttempts = clampNumber(next(), 120, 1, 1000);
    else if (item === "--request-id") args.requestId = text(next());
    else if (item === "--route-query") args.routeQuery = text(next());
    else if (item === "--json") args.json = true;
    else throw new Error(`unknown argument: ${item}`);
  }
  args.baseUrl = args.baseUrl.replace(/\/$/, "");
  if (!args.baseUrl) throw new Error("--base-url or ROOT_PUBLIC_BASE_URL is required");
  if (!args.expectedVersion) throw new Error("--expected-version or ROOT_CANARY_EXPECTED_VERSION is required");
  if (args.routeQuery && !args.expectedReleaseId) {
    throw new Error("--expected-release-id or ROOT_CANARY_EXPECTED_RELEASE_ID is required with a candidate route");
  }
  if (args.routeQuery && !args.stableReleaseId) {
    throw new Error("--stable-release-id or ROOT_CANARY_STABLE_RELEASE_ID is required with a candidate route");
  }
  if (args.stableReleaseId && !args.routeQuery) {
    throw new Error("--stable-release-id requires a candidate route");
  }
  if (args.expectedReleaseId && args.stableReleaseId && args.expectedReleaseId === args.stableReleaseId) {
    throw new Error("candidate and stable release ids must differ");
  }
  if (args.executeObjectProbe && !args.adminToken) throw new Error("ROOT_ADMIN_TOKEN is required for --execute-object-probe");
  if (args.executeObjectProbe && !args.requestId) {
    args.requestId = `canary-object-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  }
  return args;
}

function delay(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(fetchImpl, url, init = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    let body = {};
    try {
      body = await response.json();
    } catch (_) {
      body = {};
    }
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

function appendRouteQuery(rawUrl, routeQuery = "") {
  const url = new URL(rawUrl);
  const query = text(routeQuery).replace(/^\?/, "");
  if (query.length > 512) throw new Error("candidate route query exceeds 512 characters");
  for (const [key, value] of new URLSearchParams(query)) {
    if (key) url.searchParams.set(key, value);
  }
  return url.toString();
}

function probeUrl(baseUrl, path, attempt, routeQuery = "") {
  const url = new URL(path, `${baseUrl}/`);
  url.searchParams.set("canary_probe", `${Date.now()}-${attempt}`);
  return appendRouteQuery(url.toString(), routeQuery);
}

async function waitForVersion(path, options, fetchImpl) {
  const observedVersions = {};
  const observedReleaseIds = {};
  const errors = [];
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      const { response, body } = await fetchJson(fetchImpl, probeUrl(
        options.baseUrl,
        path,
        attempt,
        options.routeQuery,
      ), {
        headers: { "Cache-Control": "no-cache", Connection: "close" },
      }, options.timeoutMs);
      const data = body && body.data && typeof body.data === "object" ? body.data : {};
      const version = text(data.version, "UNVERSIONED");
      const releaseId = text(data.releaseId, "UNRELEASED");
      observedVersions[version] = (observedVersions[version] || 0) + 1;
      observedReleaseIds[releaseId] = (observedReleaseIds[releaseId] || 0) + 1;
      const releaseMatches = !options.expectedReleaseId || releaseId === options.expectedReleaseId;
      if (response.ok && body.code === 0 && version === options.expectedVersion && releaseMatches) {
        return {
          status: "PASS",
          path,
          attempt,
          httpStatus: response.status,
          version,
          releaseId,
          service: text(data.service),
          store: data.store ? {
            kind: text(data.store.kind),
            connected: data.store.connected === true,
            migrationVersion: text(data.store.migrationVersion),
            leastPrivilegeReady: data.store.leastPrivilegeReady === true,
            privilegeScope: text(data.store.privilegeScope, "UNKNOWN"),
            privilegePolicyEnforced: data.store.privilegePolicyEnforced === true,
          } : null,
          privacyNotice: path === "/api/v1/privacy/notice" ? {
            configured: data.configured === true,
            controllerNamePresent: Boolean(text(data.controllerName)),
            contactValid: isValidPrivacyContact(data.contact),
            retentionDays: Number(data.retentionDays || 0),
            policyVersionPresent: Boolean(text(data.policyVersion)),
          } : null,
          observedVersions,
          observedReleaseIds,
          errors,
        };
      }
    } catch (error) {
      errors.push(text(error && error.message, "request failed").slice(0, 160));
    }
    await delay(options.intervalMs);
  }
  return {
    status: "FAIL",
    path,
    attempt: options.attempts,
    version: "",
    releaseId: "",
    service: "",
    store: null,
    privacyNotice: null,
    observedVersions,
    observedReleaseIds,
    errors: errors.slice(-5),
  };
}

async function verifyDefaultTraffic(options, fetchImpl) {
  if (!options.routeQuery) {
    return { status: "NOT_REQUESTED", attempts: 0, candidateHits: 0, stableHits: 0 };
  }
  const observedReleaseIds = {};
  const errors = [];
  let candidateHits = 0;
  let stableHits = 0;
  for (let attempt = 1; attempt <= options.defaultProtectionAttempts; attempt += 1) {
    try {
      const { response, body } = await fetchJson(fetchImpl, probeUrl(
        options.baseUrl,
        "/health",
        attempt,
      ), {
        headers: { "Cache-Control": "no-cache", Connection: "close" },
      }, options.timeoutMs);
      const data = body && body.data && typeof body.data === "object" ? body.data : {};
      const releaseId = text(data.releaseId, "UNRELEASED");
      observedReleaseIds[releaseId] = (observedReleaseIds[releaseId] || 0) + 1;
      if (releaseId === options.expectedReleaseId) candidateHits += 1;
      if (response.ok && body.code === 0 && releaseId === options.stableReleaseId) stableHits += 1;
      else errors.push(`attempt ${attempt}: HTTP ${response.status}, releaseId ${releaseId}`);
    } catch (error) {
      errors.push(`attempt ${attempt}: ${text(error && error.message, "request failed").slice(0, 160)}`);
    }
    await delay(options.intervalMs);
  }
  return {
    status: stableHits === options.defaultProtectionAttempts && candidateHits === 0 ? "PASS" : "FAIL",
    attempts: options.defaultProtectionAttempts,
    stableHits,
    candidateHits,
    observedReleaseIds,
    errors: errors.slice(-5),
  };
}

async function waitForObjectProbe(options, fetchImpl) {
  const path = "/api/v1/admin/cloudbase-object-storage/probe";
  let stableNotFoundCount = 0;
  const errors = [];
  for (let attempt = 1; attempt <= options.objectProbeAttempts; attempt += 1) {
    try {
      const { response, body } = await fetchJson(fetchImpl, appendRouteQuery(
        `${options.baseUrl}${path}`,
        options.routeQuery,
      ), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.adminToken}`,
          "Cache-Control": "no-cache",
          Connection: "close",
          "Content-Type": "application/json",
          "X-Request-Id": options.requestId,
        },
        body: JSON.stringify({ requestId: options.requestId }),
      }, options.timeoutMs);
      if (response.status === 404) {
        stableNotFoundCount += 1;
        await delay(options.intervalMs);
        continue;
      }
      const probe = body && body.data && body.data.probe ? body.data.probe : {};
      if (response.ok && body.code === 0 && probe.version === options.expectedVersion) {
        const releaseMatches = !options.expectedReleaseId || probe.releaseId === options.expectedReleaseId;
        return {
          status: probe.status === "VERIFIED"
            && probe.uploadConfirmed === true
            && probe.deleteConfirmed === true
            && releaseMatches ? "PASS" : "FAIL",
          attempt,
          httpStatus: response.status,
          probeStatus: text(probe.status),
          provider: text(probe.provider),
          objectKey: text(probe.objectKey),
          uploadConfirmed: probe.uploadConfirmed === true,
          deleteConfirmed: probe.deleteConfirmed === true,
          residualObjectPossible: probe.residualObjectPossible === true,
          version: text(probe.version),
          releaseId: text(probe.releaseId),
          requestId: text(probe.requestId),
          checkedAt: text(probe.checkedAt),
          error: text(probe.error).slice(0, 180),
          stableNotFoundCount,
          errors,
        };
      }
      errors.push(`HTTP ${response.status} code ${body.code ?? "UNKNOWN"}`);
    } catch (error) {
      errors.push(text(error && error.message, "request failed").slice(0, 160));
    }
    await delay(options.intervalMs);
  }
  return {
    status: "FAIL",
    attempt: options.objectProbeAttempts,
    probeStatus: "NOT_REACHED",
    uploadConfirmed: false,
    deleteConfirmed: false,
    residualObjectPossible: false,
    version: "",
    releaseId: "",
    requestId: options.requestId,
    stableNotFoundCount,
    errors: errors.slice(-5),
  };
}

async function runCanaryVerification(options, context = {}) {
  const fetchImpl = context.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
  const startedAt = new Date().toISOString();
  const health = await waitForVersion("/health", options, fetchImpl);
  const ready = health.status === "PASS"
    ? await waitForVersion("/ready", options, fetchImpl)
    : { status: "SKIPPED", reason: "candidate health was not reached" };
  if (ready.status === "PASS" && (!ready.store || ready.store.connected !== true)) {
    ready.status = "FAIL";
    ready.reason = "candidate Store is not connected";
  }
  if (ready.status === "PASS" && ready.store.kind !== options.expectedStoreKind) {
    ready.status = "FAIL";
    ready.reason = `candidate Store kind is ${ready.store.kind || "missing"}; expected ${options.expectedStoreKind}`;
  }
  if (ready.status === "PASS" && ready.store.migrationVersion !== options.expectedMigrationVersion) {
    ready.status = "FAIL";
    ready.reason = `candidate migration is ${ready.store.migrationVersion || "missing"}; expected ${options.expectedMigrationVersion}`;
  }
  if (ready.status === "PASS" && options.expectedStoreKind === "mysql" && ready.store.leastPrivilegeReady !== true) {
    ready.status = "FAIL";
    ready.reason = "candidate MySQL least-privilege proof is missing";
  }
  if (ready.status === "PASS" && options.expectedStoreKind === "mysql" && ready.store.privilegeScope !== "SCHEMA") {
    ready.status = "FAIL";
    ready.reason = `candidate MySQL privilege scope is ${ready.store.privilegeScope || "missing"}; expected SCHEMA`;
  }
  if (ready.status === "PASS" && options.expectedStoreKind === "mysql" && ready.store.privilegePolicyEnforced !== true) {
    ready.status = "FAIL";
    ready.reason = "candidate MySQL privilege policy is not enforced";
  }
  const privacyNotice = ready.status === "PASS"
    ? await waitForVersion("/api/v1/privacy/notice", options, fetchImpl)
    : { status: "SKIPPED", reason: "candidate readiness did not pass" };
  if (privacyNotice.status === "PASS" && (
    !privacyNotice.privacyNotice ||
    privacyNotice.privacyNotice.configured !== true ||
    privacyNotice.privacyNotice.controllerNamePresent !== true ||
    privacyNotice.privacyNotice.contactValid !== true ||
    !Number.isInteger(privacyNotice.privacyNotice.retentionDays) ||
    privacyNotice.privacyNotice.retentionDays <= 0 ||
    privacyNotice.privacyNotice.policyVersionPresent !== true
  )) {
    privacyNotice.status = "FAIL";
    privacyNotice.reason = "candidate public privacy notice is incomplete";
  }
  const objectProbe = options.executeObjectProbe && ready.status === "PASS" && privacyNotice.status === "PASS"
    ? await waitForObjectProbe(options, fetchImpl)
    : {
      status: options.executeObjectProbe ? "SKIPPED" : "NOT_REQUESTED",
      reason: options.executeObjectProbe ? "candidate readiness did not pass" : "--execute-object-probe was not provided",
    };
  const defaultProtection = await verifyDefaultTraffic(options, fetchImpl);
  const required = [health.status, ready.status, privacyNotice.status];
  if (options.executeObjectProbe) required.push(objectProbe.status);
  if (options.routeQuery) required.push(defaultProtection.status);
  return {
    status: required.every((status) => status === "PASS") ? "PASS" : "FAIL",
    baseUrl: options.baseUrl,
    expectedVersion: options.expectedVersion,
    expectedReleaseId: options.expectedReleaseId,
    stableReleaseId: options.stableReleaseId,
    expectedStoreKind: options.expectedStoreKind,
    expectedMigrationVersion: options.expectedMigrationVersion,
    trafficChanged: false,
    executeObjectProbe: options.executeObjectProbe,
    routeQueryConfigured: Boolean(options.routeQuery),
    startedAt,
    completedAt: new Date().toISOString(),
    health,
    ready,
    privacyNotice,
    objectProbe,
    defaultProtection,
  };
}

function determineExitCode(report) {
  if (report.health.status !== "PASS") return 2;
  if (report.ready.status !== "PASS") return 3;
  if (report.privacyNotice.status !== "PASS") return 5;
  if (report.executeObjectProbe && report.objectProbe.status !== "PASS") return 4;
  if (report.routeQueryConfigured && report.defaultProtection.status !== "PASS") return 6;
  return report.status === "PASS" ? 0 : 1;
}

function printHuman(report) {
  process.stdout.write("# myRoot 生产灰度验证\n\n");
  process.stdout.write(`状态：${report.status}\n`);
  process.stdout.write(`目标版本：${report.expectedVersion}\n`);
  if (report.expectedReleaseId) process.stdout.write(`候选发布标识：${report.expectedReleaseId}\n`);
  process.stdout.write(`流量变更：否\n`);
  process.stdout.write(`定向路由：${report.routeQueryConfigured ? "是" : "否"}\n`);
  process.stdout.write(`健康探针：${report.health.status}，第 ${report.health.attempt || 0} 次命中\n`);
  process.stdout.write(`就绪探针：${report.ready.status}，第 ${report.ready.attempt || 0} 次命中\n`);
  process.stdout.write(`隐私说明：${report.privacyNotice.status}，第 ${report.privacyNotice.attempt || 0} 次命中\n`);
  process.stdout.write(`对象存储探针：${report.objectProbe.status}\n`);
  process.stdout.write(`默认流量保护：${report.defaultProtection.status}`
    + `（稳定 ${report.defaultProtection.stableHits || 0}/${report.defaultProtection.attempts || 0}`
    + `，候选误命中 ${report.defaultProtection.candidateHits || 0}）\n`);
  if (report.objectProbe.requestId) process.stdout.write(`请求号：${report.objectProbe.requestId}\n`);
}

async function main() {
  try {
    const options = parseArgs();
    const report = await runCanaryVerification(options);
    if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else printHuman(report);
    process.exitCode = determineExitCode(report);
  } catch (error) {
    process.stderr.write(`灰度验证失败：${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  appendRouteQuery,
  determineExitCode,
  parseArgs,
  runCanaryVerification,
  verifyDefaultTraffic,
  waitForObjectProbe,
  waitForVersion,
};
