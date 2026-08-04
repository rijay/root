const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizePersistedCredentials,
  phoneFingerprint,
  sessionTokenDigest,
} = require("../src/credentialProtection");
const domain = require("../src/domain");

test("phone fingerprints are keyed, versioned, and never contain the raw phone", () => {
  const first = phoneFingerprint("138 0000 0000", { ROOT_PHONE_HMAC_KEY: "test-key-a" });
  const repeated = phoneFingerprint("13800000000", { ROOT_PHONE_HMAC_KEY: "test-key-a" });
  const otherKey = phoneFingerprint("13800000000", { ROOT_PHONE_HMAC_KEY: "test-key-b" });

  assert.match(first, /^hmac-sha256:v1:[a-f0-9]{64}$/);
  assert.equal(first, repeated);
  assert.notEqual(first, otherKey);
  assert.doesNotMatch(first, /13800000000/);
});

test("phone fingerprints fail closed without a key in production and cloud runtimes", () => {
  assert.throws(
    () => phoneFingerprint("13800000000", { NODE_ENV: "production" }),
    (error) => error && error.code === "PHONE_HMAC_KEY_REQUIRED"
  );
  assert.throws(
    () => phoneFingerprint("13800000000", { TCB_ENV: "myroot-prod" }),
    (error) => error && error.code === "PHONE_HMAC_KEY_REQUIRED"
  );
});

test("missing production phone key fails before creating partial identity facts", () => {
  const store = domain.createStore();

  assert.throws(
    () => domain.login(store, {
      phone: "13800009999",
      env: { NODE_ENV: "production" },
    }),
    (error) => error && error.code === "PHONE_HMAC_KEY_REQUIRED"
  );

  assert.equal(store.rootUsers.length, 0);
  assert.equal(store.wechatIdentities.length, 0);
  assert.equal(store.userContactMethods.length, 0);
});

test("session token digests are deterministic and do not retain bearer material", () => {
  const digest = sessionTokenDigest("root_secret_bearer");
  assert.match(digest, /^sha256:v1:[a-f0-9]{64}$/);
  assert.equal(digest, sessionTokenDigest("root_secret_bearer"));
  assert.doesNotMatch(digest, /root_secret_bearer/);
});

test("persisted credential normalization removes raw sessions and token-map-only access", () => {
  const data = {
    sessions: [
      {
        session_id: "ses_legacy",
        token: "root_legacy_secret",
        user_id: "usr_1",
        expires_at: "2099-01-01T00:00:00.000Z",
        revoked_at: "",
      },
    ],
    tokens: {
      root_legacy_secret: "usr_1",
      root_map_only_secret: "usr_2",
    },
    idempotency: {
      legacy_login_request: {
        code: 0,
        data: { token: "root_legacy_secret" },
      },
      mysql_probe_sentinel: { status: "RESERVED" },
    },
  };

  normalizePersistedCredentials(data);

  const digest = sessionTokenDigest("root_legacy_secret");
  assert.equal(data.sessions[0].token, undefined);
  assert.equal(data.sessions[0].token_hash, digest);
  assert.deepEqual(data.tokens, { [digest]: "usr_1" });
  assert.deepEqual(data.idempotency, { mysql_probe_sentinel: { status: "RESERVED" } });
  assert.equal(JSON.stringify(data).includes("root_legacy_secret"), false);
  assert.equal(JSON.stringify(data).includes("root_map_only_secret"), false);
});

test("new login persists only protected phone and session representations", () => {
  const store = domain.createStore();
  const result = domain.login(store, {
    phone: "13800001234",
    env: { ROOT_PHONE_HMAC_KEY: "integration-test-phone-key" },
  }).data;
  const digest = sessionTokenDigest(result.token);

  assert.equal(store.userContactMethods[0].phone_masked, "138****1234");
  assert.match(store.userContactMethods[0].phone_hash, /^hmac-sha256:v1:/);
  assert.doesNotMatch(store.userContactMethods[0].phone_hash, /13800001234/);
  assert.equal(store.sessions[0].token, undefined);
  assert.equal(store.sessions[0].token_hash, digest);
  assert.equal(store.tokens[result.token], undefined);
  assert.equal(store.tokens[digest], result.user.userId);
  assert.equal(domain.getUserState(store, result.token).code, 0);
});

test("legacy token-map entries without a session cannot authenticate", () => {
  const store = domain.createStore();
  const login = domain.login(store, {
    phone: "13800005678",
    env: { ROOT_PHONE_HMAC_KEY: "integration-test-phone-key" },
  }).data;
  store.sessions = [];
  store.tokens = { root_map_only_secret: login.user.userId };

  assert.throws(
    () => domain.getFormalProfile(store, "root_map_only_secret"),
    (error) => error && error.code === 1003
  );
});
