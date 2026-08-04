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
  expandBrowserEvidence,
  parseArgs,
  percentile,
} = require("../../scripts/admin-performance-report.js");
const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const budgets = JSON.parse(fs.readFileSync(path.join(adminRoot, "config/performance-budgets.json"), "utf8"));

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
  const queryEvents = ["list", "detail", "write", "audit"].flatMap((scenario) => (
    Array.from({ length: 20 }, () => ({
      scenario,
      durationMs: 100,
      responseBytes: 1024,
      version: "candidate-sha",
      environment: "local-fixed-fixture",
      datasetVersion: "ADMIN_PERFORMANCE_R0",
    }))
  ));
  assert.equal(aggregateQueryEvidence(queryEvents, budgets).status, "PASS");
  assert.equal(aggregateQueryEvidence(queryEvents.slice(1), budgets).status, "BLOCK");

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
    version: "candidate-sha",
    environment: "local-fixed-fixture",
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
    ["Chrome", "Edge"].flatMap((browser) => ["office", "weak"].flatMap((networkProfile) => (
      Array.from({ length: 20 }, () => ({
        ...browserMetrics,
        scenario,
        durationMs: 100,
        browser,
        networkProfile,
      }))
    )))
  ));
  const browserEvidence = aggregateBrowserEvidence(browserEvents, budgets);
  assert.equal(browserEvidence.status, "PASS");
  assert.equal(browserEvidence.resources.sessionCount.status, "PASS");
  assert.equal(browserEvidence.journeys[0].groups.length, 4);
  assert.equal(aggregateBrowserEvidence([{ ...browserMetrics, scenario: "coldStart", durationMs: 100, fps: 49 }], budgets).status, "BLOCK");
});

test("compact browser sessions expand without duplicating sensitive data", () => {
  const events = expandBrowserEvidence({
    dimensions: {
      version: "candidate-sha",
      environment: "candidate",
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
  assert.deepEqual(events[0].evidenceLimitations, ["LOCAL_ONLY"]);
});
