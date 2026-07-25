const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const legacyAdminPath = path.join(__dirname, "..", "public", "admin.js");

test("legacy admin keeps bearer credentials tab-scoped and sends only the canonical header", () => {
  const source = fs.readFileSync(legacyAdminPath, "utf8");

  assert.match(source, /window\.sessionStorage/);
  assert.doesNotMatch(source, /window\.localStorage/);
  assert.match(source, /"X-Admin-Token"/);
  assert.doesNotMatch(source, /X-ROOT-ADMIN-TOKEN/);
});
