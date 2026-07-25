const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
  createCommandRequestDigestCodec,
  verifyLegacySha256V0,
} = require("../src/commandRequestDigest");

const protectedEnv = {
  NODE_ENV: "production",
  ROOT_COMMAND_REQUEST_DIGEST_KEY: "4f09c294c0fdd7f4f37d78eb32e1394348fa815a688b773a",
  ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: "command-request-2026-07",
};

function descriptor(overrides = {}) {
  return {
    commandName: "TASK_EVENT_RECORD",
    actorId: "user-001",
    idempotencyKey: "task-event-business-key-001",
    request: {
      taskId: "task-001",
      eventType: "CHECK_IN",
      answers: { sleep: 7, mood: "steady" },
    },
    ...overrides,
  };
}

test("hmac-sha256:v1 binds every command scope field and canonical-json:v1 request", () => {
  const codec = createCommandRequestDigestCodec(protectedEnv);
  const first = codec.digest(descriptor());
  const reordered = codec.digest(descriptor({
    request: {
      answers: { mood: "steady", sleep: 7 },
      eventType: "CHECK_IN",
      taskId: "task-001",
    },
  }));

  assert.deepEqual(first, reordered);
  assert.deepEqual(Object.keys(first).sort(), ["canonicalVersion", "digest", "digestVersion", "keyId"]);
  assert.equal(first.canonicalVersion, "canonical-json:v1");
  assert.equal(first.digestVersion, "hmac-sha256:v1");
  assert.equal(first.keyId, protectedEnv.ROOT_COMMAND_REQUEST_DIGEST_KEY_ID);
  assert.match(first.digest, /^[a-f0-9]{64}$/);
  assert.equal(codec.verify(first, descriptor()), true);

  for (const changed of [
    descriptor({ commandName: "OTHER_COMMAND" }),
    descriptor({ actorId: "user-002" }),
    descriptor({ idempotencyKey: "task-event-business-key-002" }),
    descriptor({ request: { ...descriptor().request, taskId: "task-002" } }),
  ]) {
    assert.notEqual(codec.digest(changed).digest, first.digest);
    assert.equal(codec.verify(first, changed), false);
  }

  const renamedKey = createCommandRequestDigestCodec({
    ...protectedEnv,
    ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: "command-request-2026-08",
  });
  assert.notEqual(renamedKey.digest(descriptor()).digest, first.digest);

  const persisted = JSON.stringify(first);
  assert.doesNotMatch(persisted, /task-event-business-key|task-001|steady|4f09c294/);
});

test("caller-supplied digests are ignored and verification always recomputes", () => {
  const codec = createCommandRequestDigestCodec(protectedEnv);
  const expected = codec.digest(descriptor());
  const forgedInput = descriptor({
    requestDigest: "0".repeat(64),
    request_digest: "f".repeat(64),
    digest: "a".repeat(64),
  });

  assert.deepEqual(codec.digest(forgedInput), expected);
  assert.equal(codec.verify({ ...expected, digest: "0".repeat(64) }, forgedInput), false);
});

test("protected runtime fails closed without a strong identified active key", () => {
  const missing = createCommandRequestDigestCodec({ NODE_ENV: "production" });
  assert.deepEqual(missing.getStatus(), {
    ready: false,
    status: "COMMAND_REQUEST_DIGEST_KEY_REQUIRED",
    canonicalVersion: "canonical-json:v1",
    digestVersion: "hmac-sha256:v1",
  });
  assert.throws(
    () => missing.assertReady(),
    (error) => error && error.code === "COMMAND_REQUEST_DIGEST_KEY_REQUIRED" && error.status === 503
  );

  for (const [env, code] of [
    [{
      NODE_ENV: "production",
      ROOT_COMMAND_REQUEST_DIGEST_KEY: "too-short",
      ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: "v1",
    }, "COMMAND_REQUEST_DIGEST_KEY_INVALID"],
    [{
      NODE_ENV: "production",
      ROOT_COMMAND_REQUEST_DIGEST_KEY: "x".repeat(64),
      ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: "v1",
    }, "COMMAND_REQUEST_DIGEST_KEY_INVALID"],
    [{
      NODE_ENV: "production",
      ROOT_COMMAND_REQUEST_DIGEST_KEY: protectedEnv.ROOT_COMMAND_REQUEST_DIGEST_KEY,
    }, "COMMAND_REQUEST_DIGEST_KEY_ID_REQUIRED"],
    [{
      NODE_ENV: "production",
      ROOT_COMMAND_REQUEST_DIGEST_KEY: protectedEnv.ROOT_COMMAND_REQUEST_DIGEST_KEY,
      ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: "bad key id",
    }, "COMMAND_REQUEST_DIGEST_KEY_ID_INVALID"],
  ]) {
    const codec = createCommandRequestDigestCodec(env);
    assert.throws(() => codec.digest(descriptor()), (error) => error && error.code === code);
  }
});

