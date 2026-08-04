import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  aggregateBrowserEvidence,
  aggregateQueryEvidence,
  evaluateMetric,
  evaluateCandidateBinding,
  evaluateEvidenceProvenance,
  expandBrowserEvidence,
  parseArgs,
  percentile,
} = require("../../scripts/admin-performance-report.js");
const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const budgets = JSON.parse(fs.readFileSync(path.join(adminRoot, "config/performance-budgets.json"), "utf8"));
const fiveSessionEvidence = JSON.parse(fs.readFileSync(path.join(adminRoot, "..", "docs", "evidence", "admin-performance-r0", "browser-five-session-conflict-rehearsal.json"), "utf8"));

test("approved admin performance budget remains internally consistent", () => {
  assert.equal(budgets.schemaVersion, 1);
  assert.equal(budgets.capacity.coreOperators, 2);
  assert.equal(budgets.capacity.maximumSessions, 5);
  assert.equal(budgets.fixture.users, 10000);
  assert.equal(budgets.fixture.activityEnrollments, 5000);
  assert.equal(budgets.fixture.auditLogs, 20000);
  assert.equal(budgets.fixture.contentVersions, 1000);
  assert.equal(budgets.fixture.scaleQuestions, 100);
  assert.equal(budgets.network.maxConcurrentReadsPerBrowser, 4);
  assert.equal(budgets.network.readTimeoutMs, 8000);
  assert.equal(budgets.network.writeTimeoutMs, 15000);
  assert.equal(budgets.responses.defaultPageSize, 20);
  assert.equal(budgets.responses.maximumPageSize, 50);
  assert.equal(budgets.browser.minimumHardwareConcurrency, 4);
  assert.equal(budgets.browser.minimumDeviceMemoryGiB, 8);
  assert.deepEqual(budgets.browser.supportedBrowsers, ["Chrome"]);
  assert.deepEqual(budgets.evidence.requiredGates, ["BUILD", "QUERY", "BROWSER"]);
  assert.equal(budgets.evidence.operationGateEnabled, false);
});

test("budget evaluation distinguishes target warnings from hard blocks", () => {
  assert.equal(evaluateMetric(100, { target: 100, hardLimit: 120 }).status, "PASS");
  assert.equal(evaluateMetric(101, { target: 100, hardLimit: 120 }).status, "WARN");
  assert.equal(evaluateMetric(121, { target: 100, hardLimit: 120 }).status, "BLOCK");
  assert.equal(percentile([5, 1, 4, 2, 3], 0.75), 4);
});

test("local rehearsal is explicit and cannot be mistaken for candidate evidence", () => {
  assert.equal(parseArgs(["--rehearsal"]).evidenceClass, "LOCAL_REHEARSAL");
  assert.equal(parseArgs(["--candidate"]).evidenceClass, "FORMAL_LAUNCH_CANDIDATE");
});

test("candidate query and browser evidence only pass with complete bounded samples", () => {
  const artifactCommit = "abcdef1234567890abcdef1234567890abcdef12";
  const candidateDimensions = {
    evidenceClass: "FORMAL_LAUNCH_CANDIDATE",
    targetOrigin: "https://candidate.root.example",
    artifactCommit,
  };
  const queryEvents = ["list", "detail", "write", "audit"].flatMap((scenario) => (
    Array.from({ length: 20 }, () => ({
      scenario,
      durationMs: 100,
      responseBytes: 1024,
      version: "candidate-build",
      environment: "candidate-staging",
      datasetVersion: "ADMIN_PERFORMANCE_R0",
      ...candidateDimensions,
    }))
  ));
  assert.equal(aggregateQueryEvidence(queryEvents, budgets, "FORMAL_LAUNCH_CANDIDATE").status, "PASS");
  assert.equal(aggregateQueryEvidence(queryEvents.slice(1), budgets, "FORMAL_LAUNCH_CANDIDATE").status, "BLOCK");

  const browserMetrics = {
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
    version: "candidate-build",
    environment: "candidate-staging",
    ...candidateDimensions,
    browser: "Chrome",
    browserVersion: "150.0.7871.187",
    hardwareConcurrency: 10,
    deviceMemoryGiB: 24,
    networkProfile: "office",
    viewportWidth: 1240,
    viewportHeight: 820,
    sessionCount: 5,
    maxConcurrentReads: 10,
    conflictScenarios: 2,
    networkEmulationComplete: true,
  };
  const browserEvents = Object.keys(budgets.journeys).flatMap((scenario) => (
    budgets.browser.supportedBrowsers.flatMap((browser) => ["office", "weak"].flatMap((networkProfile) => (
      Array.from({ length: 20 }, () => ({
        ...browserMetrics,
        scenario,
        durationMs: 100,
        browser,
        networkProfile,
      }))
    )))
  ));
  const browserEvidence = aggregateBrowserEvidence(browserEvents, budgets, "FORMAL_LAUNCH_CANDIDATE");
  assert.equal(browserEvidence.status, "PASS");
  assert.equal(browserEvidence.resources.sessionCount.status, "PASS");
  assert.equal(browserEvidence.journeys[0].groups.length, 2);
  assert.equal(aggregateBrowserEvidence(browserEvents.map((event) => ({ ...event, browser: "Edge" })), budgets, "FORMAL_LAUNCH_CANDIDATE").status, "BLOCK");
  assert.equal(aggregateBrowserEvidence([{ ...browserMetrics, scenario: "coldStart", durationMs: 100, fps: 49 }], budgets, "FORMAL_LAUNCH_CANDIDATE").status, "BLOCK");
});

