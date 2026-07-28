const CODEC_VERSION = "A256GCM:v1";
const MAXIMUM_PLAINTEXT_BYTES = 128 * 1024;
const ENVELOPE_FIELDS = Object.freeze([
  "bindingDigest",
  "ciphertext",
  "iv",
  "keyId",
  "protection",
  "tag",
]);

const COMMAND_RESULT_PROTECTION_POLICY = Object.freeze({
  policyVersion: "COMMAND_RESULT_PROTECTION_POLICY:v1",
  protection: "A256GCM",
  codecVersion: CODEC_VERSION,
  maximumPlaintextBytes: MAXIMUM_PLAINTEXT_BYTES,
  maximumCiphertextBytes: MAXIMUM_PLAINTEXT_BYTES,
  maximumCiphertextBase64Characters: 4 * Math.ceil(MAXIMUM_PLAINTEXT_BYTES / 3),
  maximumEnvelopeBytes: 180 * 1024,
  ivBytes: 12,
  tagBytes: 16,
  envelopeFields: ENVELOPE_FIELDS,
});

module.exports = Object.freeze({
  COMMAND_RESULT_PROTECTION_POLICY,
});