test("verification rejects unknown metadata and key rotation without leaking material", () => {
  const codec = createCommandRequestDigestCodec(protectedEnv);
  const stored = codec.digest(descriptor());

  assert.equal(codec.verify({ ...stored, canonicalVersion: "canonical-json:v2" }, descriptor()), false);
  assert.equal(codec.verify({ ...stored, digestVersion: "sha256:v0" }, descriptor()), false);
  assert.equal(codec.verify({ ...stored, keyId: "retired-key" }, descriptor()), false);
  assert.equal(codec.verify({ ...stored, digest: "not-a-digest" }, descriptor()), false);
  const hostileStored = {};
  Object.defineProperty(hostileStored, "digestVersion", {
    enumerable: true,
    get() {
      throw new Error("stored-private-material");
    },
  });
  assert.equal(codec.verify(hostileStored, descriptor()), false);

  const otherKey = createCommandRequestDigestCodec({
    ...protectedEnv,
    ROOT_COMMAND_REQUEST_DIGEST_KEY: "39be77bb11d1aaf011b5096ec1ed92a7247b40d6628768bf",
  });
  assert.equal(otherKey.verify(stored, descriptor()), false);

  const sensitiveRequest = "private-health-answer-never-log";
  const sensitiveSecret = "secret-material-never-log-12345678901234567890";
  const invalidCodec = createCommandRequestDigestCodec({
    NODE_ENV: "production",
    ROOT_COMMAND_REQUEST_DIGEST_KEY: sensitiveSecret,
    ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: "bad key id",
  });
  assert.throws(
    () => invalidCodec.digest(descriptor({ request: { sensitiveRequest } })),
    (error) => {
      const serialized = `${error.code}:${error.message}:${error.stack}`;
      assert.doesNotMatch(serialized, new RegExp(sensitiveRequest));
      assert.doesNotMatch(serialized, new RegExp(sensitiveSecret));
      return true;
    }
  );

  const hostileEnvironment = {
    NODE_ENV: "production",
    ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: "v1",
    ROOT_COMMAND_REQUEST_DIGEST_KEY: {
      toString() {
        throw new Error("environment-private-material");
      },
    },
  };
  assert.throws(
    () => createCommandRequestDigestCodec(hostileEnvironment).digest(descriptor()),
    (error) => error
      && error.code === "COMMAND_REQUEST_DIGEST_KEY_INVALID"
      && !String(error.message).includes("environment-private-material")
  );
});

test("rotation writes only the current request-digest key and verifies a bounded previous key by stored keyId", () => {
  const previousEnv = {
    ...protectedEnv,
    ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: "command-request-2026-06",
    ROOT_COMMAND_REQUEST_DIGEST_KEY: "previous-command-request-digest-secret-material-2026-06",
  };
  const previous = createCommandRequestDigestCodec(previousEnv).digest(descriptor());
  const rotated = createCommandRequestDigestCodec({
    ...protectedEnv,
    ROOT_COMMAND_REQUEST_DIGEST_VERIFICATION_KEYS_JSON: JSON.stringify({
      [previousEnv.ROOT_COMMAND_REQUEST_DIGEST_KEY_ID]: previousEnv.ROOT_COMMAND_REQUEST_DIGEST_KEY,
    }),
    ROOT_KEY_INVENTORY_RETIRED_KEY_IDS_JSON: JSON.stringify({
      REQUEST_DIGEST: [],
      COMMAND_RESULT: [],
      INBOX_CONTENT: [],
      NOTIFICATION_RECEIPT: [],
    }),
  });

  assert.equal(rotated.classifyKeyId(previous.keyId), "PREVIOUS");
  assert.equal(rotated.classifyKeyId(protectedEnv.ROOT_COMMAND_REQUEST_DIGEST_KEY_ID), "CURRENT");
  assert.equal(rotated.verify(previous, descriptor()), true);
  assert.equal(rotated.digest(descriptor()).keyId, protectedEnv.ROOT_COMMAND_REQUEST_DIGEST_KEY_ID);
  assert.notEqual(rotated.digest(descriptor()).digest, previous.digest);
});

