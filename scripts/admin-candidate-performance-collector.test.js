const assert = require("node:assert/strict");
const test = require("node:test");

const budgets = require("../admin/config/performance-budgets.json");
const {
  aggregateBrowserEvidence,
  expandBrowserEvidence,
} = require("./admin-performance-report");
const {
  WRITE_ACK,
  collectCandidateQueries,
  credentialState,
  parseArgs: parseQueryArgs,
  preflight,
} = require("./admin-candidate-query-collector");
const {
  sealBrowserCapture,
  validateRawCapture,
} = require("./admin-candidate-browser-intake");

const commit = "a".repeat(40);
const releaseId = "myroot-candidate-aaaaaaaaaaaa";
const candidateArgs = [
  "--target", "https://candidate.root.example",
  "--artifact-commit", commit,
  "--environment", "candidate-staging",
  "--version", "0.5.13",
  "--release-id", releaseId,
];

function executionEnv(overrides = {}) {
  return {
    ROOT_ADMIN_PERFORMANCE_TOKEN: "candidate-admin-secret",
    ROOT_ADMIN_PERFORMANCE_TEST_PHONE: "13900000001",
    ROOT_ADMIN_PERFORMANCE_DRAFT_ID: "candidate-welcome-draft",
    ROOT_ADMIN_PERFORMANCE_CANDIDATE_WRITE_ACK: WRITE_ACK,
    ...overrides,
  };
}

