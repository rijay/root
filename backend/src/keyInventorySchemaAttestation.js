const crypto = require("node:crypto");

const EXPECTED_CHECK_DIGESTS = Object.freeze({
  chk_inbox_payload_protection_metadata: "c53dfe6e2b75cadfbbd71afe83a184357239b99bcf2bdd52074325944e7d0234",
  chk_inbox_result_protection_metadata: "ce41b86fe146171a9850faeca1f791715c4b17d5facc4acb53798556f1f3df20",
  chk_notification_recipient_binding: "6d4fa6c0d449456d0bc7f59abeaa9196f73067fee49613458fc068006f1ad125",
  chk_notification_recipient_binding_v1: "6d4fa6c0d449456d0bc7f59abeaa9196f73067fee49613458fc068006f1ad125",
  chk_notification_send_attempt_accepted_receipt: "064bb5a4f71106a4b117c5ad1f1f4abcc5d4563ed716a204fc54802e79b2bf75",
  chk_notification_send_attempt_receipt_digest: "1f8b855ebd0cc7dc857f907d1fa7ffe19a725f53bb23eadad87baa3672b4a7c7",
  chk_notification_send_attempt_transition_digest: "353a19a0236dc233933efec344a3be9ef2775d85820d4641e587b1a3cc21adc9",
  chk_notification_send_attempt_transition_receipt: "9cb2d5d25cd44ac334fd2b901e3fbc25bc386583bf5436040cacb69b7324e97f",
  chk_wechat_identity_unionid_provenance: "bf9106729fae550e6297591cc7f4a31a95f2bdee93990f8ecc91c9f6f989d070",
});

function canonicalCheckClauseDigest(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 32 * 1024
    || value.includes("\u0000")) return null;
  let canonical = "";
  let inLiteral = false;
  let literalMode = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (inLiteral) {
      if (literalMode === "MYSQL_METADATA_ESCAPED") {
        if (character === "\\" && value[index + 1] === "'") {
          const following = value[index + 2];
          if (following !== undefined && !/[ \t\r\n),]/.test(following)) return null;
          canonical += "'";
          index += 1;
          inLiteral = false;
          literalMode = null;
        } else {
          canonical += character;
        }
        continue;
      }
      canonical += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "'") {
        if (value[index + 1] === "'") {
          canonical += value[index + 1];
          index += 1;
        } else {
          inLiteral = false;
          literalMode = null;
        }
      }
      continue;
    }
    if (character === "\\" && value[index + 1] === "'") {
      inLiteral = true;
      literalMode = "MYSQL_METADATA_ESCAPED";
      canonical += "'";
      index += 1;
    } else if (character === "'") {
      inLiteral = true;
      literalMode = "STANDARD";
      canonical += character;
    } else if (character === "`") {
      let identifier = "";
      let closed = false;
      for (index += 1; index < value.length; index += 1) {
        const identifierCharacter = value[index];
        if (identifierCharacter !== "`") {
          identifier += identifierCharacter;
          continue;
        }
        if (value[index + 1] === "`") {
          identifier += "`";
          index += 1;
          continue;
        }
        closed = true;
        break;
      }
      if (!closed || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) return null;
      canonical += identifier.toLowerCase();
    } else if (/[ \t\r\n]/.test(character)) {
      // Formatting outside literals is not semantic.
    } else {
      canonical += character.toLowerCase();
    }
  }
  if (inLiteral || literalMode !== null || escaped) return null;
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

function clauseFromSnapshot(snapshot, constraintName) {
  const prefix = `CONSTRAINT \`${constraintName}\` CHECK (`;
  const line = String(snapshot || "").split("\n")
    .find((candidate) => candidate.includes(prefix));
  if (!line) return null;
  const trimmed = line.trim();
  const start = trimmed.indexOf(prefix) + prefix.length;
  const suffixLength = trimmed.endsWith(",") ? 2 : 1;
  if (start < prefix.length || trimmed.length <= start + suffixLength) return null;
  return trimmed.slice(start, -suffixLength);
}

function inspectSnapshotCheckAttestation(snapshot) {
  const constraints = Object.entries(EXPECTED_CHECK_DIGESTS).map(([constraintName, expectedDigest]) => {
    const clause = clauseFromSnapshot(snapshot, constraintName);
    const actualDigest = canonicalCheckClauseDigest(clause);
    return Object.freeze({
      constraintName,
      expectedDigest,
      actualDigest,
      matches: actualDigest === expectedDigest,
      present: clause !== null,
    });
  });
  return Object.freeze({
    schemaVersion: "myroot.key-inventory-check-attestation-diagnostic.v1",
    matches: constraints.every((item) => item.matches),
    constraints: Object.freeze(constraints),
  });
}

module.exports = {
  EXPECTED_CHECK_DIGESTS,
  canonicalCheckClauseDigest,
  inspectSnapshotCheckAttestation,
};
