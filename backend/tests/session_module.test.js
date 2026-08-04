const test = require("node:test");
const assert = require("node:assert/strict");

const { createSeedData } = require("../src/seed");
const profileModule = require("../src/profileModule");
const sessionModule = require("../src/sessionModule");

function userFixture() {
  return {
    user_id: "usr_session",
    root_user_id: "usr_session",
    phone: "13800138000",
    state: "UNREGISTERED",
    registered_at: "",
  };
}

test("formal login exposes only the four approved outcomes", () => {
  assert.deepEqual(Object.values(sessionModule.LOGIN_OUTCOMES).sort(), [
    "IDENTITY_CONFLICT",
    "NEW_USER",
    "PROFILE_REQUIRED",
    "REGISTERED",
  ]);
});

test("new account and incomplete existing member are separated", () => {
  const data = createSeedData();
  const user = userFixture();
  assert.equal(sessionModule.classify({ data, user, created: true }), "NEW_USER");
  assert.equal(sessionModule.classify({ data, user, created: false }), "PROFILE_REQUIRED");
});

test("completed profile returns registered outcome", () => {
  const data = createSeedData();
  const user = userFixture();
  data.users.push(user);
  profileModule.save(data, user, { birthDate: "1990-01-01", gender: "MALE" });
  assert.equal(sessionModule.classify({ data, user, created: false }), "REGISTERED");
});

test("trusted identity conflicts are mapped without issuing a false success", () => {
  const result = sessionModule.fromIdentityError({
    code: "WECHAT_IDENTITY_BINDING_CONFLICT",
    message: "conflict",
  });
  assert.equal(result.sessionOutcome, "IDENTITY_CONFLICT");
  assert.equal(result.token, "");
  assert.equal(result.nextRoute, "/pages/home/index");
});
