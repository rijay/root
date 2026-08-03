const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { loadAndValidateRegistry } = require("../../scripts/lib/route-registry");
const {
  getDefaultMigrationContractRegistry,
} = require("./migrationContractRegistry");

const ENABLE_FLAG = "MYROOT_FACT_AUTHORITY_REGISTRY_FOUNDATION_ENABLED";
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const MANIFEST_PATH = path.join(
  PROJECT_ROOT,
  "contracts",
  "fact-authority-registry",
  "v1.0.0-foundation.json"
);
const PRD_PATH = path.join(PROJECT_ROOT, "docs", "v1.0.0_product_requirements.md");
const ROUTE_REGISTRY_PATH = path.join(
  PROJECT_ROOT,
  "contracts",
  "route-registry",
  "v1.0.0-draft.8.json"
);
const APP_JSON_PATH = path.join(
  PROJECT_ROOT,
  "miniprogram",
  "fixtures",
  "miniprogram-app-v1-pre-formal-rebuild.json",
);

const EXPECTED_BINDINGS = Object.freeze({
  sourcePrdPath: "docs/v1.0.0_product_requirements.md",
  sourcePrdSha256: "c7973c271bd60666196644b84655c9c56eda73835d7239072085c80290b39f81",
  sourcePrdSections: Object.freeze(["6.1", "11.1", "11.2"]),
  routeRegistryPath: "contracts/route-registry/v1.0.0-draft.8.json",
  routeRegistryVersion: "1.0.0-draft.8",
  routeRegistryDigest: "f43aeddbe9788b3f35d1f23a4c99bb99f30be842132986066b21a6d653a97edc",
  migrationContractRegistryPath: "contracts/migration-contract-registry/v1.0.0.json",
  migrationContractRegistryVersion: 1,
  migrationContractRegistryDigest: "ecaa1541b72d38f4943bd878400417481af3e571d19225f1efac336e13f7fd7c",
});

const KNOWN_MODULES = Object.freeze(new Set([
  "Activity Module",
  "Assessment Module",
  "Check-in Reminder Module",
  "Classification Module",
  "Command Idempotency Module",
  "Commerce After-sales Module",
  "Commerce Mirror Module",
  "Health Consent Module",
  "Health Eligibility Module",
  "Health Journey Module",
  "Identity 基础 Module",
  "Event Transport Module",
  "Member Identity Module",
  "Migration Execution Foundation Module",
  "Platform Privacy Orchestration Module",
  "Privacy Rights Module",
  "Product Showcase Module",
  "Questionnaire Module",
  "Recommendation Module",
  "Reward Ledger Module",
  "Route Policy Module",
  "Settlement Module",
  "Task Module",
]));

const INTERNAL_ONLY_MODULES = Object.freeze(new Set([
  "Command Idempotency Module",
  "Event Transport Module",
  "Migration Execution Foundation Module",
]));

const SNAPSHOT_REVISION_POLICIES = Object.freeze(new Set([
  "CURRENT_AUTHORITY_REVISION",
  "EVENT_TIME_WATERMARK",
  "EXTERNAL_PROVIDER_REVISION",
  "FROZEN_SOURCE_SNAPSHOT",
  "NO_SEMANTIC_BACKFILL",
  "NO_SOURCE_MIGRATION",
  "USER_RECONFIRMATION_NO_BULK_BACKFILL",
]));

