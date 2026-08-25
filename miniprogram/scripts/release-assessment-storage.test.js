const assert = require("node:assert/strict");

global.__wxConfig = { envVersion: "release" };
global.wx = {};

const calls = [];
const completedAssessment = {
  assessmentId: "has-release-server-1",
  assessmentType: "INITIAL",
  questionnaireId: "ROOT_INITIAL_BASELINE",
  questionnaireVersion: 1,
  status: "COMPLETED",
  completedAt: "2026-08-25T10:00:00.000Z",
  result: { resultCode: "STEADY", title: "状态较平稳", priorityAction: "保持节奏" },
  dimensions: [],
};

require.cache[require.resolve("../utils/request")] = {
  exports: {
    async request(options) {
      calls.push({ url: options.url, method: options.method || "GET" });
      if (options.url.endsWith("/catalog")) return { assessments: [], storageMode: "SERVER" };
      if (options.url.endsWith("/start")) {
        return { created: true, assessment: { ...completedAssessment, status: "IN_PROGRESS", result: null } };
      }
      if (options.url.endsWith("/draft")) {
        return { assessment: { ...completedAssessment, status: "IN_PROGRESS", result: null } };
      }
      if (options.url.endsWith("/complete")) return { created: true, assessment: completedAssessment };
      if (options.url.includes("/history")) return { assessments: [completedAssessment], total: 1 };
      if (options.url.endsWith("/compare")) {
        return { comparable: false, reason: "SAME_ASSESSMENT", left: completedAssessment, right: completedAssessment, dimensions: [] };
      }
      if (options.method === "DELETE") return { assessmentId: completedAssessment.assessmentId, deleted: true };
      return { assessment: completedAssessment };
    },
  },
};
require.cache[require.resolve("../utils/analytics")] = {
  exports: { track() { return { sent: false, reason: "TEST" }; } },
};

const env = require("../config/env");
const assessment = require("../utils/health-assessment");

async function main() {
  assert.equal(env.envVersion, "release");
  assert.equal(env.localV060CompatMode, false, "正式环境的其他能力不得退回全局兼容模式");
  assert.equal(env.healthAssessmentStorageMode, "SERVER");

  const catalog = await assessment.getCatalog();
  assert.equal(catalog.storageMode, "SERVER");
  await assessment.startAssessment("INITIAL");
  await assessment.saveDraft(completedAssessment.assessmentId, { stateScore: 4 });
  await assessment.completeAssessment(completedAssessment.assessmentId, { stateScore: 4 });
  await assessment.getAssessment(completedAssessment.assessmentId);
  await assessment.getHistory("INITIAL");
  await assessment.compareAssessments(completedAssessment.assessmentId, completedAssessment.assessmentId);
  const deleted = await assessment.deleteAssessment(completedAssessment.assessmentId);
  assert.equal(deleted.deleted, true);

  assert.deepEqual(calls, [
    { url: "/api/v1/health/assessments/catalog", method: "GET" },
    { url: "/api/v1/health/assessments/start", method: "POST" },
    { url: `/api/v1/health/assessments/${completedAssessment.assessmentId}/draft`, method: "POST" },
    { url: `/api/v1/health/assessments/${completedAssessment.assessmentId}/complete`, method: "POST" },
    { url: `/api/v1/health/assessments/${completedAssessment.assessmentId}`, method: "GET" },
    { url: "/api/v1/health/assessments/history?assessmentType=INITIAL", method: "GET" },
    { url: "/api/v1/health/assessments/compare", method: "POST" },
    { url: `/api/v1/health/assessments/${completedAssessment.assessmentId}`, method: "DELETE" },
  ]);
}

main()
  .then(() => {
    delete global.__wxConfig;
    delete global.wx;
    console.log("release assessment server-storage tests passed");
  })
  .catch((error) => {
    delete global.__wxConfig;
    delete global.wx;
    console.error(error);
    process.exit(1);
  });
