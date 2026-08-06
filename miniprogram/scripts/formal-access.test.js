const assert = require("node:assert/strict");

const {
  FORMAL_ACCESS_STATE,
  classifyFormalProfile,
  loginRoute,
} = require("../utils/formal-access");

assert.equal(classifyFormalProfile(null), FORMAL_ACCESS_STATE.PHONE_REQUIRED);
assert.equal(classifyFormalProfile({ phoneVerified: false, complete: true }), FORMAL_ACCESS_STATE.PHONE_REQUIRED);
assert.equal(classifyFormalProfile({ phoneVerified: true, complete: false }), FORMAL_ACCESS_STATE.PROFILE_REQUIRED);
assert.equal(classifyFormalProfile({ phoneVerified: true, complete: true }), FORMAL_ACCESS_STATE.READY);
assert.equal(loginRoute(), "/pages/login/index");
assert.equal(
  loginRoute("/pages/health/index"),
  "/pages/login/index?intent=%2Fpages%2Fhealth%2Findex",
);

console.log("formal access tests ok");