const STATUS_BLUEPRINTS = Object.freeze([
  ["ACCOUNT_STATUS_V1", "PERSISTED", ["GUEST", "AUTHENTICATED", "DISABLED"]],
  ["ACTIVITY_DEFINITION_STATUS_V1", "PERSISTED", ["DRAFT", "IN_REVIEW", "PUBLISHED", "UNPUBLISHED", "ARCHIVED"]],
  ["ACTIVITY_CAPACITY_STATUS_V1", "PROJECTION", ["AVAILABLE", "FULL"]],
  ["ACTIVITY_ENROLLMENT_STATUS_V1", "PERSISTED", ["PENDING", "CONFIRMED", "REJECTED", "CANCELED"]],
  ["ACTIVITY_SESSION_STATUS_V1", "PERSISTED", ["SCHEDULED", "OPEN", "CLOSED", "CANCELED", "ENDED"]],
  ["ASSESSMENT_SESSION_STATUS_V1", "PERSISTED", ["DRAFT", "SUBMITTED", "RESULT_PENDING", "RESULT_READY", "SAFETY_BLOCKED", "CONTENT_BLOCKED", "RESULT_FAILED", "SUPERSEDED", "ABANDONED", "EXPIRED"]],
  ["EXTERNAL_GATE_STATUS_V1", "EXTERNAL_GATE", []],
  ["HEALTH_CONSENT_STATUS_V1", "PERSISTED", ["NOT_ASKED", "DECLINED", "GRANTED", "WITHDRAWN", "RECONSENT_REQUIRED"]],
  ["HEALTH_ELIGIBILITY_STATUS_V1", "PERSISTED", ["UNKNOWN", "ELIGIBLE", "INELIGIBLE", "REVIEW_REQUIRED"]],
  ["HEALTH_JOURNEY_STATUS_V1", "PROJECTION", ["NOT_STARTED", "CLASSIFIED", "ASSESSMENT_DRAFT", "ASSESSMENT_PROCESSING", "ASSESSMENT_BLOCKED", "RESULT_READY", "ADVICE_VIEWED"]],
  ["MEMBERSHIP_STATUS_V1", "PERSISTED", ["UNKNOWN", "MATCHING", "NOT_FOUND", "ACTIVE", "EXPIRED", "SUSPENDED", "CONFLICT"]],
  ["PLATFORM_PRIVACY_STATUS_V1", "PROJECTION", ["NOT_REQUIRED", "REQUIRED", "REQUESTING", "GRANTED", "DECLINED", "PLATFORM_DISABLED", "OUTCOME_UNKNOWN"]],
  ["PRIVACY_REQUEST_STATUS_V1", "PERSISTED", ["SUBMITTED", "VERIFYING", "IN_PROGRESS", "PARTIALLY_FULFILLED", "COMPLETED", "REJECTED", "CANCELED"]],
  ["PRIVACY_SLA_STATUS_V1", "PROJECTION", ["ON_TIME", "OVERDUE"]],
  ["REMINDER_DECISION_STATUS_V1", "PERSISTED", ["ACCEPTED", "REJECTED", "PLATFORM_DISABLED", "OUTCOME_UNKNOWN"]],
  ["REMINDER_DELIVERY_STATUS_V1", "PERSISTED", ["NOT_VERIFIED", "DEVICE_RECEIPT_VERIFIED"]],
  ["REMINDER_GRANT_STATUS_V1", "PERSISTED", ["AVAILABLE", "RESERVED", "CONSUMED", "INVALID", "REVIEW_REQUIRED"]],
  ["REMINDER_ELIGIBILITY_STATUS_V1", "PROJECTION", ["INELIGIBLE", "AVAILABLE", "TEMPLATE_UNAVAILABLE", "PLATFORM_DISABLED"]],
  ["REMINDER_JOB_STATUS_V1", "PERSISTED", ["SCHEDULED", "SENDING", "PROVIDER_ACCEPTED", "SKIPPED", "FAILED", "OUTCOME_UNKNOWN", "CANCELED"]],
  ["REWARD_STATUS_V1", "PERSISTED", ["PENDING", "DELIVERING", "DELIVERED", "FAILED", "REVOKED", "DISPUTED"]],
  ["SETTLEMENT_STATUS_V1", "PERSISTED", ["PENDING", "QUALIFIED", "UNQUALIFIED", "ADJUSTED", "REVIEW_REQUIRED"]],
  ["STATELESS_V1", "STATELESS", []],
  ["TASK_STATUS_V1", "PERSISTED", ["LOCKED", "AVAILABLE", "IN_PROGRESS", "PENDING_VERIFICATION", "COMPLETED", "EXPIRED", "CANCELED"]],
]);

