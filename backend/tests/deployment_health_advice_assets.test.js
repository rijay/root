const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const backendRoot = path.resolve(__dirname, "..");

test("Docker build context includes only the reviewed health advice JSON assets", () => {
  const dockerignore = fs.readFileSync(path.join(backendRoot, ".dockerignore"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const jsonIgnoreIndex = dockerignore.indexOf("data/*.json");
  const catalogAllowIndex = dockerignore.indexOf("!data/health-advice-catalog.v1.json");
  const poolAllowIndex = dockerignore.indexOf("!data/health-advice-pool.v1.json");

  assert.notEqual(jsonIgnoreIndex, -1);
  assert.ok(catalogAllowIndex > jsonIgnoreIndex);
  assert.ok(poolAllowIndex > jsonIgnoreIndex);
  assert.equal(dockerignore.filter((line) => line.startsWith("!data/")).length, 2);
  assert.ok(fs.statSync(path.join(backendRoot, "data", "health-advice-catalog.v1.json")).isFile());
  assert.ok(fs.statSync(path.join(backendRoot, "data", "health-advice-pool.v1.json")).isFile());
});
