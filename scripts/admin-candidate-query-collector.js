#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const budgets = require("../admin/config/performance-budgets.json");
const {
  assertPrivateRegularFile,
  validateRouteMetadata,
} = require("./generate-wechat-trial-qrcode");
const {
  buildCandidateProvenance,
  readCandidateRuntime,
  requestJson,
  requireSuccess,
  writeJsonExclusive,
} = require("./admin-candidate-performance-common");

const TOKEN_ENV = "ROOT_ADMIN_PERFORMANCE_TOKEN";
const PHONE_ENV = "ROOT_ADMIN_PERFORMANCE_TEST_PHONE";
const DRAFT_ENV = "ROOT_ADMIN_PERFORMANCE_DRAFT_ID";
const WRITE_ACK_ENV = "ROOT_ADMIN_PERFORMANCE_CANDIDATE_WRITE_ACK";
const WRITE_ACK = "I_UNDERSTAND_CANDIDATE_DRAFT_WILL_BE_REVISED";

function parseArgs(argv) {
  const options = {
    mode: "preflight",
    targetOrigin: "",
    artifactCommit: "",
    environment: "",
    version: "",
    releaseId: "",
    routeFile: "",
    expectedRouteVersion: "",
    outputDir: "",
    samples: budgets.queries.samplesPerScenario,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--preflight") options.mode = "preflight";
    else if (value === "--execute-query") options.mode = "execute-query";
    else if (value === "--target") options.targetOrigin = argv[++index];
    else if (value === "--artifact-commit") options.artifactCommit = argv[++index];
    else if (value === "--environment") options.environment = argv[++index];
    else if (value === "--version") options.version = argv[++index];
    else if (value === "--release-id") options.releaseId = argv[++index];
    else if (value === "--route-file") options.routeFile = argv[++index];
    else if (value === "--expected-route-version") options.expectedRouteVersion = argv[++index];
    else if (value === "--output-dir") options.outputDir = argv[++index];
    else if (value === "--samples") options.samples = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!Number.isInteger(options.samples) || options.samples < budgets.queries.samplesPerScenario || options.samples > 100) {
    throw new Error(`samples must be an integer between ${budgets.queries.samplesPerScenario} and 100`);
  }
  options.provenance = buildCandidateProvenance(options);
  if (Boolean(options.routeFile) !== Boolean(options.expectedRouteVersion)) {
    throw new Error("route file and expected route version must be provided together");
  }
  options.candidateRoute = options.routeFile
    ? readCandidateRoute(options.routeFile, options.expectedRouteVersion)
    : null;
  if (options.mode === "execute-query" && !String(options.outputDir || "").trim()) {
    throw new Error("output dir is required for query execution");
  }
  return options;
}

function readCandidateRoute(routeFile, expectedVersion) {
  const resolved = assertPrivateRegularFile(routeFile, "Candidate route file");
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (_error) {
    throw new Error("candidate route file must contain valid JSON");
  }
  return validateRouteMetadata(payload, expectedVersion);
}

function credentialState(env = process.env) {
  return {
    tokenConfigured: Boolean(String(env[TOKEN_ENV] || "").trim()),
    testPhoneConfigured: /^1\d{10}$/.test(String(env[PHONE_ENV] || "").trim()),
    draftIdConfigured: Boolean(String(env[DRAFT_ENV] || "").trim()),
    candidateWriteAcknowledged: env[WRITE_ACK_ENV] === WRITE_ACK,
  };
}

function preflight(options, env = process.env) {
  const credentials = credentialState(env);
  return {
    schemaVersion: 1,
    mode: "PREFLIGHT_ONLY",
    networkRequestsMade: false,
    candidateWritesMade: false,
    provenance: options.provenance,
    samplesPerScenario: options.samples,
    requiredScenarios: ["list", "detail", "audit", "write"],
    requiredCandidateRuntimeConfiguration: `ROOT_ADMIN_PERFORMANCE_DATASET_VERSION=${budgets.fixture.version}`,
    candidateRouting: options.candidateRoute ? {
      mode: "PRIVATE_ROUTE_FILE",
      versionName: options.candidateRoute.versionName,
      routeFingerprint: crypto.createHash("sha256").update(options.candidateRoute.query).digest("hex").slice(0, 12),
      routeValueDisclosed: false,
    } : {
      mode: "DIRECT_ORIGIN",
      routeValueDisclosed: false,
    },
    credentials,
    executeReady: Object.values(credentials).every(Boolean),
    warnings: [
      "preflight does not connect to the candidate environment",
      "execute-query revises one dedicated candidate welcome draft for every write sample",
    ],
  };
}

function candidateEvent(runtime, scenario, measured) {
  return {
    version: runtime.version,
    environment: runtime.environment,
    evidenceClass: runtime.evidenceClass,
    targetOrigin: runtime.targetOrigin,
    artifactCommit: runtime.artifactCommit,
    releaseId: runtime.releaseId,
    releaseIdConfigured: true,
    datasetVersion: budgets.fixture.version,
    scenario,
    durationMs: measured.durationMs,
    responseBytes: measured.responseBytes,
  };
}

