const HEALTH_AI_DATA_POLICY_VERSION = "myroot-health-ai-data-2026-08-26-v4";

const HEALTH_AI_DATA_LIMITS = Object.freeze({
  healthContentRetentionDays: 180,
  primaryDeletionSlaHours: 24,
  providerLogRetentionDays: 7,
  applicationLogRetentionDays: 30,
  securityLogRetentionDays: 180,
  backupRetentionDays: 30,
  privacyEvidenceRetentionDays: 1095,
});

module.exports = {
  HEALTH_AI_DATA_LIMITS,
  HEALTH_AI_DATA_POLICY_VERSION,
};
