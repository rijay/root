const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("formal Activity write path stays independent from the retired task reward runtime", () => {
  const domainSource = source("src/domain.js");
  const activitySource = source("src/activityModule.js");

  assert.equal(domainSource.includes("activityTaskOutboxCoordinator"), false);
  assert.equal(domainSource.includes("executeActivityTaskWrite"), false);
  assert.equal(activitySource.includes("preboundTaskDefinitionId"), false);
  assert.equal(activitySource.includes("prebound_task_definition_id"), false);
});