const FACT_BLUEPRINTS = Object.freeze([
  ["ACCOUNT_IDENTITY", "LEGACY_ROOT_USER_AND_WECHAT_IDENTITY", "Identity 基础 Module", "root_user/account_projection", "ACCOUNT_STATUS_V1", ["AUTH_LOGIN", "AUTH_REGISTER", "PROFILE"], "FROZEN_SOURCE_SNAPSHOT"],
  ["ACTIVITY_DEFINITION", "LEGACY_CAMPAIGN_RULES", "Activity Module", "activity_definition", "ACTIVITY_DEFINITION_STATUS_V1", ["ACTIVITY_LIST", "ACTIVITY_DETAIL"], "FROZEN_SOURCE_SNAPSHOT"],
  ["ACTIVITY_CAPACITY_PROJECTION", "ACTIVITY_SESSION_AND_RESERVATION_FACTS", "Activity Module", "activity_capacity_projection", "ACTIVITY_CAPACITY_STATUS_V1", ["ACTIVITY_LIST", "ACTIVITY_DETAIL", "MY_ENROLLMENTS"], "EVENT_TIME_WATERMARK"],
  ["ACTIVITY_ENROLLMENT", "LEGACY_CAMPAIGN_JOIN_FACT", "Activity Module", "activity_enrollment_event", "ACTIVITY_ENROLLMENT_STATUS_V1", ["ACTIVITY_DETAIL", "MY_ENROLLMENTS", "LEGACY_ACTIVITY_ROUTER"], "EVENT_TIME_WATERMARK"],
  ["ACTIVITY_SESSION", "LEGACY_CAMPAIGN_SESSION", "Activity Module", "activity_session", "ACTIVITY_SESSION_STATUS_V1", ["ACTIVITY_LIST", "ACTIVITY_DETAIL"], "FROZEN_SOURCE_SNAPSHOT"],
  ["COMMERCE_AFTER_SALES", "EXTERNAL_AFTER_SALES_AUTHORITY", "Commerce After-sales Module", "after_sales_request/event", "EXTERNAL_GATE_STATUS_V1", ["REFUND_APPLY", "REFUND_STATUS"], "EXTERNAL_PROVIDER_REVISION"],
  ["COMMERCE_MIRROR", "EXTERNAL_ORDER_AND_CUSTOMER_AUTHORITY", "Commerce Mirror Module", "commerce_order/customer_mirror", "EXTERNAL_GATE_STATUS_V1", ["LEGACY_ORDER_MATCH", "ORDER_HISTORY"], "EXTERNAL_PROVIDER_REVISION"],
  ["COMMAND_IDEMPOTENCY_RECORD", "PERSISTENT_COMMAND_RECORD", "Command Idempotency Module", "idempotency_record", "EXTERNAL_GATE_STATUS_V1", [], "NO_SOURCE_MIGRATION"],
  ["CONSUMER_CHECKPOINT", "PERSISTENT_CONSUMER_CHECKPOINT", "Event Transport Module", "consumer_checkpoint", "EXTERNAL_GATE_STATUS_V1", [], "NO_SOURCE_MIGRATION"],
  ["HEALTH_ADVICE_VIEW", "NO_LEGACY_SEMANTIC_SOURCE", "Recommendation Module", "advice_viewed_event", "STATELESS_V1", ["HEALTH_ADVICE"], "NO_SOURCE_MIGRATION"],
  ["HEALTH_ASSESSMENT", "LEGACY_HEALTH_DATA_REFERENCE_ONLY", "Assessment Module", "assessment_definition/version/session/answer/result", "ASSESSMENT_SESSION_STATUS_V1", ["HEALTH_ASSESSMENT", "HEALTH_RESULT", "HEALTH_HISTORY"], "NO_SEMANTIC_BACKFILL"],
  ["HEALTH_CLASSIFICATION", "LEGACY_HEALTH_DATA_REFERENCE_ONLY", "Classification Module", "classification_definition/version/session", "EXTERNAL_GATE_STATUS_V1", ["HEALTH_CLASSIFICATION", "HEALTH_HISTORY"], "NO_SEMANTIC_BACKFILL"],
  ["HEALTH_CONSENT", "LEGACY_HEALTH_CONSENT", "Health Consent Module", "health_consent_event", "HEALTH_CONSENT_STATUS_V1", ["HEALTH_HOME", "HEALTH_CONSENT"], "FROZEN_SOURCE_SNAPSHOT"],
  ["HEALTH_ELIGIBILITY", "USER_RECONFIRMATION_EVIDENCE", "Health Eligibility Module", "health_eligibility_event", "HEALTH_ELIGIBILITY_STATUS_V1", ["HEALTH_HOME", "HEALTH_ELIGIBILITY"], "USER_RECONFIRMATION_NO_BULK_BACKFILL"],
  ["HEALTH_JOURNEY_PROJECTION", "HEALTH_LOWER_FACTS", "Health Journey Module", "health_journey_projection", "HEALTH_JOURNEY_STATUS_V1", ["HEALTH_HOME", "HEALTH_HISTORY"], "EVENT_TIME_WATERMARK"],
  ["HEALTH_QUESTIONNAIRE", "LEGACY_HEALTH_DATA_REFERENCE_ONLY", "Questionnaire Module", "questionnaire_definition/session/answer", "EXTERNAL_GATE_STATUS_V1", ["HEALTH_QUESTIONNAIRES", "HEALTH_QUESTIONNAIRE", "HEALTH_HISTORY"], "NO_SEMANTIC_BACKFILL"],
  ["HEALTH_RECOMMENDATION", "APPROVED_HEALTH_CONTENT_AUTHORITY", "Recommendation Module", "recommendation_bundle/version", "EXTERNAL_GATE_STATUS_V1", ["HEALTH_ADVICE"], "CURRENT_AUTHORITY_REVISION"],
  ["INBOX_RECEIPT", "PERSISTENT_INBOX_RECEIPT", "Event Transport Module", "inbox_receipt", "EXTERNAL_GATE_STATUS_V1", [], "NO_SOURCE_MIGRATION"],
  ["MEMBERSHIP_LINK_ATTEMPT", "ROOT_MEMBER_AUTHORITY_EXTERNAL_GATE", "Member Identity Module", "membership_link_attempt", "EXTERNAL_GATE_STATUS_V1", ["MEMBER_LINK", "MEMBER_LINK_RESULT", "MEMBER_REVIEW"], "CURRENT_AUTHORITY_REVISION"],
  ["MEMBERSHIP_RECORD", "ROOT_MEMBER_AUTHORITY_EXTERNAL_GATE", "Member Identity Module", "membership_record", "MEMBERSHIP_STATUS_V1", ["MEMBER_LINK", "MEMBER_LINK_RESULT", "PROFILE"], "CURRENT_AUTHORITY_REVISION"],
  ["MIGRATION_LINEAGE", "MIGRATION_SOURCE_TARGET_LINEAGE", "Migration Execution Foundation Module", "migration_lineage", "EXTERNAL_GATE_STATUS_V1", [], "EVENT_TIME_WATERMARK"],
  ["NOTIFICATION_DELIVERY_EVIDENCE", "WECHAT_DEVICE_RECEIPT_EXTERNAL_GATE", "Check-in Reminder Module", "notification_delivery_evidence", "REMINDER_DELIVERY_STATUS_V1", ["TASK_DETAIL"], "EXTERNAL_PROVIDER_REVISION"],
  ["NOTIFICATION_ELIGIBILITY_PROJECTION", "TASK_TEMPLATE_AND_GRANT_FACTS", "Check-in Reminder Module", "notification_eligibility_projection", "REMINDER_ELIGIBILITY_STATUS_V1", ["TASK_DETAIL"], "EVENT_TIME_WATERMARK"],
  ["NOTIFICATION_JOB", "LEGACY_NOTIFICATION_HISTORY_REFERENCE_ONLY", "Check-in Reminder Module", "notification_job/event", "REMINDER_JOB_STATUS_V1", ["TASK_DETAIL"], "EVENT_TIME_WATERMARK"],
  ["NOTIFICATION_SEND_ATTEMPT", "LEGACY_NOTIFICATION_HISTORY_REFERENCE_ONLY", "Check-in Reminder Module", "notification_send_attempt", "EXTERNAL_GATE_STATUS_V1", ["TASK_DETAIL"], "EVENT_TIME_WATERMARK"],
  ["NOTIFICATION_SUBSCRIPTION_DECISION", "LEGACY_NOTIFICATION_HISTORY_REFERENCE_ONLY", "Check-in Reminder Module", "notification_subscription_attempt", "REMINDER_DECISION_STATUS_V1", ["TASK_DETAIL"], "EVENT_TIME_WATERMARK"],
  ["NOTIFICATION_SUBSCRIPTION_GRANT", "LEGACY_NOTIFICATION_HISTORY_REFERENCE_ONLY", "Check-in Reminder Module", "notification_subscription_grant", "REMINDER_GRANT_STATUS_V1", ["TASK_DETAIL"], "EVENT_TIME_WATERMARK"],
  ["NOTIFICATION_TEMPLATE", "WECHAT_TEMPLATE_AUTHORITY_EXTERNAL_GATE", "Check-in Reminder Module", "notification_template_version", "EXTERNAL_GATE_STATUS_V1", ["TASK_DETAIL"], "CURRENT_AUTHORITY_REVISION"],
  ["ONBOARDING_PROGRESS", "NO_LEGACY_HEALTH_OR_MEMBER_SOURCE", "Identity 基础 Module", "onboarding_progress", "STATELESS_V1", ["HOME", "AUTH_LOGIN", "AUTH_REGISTER"], "NO_SOURCE_MIGRATION"],
  ["OUTBOX_EVENT", "PERSISTENT_OUTBOX_EVENT", "Event Transport Module", "outbox_event", "EXTERNAL_GATE_STATUS_V1", [], "NO_SOURCE_MIGRATION"],
  ["PLATFORM_PRIVACY_INTERACTION", "WECHAT_PLATFORM_PRIVACY_INTERFACE", "Platform Privacy Orchestration Module", "platform_privacy_interaction_projection", "PLATFORM_PRIVACY_STATUS_V1", ["LEGAL"], "CURRENT_AUTHORITY_REVISION"],
  ["PRIVACY_RIGHTS_REQUEST", "LEGACY_SUPPORT_EVIDENCE_ONLY", "Privacy Rights Module", "privacy_request/event", "PRIVACY_REQUEST_STATUS_V1", ["PRIVACY_ACCOUNT", "PRIVACY_REQUEST", "PRIVACY_REQUEST_STATUS"], "FROZEN_SOURCE_SNAPSHOT"],
  ["PRIVACY_RIGHTS_SLA_PROJECTION", "PRIVACY_REQUEST_EVENT_TIME", "Privacy Rights Module", "privacy_request_sla_projection", "PRIVACY_SLA_STATUS_V1", ["PRIVACY_ACCOUNT", "PRIVACY_REQUEST_STATUS"], "EVENT_TIME_WATERMARK"],
  ["PRODUCT_SHOWCASE", "PRODUCT_MIRROR_AUTHORITY_EXTERNAL_GATE", "Product Showcase Module", "product_showcase_snapshot/jump_event", "EXTERNAL_GATE_STATUS_V1", ["PRODUCT_LIST", "PRODUCT_DETAIL"], "CURRENT_AUTHORITY_REVISION"],
  ["REWARD_LEDGER", "LEGACY_REWARD_AND_EXTERNAL_RECEIPT", "Reward Ledger Module", "reward_ledger_entry/event", "REWARD_STATUS_V1", ["REWARD_LIST", "REWARD_DETAIL", "LEGACY_REWARD_ROUTER"], "EXTERNAL_PROVIDER_REVISION"],
  ["ROUTE_INTENT", "NO_LEGACY_ARBITRARY_URL_SOURCE", "Route Policy Module", "route_intent", "EXTERNAL_GATE_STATUS_V1", ["AUTH_LOGIN", "AUTH_REGISTER", "MEMBER_LINK", "MEMBER_LINK_RESULT"], "NO_SOURCE_MIGRATION"],
  ["SETTLEMENT", "NEW_SETTLEMENT_AND_LEGACY_REWARD_REFERENCE", "Settlement Module", "settlement_record/event", "SETTLEMENT_STATUS_V1", ["TASK_DETAIL", "LEGACY_CHECKIN_RESULT", "REWARD_LIST"], "EVENT_TIME_WATERMARK"],
  ["TASK", "LEGACY_TASK_EVENT_PROGRESS_AND_CHECKIN", "Task Module", "task_definition/event/progress", "TASK_STATUS_V1", ["TASK_CENTER", "TASK_DETAIL", "TASK_CHECKIN", "TASK_QUESTIONNAIRE", "LEGACY_TASK_PROGRESS"], "EVENT_TIME_WATERMARK"],
]);

