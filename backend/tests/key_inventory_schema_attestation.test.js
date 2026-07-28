const assert = require("node:assert/strict");
const test = require("node:test");

const {
  EXPECTED_CHECK_DIGESTS,
  canonicalCheckClauseDigest,
  inspectSnapshotCheckAttestation,
} = require("../src/keyInventorySchemaAttestation");

test("frozen CHECK digests match the R19 MySQL 8.0.43 attestation evidence", () => {
  assert.equal(EXPECTED_CHECK_DIGESTS.chk_notification_send_attempt_accepted_receipt,
    "064bb5a4f71106a4b117c5ad1f1f4abcc5d4563ed716a204fc54802e79b2bf75");
  assert.equal(EXPECTED_CHECK_DIGESTS.chk_notification_send_attempt_receipt_digest,
    "1f8b855ebd0cc7dc857f907d1fa7ffe19a725f53bb23eadad87baa3672b4a7c7");
  assert.equal(Object.keys(EXPECTED_CHECK_DIGESTS).length, 9);
});

test("attestation diagnostic retains only names and digests and exposes drift", () => {
  const name = "chk_inbox_payload_protection_metadata";
  const snapshot = `CREATE TABLE \`inbox_receipt\` (\n  CONSTRAINT \`${name}\` CHECK ((\`payload_key_id\` = 'drift'))\n);\n`;
  const report = inspectSnapshotCheckAttestation(snapshot);
  const item = report.constraints.find((candidate) => candidate.constraintName === name);
  assert.equal(report.matches, false);
  assert.equal(item.present, true);
  assert.match(item.actualDigest, /^[0-9a-f]{64}$/);
  assert.notEqual(item.actualDigest, item.expectedDigest);
  assert.deepEqual(Object.keys(item).sort(), [
    "actualDigest", "constraintName", "expectedDigest", "matches", "present",
  ]);
  assert.equal(canonicalCheckClauseDigest("unterminated 'literal"), null);
});