test("candidate mode rejects complete local rehearsal metrics", () => {
  const local = {
    version: "local-0.5.13",
    environment: "local-fixed-fixture",
    evidenceClass: "LOCAL_REHEARSAL",
    targetOrigin: "http://127.0.0.1:4173",
    artifactCommit: "",
  };
  assert.equal(evaluateEvidenceProvenance([local], "LOCAL_REHEARSAL").status, "PASS");
  const rejected = evaluateEvidenceProvenance([local], "FORMAL_LAUNCH_CANDIDATE");
  assert.equal(rejected.status, "BLOCK");
  assert.equal(rejected.reason, "EVIDENCE_PROVENANCE_MISSING_OR_MIXED");

  const relabeledLocal = {
    ...local,
    evidenceClass: "FORMAL_LAUNCH_CANDIDATE",
    artifactCommit: "abcdef1",
  };
  const relabeledRejected = evaluateEvidenceProvenance([relabeledLocal], "FORMAL_LAUNCH_CANDIDATE");
  assert.equal(relabeledRejected.status, "BLOCK");
  assert.equal(relabeledRejected.reason, "CANDIDATE_PROVENANCE_INVALID");
});

test("candidate query and browser evidence must bind to the same deployed artifact", () => {
  const query = {
    provenance: { status: "PASS" },
    dimensions: { artifactCommit: "abcdef1", targetOrigin: "https://candidate.root.example" },
  };
  const browser = {
    provenance: { status: "PASS" },
    dimensions: { artifactCommit: "abcdef1", targetOrigin: "https://candidate.root.example" },
  };
  assert.deepEqual(evaluateCandidateBinding(query, browser, "FORMAL_LAUNCH_CANDIDATE"), {
    status: "PASS",
    artifactCommit: "abcdef1",
    targetOrigin: "https://candidate.root.example",
  });
  assert.equal(evaluateCandidateBinding(query, {
    ...browser,
    dimensions: { ...browser.dimensions, artifactCommit: "1234567" },
  }, "FORMAL_LAUNCH_CANDIDATE").status, "BLOCK");
  assert.equal(evaluateCandidateBinding(query, browser, "LOCAL_REHEARSAL").status, "NOT_APPLICABLE");
});

test("compact browser sessions expand without duplicating sensitive data", () => {
  const events = expandBrowserEvidence({
    dimensions: {
      version: "candidate-sha",
      environment: "candidate",
      evidenceClass: "LOCAL_REHEARSAL",
      targetOrigin: "http://127.0.0.1:4173",
      artifactCommit: "",
      browser: "Chrome",
      browserVersion: "150",
      hardwareConcurrency: 10,
      deviceMemoryGiB: 24,
      viewportWidth: 1240,
      viewportHeight: 820,
    },
    resources: { initialDomNodes: 100, pageDomNodes: 200 },
    capacity: { sessionCount: 1 },
    networks: { office: { networkEmulationComplete: true, limitations: [] } },
    journeys: { coldStart: { office: [100, 110] } },
    limitations: ["LOCAL_ONLY"],
  });
  assert.equal(events.length, 2);
  assert.equal(events[0].scenario, "coldStart");
  assert.equal(events[0].networkEmulationComplete, true);
  assert.equal(events[0].hardwareConcurrency, 10);
  assert.equal(events[0].evidenceClass, "LOCAL_REHEARSAL");
  assert.equal(events[0].targetOrigin, "http://127.0.0.1:4173");
  assert.deepEqual(events[0].evidenceLimitations, ["LOCAL_ONLY"]);
});

test("controlled Chrome five-session evidence stays local and covers both conflict paths", () => {
  assert.equal(fiveSessionEvidence.evidenceClass, "LOCAL_REHEARSAL");
  assert.deepEqual(fiveSessionEvidence.browser.supportedBrowserScope, ["Chrome"]);
  assert.equal(fiveSessionEvidence.browser.edgeRequired, false);
  assert.equal(fiveSessionEvidence.sessions.sessionCount, 5);
  assert.equal(fiveSessionEvidence.sessions.allSessionsAtApprovedViewport, true);
  assert.deepEqual(fiveSessionEvidence.conflicts.map((item) => [item.scenario, item.staleWriteHttpStatus, item.status]), [
    ["HOME_CAROUSEL_DRAFT", 409, "PASS"],
    ["HEALTH_SCALE_DRAFT", 409, "PASS"],
  ]);
  assert.equal(fiveSessionEvidence.limitations.includes("NOT_CANDIDATE_GATE_EVIDENCE"), true);
});