function fakeCandidateFetch() {
  let revision = 1;
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    calls.push({ path: parsed.pathname, method: options.method || "GET", headers: options.headers, body: options.body });
    let data = {};
    if (parsed.pathname === "/health") {
      data = {
        version: "0.5.13",
        releaseId,
        releaseIdConfigured: true,
        adminPerformanceDatasetVersion: "ADMIN_PERFORMANCE_R0",
        adminPerformanceDatasetConfigured: true,
      };
    } else if (parsed.pathname === "/api/v1/admin/content/welcome" && (options.method || "GET") === "GET") {
      data = {
        screens: [{
          id: "candidate-welcome-draft",
          versionId: "candidate-welcome-draft",
          revision,
          status: "DRAFT",
          slot: 1,
          copy: "欢迎加入 Root Member Club",
          assetId: "candidate-asset",
        }],
      };
    } else if (parsed.pathname === "/api/v1/admin/content/welcome/draft") {
      revision += 1;
      data = { version: {
        id: "candidate-welcome-draft",
        versionId: "candidate-welcome-draft",
        revision,
        status: "DRAFT",
        slot: 1,
        copy: "欢迎加入 Root Member Club",
        assetId: "candidate-asset",
      } };
    }
    return new Response(JSON.stringify({ code: 0, message: "ok", data }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { calls, fetchImpl };
}

function runtimeReadback() {
  return {
    schemaVersion: 1,
    version: "0.5.13",
    environment: "candidate-staging",
    evidenceClass: "FORMAL_LAUNCH_CANDIDATE",
    targetOrigin: "https://candidate.root.example",
    artifactCommit: commit,
    releaseId,
    releaseIdConfigured: true,
    observedAt: "2026-08-04T00:00:00.000Z",
    runtimeReadback: {
      route: "/health",
      httpStatus: 200,
      version: "0.5.13",
      releaseId,
      releaseIdConfigured: true,
      adminPerformanceDatasetVersion: "ADMIN_PERFORMANCE_R0",
      adminPerformanceDatasetConfigured: true,
    },
  };
}

function browserCapture() {
  const samples = () => Array.from({ length: 20 }, () => 100);
  return {
    schemaVersion: 1,
    dimensions: {
      browser: "Chrome",
      browserVersion: "150.0.7871.187",
      hardwareConcurrency: 10,
      deviceMemoryGiB: 24,
      viewportWidth: 1240,
      viewportHeight: 820,
    },
    resources: {
      initialDomNodes: 1000,
      pageDomNodes: 2000,
      maxTaskMs: 40,
      maxFreezeMs: 150,
      stableMemoryMiB: 180,
      fps: 55,
      memoryGrowthRatio: 0.1,
      menuCycles: 10,
      editCycles: 10,
      journeyDurationMinutes: 30,
    },
    capacity: { sessionCount: 5, maxConcurrentReads: 10, conflictScenarios: 2 },
    networks: {
      office: { ...budgets.networkProfiles.office, networkEmulationComplete: true, limitations: [] },
      weak: { ...budgets.networkProfiles.weak, networkEmulationComplete: true, limitations: [] },
    },
    journeys: Object.fromEntries(Object.keys(budgets.journeys).map((scenario) => [scenario, {
      office: samples(),
      weak: samples(),
    }])),
    limitations: [],
  };
}

test("candidate query preflight is zero-network and reports authority without exposing values", () => {
  const options = parseQueryArgs(["--preflight", ...candidateArgs]);
  const result = preflight(options, executionEnv());
  assert.equal(result.networkRequestsMade, false);
  assert.equal(result.candidateWritesMade, false);
  assert.equal(result.executeReady, true);
  assert.equal(JSON.stringify(result).includes("candidate-admin-secret"), false);
  assert.equal(JSON.stringify(result).includes("13900000001"), false);
  assert.deepEqual(credentialState({}), {
    tokenConfigured: false,
    testPhoneConfigured: false,
    draftIdConfigured: false,
    candidateWriteAcknowledged: false,
  });
  assert.throws(() => parseQueryArgs([
    "--preflight",
    ...candidateArgs.map((value) => value === "https://candidate.root.example" ? "http://127.0.0.1:3000" : value),
  ]), /candidate provenance rejected/);
});

test("candidate query collector binds runtime and emits 20 safe samples per scenario", async () => {
  const options = parseQueryArgs(["--execute-query", ...candidateArgs, "--output-dir", "/tmp/not-written-by-unit-test"]);
  const candidate = fakeCandidateFetch();
  const result = await collectCandidateQueries(options, { env: executionEnv(), fetchImpl: candidate.fetchImpl });
  assert.equal(result.events.length, 80);
  assert.deepEqual(Object.fromEntries(["list", "detail", "audit", "write"].map((scenario) => [
    scenario,
    result.events.filter((event) => event.scenario === scenario).length,
  ])), { list: 20, detail: 20, audit: 20, write: 20 });
  assert.equal(result.runtime.runtimeReadback.releaseId, releaseId);
  assert.equal(candidate.calls.filter((call) => call.path === "/api/v1/admin/content/welcome/draft").length, 20);
  assert.equal(JSON.stringify(result).includes("candidate-admin-secret"), false);
  assert.equal(JSON.stringify(result).includes("13900000001"), false);
  await assert.rejects(
    collectCandidateQueries(options, {
      env: executionEnv({ ROOT_ADMIN_PERFORMANCE_CANDIDATE_WRITE_ACK: "" }),
      fetchImpl: async () => { throw new Error("network must not be reached"); },
    }),
    /requires ROOT_ADMIN_PERFORMANCE_TOKEN/,
  );
});

test("browser intake stamps trusted runtime provenance and rejects incomplete capture", () => {
  const sealed = sealBrowserCapture(runtimeReadback(), browserCapture());
  assert.equal(sealed.dimensions.releaseId, releaseId);
  assert.equal(sealed.dimensions.artifactCommit, commit);
  const browser = aggregateBrowserEvidence(
    expandBrowserEvidence(sealed),
    budgets,
    "FORMAL_LAUNCH_CANDIDATE",
  );
  assert.equal(browser.status, "PASS");
  assert.equal(browser.provenance.status, "PASS");

  const selfAsserted = browserCapture();
  selfAsserted.dimensions.releaseId = releaseId;
  assert.throws(() => validateRawCapture(selfAsserted), /must not self-assert provenance/);
  const incompleteNetwork = browserCapture();
  incompleteNetwork.networks.weak.packetLossRatio = 0;
  assert.throws(() => validateRawCapture(incompleteNetwork), /network profiles/);
  const unresolved = browserCapture();
  unresolved.limitations.push("THIRTY_MINUTE_STABILITY_NOT_RUN");
  assert.throws(() => validateRawCapture(unresolved), /no unresolved limitations/);
});
