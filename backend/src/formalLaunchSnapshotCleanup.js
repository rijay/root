const {
  ACTIVE_RELATIONAL_TABLES,
  ARCHIVE_BEFORE_PRUNE_SNAPSHOT_KEYS,
  AUTOMATICALLY_PRUNABLE_SNAPSHOT_KEYS,
  CONFIRMATION_REQUIRED_SNAPSHOT_KEYS,
  FORMAL_LAUNCH_DATA_DISPOSITION_VERSION,
  OWNER_CONFIRMATION_RELATIONAL_TABLES,
  PROTECTED_SNAPSHOT_KEYS,
  SYSTEM_RELATIONAL_TABLES,
} = require("./formalLaunchDataDisposition");

const RETIRED_AUDIT_ACTIONS = Object.freeze(new Set([
  "OPERATIONAL_ALERT_JOB_PREVIEW",
]));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function collectionCount(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value).length;
  return value === undefined || value === null || value === "" ? 0 : 1;
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function summarize(snapshot, keys) {
  return keys
    .filter((key) => Object.prototype.hasOwnProperty.call(snapshot, key))
    .map((key) => Object.freeze({
      key,
      itemCount: collectionCount(snapshot[key]),
      estimatedBytes: byteLength(snapshot[key]),
    }));
}

function buildFormalLaunchSnapshotCleanupPlan(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    const error = new Error("snapshot must be a JSON object");
    error.code = "FORMAL_LAUNCH_SNAPSHOT_INVALID";
    throw error;
  }

  const candidate = clone(snapshot);
  const automatic = summarize(snapshot, AUTOMATICALLY_PRUNABLE_SNAPSHOT_KEYS);
  AUTOMATICALLY_PRUNABLE_SNAPSHOT_KEYS.forEach((key) => delete candidate[key]);

  const auditLogs = Array.isArray(candidate.auditLogs) ? candidate.auditLogs : [];
  const retainedAuditLogs = auditLogs.filter((entry) => (
    !RETIRED_AUDIT_ACTIONS.has(String(entry && entry.action || "").toUpperCase())
  ));
  const filteredAuditLogCount = auditLogs.length - retainedAuditLogs.length;
  if (filteredAuditLogCount > 0) candidate.auditLogs = retainedAuditLogs;

  const archiveRequired = summarize(snapshot, ARCHIVE_BEFORE_PRUNE_SNAPSHOT_KEYS);
  const confirmationRequired = summarize(snapshot, CONFIRMATION_REQUIRED_SNAPSHOT_KEYS);
  const protectedCollections = summarize(snapshot, PROTECTED_SNAPSHOT_KEYS);
  const beforeBytes = byteLength(snapshot);
  const candidateBytes = byteLength(candidate);
  const confirmationItemCount = confirmationRequired.reduce((sum, item) => sum + item.itemCount, 0);
  const archiveItemCount = archiveRequired.reduce((sum, item) => sum + item.itemCount, 0);

  return Object.freeze({
    mode: "DRY_RUN",
    dispositionVersion: FORMAL_LAUNCH_DATA_DISPOSITION_VERSION,
    writePerformed: false,
    beforeBytes,
    candidateBytes,
    estimatedReducibleBytes: Math.max(0, beforeBytes - candidateBytes),
    estimatedReductionPercent: beforeBytes > 0
      ? Number((((beforeBytes - candidateBytes) / beforeBytes) * 100).toFixed(2))
      : 0,
    automatic,
    filteredAuditLogs: Object.freeze({
      action: "OPERATIONAL_ALERT_JOB_PREVIEW",
      itemCount: filteredAuditLogCount,
    }),
    archiveRequired,
    confirmationRequired,
    protectedCollections,
    retainedRelationalTables: Object.freeze({
      active: ACTIVE_RELATIONAL_TABLES,
      system: SYSTEM_RELATIONAL_TABLES,
      ownerConfirmationRequired: OWNER_CONFIRMATION_RELATIONAL_TABLES,
    }),
    blockers: Object.freeze([
      ...(confirmationItemCount > 0
        ? [`${confirmationItemCount} pre-launch business records require owner confirmation`]
        : []),
      ...(archiveItemCount > 0
        ? [`${archiveItemCount} evidence records require offline archive confirmation`]
        : []),
      ...(collectionCount(snapshot.sessions) > 0
        ? [`${collectionCount(snapshot.sessions)} sessions require an explicit revocation decision`]
        : []),
    ]),
  });
}

module.exports = {
  ARCHIVE_BEFORE_PRUNE_KEYS: ARCHIVE_BEFORE_PRUNE_SNAPSHOT_KEYS,
  AUTOMATICALLY_PRUNABLE_KEYS: AUTOMATICALLY_PRUNABLE_SNAPSHOT_KEYS,
  CONFIRMATION_REQUIRED_KEYS: CONFIRMATION_REQUIRED_SNAPSHOT_KEYS,
  PROTECTED_KEYS: PROTECTED_SNAPSHOT_KEYS,
  buildFormalLaunchSnapshotCleanupPlan,
  collectionCount,
};
