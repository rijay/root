const FORMAL_LAUNCH_DATA_DISPOSITION_VERSION = "formal-launch-data-disposition:v2";

const ACTIVE_SNAPSHOT_KEYS = Object.freeze([
  "activityDefinitionVersions",
  "activityEnrollmentEvents",
  "activityEnrollments",
  "activitySessionEvents",
  "activitySessions",
  "auditLogs",
  "commandIdempotencyRecords",
  "contentAssets",
  "contentPreviewRecords",
  "contentPublicationRecords",
  "contentVersions",
  "formalContentItems",
  "healthContentVersions",
  "questionnaireDefinitions",
]);

const PROTECTED_SNAPSHOT_KEYS = Object.freeze([
  "formalProfiles",
  "healthScaleResponses",
  "identityLinks",
  "leadProfiles",
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

const AUTOMATICALLY_PRUNABLE_SNAPSHOT_KEYS = Object.freeze([
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

const CONFIRMED_PRELAUNCH_RETIREMENT_SNAPSHOT_KEYS = Object.freeze([
  "campaignDefinitions",
  "campaignParticipants",
  "campaignRuleVersions",
  "notificationDeliveries",
  "notificationJobs",
  "notificationSubscriptionGrants",
  "notificationSubscriptions",
  "notificationTemplates",
  "taskDefinitions",
  "taskEvents",
  "taskProgressSnapshots",
]);

const ARCHIVE_BEFORE_PRUNE_SNAPSHOT_KEYS = Object.freeze([
  "externalAdapterCursors",
  "externalAdapterRuns",
  "externalSampleReviews",
  "externalStatusMappings",
  "importBatches",
  "productionCutoverProofs",
  "releaseSignoffs",
  "rootMemberCenterJumpProofs",
]);

const CONFIRMATION_REQUIRED_SNAPSHOT_KEYS = Object.freeze([
  "campaignProductRelations",
  "checkinRecords",
  "checkinSessions",
  "consultationAdvisorAssignments",
  "consultationWeworkWritebacks",
  "couponEvents",
  "dailyCheckinRecords",
  "dailySummaries",
  "manualReviewItems",
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
  "uploads",
  "weworkTouchJobs",
  "youzanCustomers",
  "youzanIdentityReconciliations",
  "youzanOrders",
  "youzanProducts",
  "youzanSkus",
]);

const ACTIVE_RELATIONAL_TABLES = Object.freeze([
  "activity_definition_version",
  "activity_enrollment",
  "activity_enrollment_event",
  "activity_session",
  "activity_session_event",
  "command_idempotency",
  "privacy_consent_record",
  "questionnaire_answer",
  "root_user",
  "user_contact_method",
  "user_lifecycle_event",
  "wechat_identity",
]);

const SYSTEM_RELATIONAL_TABLES = Object.freeze([
  "root_store_snapshot",
  "schema_migrations",
]);

const CONFIRMED_PRELAUNCH_RETIREMENT_RELATIONAL_TABLES = Object.freeze([
  "campaign_definition",
  "campaign_participant",
  "campaign_rule_version",
  "notification_delivery",
  "notification_job",
  "notification_subscription",
  "notification_subscription_grant",
  "notification_template",
  "task_definition",
  "task_event",
  "task_progress_snapshot",
]);

function assertUniqueDisposition(groups, label) {
  const seen = new Set();
  groups.forEach((group) => group.forEach((item) => {
    if (seen.has(item)) throw new Error(`duplicate ${label} disposition: ${item}`);
    seen.add(item);
  }));
}

const SNAPSHOT_DISPOSITION_GROUPS = Object.freeze([
  ACTIVE_SNAPSHOT_KEYS,
  PROTECTED_SNAPSHOT_KEYS,
  AUTOMATICALLY_PRUNABLE_SNAPSHOT_KEYS,
  CONFIRMED_PRELAUNCH_RETIREMENT_SNAPSHOT_KEYS,
  ARCHIVE_BEFORE_PRUNE_SNAPSHOT_KEYS,
  CONFIRMATION_REQUIRED_SNAPSHOT_KEYS,
]);
const RELATIONAL_DISPOSITION_GROUPS = Object.freeze([
  ACTIVE_RELATIONAL_TABLES,
  SYSTEM_RELATIONAL_TABLES,
]);

assertUniqueDisposition(SNAPSHOT_DISPOSITION_GROUPS, "snapshot key");
assertUniqueDisposition([
  ...RELATIONAL_DISPOSITION_GROUPS,
  CONFIRMED_PRELAUNCH_RETIREMENT_RELATIONAL_TABLES,
], "relational table");

const RETIRED_SNAPSHOT_DEFAULT_KEYS = Object.freeze([
  ...AUTOMATICALLY_PRUNABLE_SNAPSHOT_KEYS,
  ...CONFIRMED_PRELAUNCH_RETIREMENT_SNAPSHOT_KEYS,
  ...ARCHIVE_BEFORE_PRUNE_SNAPSHOT_KEYS,
  ...CONFIRMATION_REQUIRED_SNAPSHOT_KEYS,
]);

module.exports = {
  ACTIVE_RELATIONAL_TABLES,
  ACTIVE_SNAPSHOT_KEYS,
  ARCHIVE_BEFORE_PRUNE_SNAPSHOT_KEYS,
  AUTOMATICALLY_PRUNABLE_SNAPSHOT_KEYS,
  CONFIRMATION_REQUIRED_SNAPSHOT_KEYS,
  CONFIRMED_PRELAUNCH_RETIREMENT_RELATIONAL_TABLES,
  CONFIRMED_PRELAUNCH_RETIREMENT_SNAPSHOT_KEYS,
  FORMAL_LAUNCH_DATA_DISPOSITION_VERSION,
  PROTECTED_SNAPSHOT_KEYS,
  RELATIONAL_DISPOSITION_GROUPS,
  RETIRED_SNAPSHOT_DEFAULT_KEYS,
  SNAPSHOT_DISPOSITION_GROUPS,
  SYSTEM_RELATIONAL_TABLES,
  assertUniqueDisposition,
};