const TASK_SHARE_FACT = Object.freeze({
  factType: "TASK_SHARE",
  authoritativeSource: "LEGACY_TASK_EVENT",
  sourceQueryId: "task_share_legacy_succeeded_by_occurred_at_v1",
  sourceQueryDigest: "423ef18f3a83869b765b394ecf5cffe26a9b2335e68025a29b1f200bc2315f9d",
  snapshotRevisionPolicy: "FROZEN_SOURCE_SNAPSHOT",
  targetRecord: "task_share_migration_projection",
  writeOwnerModule: "Task Module",
  projectionParityCheckId: "task-share-migration-parity-v1",
  projectionParityCheckDigest: "69ea1903692d29ecc1c477ff32236f1e753229f4b02dd7737281ff65bf503a7d",
  migrationContractId: "TASK_SHARE_SYNTHETIC_V1",
  statusRegistryRef: "STATELESS_V1",
  routeRefs: Object.freeze(["LEGACY_SHARE_POSTER", "TASK_DETAIL"]),
});

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(domain, value) {
  return crypto.createHash("sha256")
    .update(`${domain}\0`, "utf8")
    .update(typeof value === "string" || Buffer.isBuffer(value) ? value : canonicalJson(value))
    .digest("hex");
}

function fileSha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function factError(code = "FACT_AUTHORITY_REGISTRY_INVALID") {
  const error = new Error("fact authority registry operation failed");
  error.code = code;
  return error;
}

function plainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys) {
  if (!plainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function safeId(value) {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]*$/.test(value)
    && value.length <= 96;
}

function safeText(value, maximumLength = 160) {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength
    && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}

function safeDigest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function uniqueStrings(value, options = {}) {
  return Array.isArray(value)
    && (!options.nonEmpty || value.length > 0)
    && value.every((entry) => safeText(entry, options.maximumLength || 96))
    && new Set(value).size === value.length;
}

function makeExternalFact(blueprint) {
  const [
    factType,
    authoritativeSource,
    writeOwnerModule,
    targetRecord,
    statusRegistryRef,
    routeRefs,
    snapshotRevisionPolicy,
  ] = blueprint;
  const sourceQueryId = `EXTERNAL_GATE_${factType}_SOURCE_V1`;
  const sourceQueryDigest = digest("myroot-fact-authority-source-query:v1", {
    authoritativeSource,
    factType,
    gate: "EXTERNAL_GATE",
    snapshotRevisionPolicy,
    sourceQueryId,
    targetRecord,
  });
  const projectionParityCheckId = `EXTERNAL_GATE_${factType}_PARITY_V1`;
  const projectionParityCheckDigest = digest("myroot-fact-authority-parity-check:v1", {
    factType,
    gate: "EXTERNAL_GATE",
    projectionParityCheckId,
    targetRecord,
    writeOwnerModule,
  });
  return {
    factType,
    authoritativeSource,
    sourceQueryId,
    sourceQueryDigest,
    snapshotRevisionPolicy,
    targetRecord,
    writeOwnerModule,
    projectionParityCheckId,
    projectionParityCheckDigest,
    migrationContractId: "EXTERNAL_GATE",
    statusRegistryRef,
    routeRefs: [...routeRefs].sort(),
  };
}

function expectedManifest() {
  const withoutDigest = {
    schemaVersion: "1.0.0",
    registryVersion: "1.0.0-foundation.1",
    status: "NON_RUNTIME_DEFAULT_DISABLED_FOUNDATION",
    scope: "V1_FACT_AUTHORITY",
    runtimeIntegration: false,
    writeRoutingEnabled: false,
    gateClosureAuthorized: false,
    namedSignoffPresent: false,
    bindings: clone(EXPECTED_BINDINGS),
    statusRegistry: STATUS_BLUEPRINTS.map(([statusRegistryRef, persistenceMode, states]) => ({
      statusRegistryRef,
      persistenceMode,
      states: [...states],
    })),
    facts: [...FACT_BLUEPRINTS.map(makeExternalFact), clone(TASK_SHARE_FACT)]
      .sort((left, right) => left.factType.localeCompare(right.factType)),
    coverageExceptions: [{
      prdRecordRef: "11.2:图片与附件",
      reasonCode: "NO_CENTRAL_FACT_AUTHORITY",
      authorityRule: "BUSINESS_REFERENCE_REMAINS_WITH_OWNING_FACT_MODULE",
      migrationContractId: "EXTERNAL_GATE",
    }],
  };
  return deepFreeze({
    ...withoutDigest,
    registryDigest: digest("myroot-fact-authority-registry:v1", withoutDigest),
  });
}

const EXPECTED_MANIFEST = expectedManifest();

function validateStatusRegistry(statusRegistry) {
  if (!Array.isArray(statusRegistry) || statusRegistry.length !== STATUS_BLUEPRINTS.length) {
    throw factError();
  }
  const byRef = new Map();
  for (const record of statusRegistry) {
    if (!exactKeys(record, ["persistenceMode", "states", "statusRegistryRef"])
      || !safeId(record.statusRegistryRef)
      || !["EXTERNAL_GATE", "PERSISTED", "PROJECTION", "STATELESS"].includes(record.persistenceMode)
      || !uniqueStrings(record.states)
      || byRef.has(record.statusRegistryRef)) throw factError();
    if ((record.persistenceMode === "PERSISTED" || record.persistenceMode === "PROJECTION")
      && record.states.length === 0) throw factError();
    if ((record.persistenceMode === "STATELESS" || record.persistenceMode === "EXTERNAL_GATE")
      && record.states.length !== 0) throw factError();
    byRef.set(record.statusRegistryRef, record);
  }
  return byRef;
}

function validateFacts(facts, statusByRef, routeRegistry, migrationRegistry) {
  if (!Array.isArray(facts) || facts.length !== FACT_BLUEPRINTS.length + 1) throw factError();
  const routeById = new Map(routeRegistry.routes.map((route) => [route.routeId, route]));
  const migrationById = new Map(migrationRegistry.contracts.map((contract) => [
    contract.contractId,
    contract,
  ]));
  const byType = new Map();
  const byTargetRecord = new Map();
  for (const fact of facts) {
    if (!exactKeys(fact, [
      "authoritativeSource",
      "factType",
      "migrationContractId",
      "projectionParityCheckDigest",
      "projectionParityCheckId",
      "routeRefs",
      "snapshotRevisionPolicy",
      "sourceQueryDigest",
      "sourceQueryId",
      "statusRegistryRef",
      "targetRecord",
      "writeOwnerModule",
    ])
      || !safeId(fact.factType)
      || !safeId(fact.authoritativeSource)
      || !safeText(fact.sourceQueryId)
      || !safeDigest(fact.sourceQueryDigest)
      || !SNAPSHOT_REVISION_POLICIES.has(fact.snapshotRevisionPolicy)
      || !safeText(fact.targetRecord)
      || !safeText(fact.writeOwnerModule)
      || !safeText(fact.projectionParityCheckId)
      || !safeDigest(fact.projectionParityCheckDigest)
      || !safeText(fact.migrationContractId)
      || !safeId(fact.statusRegistryRef)
      || !uniqueStrings(fact.routeRefs)
      || byType.has(fact.factType)) throw factError();
    if (!KNOWN_MODULES.has(fact.writeOwnerModule)) {
      throw factError("FACT_AUTHORITY_UNKNOWN_MODULE");
    }
    if (byTargetRecord.has(fact.targetRecord)) {
      throw factError("FACT_AUTHORITY_DUPLICATE_WRITE_OWNER");
    }
    if (INTERNAL_ONLY_MODULES.has(fact.writeOwnerModule) !== (fact.routeRefs.length === 0)) {
      throw factError("FACT_AUTHORITY_ROUTE_SCOPE_INVALID");
    }
    if (!statusByRef.has(fact.statusRegistryRef)) {
      throw factError("FACT_AUTHORITY_UNKNOWN_STATUS_REGISTRY");
    }
    for (const routeId of fact.routeRefs) {
      if (!routeById.has(routeId)) throw factError("FACT_AUTHORITY_UNKNOWN_ROUTE");
    }
    if (fact.migrationContractId === "EXTERNAL_GATE") {
      const expected = makeExternalFact([
        fact.factType,
        fact.authoritativeSource,
        fact.writeOwnerModule,
        fact.targetRecord,
        fact.statusRegistryRef,
        fact.routeRefs,
        fact.snapshotRevisionPolicy,
      ]);
      if (expected.sourceQueryId !== fact.sourceQueryId
        || expected.sourceQueryDigest !== fact.sourceQueryDigest
        || expected.projectionParityCheckId !== fact.projectionParityCheckId
        || expected.projectionParityCheckDigest !== fact.projectionParityCheckDigest) throw factError();
    } else {
      const contract = migrationById.get(fact.migrationContractId);
      if (!contract
        || contract.factType !== fact.factType
        || contract.authoritativeSource !== fact.authoritativeSource
        || contract.sourceQueryId !== fact.sourceQueryId
        || contract.sourceQueryDigest !== fact.sourceQueryDigest
        || contract.targetType.toLowerCase() !== fact.targetRecord
        || contract.parityAdapterId !== fact.projectionParityCheckId
        || contract.parityAdapterDigest !== fact.projectionParityCheckDigest) {
        throw factError("FACT_AUTHORITY_MIGRATION_CONTRACT_DRIFT");
      }
    }
    byType.set(fact.factType, fact);
    byTargetRecord.set(fact.targetRecord, fact.writeOwnerModule);
  }
  return byType;
}

function validateManifest(input) {
  const { manifest, migrationRegistry, prdBytes, routeRegistry } = input;
  if (!exactKeys(manifest, [
    "bindings",
    "coverageExceptions",
    "facts",
    "gateClosureAuthorized",
    "namedSignoffPresent",
    "registryDigest",
    "registryVersion",
    "runtimeIntegration",
    "schemaVersion",
    "scope",
    "status",
    "statusRegistry",
    "writeRoutingEnabled",
  ])
    || manifest.schemaVersion !== "1.0.0"
    || manifest.registryVersion !== "1.0.0-foundation.1"
    || manifest.status !== "NON_RUNTIME_DEFAULT_DISABLED_FOUNDATION"
    || manifest.scope !== "V1_FACT_AUTHORITY"
    || manifest.runtimeIntegration !== false
    || manifest.writeRoutingEnabled !== false
    || manifest.gateClosureAuthorized !== false
    || manifest.namedSignoffPresent !== false
    || !safeDigest(manifest.registryDigest)
    || !exactKeys(manifest.bindings, [
      "migrationContractRegistryDigest",
      "migrationContractRegistryPath",
      "migrationContractRegistryVersion",
      "routeRegistryDigest",
      "routeRegistryPath",
      "routeRegistryVersion",
      "sourcePrdPath",
      "sourcePrdSections",
      "sourcePrdSha256",
    ])
    || !Array.isArray(manifest.coverageExceptions)
    || manifest.coverageExceptions.length !== 1
    || !exactKeys(manifest.coverageExceptions[0], [
      "authorityRule", "migrationContractId", "prdRecordRef", "reasonCode",
    ])
    || manifest.coverageExceptions[0].prdRecordRef !== "11.2:图片与附件"
    || manifest.coverageExceptions[0].reasonCode !== "NO_CENTRAL_FACT_AUTHORITY"
    || manifest.coverageExceptions[0].authorityRule
      !== "BUSINESS_REFERENCE_REMAINS_WITH_OWNING_FACT_MODULE"
    || manifest.coverageExceptions[0].migrationContractId !== "EXTERNAL_GATE") throw factError();

  if (!plainRecord(routeRegistry)
    || !safeText(routeRegistry.registryVersion)
    || !safeDigest(routeRegistry.digest)
    || !Array.isArray(routeRegistry.routes)
    || routeRegistry.routes.some((route) => !plainRecord(route) || !safeId(route.routeId))) {
    throw factError("FACT_AUTHORITY_ROUTE_REGISTRY_DRIFT");
  }
  if (!plainRecord(migrationRegistry)
    || !Number.isSafeInteger(migrationRegistry.registryVersion)
    || !safeDigest(migrationRegistry.registryDigest)
    || !Array.isArray(migrationRegistry.contracts)
    || migrationRegistry.contracts.some((contract) => (
      !plainRecord(contract) || !safeText(contract.contractId)
    ))) {
    throw factError("FACT_AUTHORITY_MIGRATION_REGISTRY_DRIFT");
  }

  const statusByRef = validateStatusRegistry(manifest.statusRegistry);
  const factByType = validateFacts(manifest.facts, statusByRef, routeRegistry, migrationRegistry);

  if (!Buffer.isBuffer(prdBytes)
    || fileSha256(prdBytes) !== manifest.bindings.sourcePrdSha256) {
    throw factError("FACT_AUTHORITY_PRD_DRIFT");
  }
  if (routeRegistry.registryVersion !== manifest.bindings.routeRegistryVersion
    || routeRegistry.digest !== manifest.bindings.routeRegistryDigest) {
    throw factError("FACT_AUTHORITY_ROUTE_REGISTRY_DRIFT");
  }
  if (migrationRegistry.registryVersion !== manifest.bindings.migrationContractRegistryVersion
    || migrationRegistry.registryDigest !== manifest.bindings.migrationContractRegistryDigest) {
    throw factError("FACT_AUTHORITY_MIGRATION_REGISTRY_DRIFT");
  }
  const withoutDigest = { ...manifest };
  delete withoutDigest.registryDigest;
  if (digest("myroot-fact-authority-registry:v1", withoutDigest) !== manifest.registryDigest) {
    throw factError();
  }
  return { factByType, statusByRef };
}

function productionInputs() {
  let manifest;
  let prdBytes;
  let routeRegistry;
  let migrationRegistry;
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    prdBytes = fs.readFileSync(PRD_PATH);
    routeRegistry = loadAndValidateRegistry(ROUTE_REGISTRY_PATH, { appJsonPath: APP_JSON_PATH });
    migrationRegistry = getDefaultMigrationContractRegistry().describe();
  } catch {
    throw factError();
  }
  if (canonicalJson(manifest) !== canonicalJson(EXPECTED_MANIFEST)) throw factError();
  return { manifest, migrationRegistry, prdBytes, routeRegistry };
}

