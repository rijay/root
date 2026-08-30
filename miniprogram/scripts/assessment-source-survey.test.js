const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const survey = require("../utils/assessment-source-survey");

assert.equal(
  survey.confirmationPath("assessment_001"),
  "/subpkg/health/pages/source-confirmation/index?assessmentId=assessment_001",
);
assert.equal(survey.resultPath("invalid/id"), "/pages/health/index");

Promise.all([
  survey.nextPathAfterAssessment({
    assessmentId: "assessment_safety",
    assessmentType: "GUT_REGULARITY",
    status: "SAFETY_STOPPED",
  }),
  survey.nextPathAfterAssessment({
    assessmentId: "assessment_initial",
    assessmentType: "INITIAL",
    status: "COMPLETED",
  }),
]).then(([safetyPath, initialPath]) => {
  assert.equal(safetyPath, "/subpkg/health/pages/result/index?assessmentId=assessment_safety");
  assert.equal(initialPath, "/subpkg/health/pages/result/index?assessmentId=assessment_initial");

  const app = JSON.parse(read("app.json"));
  const healthPackage = app.subPackages.find((item) => item.root === "subpkg/health");
  assert.ok(healthPackage.pages.includes("pages/source-confirmation/index"));
  assert.match(read("subpkg/health/pages/assessment/index.js"), /nextPathAfterAssessment/);
  assert.match(read("subpkg/health/pages/source-confirmation/index.wxml"), /wx:for="\{\{options\}\}"/);
  assert.match(read("subpkg/health/pages/source-confirmation/index.wxss"), /\.source-actions\s*\{[^}]*position:\s*fixed/s);
  assert.match(read("subpkg/health/pages/source-confirmation/index.js"), /gate\.required !== true[\s\S]*this\.goResult\(\)/);
  console.log("assessment source survey checks passed");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
