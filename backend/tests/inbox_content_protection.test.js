const test = require("node:test");
const assert = require("node:assert/strict");

const { createInboxContentCodec } = require("../src/inboxContentProtection");

const activeSecret = "inbox-content-test-key-with-at-least-32-characters";
const previousSecret = "previous-inbox-content-key-with-at-least-32-characters";
const protectedEnv = Object.freeze({
  NODE_ENV: "production",
  ROOT_INBOX_CONTENT_ENCRYPTION_KEY: activeSecret,
  ROOT_INBOX_CONTENT_KEY_ID: "inbox-key-v2",
  ROOT_INBOX_CONTENT_DECRYPTION_KEYS_JSON: JSON.stringify({
    "inbox-key-v1": previousSecret,
  }),
});
const payloadBinding = Object.freeze({
  consumerName: "task-projection-v1",
  sourceName: "myroot-api",
  partitionKey: "health-assessment:user-001",
  partitionPosition: 1,
  eventId: "event-health-001",
  handlerVersion: "task-projection-v1",
});

test("protected Inbox content is authenticated and hides sensitive health plaintext", () => {
  const codec = createInboxContentCodec(protectedEnv);
  const payload = {
    mobile: "13800138000",
    questionnaireAnswers: ["sensitive-answer-a", "sensitive-answer-b"],
    gutState: "sensitive-gut-state",
  };

  const sealed = codec.seal(payload, { purpose: "PAYLOAD", binding: payloadBinding });
  const serialized = JSON.stringify(sealed.stored);
  assert.equal(sealed.protected, true);
  assert.equal(sealed.keyId, "inbox-key-v2");
  assert.equal(sealed.stored.protection, "A256GCM");
  assert.equal(sealed.stored.codecVersion, "A256GCM:v1");
  assert.match(sealed.contentDigest, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(serialized, /13800138000|sensitive-answer|sensitive-gut-state/);
  assert.deepEqual(
    codec.open(sealed.stored, { purpose: "PAYLOAD", binding: payloadBinding }),
    {
      value: payload,
      contentDigest: sealed.contentDigest,
      keyId: "inbox-key-v2",
      protected: true,
      codecVersion: "A256GCM:v1",
      digestScheme: "hmac-sha256:v1",
    }
  );
  assert.deepEqual(codec.getStatus(), {
    ready: true,
    enabled: true,
    status: "INBOX_CONTENT_PROTECTION_READY",
    decryptionKeyCount: 2,
  });
});

test("canonical envelope exposes an explicit codec version and rejects oversized content before decrypt", () => {
  const codec = createInboxContentCodec(protectedEnv);
  const sealed = codec.seal({ answer: "private" }, { purpose: "RESULT", binding: payloadBinding });
  assert.deepEqual(codec.inspectEnvelope(sealed.stored), {
    protected: true,
    codecVersion: "A256GCM:v1",
    digestScheme: "hmac-sha256:v1",
    keyId: "inbox-key-v2",
    purpose: "RESULT",
    contentDigest: sealed.contentDigest,
  });

  assert.throws(
    () => codec.seal({ text: "x".repeat(64 * 1024) }, {
      purpose: "PAYLOAD",
      binding: payloadBinding,
    }),
    (error) => error && error.code === "INBOX_CONTENT_SIZE_LIMIT"
  );
  assert.throws(
    () => codec.open({
      ...sealed.stored,
      ciphertext: "A".repeat(4 * Math.ceil((96 * 1024) / 3) + 4),
    }, { purpose: "RESULT", binding: payloadBinding }),
    (error) => error && error.code === "INBOX_CONTENT_ENVELOPE_INVALID"
  );
});

test("purpose and immutable binding are authenticated independently", () => {
  const codec = createInboxContentCodec(protectedEnv);
  const sealed = codec.seal({ answer: "private" }, { purpose: "PAYLOAD", binding: payloadBinding });

  assert.throws(
    () => codec.open(sealed.stored, { purpose: "RESULT", binding: payloadBinding }),
    (error) => error && error.code === "INBOX_CONTENT_PURPOSE_MISMATCH"
  );
  assert.throws(
    () => codec.open(sealed.stored, {
      purpose: "PAYLOAD",
      binding: { ...payloadBinding, partitionPosition: 2 },
    }),
    (error) => error && error.code === "INBOX_CONTENT_BINDING_MISMATCH"
  );
});

test("tampering with ciphertext, digest or canonical envelope fails closed", () => {
  const codec = createInboxContentCodec(protectedEnv);
  const sealed = codec.seal({ answer: "private" }, { purpose: "RESULT", binding: payloadBinding });
  const malformed = [
    { ...sealed.stored, ciphertext: `${sealed.stored.ciphertext.slice(0, -4)}AAAA` },
    { ...sealed.stored, contentDigest: "0".repeat(64) },
    { ...sealed.stored, unexpected: true },
  ];

  for (const stored of malformed) {
    assert.throws(
      () => codec.open(stored, { purpose: "RESULT", binding: payloadBinding }),
      (error) => error && [
        "INBOX_CONTENT_DECRYPT_FAILED",
        "INBOX_CONTENT_ENVELOPE_INVALID",
      ].includes(error.code)
    );
  }
});

test("previous keys are decode-only and active key remains authoritative for new writes", () => {
  const previousCodec = createInboxContentCodec({
    NODE_ENV: "production",
    ROOT_INBOX_CONTENT_ENCRYPTION_KEY: previousSecret,
    ROOT_INBOX_CONTENT_KEY_ID: "inbox-key-v1",
  });
  const previous = previousCodec.seal(
    { answer: "created-before-rotation" },
    { purpose: "PAYLOAD", binding: payloadBinding }
  );
  const rotated = createInboxContentCodec(protectedEnv);

  assert.equal(rotated.open(previous.stored, {
    purpose: "PAYLOAD",
    binding: payloadBinding,
  }).value.answer, "created-before-rotation");
  assert.equal(rotated.seal({ answer: "new" }, {
    purpose: "PAYLOAD",
    binding: payloadBinding,
  }).keyId, "inbox-key-v2");
});

test("keyed digest is domain-bound and can be verified with the persisted key id", () => {
  const codec = createInboxContentCodec(protectedEnv);
  const value = { manifest: "low-entropy-value" };
  const payloadDigest = codec.digest(value, {
    purpose: "PAYLOAD",
    binding: payloadBinding,
    keyId: "inbox-key-v2",
  });
  const manifestDigest = codec.digest(value, {
    purpose: "MANIFEST",
    binding: payloadBinding,
    keyId: "inbox-key-v2",
  });

  assert.match(payloadDigest, /^[a-f0-9]{64}$/);
  assert.notEqual(payloadDigest, manifestDigest);
  assert.equal(codec.verifyDigest(value, payloadDigest, {
    purpose: "PAYLOAD",
    binding: payloadBinding,
    keyId: "inbox-key-v2",
  }), true);
  assert.equal(codec.verifyDigest({ manifest: "guessed-other-value" }, payloadDigest, {
    purpose: "PAYLOAD",
    binding: payloadBinding,
    keyId: "inbox-key-v2",
  }), false);
});

test("protected runtime fails closed for missing, weak, unidentified or malformed keys", () => {
  const invalidEnvironments = [
    { NODE_ENV: "production" },
    {
      NODE_ENV: "production",
      ROOT_INBOX_CONTENT_ENCRYPTION_KEY: "too-short",
      ROOT_INBOX_CONTENT_KEY_ID: "v1",
    },
    {
      NODE_ENV: "production",
      ROOT_INBOX_CONTENT_ENCRYPTION_KEY: activeSecret,
    },
    {
      NODE_ENV: "production",
      ROOT_INBOX_CONTENT_ENCRYPTION_KEY: activeSecret,
      ROOT_INBOX_CONTENT_KEY_ID: "invalid/key",
    },
    {
      ...protectedEnv,
      ROOT_INBOX_CONTENT_DECRYPTION_KEYS_JSON: "[]",
    },
  ];

  for (const env of invalidEnvironments) {
    const codec = createInboxContentCodec(env);
    assert.equal(codec.getStatus().ready, false);
    assert.throws(() => codec.assertReady(), (error) => /^INBOX_CONTENT_/.test(error && error.code));
  }
});

test("local compatibility preserves existing fixtures but advertises plaintext status", () => {
  const codec = createInboxContentCodec({ NODE_ENV: "test" });
  const value = { local: "fixture-only" };
  const sealed = codec.seal(value, { purpose: "PAYLOAD", binding: payloadBinding });

  assert.deepEqual(sealed.stored, value);
  assert.equal(sealed.protected, false);
  assert.deepEqual(codec.open(sealed.stored, {
    purpose: "PAYLOAD",
    binding: payloadBinding,
  }).value, value);
  assert.deepEqual(codec.getStatus(), {
    ready: true,
    enabled: false,
    status: "LOCAL_PLAINTEXT_COMPATIBILITY",
    decryptionKeyCount: 0,
  });
});