test("retired and unknown request-digest keys fail closed while malformed keyrings leak no material", () => {
  const retiredKeyId = "command-request-retired-v0";
  const retired = createCommandRequestDigestCodec({
    ...protectedEnv,
    ROOT_KEY_INVENTORY_RETIRED_KEY_IDS_JSON: JSON.stringify({
      REQUEST_DIGEST: [retiredKeyId],
      COMMAND_RESULT: [],
      INBOX_CONTENT: [],
      NOTIFICATION_RECEIPT: [],
    }),
  });
  const stored = createCommandRequestDigestCodec({
    ...protectedEnv,
    ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: retiredKeyId,
  }).digest(descriptor());
  assert.equal(retired.classifyKeyId(retiredKeyId), "RETIRED");
  assert.equal(retired.classifyKeyId("command-request-unknown-v9"), "UNKNOWN");
  assert.equal(retired.verify(stored, descriptor()), false);

  const privateMaterial = "previous-private-material-never-log-1234567890";
  for (const raw of [
    "not-json",
    JSON.stringify({ [protectedEnv.ROOT_COMMAND_REQUEST_DIGEST_KEY_ID]: privateMaterial }),
    JSON.stringify(Object.fromEntries(Array.from({ length: 9 }, (_, index) => [
      `previous-${index}`,
      `${privateMaterial}-${index}`,
    ]))),
    JSON.stringify({ "previous-weak": "too-short" }),
  ]) {
    const codec = createCommandRequestDigestCodec({
      ...protectedEnv,
      ROOT_COMMAND_REQUEST_DIGEST_VERIFICATION_KEYS_JSON: raw,
    });
    assert.throws(
      () => codec.assertReady(),
      (error) => {
        assert.equal(error && error.code, "COMMAND_REQUEST_DIGEST_KEY_RING_INVALID");
        assert.doesNotMatch(`${error.message}:${error.stack}`, /previous-private-material-never-log/);
        return true;
      }
    );
  }
});

test("canonical-json:v1 rejects values that are not unambiguous JSON", () => {
  const codec = createCommandRequestDigestCodec(protectedEnv);
  const circular = {};
  circular.self = circular;

  for (const request of [
    { value: Number.NaN },
    { value: 1n },
    { value: undefined },
    { value: () => true },
    circular,
    new Date("2026-07-16T00:00:00.000Z"),
  ]) {
    assert.throws(
      () => codec.digest(descriptor({ request })),
      (error) => error
        && error.code === "COMMAND_REQUEST_NOT_CANONICALIZABLE"
        && !String(error.message).includes("private")
    );
  }
});

test("non-protected runtime uses a keyed local compatibility configuration", () => {
  const codec = createCommandRequestDigestCodec({ NODE_ENV: "test" });
  assert.deepEqual(codec.getStatus(), {
    ready: true,
    status: "LOCAL_COMMAND_REQUEST_DIGEST_KEY",
    canonicalVersion: "canonical-json:v1",
    digestVersion: "hmac-sha256:v1",
    keyId: "local-development-v1",
  });
  assert.equal(codec.verify(codec.digest(descriptor()), descriptor()), true);
});

test("sha256:v0 helper verifies legacy values read-only with timing-safe comparison", () => {
  const request = {
    z: [1, undefined, "x"],
    a: { nested: true },
  };
  const legacyCanonical = "{\"a\":{\"nested\":true},\"z\":[1,null,\"x\"]}";
  const digest = crypto.createHash("sha256").update(legacyCanonical).digest("hex");

  assert.equal(verifyLegacySha256V0(digest, request), true);
  assert.equal(verifyLegacySha256V0({ digestVersion: "sha256:v0", digest }, request), true);
  assert.equal(verifyLegacySha256V0(digest, { ...request, a: { nested: false } }), false);
  assert.equal(verifyLegacySha256V0({ digestVersion: "hmac-sha256:v1", digest }, request), false);
  assert.equal(verifyLegacySha256V0("not-a-digest", request), false);
});
