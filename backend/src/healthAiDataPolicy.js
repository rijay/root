const HEALTH_AI_DATA_POLICY_VERSION = "myroot-health-ai-data-2026-08-26-v3";

const HEALTH_AI_DATA_LIMITS = Object.freeze({
  healthContentRetentionDays: 180,
  primaryDeletionSlaHours: 24,
  providerLogRetentionDays: 7,
  providerCacheRetentionMinutes: 5,
  applicationLogRetentionDays: 30,
  securityLogRetentionDays: 180,
  backupRetentionDays: 30,
  privacyEvidenceRetentionDays: 1095,
});

function text(value) {
  return String(value ?? "").trim();
}

function exactTrue(value) {
  return text(value) === "true";
}

function exactProviderLogRetention(value) {
  return text(value) === String(HEALTH_AI_DATA_LIMITS.providerLogRetentionDays);
}

function exactProviderCacheRetention(value) {
  return text(value) === String(HEALTH_AI_DATA_LIMITS.providerCacheRetentionMinutes);
}

function resolveHealthAiDataPolicy(env = process.env) {
  const values = {
    secondaryUse: text(env.ROOT_HEALTH_ADVICE_MODEL_SECONDARY_USE).toUpperCase(),
    processingRegion: text(env.ROOT_HEALTH_ADVICE_MODEL_PROCESSING_REGION).toUpperCase(),
    otherProcessors: text(env.ROOT_HEALTH_ADVICE_MODEL_OTHER_PROCESSORS).toUpperCase(),
    logRetentionDays: text(env.ROOT_HEALTH_ADVICE_MODEL_LOG_RETENTION_DAYS),
    cacheRetentionMinutes: text(env.ROOT_HEALTH_ADVICE_MODEL_CACHE_RETENTION_MINUTES),
    verified: exactTrue(env.ROOT_HEALTH_ADVICE_MODEL_DATA_POLICY_VERIFIED),
  };
  const issues = [];
  if (values.secondaryUse !== "NONE") issues.push("SECONDARY_USE_MUST_BE_NONE");
  if (values.processingRegion !== "CN_MAINLAND") issues.push("PROCESSING_REGION_MUST_BE_CN_MAINLAND");
  if (values.otherProcessors !== "NONE") issues.push("OTHER_PROCESSORS_MUST_BE_NONE");
  if (!exactProviderLogRetention(values.logRetentionDays)) issues.push("PROVIDER_LOG_RETENTION_MUST_BE_SEVEN_DAYS");
  if (!exactProviderCacheRetention(values.cacheRetentionMinutes)) issues.push("PROVIDER_CACHE_RETENTION_MUST_BE_FIVE_MINUTES");
  if (!values.verified) issues.push("DATA_POLICY_MUST_BE_VERIFIED");
  return Object.freeze({
    policyVersion: HEALTH_AI_DATA_POLICY_VERSION,
    configured: issues.length === 0,
    issues: Object.freeze(issues),
    ...values,
  });
}

module.exports = {
  HEALTH_AI_DATA_LIMITS,
  HEALTH_AI_DATA_POLICY_VERSION,
  resolveHealthAiDataPolicy,
};