function createFactAuthorityRegistryFoundation(options = {}) {
  if (!exactKeys(options, Object.keys(options).length === 0 ? [] : ["env"])) throw factError();
  const env = options.env === undefined ? process.env : options.env;
  if (!plainRecord(env)) throw factError();
  const enabled = env[ENABLE_FLAG] === "true";
  let checked;

  function assertEnabled() {
    if (!enabled) throw factError("FACT_AUTHORITY_REGISTRY_DISABLED");
  }

  function registry() {
    assertEnabled();
    if (!checked) {
      const inputs = productionInputs();
      const indexes = validateManifest(inputs);
      checked = {
        manifest: deepFreeze(clone(inputs.manifest)),
        ...indexes,
      };
    }
    return checked;
  }

  function assertReady() {
    const current = registry();
    return deepFreeze({
      enabled: true,
      registryDigest: current.manifest.registryDigest,
      registryVersion: current.manifest.registryVersion,
      runtimeIntegrated: false,
      writeRoutingEnabled: false,
      gateClosureAuthorized: false,
      namedSignoffPresent: false,
    });
  }

  function describe() {
    return deepFreeze(clone(registry().manifest));
  }

  function getFact(factType) {
    if (!safeId(factType)) throw factError("FACT_AUTHORITY_INPUT_INVALID");
    const fact = registry().factByType.get(factType);
    if (!fact) throw factError("FACT_AUTHORITY_FACT_UNSUPPORTED");
    return deepFreeze(clone(fact));
  }

  function assertStatus(input) {
    if (!exactKeys(input, ["factType", "status"])
      || !safeId(input.factType)
      || !safeId(input.status)) throw factError("FACT_AUTHORITY_INPUT_INVALID");
    const current = registry();
    const fact = current.factByType.get(input.factType);
    if (!fact) throw factError("FACT_AUTHORITY_FACT_UNSUPPORTED");
    const status = current.statusByRef.get(fact.statusRegistryRef);
    if (status.persistenceMode === "EXTERNAL_GATE") {
      throw factError("FACT_AUTHORITY_STATUS_GATE_OPEN");
    }
    if (!status.states.includes(input.status)) {
      throw factError("FACT_AUTHORITY_STATUS_UNSUPPORTED");
    }
    return deepFreeze({
      factType: fact.factType,
      status: input.status,
      statusRegistryRef: fact.statusRegistryRef,
    });
  }

  return Object.freeze({ assertReady, assertStatus, describe, getFact });
}

function validateFactAuthorityRegistryForTest(options) {
  if (!exactKeys(options, ["manifest", "migrationRegistry", "prdBytes", "routeRegistry", "scope"])
    || options.scope !== "TEST_ONLY") throw factError();
  validateManifest(options);
  return true;
}

if (require.main === module) {
  process.stdout.write(`${JSON.stringify(EXPECTED_MANIFEST, null, 2)}\n`);
}

module.exports = Object.freeze({
  createFactAuthorityRegistryFoundation,
  validateFactAuthorityRegistryForTest,
});
