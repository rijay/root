const assert = require("node:assert/strict");

const { appVersion } = require("../config/version");
const packageVersion = require("../package.json").version;

assert.equal(appVersion, "0.8.1");
assert.equal(packageVersion, "0.8.1");

console.log("myRoot v0.8.1 version contract passed");
