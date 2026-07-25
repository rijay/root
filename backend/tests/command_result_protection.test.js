const crypto = require("node:crypto");
const test = require("node:test");
const assert = require("node:assert/strict");

const { createCommandResultCodec } = require("../src/commandResultProtection");
const {
  COMMAND_RESULT_PROTECTION_POLICY,
} = require("../src/commandResultProtectionPolicy");

const protectedEnv = {
  NODE_ENV: "production",
  ROOT_COMMAND_RESULT_ENCRYPTION_KEY: "command-result-test-key-with-at-least-32-characters",
  ROOT_COMMAND_RESULT_KEY_ID: "test-key-v1",
};
const binding = "cmdidem_001\u0000HEALTH_ASSESSMENT_SUBMIT\u0000user-001\u0000request-001";
const MAX_PLAINTEXT_BYTES_V1 = 128 * 1024;

function authenticatedEnvelopeForRawPlaintext(plaintext) {
  const keyId = protectedEnv.ROOT_COMMAND_RESULT_KEY_ID;
  const key = crypto.createHash("sha256")
    .update(protectedEnv.ROOT_COMMAND_RESULT_ENCRYPTION_KEY, "utf8")
    .digest();
  const expectedBindingDigest = crypto.createHash("sha256").update(binding, "utf8").digest("hex");
  const iv = Buffer.alloc(12, 0x5a);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`myroot-command-result:${keyId}:${expectedBindingDigest}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    protection: "A256GCM",
    keyId,
    bindingDigest: expectedBindingDigest,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

test("internal A256GCM:v1 size policy is fixed without expanding the codec export", () => {
  assert.deepEqual(Object.keys(require("../src/commandResultProtection")), ["createCommandResultCodec"]);
  assert.equal(COMMAND_RESULT_PROTECTION_POLICY.policyVersion, "COMMAND_RESULT_PROTECTION_POLICY:v1");
  assert.equal(COMMAND_RESULT_PROTECTION_POLICY.maximumPlaintextBytes, 131072);
  assert.equal(COMMAND_RESULT_PROTECTION_POLICY.maximumCiphertextBytes, 131072);
  assert.equal(COMMAND_RESULT_PROTECTION_POLICY.maximumCiphertextBase64Characters, 174764);
  assert.equal(COMMAND_RESULT_PROTECTION_POLICY.maximumEnvelopeBytes, 184320);
  assert.equal(Object.isFrozen(COMMAND_RESULT_PROTECTION_POLICY), true);
  assert.equal(Object.isFrozen(COMMAND_RESULT_PROTECTION_POLICY.envelopeFields), true);
});

test("protected command results are authenticated and never persist health plaintext", () => {
  const codec = createCommandResultCodec(protectedEnv);
  const result = {
    code: 0,
    data: {
      gutState: "sensitive-gut-state",
      questionnaireAnswers: ["sensitive-answer-a", "sensitive-answer-b"],
    },
  };

  const stored = codec.encode(result, { binding });
  const serialized = JSON.stringify(stored);
  assert.equal(stored.protection, "A256GCM");
  assert.equal(stored.keyId, "test-key-v1");
  assert.doesNotMatch(serialized, /sensitive-gut-state|sensitive-answer/);
  assert.match(stored.bindingDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(codec.decode(stored, { binding }), result);
  assert.deepEqual(codec.getStatus(), {
    ready: true,
    enabled: true,
    status: "COMMAND_RESULT_PROTECTION_READY",
  });
});

test("explicit command result keys enforce byte length, clean edges and character diversity", () => {
  const invalidSecrets = [
    " 0123456789abcdef0123456789abcdef",
    "0123456789abcdef0123456789abcdef ",
    "0123456789abcdef\u00000123456789abcdef",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "123456-123456-123456-123456-123456-",
  ];

  for (const secret of invalidSecrets) {
    const codec = createCommandResultCodec({
      NODE_ENV: "test",
      ROOT_COMMAND_RESULT_ENCRYPTION_KEY: secret,
      ROOT_COMMAND_RESULT_KEY_ID: "test-key-v1",
    });
    assert.throws(
      () => codec.assertReady(),
      (error) => {
        assert.equal(error && error.code, "COMMAND_RESULT_KEY_REQUIRED");
        assert.doesNotMatch(error.message, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        return true;
      }
    );
  }

  const byteLengthCodec = createCommandResultCodec({
    NODE_ENV: "test",
    ROOT_COMMAND_RESULT_ENCRYPTION_KEY: "甲乙丙丁戊己庚辛壬癸子丑",
    ROOT_COMMAND_RESULT_KEY_ID: "unicode-key-v1",
  });
  assert.equal(byteLengthCodec.assertReady(), true);
});

test("command result key identifiers use a persistence-safe exact format", () => {
  const invalidKeyIds = [
    " key-v1",
    "key-v1 ",
    "key/v1",
    "key:v1",
    "_key-v1",
    "a".repeat(65),
  ];

  for (const keyId of invalidKeyIds) {
    const codec = createCommandResultCodec({
      ...protectedEnv,
      ROOT_COMMAND_RESULT_KEY_ID: keyId,
    });
    assert.throws(
      () => codec.assertReady(),
      (error) => error && error.code === "COMMAND_RESULT_KEY_ID_INVALID"
    );
  }
});

test("inspectEnvelope accepts only complete canonical A256GCM envelopes without decrypting", () => {
  const codec = createCommandResultCodec(protectedEnv);
  const stored = codec.encode({ code: 0, data: { value: "inspect-only-secret" } }, { binding });

  assert.deepEqual(codec.inspectEnvelope(stored), {
    protected: true,
    codecVersion: "A256GCM:v1",
    keyId: "test-key-v1",
  });

  const validButTampered = {
    ...stored,
    ciphertext: Buffer.from("not-the-original-ciphertext", "utf8").toString("base64"),
  };
  assert.deepEqual(codec.inspectEnvelope(validButTampered), {
    protected: true,
    codecVersion: "A256GCM:v1",
    keyId: "test-key-v1",
  });
  assert.throws(
    () => codec.decode(validButTampered, { binding }),
    (error) => error && error.code === "COMMAND_RESULT_DECRYPT_FAILED"
  );
});

test("inspectEnvelope rejects incomplete, ambiguous or malformed persistence envelopes", () => {
  const codec = createCommandResultCodec({ NODE_ENV: "test" });
  const complete = createCommandResultCodec(protectedEnv).encode({ code: 0 }, { binding });
  const malformed = [
    null,
    [],
    { code: 0 },
    { ...complete, protection: "A128GCM" },
    { ...complete, keyId: "invalid/key" },
    { ...complete, bindingDigest: complete.bindingDigest.toUpperCase() },
    { ...complete, bindingDigest: "0".repeat(63) },
    { ...complete, iv: "!!!!" },
    { ...complete, iv: Buffer.alloc(11).toString("base64") },
    { ...complete, tag: Buffer.alloc(15).toString("base64") },
    { ...complete, ciphertext: "" },
    { ...complete, ciphertext: "YQ" },
    { ...complete, unexpected: true },
  ];
  const { tag: _tag, ...missingTag } = complete;
  malformed.push(missingTag);

  for (const candidate of malformed) {
    assert.throws(
      () => codec.inspectEnvelope(candidate),
      (error) => error && error.code === "COMMAND_RESULT_ENVELOPE_INVALID"
    );
  }
});

test("A256GCM:v1 accepts exactly 128 KiB of serialized plaintext and rejects one byte more", () => {
  const codec = createCommandResultCodec(protectedEnv);
  const exactBoundary = "x".repeat(MAX_PLAINTEXT_BYTES_V1 - 2);
  const oversizedMarker = `do-not-leak-${"x".repeat(MAX_PLAINTEXT_BYTES_V1 - 12)}`;

  assert.equal(Buffer.byteLength(JSON.stringify(exactBoundary), "utf8"), MAX_PLAINTEXT_BYTES_V1);
  const stored = codec.encode(exactBoundary, { binding });
  assert.equal(Buffer.from(stored.ciphertext, "base64").length, MAX_PLAINTEXT_BYTES_V1);
  assert.equal(codec.decode(stored, { binding }), exactBoundary);

  assert.equal(Buffer.byteLength(JSON.stringify(oversizedMarker), "utf8") > MAX_PLAINTEXT_BYTES_V1, true);
  assert.throws(
    () => codec.encode(oversizedMarker, { binding }),
    (error) => {
      assert.equal(error && error.code, "COMMAND_RESULT_PLAINTEXT_TOO_LARGE");
      assert.equal(error && error.status, 413);
      assert.doesNotMatch(error.message, /do-not-leak/);
      assert.equal(Object.hasOwn(error, "cause"), false);
      return true;
    }
  );
});

test("local plaintext compatibility uses the same A256GCM:v1 128 KiB contract", () => {
  const codec = createCommandResultCodec({ NODE_ENV: "test" });
  const exactBoundary = "本".repeat((MAX_PLAINTEXT_BYTES_V1 - 2) / 3);
  const oversized = `${exactBoundary}本`;

  assert.equal(Buffer.byteLength(JSON.stringify(exactBoundary), "utf8"), MAX_PLAINTEXT_BYTES_V1);
  assert.equal(codec.encode(exactBoundary), exactBoundary);
  assert.equal(codec.decode(exactBoundary), exactBoundary);
  for (const operation of [
    () => codec.encode(oversized),
    () => codec.decode(oversized),
  ]) {
    assert.throws(
      operation,
      (error) => error
        && error.code === "COMMAND_RESULT_PLAINTEXT_TOO_LARGE"
        && error.status === 413
    );
  }
});

test("encode rejects non-serializable results with a stable content-free failure", () => {
  const codec = createCommandResultCodec(protectedEnv);
  const circular = { marker: "do-not-leak-circular" };
  circular.self = circular;

  for (const value of [1n, circular, () => "do-not-leak-function"]) {
    assert.throws(
      () => codec.encode(value, { binding }),
      (error) => {
        assert.equal(error && error.code, "COMMAND_RESULT_SERIALIZATION_INVALID");
        assert.equal(error && error.status, 409);
        assert.doesNotMatch(error.message, /do-not-leak|BigInt|circular|function/i);
        assert.equal(Object.hasOwn(error, "cause"), false);
        return true;
      }
    );
  }
});

test("inspect and decode reject oversized ciphertext before accepting an envelope", () => {
  const codec = createCommandResultCodec(protectedEnv);
  const stored = codec.encode({ code: 0 }, { binding });
  const oversized = [1, 2].map((extraBytes) => ({
    ...stored,
    ciphertext: Buffer.alloc(MAX_PLAINTEXT_BYTES_V1 + extraBytes).toString("base64"),
  }));

  for (const candidate of oversized) {
    for (const operation of [
      () => codec.inspectEnvelope(candidate),
      () => codec.decode(candidate, { binding }),
    ]) {
      assert.throws(
        operation,
        (error) => error
          && error.code === "COMMAND_RESULT_ENVELOPE_INVALID"
          && !Object.hasOwn(error, "cause")
      );
    }
  }
});

test("decode performs complete canonical envelope inspection before authentication", () => {
  const codec = createCommandResultCodec(protectedEnv);
  const stored = codec.encode({ code: 0, marker: "do-not-leak-envelope" }, { binding });
  const malformed = [
    { ...stored, unexpected: true },
    { ...stored, iv: "YQ" },
    { ...stored, tag: `${stored.tag.slice(0, -1)}A` },
    { ...stored, ciphertext: `${stored.ciphertext.slice(0, -1)}\n` },
  ];

  for (const candidate of malformed) {
    assert.throws(
      () => codec.decode(candidate, { binding }),
      (error) => {
        assert.equal(error && error.code, "COMMAND_RESULT_ENVELOPE_INVALID");
        assert.doesNotMatch(error.message, /do-not-leak-envelope/);
        assert.equal(Object.hasOwn(error, "cause"), false);
        return true;
      }
    );
  }
});

test("decode snapshots exact envelope descriptors without invoking property getters", () => {
  const codec = createCommandResultCodec(protectedEnv);
  const result = { code: 0, data: { value: "descriptor-safe" } };
  const stored = codec.encode(result, { binding });
  const proxied = new Proxy(stored, {
    get() {
      throw new Error("do-not-leak-property-get");
    },
  });

  assert.deepEqual(codec.decode(proxied, { binding }), result);
});

test("decode converts Proxy descriptor failures into a stable content-free envelope error", () => {
  const codec = createCommandResultCodec(protectedEnv);
  const stored = codec.encode({ code: 0 }, { binding });
  const proxied = new Proxy(stored, {
    ownKeys() {
      throw new Error("do-not-leak-proxy-own-keys");
    },
  });

  for (const operation of [
    () => codec.inspectEnvelope(proxied),
    () => codec.decode(proxied, { binding }),
  ]) {
    assert.throws(operation, (error) => {
      assert.equal(error && error.code, "COMMAND_RESULT_ENVELOPE_INVALID");
      assert.doesNotMatch(error.message, /do-not-leak-proxy-own-keys/);
      assert.equal(Object.hasOwn(error, "cause"), false);
      return true;
    });
  }
});

test("exact envelope inspection rejects Symbol, non-enumerable, accessor and inherited shapes", () => {
  const codec = createCommandResultCodec(protectedEnv);
  const stored = codec.encode({ code: 0 }, { binding });
  const symbolExtra = { ...stored, [Symbol("do-not-leak-symbol")]: true };
  const nonEnumerableExtra = { ...stored };
  Object.defineProperty(nonEnumerableExtra, "do-not-leak-hidden", { value: true });
  const nonEnumerableField = { ...stored };
  Object.defineProperty(nonEnumerableField, "ciphertext", {
    value: stored.ciphertext,
    enumerable: false,
  });
  const accessorField = { ...stored };
  Object.defineProperty(accessorField, "ciphertext", {
    enumerable: true,
    get() {
      throw new Error("do-not-leak-accessor");
    },
  });
  const inheritedShape = Object.assign(Object.create({ inherited: true }), stored);

  for (const candidate of [
    symbolExtra,
    nonEnumerableExtra,
    nonEnumerableField,
    accessorField,
    inheritedShape,
  ]) {
    for (const operation of [
      () => codec.inspectEnvelope(candidate),
      () => codec.decode(candidate, { binding }),
    ]) {
      assert.throws(operation, (error) => {
        assert.equal(error && error.code, "COMMAND_RESULT_ENVELOPE_INVALID");
        assert.doesNotMatch(error.message, /do-not-leak/);
        assert.equal(Object.hasOwn(error, "cause"), false);
        return true;
      });
    }
  }
});

test("authenticated non-UTF-8 plaintext fails closed instead of replacement decoding", () => {
  const codec = createCommandResultCodec(protectedEnv);
  const invalidUtf8Json = Buffer.from([
    0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d,
  ]);
  const envelope = authenticatedEnvelopeForRawPlaintext(invalidUtf8Json);

  assert.deepEqual(codec.inspectEnvelope(envelope), {
    protected: true,
    codecVersion: "A256GCM:v1",
    keyId: "test-key-v1",
  });
  assert.throws(
    () => codec.decode(envelope, { binding }),
    (error) => error
      && error.code === "COMMAND_RESULT_DECRYPT_FAILED"
      && !Object.hasOwn(error, "cause")
  );
});

test("protected runtime fails closed for missing, weak or unidentified keys", () => {
  const missingCodec = createCommandResultCodec({ NODE_ENV: "production" });
  assert.deepEqual(missingCodec.getStatus(), {
    ready: false,
    enabled: false,
    status: "COMMAND_RESULT_KEY_REQUIRED",
  });
  assert.throws(
    () => missingCodec.assertReady(),
    (error) => error && error.code === "COMMAND_RESULT_KEY_REQUIRED"
  );
  assert.throws(
    () => createCommandResultCodec({ NODE_ENV: "production" }).encode({ code: 0 }),
    (error) => error && error.code === "COMMAND_RESULT_KEY_REQUIRED"
  );
  assert.throws(
    () => createCommandResultCodec({
      NODE_ENV: "production",
      ROOT_COMMAND_RESULT_ENCRYPTION_KEY: "too-short",
      ROOT_COMMAND_RESULT_KEY_ID: "v1",
    }).encode({ code: 0 }),
    (error) => error && error.code === "COMMAND_RESULT_KEY_REQUIRED"
  );
  assert.throws(
    () => createCommandResultCodec({
      NODE_ENV: "production",
      ROOT_COMMAND_RESULT_ENCRYPTION_KEY: protectedEnv.ROOT_COMMAND_RESULT_ENCRYPTION_KEY,
    }).encode({ code: 0 }),
    (error) => error && error.code === "COMMAND_RESULT_KEY_ID_REQUIRED"
  );
});

test("tampered or wrong-key command results cannot be replayed", () => {
  const codec = createCommandResultCodec(protectedEnv);
  const stored = codec.encode({ code: 0, data: { value: "verified" } }, { binding });
  const tampered = { ...stored, ciphertext: `${stored.ciphertext.slice(0, -2)}AA` };
  assert.throws(
    () => codec.decode(tampered, { binding }),
    (error) => error
      && error.code === "COMMAND_RESULT_DECRYPT_FAILED"
      && !Object.hasOwn(error, "cause")
  );

  const rotated = createCommandResultCodec({
    ...protectedEnv,
    ROOT_COMMAND_RESULT_ENCRYPTION_KEY: "different-command-result-key-with-at-least-32-characters",
  });
  assert.throws(
    () => rotated.decode(stored, { binding }),
    (error) => error && error.code === "COMMAND_RESULT_DECRYPT_FAILED"
  );
  assert.throws(
    () => codec.decode(stored, { binding: `${binding}-other-command` }),
    (error) => error && error.code === "COMMAND_RESULT_BINDING_MISMATCH"
  );
});

test("rotation decrypts a bounded previous command-result key while every new write uses the current key", () => {
  const previousEnv = {
    NODE_ENV: "production",
    ROOT_COMMAND_RESULT_ENCRYPTION_KEY: "previous-command-result-secret-material-2026-06",
    ROOT_COMMAND_RESULT_KEY_ID: "command-result-2026-06",
  };
  const previousStored = createCommandResultCodec(previousEnv).encode(
    { code: 0, data: { value: "previous-result" } },
    { binding }
  );
  const rotated = createCommandResultCodec({
    ...protectedEnv,
    ROOT_COMMAND_RESULT_DECRYPTION_KEYS_JSON: JSON.stringify({
      [previousEnv.ROOT_COMMAND_RESULT_KEY_ID]: previousEnv.ROOT_COMMAND_RESULT_ENCRYPTION_KEY,
    }),
    ROOT_KEY_INVENTORY_RETIRED_KEY_IDS_JSON: JSON.stringify({
      REQUEST_DIGEST: [],
      COMMAND_RESULT: [],
      INBOX_CONTENT: [],
      NOTIFICATION_RECEIPT: [],
    }),
  });

  assert.deepEqual(rotated.decode(previousStored, { binding }), {
    code: 0,
    data: { value: "previous-result" },
  });
  const currentStored = rotated.encode({ code: 0, data: { value: "current-result" } }, { binding });
  assert.equal(currentStored.keyId, protectedEnv.ROOT_COMMAND_RESULT_KEY_ID);
});

test("retired and unknown command-result keys fail closed and invalid keyrings never expose material", () => {
  const retiredEnv = {
    NODE_ENV: "production",
    ROOT_COMMAND_RESULT_ENCRYPTION_KEY: "retired-command-result-secret-material-2026-05",
    ROOT_COMMAND_RESULT_KEY_ID: "command-result-retired-v0",
  };
  const retiredStored = createCommandResultCodec(retiredEnv).encode({ code: 0 }, { binding });
  const retiredCodec = createCommandResultCodec({
    ...protectedEnv,
    ROOT_KEY_INVENTORY_RETIRED_KEY_IDS_JSON: JSON.stringify({
      REQUEST_DIGEST: [],
      COMMAND_RESULT: [retiredEnv.ROOT_COMMAND_RESULT_KEY_ID],
      INBOX_CONTENT: [],
      NOTIFICATION_RECEIPT: [],
    }),
  });
  assert.throws(
    () => retiredCodec.decode(retiredStored, { binding }),
    (error) => error && error.code === "COMMAND_RESULT_KEY_RETIRED" && error.status === 409
  );

  const unknownStored = {
    ...retiredStored,
    keyId: "command-result-unknown-v9",
  };
  assert.throws(
    () => retiredCodec.decode(unknownStored, { binding }),
    (error) => error && error.code === "COMMAND_RESULT_KEY_UNAVAILABLE" && error.status === 409
  );

  const privateMaterial = "previous-private-command-result-never-log-1234567890";
  for (const raw of [
    "not-json",
    JSON.stringify({ [protectedEnv.ROOT_COMMAND_RESULT_KEY_ID]: privateMaterial }),
    JSON.stringify(Object.fromEntries(Array.from({ length: 9 }, (_, index) => [
      `result-previous-${index}`,
      `${privateMaterial}-${index}`,
    ]))),
    JSON.stringify({ "result-previous-weak": "too-short" }),
  ]) {
    const codec = createCommandResultCodec({
      ...protectedEnv,
      ROOT_COMMAND_RESULT_DECRYPTION_KEYS_JSON: raw,
    });
    assert.throws(
      () => codec.assertReady(),
      (error) => {
        assert.equal(error && error.code, "COMMAND_RESULT_KEY_RING_INVALID");
        assert.doesNotMatch(`${error.message}:${error.stack}`, /previous-private-command-result-never-log/);
        return true;
      }
    );
  }
});

test("local runtime keeps compatibility without requiring an encryption key", () => {
  const codec = createCommandResultCodec({ NODE_ENV: "test" });
  const result = { code: 0, data: { value: "local-only" } };
  assert.deepEqual(codec.decode(codec.encode(result)), result);
});

test("local plaintext results may use envelope field names without becoming envelopes", () => {
  const codec = createCommandResultCodec({ NODE_ENV: "test" });
  const results = [
    { code: 0, tag: "business-tag" },
    { code: 0, ciphertext: "business-copy" },
    { code: 0, bindingDigest: "business-digest" },
    { code: 0, protection: "business-policy" },
    {
      code: 0,
      tag: "business-tag",
      ciphertext: "business-copy",
      bindingDigest: "business-digest",
      protection: "business-policy",
    },
  ];

  for (const result of results) {
    assert.deepEqual(codec.decode(codec.encode(result)), result);
  }
});

test("A256GCM remains the reserved fail-closed persistence discriminator", () => {
  const localCodec = createCommandResultCodec({ NODE_ENV: "test" });
  assert.throws(
    () => localCodec.decode({ code: 0, protection: "A256GCM" }),
    (error) => error && error.code === "COMMAND_RESULT_ENVELOPE_INVALID"
  );

  const protectedCodec = createCommandResultCodec(protectedEnv);
  assert.throws(
    () => protectedCodec.decode({ code: 0, protection: "business-policy" }),
    (error) => error && error.code === "COMMAND_RESULT_REKEY_REQUIRED"
  );
});
