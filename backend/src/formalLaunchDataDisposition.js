const FORMAL_LAUNCH_DATA_DISPOSITION_VERSION = "formal-launch-data-disposition:v2";

const ACTIVE_SNAPSHOT_KEYS = Object.freeze([
  "activityDefinitionVersions",
  "activityEnrollmentEvents",
  "activityEnrollments",
  "activitySessionEvents",
  "activitySessions",
  "auditLogs",
  "analyticsEvents",
  "campaignDefinitions",
  "campaignProductRelations",
  "channelDefinitions",
  "channelQrCodes",
  "commandIdempotencyRecords",
  "contentAssets",
  "contentPreviewRecords",
  "contentPublicationRecords",
  "contentVersions",
  "formalContentItems",
  "healthContentVersions",
  "healthAssessmentDefinitions",
  "questionnaireDefinitions",
  "youzanProducts",
  "youzanSkus",
]);

const PROTECTED_SNAPSHOT_KEYS = Object.freeze([
  "formalProfiles",
  "campaignPopupReceipts",
  "channelAttributionAttempts",
  "channelAttributions",
  "channelFunnelEvents",
  "channelFunnelVisits",
  "healthScaleResponses",
  "healthAssessmentAttempts",
  "healthAdviceSnapshots",
  "identityLinks",
  "leadProfiles",
  "privacyConsentRecords",
  "productJumpLogs",
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
]);

const ACTIVE_RELATIONAL_TABLES = Object.freeze([
  "activity_definition_version",
  "activity_enrollment",
  "activity_enrollment_event",
  "activity_session",
  "activity_session_event",
  "command_idempotency",
  "health_assessment_definition",
  "health_assessment_attempt",
  "health_advice_snapshot",
  "channel_definition",
  "channel_qr_code",
  "channel_funnel_visit",
  "channel_funnel_event",
  "channel_attribution",
  "channel_attribution_attempt",
  "campaign_popup_receipt",
  "analytics_event",
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
