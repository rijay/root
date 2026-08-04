const AUTOMATICALLY_PRUNABLE_KEYS = Object.freeze([
  "adminLegacyDeprecationDecisions",
  "adminLifecycleFilterPresets",
  "adminLifecycleSettlementJobs",
  "adminLifecycleUserExports",
  "eventConsumerCheckpoints",
  "eventInbox",
  "eventOutbox",
  "events",
  "eventsTrack",
  "idempotency",
  "legacyDataMigrationDecisions",
  "legacyDataMigrationExecutions",
  "operationalAlertNotifications",
  "operationalAlertRules",
  "operationalAlertRuns",
]);

const ARCHIVE_BEFORE_PRUNE_KEYS = Object.freeze([
  "externalAdapterCursors",
  "externalAdapterRuns",
  "externalSampleReviews",
  "externalStatusMappings",
  "productionCutoverProofs",
  "releaseSignoffs",
]);

const CONFIRMATION_REQUIRED_KEYS = Object.freeze([
  "campaignDefinitions",
  "campaignParticipants",
  "campaignProductRelations",
  "campaignRuleVersions",
  "checkinRecords",
  "checkinSessions",
  "consultationAdvisorAssignments",
  "consultationWeworkWritebacks",
  "couponEvents",
  "dailyCheckinRecords",
  "dailySummaries",
  "manualReviewItems",
  "notificationDeliveries",
  "notificationJobs",
  "notificationSubscriptionGrants",
  "notificationSubscriptions",
  "notificationTemplates",
  "operationTasks",
  "orderAfterSalesRecords",
  "orderFulfillments",
  "productJumpLogs",
  "refundWorkItems",
  "refunds",
  "rewardDeliveryJobs",
  "rewardGrants",
  "rewardInventoryPools",
  "rewardInventoryReservations",
  "rewardRecoveryRecords",
  "settlementRecords",
  "taskDefinitions",
  "taskEvents",
  "taskProgressSnapshots",
  "uploads",
  "weworkTouchJobs",
  "youzanCustomers",
  "youzanIdentityReconciliations",
  "youzanOrders",
  "youzanProducts",
  "youzanSkus",
]);

const PROTECTED_KEYS = Object.freeze([
  "formalProfiles",
  "healthScaleResponses",
  "privacyConsentRecords",
  "profiles",
  "questionnaireAnswers",
  "questionnaireResponses",
  "rootUsers",
  "sessions",
  "tokens",
  "userContactMethods",
  "userLifecycleEvents",
  "users",
  "wechatIdentities",
]);

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
  const automatic = summarize(snapshot, AUTOMATICALLY_PRUNABLE_KEYS);
  AUTOMATICALLY_PRUNABLE_KEYS.forEach((key) => delete candidate[key]);

  const auditLogs = Array.isArray(candidate.auditLogs) ? candidate.auditLogs : [];
  const retainedAuditLogs = auditLogs.filter((entry) => (
    !RETIRED_AUDIT_ACTIONS.has(String(entry && entry.action || "").toUpperCase())
  ));
  const filteredAuditLogCount = auditLogs.length - retainedAuditLogs.length;
  if (filteredAuditLogCount > 0) candidate.auditLogs = retainedAuditLogs;

  const archiveRequired = summarize(snapshot, ARCHIVE_BEFORE_PRUNE_KEYS);
  const confirmationRequired = summarize(snapshot, CONFIRMATION_REQUIRED_KEYS);
  const protectedCollections = summarize(snapshot, PROTECTED_KEYS);
  const beforeBytes = byteLength(snapshot);
  const candidateBytes = byteLength(candidate);
  const confirmationItemCount = confirmationRequired.reduce((sum, item) => sum + item.itemCount, 0);
  const archiveItemCount = archiveRequired.reduce((sum, item) => sum + item.itemCount, 0);

  return Object.freeze({
    mode: "DRY_RUN",
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
  ARCHIVE_BEFORE_PRUNE_KEYS,
  AUTOMATICALLY_PRUNABLE_KEYS,
  CONFIRMATION_REQUIRED_KEYS,
  PROTECTED_KEYS,
  buildFormalLaunchSnapshotCleanupPlan,
  collectionCount,
};