async function measure(fetchImpl, runtime, token, scenario, route, options = {}) {
  const measured = await requestJson(fetchImpl, runtime.targetOrigin, route, {
    ...options,
    token,
    candidateRouteQuery: runtime.candidateRouteQuery,
    timeoutMs: options.method === "POST" && scenario === "write"
      ? budgets.network.writeTimeoutMs : budgets.network.readTimeoutMs,
  });
  const data = requireSuccess(measured, `candidate ${scenario}`);
  return { event: candidateEvent(runtime, scenario, measured), data };
}

function requireExecutionAuthority(env = process.env) {
  const state = credentialState(env);
  if (!Object.values(state).every(Boolean)) {
    throw new Error(`candidate query execution requires ${TOKEN_ENV}, ${PHONE_ENV}, ${DRAFT_ENV} and exact ${WRITE_ACK_ENV}`);
  }
  return {
    token: String(env[TOKEN_ENV]).trim(),
    phone: String(env[PHONE_ENV]).trim(),
    draftId: String(env[DRAFT_ENV]).trim(),
  };
}

async function collectCandidateQueries(options, dependencies = {}) {
  if (options.mode !== "execute-query") throw new Error("query collection requires --execute-query");
  const env = dependencies.env || process.env;
  const fetchImpl = dependencies.fetchImpl || fetch;
  const authority = requireExecutionAuthority(env);
  const runtimeReadback = await readCandidateRuntime(fetchImpl, options.provenance, {
    candidateRouteQuery: options.candidateRoute && options.candidateRoute.query,
  });
  const runtime = {
    ...runtimeReadback,
    candidateRouteQuery: options.candidateRoute && options.candidateRoute.query,
  };
  const events = [];
  const readScenarios = [
    ["list", "/api/v1/admin/content/home-carousel?page=1&pageSize=20", {}],
    ["detail", "/api/v1/admin/formal-users/query", { method: "POST", body: { phone: authority.phone } }],
    ["audit", "/api/v1/admin/audit-logs?page=1&pageSize=20", {}],
  ];
  for (const [scenario, route, requestOptions] of readScenarios) {
    for (let index = 0; index < options.samples; index += 1) {
      const measured = await measure(fetchImpl, runtime, authority.token, scenario, route, requestOptions);
      events.push(measured.event);
    }
  }

  const welcome = await requestJson(fetchImpl, runtime.targetOrigin, "/api/v1/admin/content/welcome", {
    token: authority.token,
    timeoutMs: budgets.network.readTimeoutMs,
    candidateRouteQuery: runtime.candidateRouteQuery,
  });
  const welcomeData = requireSuccess(welcome, "candidate welcome draft lookup");
  let draft = (welcomeData.screens || []).find((item) => item.id === authority.draftId);
  if (!draft || draft.status !== "DRAFT") throw new Error("configured candidate performance draft is missing or not DRAFT");
  const collectionId = `admin-perf-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  for (let index = 0; index < options.samples; index += 1) {
    const attempt = String(index + 1).padStart(3, "0");
    const requestId = `${collectionId}-write-${attempt}`;
    const measured = await measure(
      fetchImpl,
      runtime,
      authority.token,
      "write",
      "/api/v1/admin/content/welcome/draft",
      {
        method: "POST",
        headers: {
          "X-Request-Id": requestId,
          "X-Idempotency-Key": `${collectionId}-intent-${attempt}`,
        },
        body: {
          id: draft.id,
          expectedRevision: draft.revision,
          slot: draft.slot,
          copy: draft.copy,
          assetId: draft.assetId,
        },
      },
    );
    if (!measured.data || !measured.data.version) throw new Error("candidate write response missing authoritative version");
    draft = measured.data.version;
    events.push(measured.event);
  }

  const { candidateRouteQuery: _candidateRouteQuery, ...safeRuntime } = runtime;
  return { runtime: safeRuntime, events };
}

function writeCollection(options, collection) {
  const outputDir = path.resolve(options.outputDir);
  const runtimeTarget = path.join(outputDir, "runtime-readback.json");
  const queryTarget = path.join(outputDir, "query-events.json");
  if (fs.existsSync(runtimeTarget) || fs.existsSync(queryTarget)) {
    throw new Error("candidate evidence output already exists; choose a new output dir");
  }
  const runtimePath = writeJsonExclusive(runtimeTarget, collection.runtime);
  const queryPath = writeJsonExclusive(queryTarget, collection.events);
  return { runtimePath, queryPath };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === "preflight") {
    process.stdout.write(`${JSON.stringify(preflight(options), null, 2)}\n`);
    return;
  }
  const collection = await collectCandidateQueries(options);
  const files = writeCollection(options, collection);
  process.stdout.write(`${JSON.stringify({
    status: "COLLECTED",
    releaseId: collection.runtime.releaseId,
    eventCount: collection.events.length,
    files,
  }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`Admin candidate query collector failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  WRITE_ACK,
  collectCandidateQueries,
  credentialState,
  parseArgs,
  preflight,
  readCandidateRoute,
  requireExecutionAuthority,
  writeCollection,
};
