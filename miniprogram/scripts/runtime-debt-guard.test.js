const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const projectRoot = path.resolve(root, "..");

const retiredPaths = [
  "pages/dev-identity-probe",
  "pages/launching",
  "subpkg/health/pages/initial-assessment",
  "subpkg/health/pages/scale-assessment",
  "utils/local-health-assessment.js",
  "utils/local-health-retention.js",
];

retiredPaths.forEach((relativePath) => {
  assert.equal(fs.existsSync(path.join(root, relativePath)), false, `废弃路径仍存在：${relativePath}`);
});

assert.equal(fs.existsSync(path.join(projectRoot, "backend/src/v060Api.js")), false, "旧版本 API 模块仍存在");

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(js|json|wxml|wxss)$/.test(entry.name) ? [target] : [];
  });
}

const runtimeFiles = [
  ...sourceFiles(root).filter((file) => !file.includes(`${path.sep}scripts${path.sep}`)),
  ...sourceFiles(path.join(projectRoot, "backend/src")),
];
const retiredRuntimePattern = /DAY4_MIDPOINT|DAY8_SUMMARY|DAY4_QUESTIONNAIRE|DAY8_QUESTIONNAIRE|DAY4_PENDING|DAY8_PENDING|healthAssessmentStorageMode|localV060CompatMode|LOCAL_V060_COMPAT|local-health-assessment|local-health-retention|v060Api/;
const matches = runtimeFiles.filter((file) => retiredRuntimePattern.test(fs.readFileSync(file, "utf8")));
assert.deepEqual(matches, [], `废弃运行时标识回流：${matches.join(", ")}`);

console.log("v0.8.0 runtime debt guard passed");
