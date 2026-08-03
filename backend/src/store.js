const fs = require("node:fs");
const path = require("node:path");

const { createSeedData } = require("./seed");
const { minimizePersistedExternalEvidence } = require("./externalEvidenceSanitizer");
const { normalizePersistedCredentials } = require("./credentialProtection");
const { createCommandRequestDigestCodec } = require("./commandRequestDigest");
const { createCommandResultCodec } = require("./commandResultProtection");
const {
  normalizeTaskEventIdempotencyState,
  validateTaskEventIdempotencyCollection,
} = require("./taskEventIdempotency");
const {
  normalizeWechatIdentityAuthority,
  validateWechatIdentityCollection,
} = require("./wechatIdentityAuthority");
const {
  RECIPIENT_BINDING_STATUS,
  markRecipientBindingUnverified,
  validateRecipientBindingCollection,
} = require("./wechatRecipientBinding");
const {
  createMysqlSettlementSourceInvalidationReadAdapter,
} = require("./settlementSourceInvalidationReadAdapter");
const {
  createMysqlSettlementSourceInvalidationResolveAdapter,
} = require("./settlementSourceInvalidationResolveAdapter");
const { runtimeAlertDeliveryMode } = require("./v1RuntimeAlertPayloadAdapter");

const SQLITE_SCHEMA_VERSION = 1;
const SQLITE_STORE_KEY = "root-checkin";
const MYSQL_SCHEMA_VERSION = 28;
const MYSQL_STORE_KEY = "root-checkin";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const SETTLEMENT_AUTHORITY_COLLECTIONS = Object.freeze([
  Object.freeze({ key: "settlementRecords", id: "settlement_record_id" }),
  Object.freeze({ key: "rewardGrants", id: "reward_grant_id" }),
  Object.freeze({
    key: "rewardInventoryReservations",
    id: "reward_inventory_reservation_id",
  }),
]);

function settlementAuthorityScopes(before, after) {
  const scopes = new Map();
  for (const collection of SETTLEMENT_AUTHORITY_COLLECTIONS) {
    const beforeRows = Array.isArray(before && before[collection.key])
      ? before[collection.key]
      : [];
    const afterRows = Array.isArray(after && after[collection.key])
      ? after[collection.key]
      : [];
    const indexRows = (rows) => {
      const indexed = new Map();
      for (const row of rows) {
        const id = row && row[collection.id];
        if (typeof id !== "string" || !id.trim()
          || id !== id.trim() || id.length > 128
          || /[\u0000-\u001f\u007f]/.test(id)
          || indexed.has(id)) {
          const error = new Error("Settlement authority collection identity is invalid");
          error.code = "SETTLEMENT_SOURCE_INVALIDATION_READ_SCOPE_INVALID";
          error.status = 503;
          throw error;
        }
        indexed.set(id, row);
      }
      return indexed;
    };
    const beforeById = indexRows(beforeRows);
    const afterById = indexRows(afterRows);
    const ids = new Set([...beforeById.keys(), ...afterById.keys()]);
    for (const id of ids) {
      const previous = beforeById.get(id) || null;
      const current = afterById.get(id) || null;
      if (JSON.stringify(previous) === JSON.stringify(current)) continue;
      for (const row of [previous, current].filter(Boolean)) {
        const rootUserId = row.root_user_id;
        const campaignId = row.campaign_id;
        if (typeof rootUserId !== "string" || !rootUserId.trim()
          || rootUserId !== rootUserId.trim() || rootUserId.length > 32
          || typeof campaignId !== "string" || !campaignId.trim()
          || campaignId !== campaignId.trim() || campaignId.length > 64) {
          const error = new Error("Settlement authority scope is invalid");
          error.code = "SETTLEMENT_SOURCE_INVALIDATION_READ_SCOPE_INVALID";
          error.status = 503;
          throw error;
        }
        scopes.set(`${rootUserId}\0${campaignId}`, { rootUserId, campaignId });
      }
    }
  }
  return [...scopes.values()].sort((left, right) => Buffer.compare(
    Buffer.from(`${left.rootUserId}\0${left.campaignId}`, "utf8"),
    Buffer.from(`${right.rootUserId}\0${right.campaignId}`, "utf8")
  ));
}

function assertSettlementAuthorityAvailable(candidates) {
  const rows = Array.isArray(candidates) ? candidates : [];
  if (rows.some((row) => row.review_type === "SETTLEMENT_STOP_CANDIDATE")) {
    const error = new Error("活动任务来源已取消，本次结算已停止");
    error.code = "SETTLEMENT_SOURCE_INVALIDATED";
    error.status = 409;
    throw error;
  }
  if (rows.length > 0) {
    const error = new Error("原结算需通过追加调整流程复核，不能自动重算或覆盖");
    error.code = "SETTLEMENT_RECALCULATION_REQUIRED";
    error.status = 409;
    throw error;
  }
}

function mergeDefaults(target, defaults) {
  if (Array.isArray(defaults)) return Array.isArray(target) ? target : clone(defaults);
  if (!defaults || typeof defaults !== "object") return target === undefined ? defaults : target;
  const next = target && typeof target === "object" && !Array.isArray(target) ? target : {};
  Object.entries(defaults).forEach(([key, value]) => {
    if (next[key] === undefined) {
      next[key] = clone(value);
      return;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      next[key] = mergeDefaults(next[key], value);
    }
  });
  return next;
}

function createEmptyData() {
  const data = createSeedData();
  data.formalContentItems = [];
  data.youzanProducts = [];
  data.youzanSkus = [];
  data.campaignProductRelations = [];
  data.productJumpLogs = [];
  data.youzanCustomers = [];
  data.youzanIdentityReconciliations = [];
  data.campaignDefinitions = [];
  data.campaignParticipants = [];
  data.activityDefinitionVersions = [];
  data.activitySessions = [];
  data.activitySessionEvents = [];
  data.activityEnrollments = [];
  data.activityEnrollmentEvents = [];
  data.taskDefinitions = [];
  data.taskEvents = [];
  data.taskProgressSnapshots = [];
  data.notificationTemplates = [];
  data.notificationSubscriptions = [];
  data.notificationSubscriptionGrants = [];
  data.notificationJobs = [];
  data.notificationDeliveries = [];
  data.questionnaireAnswers = [];
  data.campaignRuleVersions = [];
  data.settlementRecords = [];
  data.rewardInventoryPools = [];
  data.rewardInventoryReservations = [];
  data.rewardGrants = [];
  data.rewardRecoveryRecords = [];
  data.rewardDeliveryJobs = [];
  data.manualReviewItems = [];
  data.adminLifecycleFilterPresets = [];
  data.adminLifecycleSettlementJobs = [];
  data.adminLifecycleUserExports = [];
  data.operationalAlertRules = [];
  data.operationalAlertRuns = [];
  data.operationalAlertNotifications = [];
  data.releaseEvidenceArchives = [];
  data.releaseSignoffs = [];
  data.adminLegacyDeprecationDecisions = [];
  data.productionCutoverProofs = [];
  data.rootMemberCenterJumpProofs = [];
  data.legacyDataMigrationDecisions = [];
  data.legacyDataMigrationExecutions = [];
  data.consultationAdvisorAssignments = [];
  data.consultationWeworkWritebacks = [];
  data.weworkTouchJobs = [];
  data.orderAfterSalesRecords = [];
  data.youzanOrders = [];
  data.orderFulfillments = [];
  data.events = [];
  data.commandIdempotencyRecords = [];
  data.eventOutbox = [];
  data.eventInbox = [];
  data.eventConsumerCheckpoints = [];
  return data;
}

function defaultsForOptions(options = {}) {
  return options.seedSampleData ? createSeedData() : createEmptyData();
}

function normalizeStoreData(rawData, options = {}) {
  const normalized = minimizePersistedExternalEvidence(mergeDefaults(clone(rawData || {}), defaultsForOptions(options)));
  normalizePersistedCredentials(normalized);
  if (Array.isArray(normalized.taskEvents)) {
    normalized.taskEvents.forEach(normalizeTaskEventIdempotencyState);
  }
  if (Array.isArray(normalized.wechatIdentities)) {
    normalized.wechatIdentities.forEach(normalizeWechatIdentityAuthority);
  }
  if (Array.isArray(normalized.notificationSubscriptionGrants)) {
    normalized.notificationSubscriptionGrants.forEach((grant) => {
      if (!grant.recipient_binding_status) markRecipientBindingUnverified(grant);
      if (grant.recipient_binding_status === RECIPIENT_BINDING_STATUS.UNVERIFIED
        && grant.status !== "REVIEW_REQUIRED") {
        grant.status = "REVIEW_REQUIRED";
        grant.release_reason = grant.release_reason || "RECIPIENT_BINDING_UNVERIFIED";
        grant.review_required_at = grant.review_required_at || grant.updated_at || grant.created_at || "";
      }
    });
  }
  delete normalized.wechatAccessToken;
  return normalized;
}

function validateSnapshot(snapshot, options = {}) {
  const errors = [];
  const warnings = [];
  const defaults = defaultsForOptions({ seedSampleData: false, ...options });

  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return {
      valid: false,
      errors: ["snapshot must be an object"],
      warnings,
      counts: {},
    };
  }

  Object.entries(defaults).forEach(([key, defaultValue]) => {
    const value = snapshot[key];
    if (value === undefined) {
      errors.push(`missing key: ${key}`);
      return;
    }
    if (Array.isArray(defaultValue) && !Array.isArray(value)) {
      errors.push(`key ${key} must be an array`);
      return;
    }
    if (defaultValue && typeof defaultValue === "object" && !Array.isArray(defaultValue)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) errors.push(`key ${key} must be an object`);
    }
  });

  const duplicateChecks = [
    ["users", "user_id"],
    ["rootUsers", "root_user_id"],
    ["wechatIdentities", "wechat_identity_id"],
    ["privacyConsentRecords", "privacy_consent_record_id"],
    ["youzanProducts", "youzan_product_id"],
    ["youzanSkus", "youzan_sku_id"],
    ["campaignProductRelations", "campaign_product_relation_id"],
    ["productJumpLogs", "product_jump_log_id"],
    ["campaignDefinitions", "campaign_id"],
    ["campaignParticipants", "campaign_participant_id"],
    ["activityDefinitionVersions", "activity_version_id"],
    ["activitySessions", "activity_session_id"],
    ["activitySessionEvents", "activity_session_event_id"],
    ["activitySessionEvents", "request_id"],
    ["activityEnrollments", "activity_enrollment_id"],
    ["activityEnrollmentEvents", "activity_enrollment_event_id"],
    ["activityEnrollmentEvents", "request_id"],
    ["taskDefinitions", "task_definition_id"],
    ["taskEvents", "task_event_id"],
    ["taskProgressSnapshots", "task_progress_snapshot_id"],
    ["notificationTemplates", "notification_template_id"],
    ["notificationSubscriptions", "notification_subscription_id"],
    ["notificationSubscriptionGrants", "notification_subscription_grant_id"],
    ["notificationSubscriptionGrants", "idempotency_key"],
    ["notificationJobs", "notification_job_id"],
    ["notificationJobs", "idempotency_key"],
    ["notificationDeliveries", "notification_delivery_id"],
    ["campaignRuleVersions", "campaign_rule_version_id"],
    ["settlementRecords", "settlement_record_id"],
    ["rewardInventoryPools", "reward_inventory_pool_id"],
    ["rewardInventoryReservations", "reward_inventory_reservation_id"],
    ["rewardInventoryReservations", "idempotency_key"],
    ["rewardGrants", "reward_grant_id"],
    ["rewardRecoveryRecords", "reward_recovery_record_id"],
    ["rewardRecoveryRecords", "idempotency_key"],
    ["rewardDeliveryJobs", "reward_delivery_job_id"],
    ["manualReviewItems", "manual_review_item_id"],
    ["adminLifecycleFilterPresets", "preset_id"],
    ["adminLifecycleSettlementJobs", "job_id"],
    ["adminLifecycleUserExports", "export_id"],
    ["operationalAlertRules", "alert_rule_id"],
    ["operationalAlertRuns", "operational_alert_run_id"],
    ["operationalAlertNotifications", "operational_alert_notification_id"],
    ["releaseEvidenceArchives", "archive_id"],
    ["releaseEvidenceArchives", "request_id"],
    ["releaseSignoffs", "signoff_id"],
    ["releaseSignoffs", "request_id"],
    ["adminLegacyDeprecationDecisions", "decision_id"],
    ["adminLegacyDeprecationDecisions", "request_id"],
    ["productionCutoverProofs", "proof_id"],
    ["productionCutoverProofs", "request_id"],
    ["rootMemberCenterJumpProofs", "proof_id"],
    ["rootMemberCenterJumpProofs", "request_id"],
    ["legacyDataMigrationDecisions", "decision_id"],
    ["legacyDataMigrationDecisions", "request_id"],
    ["legacyDataMigrationExecutions", "execution_id"],
    ["legacyDataMigrationExecutions", "request_id"],
    ["youzanIdentityReconciliations", "reconciliation_id"],
    ["consultationAdvisorAssignments", "assignment_id"],
    ["consultationAdvisorAssignments", "request_id"],
    ["consultationWeworkWritebacks", "writeback_id"],
    ["consultationWeworkWritebacks", "request_id"],
    ["weworkTouchJobs", "wework_touch_job_id"],
    ["weworkTouchJobs", "idempotency_key"],
    ["orderAfterSalesRecords", "order_after_sales_record_id"],
    ["orderAfterSalesRecords", "after_sales_no"],
    ["orderAfterSalesRecords", "idempotency_key"],
    ["youzanOrders", "order_id"],
    ["youzanOrders", "youzan_order_no"],
    ["orderFulfillments", "fulfillment_id"],
    ["checkinSessions", "session_id"],
    ["operationTasks", "task_id"],
    ["userContactMethods", "contact_method_id"],
    ["userLifecycleEvents", "lifecycle_event_id"],
    ["importBatches", "batch_id"],
    ["auditLogs", "audit_id"],
    ["commandIdempotencyRecords", "recordId"],
    ["eventOutbox", "outbox_event_id"],
    ["eventInbox", "inbox_receipt_id"],
  ];
  duplicateChecks.forEach(([listKey, idKey]) => {
    const list = snapshot[listKey];
    if (!Array.isArray(list)) return;
    const seen = new Set();
    list.forEach((item) => {
      const id = item && item[idKey];
      if (!id) return;
      if (seen.has(id)) errors.push(`duplicate ${listKey}.${idKey}: ${id}`);
      seen.add(id);
    });
  });

  const taskEventIdempotency = validateTaskEventIdempotencyCollection(snapshot.taskEvents);
  errors.push(...taskEventIdempotency.errors);
  warnings.push(...taskEventIdempotency.warnings);
  const wechatIdentityAuthority = validateWechatIdentityCollection(snapshot.wechatIdentities, {
    env: options.env || process.env,
  });
  errors.push(...wechatIdentityAuthority.errors);
  const recipientBindings = validateRecipientBindingCollection(snapshot.notificationSubscriptionGrants, {
    env: options.env || process.env,
  });
  errors.push(...recipientBindings.errors);

  const activityVersions = new Set();
  const activityVersionIds = new Set();
  const activityPublicationDecisions = new Set();
  if (Array.isArray(snapshot.activityDefinitionVersions)) {
    snapshot.activityDefinitionVersions.forEach((definition) => {
      const identity = `${definition.activity_id || ""}:${definition.version || ""}`;
      if (activityVersions.has(identity)) errors.push(`duplicate activity version: ${identity}`);
      activityVersions.add(identity);
      if (definition.activity_version_id) activityVersionIds.add(definition.activity_version_id);
      const preboundTaskDefinitionId = String(definition.prebound_task_definition_id || "").trim();
      const preboundTaskDefinitionVersion = String(definition.prebound_task_definition_version || "").trim();
      if (Boolean(preboundTaskDefinitionId) !== Boolean(preboundTaskDefinitionVersion)) {
        errors.push(`activity task binding is incomplete: ${definition.activity_version_id || "unknown"}`);
      }
      if (definition.status === "PUBLISHED") {
        const decisionIdentity = `${definition.publication_authorization_adapter_id || ""}:${definition.publication_authorization_decision_ref || ""}`;
        if (activityPublicationDecisions.has(decisionIdentity)) {
          errors.push(`duplicate activity publication decision: ${decisionIdentity}`);
        }
        activityPublicationDecisions.add(decisionIdentity);
        const requiredRefs = [
          "publish_owner_signer_ref",
          "publication_authorization_adapter_id",
          "publication_authorization_decision_ref",
          "publication_authorized_principal_ref",
          "controlled_approval_ref",
          "authorization_verified_at",
          "published_at",
        ];
        if (requiredRefs.some((key) => !String(definition[key] || "").trim())) {
          errors.push(`published activity is missing authorization evidence: ${definition.activity_version_id || "unknown"}`);
        }
        const digestKeys = [
          "content_authorization_digest",
          "ued_acceptance_digest",
          "photography_authorization_digest",
          "artifact_provenance_digest",
        ];
        if (digestKeys.some((key) => !/^[a-f0-9]{64}$/.test(String(definition[key] || "")))) {
          errors.push(`published activity has invalid authorization digest: ${definition.activity_version_id || "unknown"}`);
        }
        if (definition.controlled_approval_ref !== definition.content_approval_ref) {
          errors.push(`published activity approval reference mismatch: ${definition.activity_version_id || "unknown"}`);
        }
        if (!Number.isFinite(Date.parse(definition.authorization_verified_at || ""))
          || !Number.isFinite(Date.parse(definition.published_at || ""))) {
          errors.push(`published activity has invalid authorization timestamp: ${definition.activity_version_id || "unknown"}`);
        }
      }
    });
  }
  const activitySessionIds = new Set();
  const activitySessionBusinessTimes = new Set();
  if (Array.isArray(snapshot.activitySessions)) {
    snapshot.activitySessions.forEach((session) => {
      if (session.activity_session_id) activitySessionIds.add(session.activity_session_id);
      const businessTime = `${session.activity_version_id || ""}:${session.session_start_at || ""}`;
      if (activitySessionBusinessTimes.has(businessTime)) {
        errors.push(`duplicate activity session business time: ${businessTime}`);
      }
      activitySessionBusinessTimes.add(businessTime);
      if (session.activity_version_id && !activityVersionIds.has(session.activity_version_id)) {
        errors.push(`activity session references missing version: ${session.activity_version_id}`);
      }
      if (session.status === "CANCELED" && !session.cancel_reason) {
        errors.push(`canceled activity session is missing cancel reason: ${session.activity_session_id || "unknown"}`);
      }
      if (session.status !== "CANCELED" && session.cancel_reason) {
        errors.push(`active activity session has cancel reason: ${session.activity_session_id || "unknown"}`);
      }
      if (session.approval_mode === "MANUAL") {
        const reviewDeadline = Date.parse(session.review_deadline || "");
        const registrationClose = Date.parse(session.registration_close_at || "");
        const sessionStart = Date.parse(session.session_start_at || "");
        if (!Number.isFinite(reviewDeadline)
          || reviewDeadline < registrationClose
          || reviewDeadline > sessionStart) {
          errors.push(`manual activity session has invalid review deadline: ${session.activity_session_id || "unknown"}`);
        }
      }
      const cancelClose = Date.parse(session.cancel_close_at || "");
      const registrationOpen = Date.parse(session.registration_open_at || "");
      const sessionStart = Date.parse(session.session_start_at || "");
      if (!Number.isFinite(cancelClose)
        || !Number.isFinite(registrationOpen)
        || !Number.isFinite(sessionStart)
        || cancelClose <= registrationOpen
        || cancelClose > sessionStart) {
        errors.push(`activity session has invalid cancel window: ${session.activity_session_id || "unknown"}`);
      }
    });
  }
  const activityEnrollmentIds = new Set();
  const activityEnrollmentGenerations = new Map();
  const activityEnrollmentIdentities = new Set();
  const pendingActivitySessionIds = new Set();
  if (Array.isArray(snapshot.activityEnrollments)) {
    snapshot.activityEnrollments.forEach((enrollment) => {
      const identity = `${enrollment.activity_session_id || ""}:${enrollment.root_user_id || ""}`;
      if (activityEnrollmentIdentities.has(identity)) errors.push(`duplicate activity enrollment: ${identity}`);
      activityEnrollmentIdentities.add(identity);
      if (enrollment.activity_enrollment_id) {
        activityEnrollmentIds.add(enrollment.activity_enrollment_id);
        activityEnrollmentGenerations.set(enrollment.activity_enrollment_id, enrollment.attempt_generation);
      }
      if (enrollment.activity_session_id && !activitySessionIds.has(enrollment.activity_session_id)) {
        errors.push(`activity enrollment references missing session: ${enrollment.activity_session_id}`);
      }
      if (enrollment.status === "PENDING") pendingActivitySessionIds.add(enrollment.activity_session_id);
    });
  }
  if (Array.isArray(snapshot.activitySessions)) {
    snapshot.activitySessions.forEach((session) => {
      if (session.status === "ENDED" && pendingActivitySessionIds.has(session.activity_session_id)) {
        errors.push(`ended activity session has pending enrollment: ${session.activity_session_id || "unknown"}`);
      }
    });
  }
  const activitySessionEventSequences = new Set();
  const canceledActivitySessionIds = new Set();
  if (Array.isArray(snapshot.activitySessionEvents)) {
    snapshot.activitySessionEvents.forEach((event) => {
      if (event.activity_session_id && !activitySessionIds.has(event.activity_session_id)) {
        errors.push(`activity session event references missing session: ${event.activity_session_id}`);
      }
      const sequenceIdentity = `${event.activity_session_id || ""}:${event.event_sequence || ""}`;
      if (activitySessionEventSequences.has(sequenceIdentity)) {
        errors.push(`duplicate activity session event sequence: ${sequenceIdentity}`);
      }
      activitySessionEventSequences.add(sequenceIdentity);
      const allowedFromStatuses = new Set(["SCHEDULED", "OPEN", "CLOSED"]);
      const allowedReasons = new Set(["OPERATOR_CANCELED", "WEATHER", "VENUE", "FORCE_MAJEURE", "OTHER"]);
      if (event.operation !== "SESSION_CANCELED"
        || event.to_status !== "CANCELED"
        || !allowedFromStatuses.has(event.from_status)
        || !allowedReasons.has(event.reason_code)
        || !Number.isInteger(event.event_sequence)
        || event.event_sequence <= 0
        || !String(event.request_id || "").trim()
        || !String(event.actor_ref || "").trim()
        || (event.reason_code === "OTHER" && !String(event.reason_detail || "").trim())) {
        errors.push(`invalid activity session event shape: ${event.activity_session_event_id || "unknown"}`);
      }
      if (event.operation === "SESSION_CANCELED") {
        if (canceledActivitySessionIds.has(event.activity_session_id)) {
          errors.push(`duplicate activity session cancellation event: ${event.activity_session_id || "unknown"}`);
        }
        canceledActivitySessionIds.add(event.activity_session_id);
      }
    });
  }
  if (Array.isArray(snapshot.activitySessions)) {
    snapshot.activitySessions.forEach((session) => {
      if (session.status === "CANCELED" && !canceledActivitySessionIds.has(session.activity_session_id)) {
        errors.push(`canceled activity session is missing durable event: ${session.activity_session_id || "unknown"}`);
      }
    });
  }
  if (Array.isArray(snapshot.activityEnrollmentEvents)) {
    const sessionRequestIds = new Set((snapshot.activitySessionEvents || []).map((event) => event.request_id));
    snapshot.activityEnrollmentEvents.forEach((event) => {
      if (event.activity_enrollment_id && !activityEnrollmentIds.has(event.activity_enrollment_id)) {
        errors.push(`activity enrollment event references missing enrollment: ${event.activity_enrollment_id}`);
      }
      const currentGeneration = activityEnrollmentGenerations.get(event.activity_enrollment_id);
      if (!Number.isInteger(event.attempt_generation)
        || event.attempt_generation <= 0
        || !Number.isInteger(currentGeneration)
        || event.attempt_generation > currentGeneration) {
        errors.push(`activity enrollment event has invalid attempt generation: ${event.activity_enrollment_event_id || "unknown"}`);
      }
      if (sessionRequestIds.has(event.request_id)) {
        errors.push(`activity request id reused across event projections: ${event.request_id}`);
      }
    });
  }

  const orderIds = new Set(Array.isArray(snapshot.youzanOrders) ? snapshot.youzanOrders.map((order) => order.order_id).filter(Boolean) : []);
  if (Array.isArray(snapshot.orderFulfillments)) {
    snapshot.orderFulfillments.forEach((fulfillment) => {
      if (fulfillment.order_id && !orderIds.has(fulfillment.order_id)) {
        warnings.push(`fulfillment references missing order: ${fulfillment.order_id}`);
      }
    });
  }
  if (Array.isArray(snapshot.orderAfterSalesRecords)) {
    snapshot.orderAfterSalesRecords.forEach((record) => {
      if (record.order_id && !orderIds.has(record.order_id)) {
        warnings.push(`after sales record references missing order: ${record.order_id}`);
      }
    });
  }

  const counts = Object.fromEntries(Object.keys(defaults)
    .filter((key) => Array.isArray(snapshot[key]))
    .map((key) => [key, snapshot[key].length]));

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    counts,
  };
}

function replaceStoreData(target, nextData, options = {}) {
  Object.keys(target).forEach((key) => {
    delete target[key];
  });
  Object.assign(target, normalizeStoreData(clone(nextData || {}), options));
  return target;
}

function createMemoryStore(initialData, options = { seedSampleData: true }) {
  const data = normalizeStoreData(initialData || defaultsForOptions(options), options);
  const adapter = {
    kind: "memory",
    data,
    save() {},
    exportSnapshot() {
      return clone(data);
    },
    importSnapshot(snapshot) {
      replaceStoreData(data, snapshot, options);
    },
    validateSnapshot(snapshot = data) {
      return validateSnapshot(snapshot, options);
    },
    getStoreHealth() {
      return {
        kind: "memory",
        schemaVersion: null,
        lastSavedAt: "",
        persistent: false,
      };
    },
  };
  return adapter;
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, "utf8");
  if (!text.trim()) return null;
  return JSON.parse(text);
}

function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

function createJsonFileStore(filePath, options = {}) {
  if (!filePath) throw new Error("JSON store path is required");
  const absolutePath = path.resolve(filePath);
  const data = normalizeStoreData(readJsonFile(absolutePath) || defaultsForOptions(options), options);
  let lastSavedAt = "";
  const adapter = {
    kind: "json-file",
    filePath: absolutePath,
    data,
    save() {
      writeJsonFile(absolutePath, data);
      lastSavedAt = new Date().toISOString();
    },
    exportSnapshot() {
      return clone(data);
    },
    importSnapshot(snapshot) {
      replaceStoreData(data, snapshot, options);
      adapter.save();
    },
    validateSnapshot(snapshot = data) {
      return validateSnapshot(snapshot, options);
    },
    getStoreHealth() {
      return {
        kind: "json-file",
        filePath: absolutePath,
        schemaVersion: null,
        lastSavedAt,
        persistent: true,
      };
    },
  };
  adapter.save();
  return adapter;
}

function createSqliteStore(filePath, options = {}) {
  if (!filePath) throw new Error("SQLite store path is required");
  const { DatabaseSync } = require("node:sqlite");
  const absolutePath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const db = new DatabaseSync(absolutePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS root_store_snapshot (
      store_key TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const row = db.prepare("SELECT payload_json FROM root_store_snapshot WHERE store_key = ?").get(SQLITE_STORE_KEY);
  const data = normalizeStoreData(row ? JSON.parse(row.payload_json) : defaultsForOptions(options), options);
  let lastSavedAt = "";

  const adapter = {
    kind: "sqlite",
    filePath: absolutePath,
    data,
    save() {
      const payload = JSON.stringify(data);
      const updatedAt = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(`
          INSERT INTO root_store_snapshot (store_key, schema_version, payload_json, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(store_key) DO UPDATE SET
            schema_version = excluded.schema_version,
            payload_json = excluded.payload_json,
            updated_at = excluded.updated_at
        `).run(SQLITE_STORE_KEY, SQLITE_SCHEMA_VERSION, payload, updatedAt);
        db.exec("COMMIT");
        lastSavedAt = updatedAt;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    exportSnapshot() {
      return clone(data);
    },
    importSnapshot(snapshot) {
      replaceStoreData(data, snapshot, options);
      return adapter.save();
    },
    validateSnapshot(snapshot = data) {
      return validateSnapshot(snapshot, options);
    },
    close() {
      db.close();
    },
    getStoreHealth() {
      return {
        kind: "sqlite",
        filePath: absolutePath,
        schemaVersion: SQLITE_SCHEMA_VERSION,
        lastSavedAt,
        persistent: true,
      };
    },
  };
  adapter.save();
  return adapter;
}

function parseMysqlAddress(address = "") {
  const [hostPart, portPart] = String(address || "").split(":");
  return {
    host: hostPart || "127.0.0.1",
    port: Number(portPart || 3306),
  };
}

function mysqlConfigFromEnv(env = process.env) {
  const address = parseMysqlAddress(env.MYSQL_ADDRESS || "");
  return {
    host: env.MYSQL_HOST || address.host,
    port: Number(env.MYSQL_PORT || address.port || 3306),
    user: env.MYSQL_USERNAME || env.MYSQL_USER || "root",
    password: env.MYSQL_PASSWORD || "",
    database: env.MYSQL_DATABASE || "root_checkin",
    connectionLimit: Math.max(1, Number(env.MYSQL_CONNECTION_LIMIT || 8)),
    connectTimeout: Math.max(1000, Number(env.MYSQL_CONNECT_TIMEOUT_MS || 10000)),
  };
}

function validateMysqlConfig(config = {}) {
  const required = ["host", "user", "password", "database"];
  const missing = required.filter((key) => !String(config[key] || "").trim());
  if (missing.length) throw new Error(`MySQL configuration missing: ${missing.join(", ")}`);
  if (!Number.isInteger(Number(config.port)) || Number(config.port) <= 0) throw new Error("MySQL port must be a positive integer");
  return config;
}

function strictOptionalBooleanFlag(env, name) {
  const value = env && Object.prototype.hasOwnProperty.call(env, name) ? env[name] : "";
  if (value === undefined || value === null || value === "" || value === "false") return false;
  if (value === "true") return true;
  const error = new Error(`${name} must be the exact string true or false`);
  error.code = "V1_RUNTIME_CONTROL_PLANE_CONFIGURATION_INVALID";
  throw error;
}

function resolveMysqlMigrationMode(env = process.env) {
  const raw = String(env.ROOT_MYSQL_MIGRATION_MODE || "").trim().toLowerCase();
  const production = String(env.NODE_ENV || "").trim().toLowerCase() === "production";
  if (raw === "verify_only") return raw;
  if (raw === "auto_apply" && !production) return raw;
  if (!production && !raw) return "auto_apply";
  const error = new Error("ROOT_MYSQL_MIGRATION_MODE must be verify_only in production");
  error.code = "MYSQL_MIGRATION_MODE_INVALID";
  throw error;
}

function v1RuntimeConnectionLimit(env) {
  const raw = env && Object.prototype.hasOwnProperty.call(env, "MYROOT_V1_RUNTIME_CONNECTION_LIMIT")
    ? env.MYROOT_V1_RUNTIME_CONNECTION_LIMIT
    : "3";
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    const error = new Error("MYROOT_V1_RUNTIME_CONNECTION_LIMIT must be an integer from 3 to 64");
    error.code = "V1_RUNTIME_CONTROL_PLANE_CONFIGURATION_INVALID";
    throw error;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 3 || value > 64) {
    const error = new Error("MYROOT_V1_RUNTIME_CONNECTION_LIMIT must be an integer from 3 to 64");
    error.code = "V1_RUNTIME_CONTROL_PLANE_CONFIGURATION_INVALID";
    throw error;
  }
  return value;
}

function v1RuntimeAlertRoleMysqlConfig(env, role) {
  const prefix = `MYROOT_V1_RUNTIME_ALERT_${role}_MYSQL_`;
  const user = env[`${prefix}USERNAME`];
  const password = env[`${prefix}PASSWORD`];
  const expectedCurrentUser = env[`${prefix}CURRENT_USER`];
  const rawLimit = env[`${prefix}CONNECTION_LIMIT`];
  const valid = typeof user === "string" && user.length >= 1 && user.length <= 128
    && user === user.trim()
    && !/[\u0000-\u001f\u007f]/.test(user)
    && typeof password === "string" && password.length >= 16 && password.length <= 4096
    && password === password.trim()
    && !/[\u0000-\u001f\u007f]/.test(password)
    && typeof expectedCurrentUser === "string"
    && expectedCurrentUser.length >= 3 && expectedCurrentUser.length <= 288
    && expectedCurrentUser.includes("@")
    && /^[\x21-\x7e]+$/.test(expectedCurrentUser)
    && typeof rawLimit === "string" && /^[1-9][0-9]*$/.test(rawLimit);
  const connectionLimit = Number(rawLimit);
  if (!valid || !Number.isSafeInteger(connectionLimit)
    || connectionLimit < 1 || connectionLimit > 64) {
    const error = new Error("V1 runtime alert database authority configuration is invalid");
    error.code = "V1_RUNTIME_ALERT_DELIVERY_AUTHORITY_CONFIGURATION_INVALID";
    throw error;
  }
  return Object.freeze({ user, password, expectedCurrentUser, connectionLimit });
}

function parseMysqlPayload(value) {
  if (!value) return null;
  if (typeof value === "string") return JSON.parse(value);
  if (Buffer.isBuffer(value)) return JSON.parse(value.toString("utf8"));
  if (typeof value === "object") return clone(value);
  return JSON.parse(String(value));
}

async function createMysqlStore(config = {}, options = {}) {
  const dependencies = options.dependencies || {};
  const mysql = dependencies.mysql || require("mysql2/promise");
  const migrationModule = require("./mysqlMigrations");
  const projectionModule = require("./mysqlProjection");
  const privilegeModule = require("./mysqlPrivilegePolicy");
  const eventTransportModule = require("./mysqlEventTransportAdapter");
  const commandIdempotencyModule = require("./mysqlCommandIdempotencyAdapter");
  const commandRecoveryModule = require("./mysqlCommandRecovery");
  const activityTaskReadModule = require("./activityTaskReadAdapter");
  const runtimeControlPlaneModule = require("./v1RuntimeControlPlaneFoundation");
  const runtimePrincipalReadinessModule = require("./mysqlRuntimePrincipalReadiness");
  const notificationDeliveryModule = require("./mysqlNotificationDeliveryCore");
  const applyMysqlMigrations = dependencies.applyMysqlMigrations || migrationModule.applyMysqlMigrations;
  const verifyMysqlMigrations = dependencies.verifyMysqlMigrations || migrationModule.verifyMysqlMigrations;
  const changedCollectionKeys = dependencies.changedCollectionKeys || projectionModule.changedCollectionKeys;
  const syncCoreProjections = dependencies.syncCoreProjections || projectionModule.syncCoreProjections;
  const assertMysqlPrivilegePolicy = dependencies.assertMysqlPrivilegePolicy || privilegeModule.assertMysqlPrivilegePolicy;
  const readMysqlPrivilegePolicy = dependencies.readMysqlPrivilegePolicy || privilegeModule.readMysqlPrivilegePolicy;
  const readMysqlPrivilegePolicyFromConnection = dependencies.readMysqlPrivilegePolicyFromConnection
    || privilegeModule.readMysqlPrivilegePolicyFromConnection;
  const createMysqlEventTransportAdapter = dependencies.createMysqlEventTransportAdapter
    || eventTransportModule.createMysqlEventTransportAdapter;
  const createMysqlCommandIdempotencyAdapter = dependencies.createMysqlCommandIdempotencyAdapter
    || commandIdempotencyModule.createMysqlCommandIdempotencyAdapter;
  const createMysqlCommandRecovery = dependencies.createMysqlCommandRecovery
    || commandRecoveryModule.createMysqlCommandRecovery;
  const createMysqlActivityTaskReadAdapter = dependencies.createMysqlActivityTaskReadAdapter
    || activityTaskReadModule.createMysqlActivityTaskReadAdapter;
  const createV1RuntimeControlPlane = dependencies.createV1RuntimeControlPlane
    || runtimeControlPlaneModule.createV1RuntimeControlPlane;
  const createMysqlRuntimePrincipalReadiness = dependencies.createMysqlRuntimePrincipalReadiness
    || runtimePrincipalReadinessModule.createMysqlRuntimePrincipalReadiness;
  const assertMysqlRuntimePrincipalReadinessStatus = dependencies
    .assertMysqlRuntimePrincipalReadinessStatus
    || runtimePrincipalReadinessModule.assertMysqlRuntimePrincipalReadinessStatus;
  const createMysqlNotificationDeliveryCore = dependencies.createMysqlNotificationDeliveryCore
    || notificationDeliveryModule.createMysqlNotificationDeliveryCore;
  const createSettlementSourceInvalidationReadAdapter = dependencies
    .createMysqlSettlementSourceInvalidationReadAdapter
    || createMysqlSettlementSourceInvalidationReadAdapter;
  const createSettlementSourceInvalidationResolveAdapter = dependencies
    .createMysqlSettlementSourceInvalidationResolveAdapter
    || createMysqlSettlementSourceInvalidationResolveAdapter;
  const policyEnvSource = options.env || process.env;
  // Node exposes process.env as a host object whose prototype is not
  // Object.prototype. Internal persistence modules intentionally accept only
  // plain records, so normalize the platform environment at this seam while
  // preserving explicitly supplied test/configuration records unchanged.
  const policyEnv = policyEnvSource === process.env
    ? { ...policyEnvSource }
    : policyEnvSource;
  const commandRequestDigestCodec = options.commandRequestDigestCodec
    || createCommandRequestDigestCodec(policyEnv);
  const commandResultCodec = options.commandResultCodec
    || createCommandResultCodec(policyEnv);
  commandRequestDigestCodec.assertReady();
  commandResultCodec.assertReady();
  const commandRequestDigestStatus = commandRequestDigestCodec.getStatus();
  const commandResultProtectionStatus = commandResultCodec.getStatus();
  if (
    commandRequestDigestStatus.ready !== true
    || commandResultProtectionStatus.ready !== true
    || commandResultProtectionStatus.enabled !== true
  ) {
    const error = new Error("MySQL command persistence protection is unavailable");
    error.code = "MYSQL_COMMAND_PROTECTION_REQUIRED";
    throw error;
  }
  const mysqlMigrationMode = resolveMysqlMigrationMode(policyEnv);
  const mergedConfig = validateMysqlConfig({
    ...mysqlConfigFromEnv(),
    ...config,
  });
  const database = mergedConfig.database;
  const mysqlPoolOptions = Object.freeze({
    host: mergedConfig.host,
    port: Number(mergedConfig.port || 3306),
    user: mergedConfig.user,
    password: mergedConfig.password,
    database,
    charset: "utf8mb4",
    timezone: "+08:00",
    dateStrings: true,
    multipleStatements: false,
    waitForConnections: true,
    connectionLimit: Math.max(1, Number(mergedConfig.connectionLimit || 8)),
    queueLimit: 0,
    connectTimeout: Math.max(1000, Number(mergedConfig.connectTimeout || 10000)),
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  });
  const pool = mysql.createPool({ ...mysqlPoolOptions });
  let notificationDeliveryCore;
  let privilegePolicy;
  let migrationState;
  try {
    notificationDeliveryCore = createMysqlNotificationDeliveryCore(pool, { env: policyEnv });
    privilegePolicy = await readMysqlPrivilegePolicy(pool, { database, env: policyEnv });
    assertMysqlPrivilegePolicy(privilegePolicy);
    migrationState = mysqlMigrationMode === "verify_only"
      ? await verifyMysqlMigrations(pool, { ...options, database })
      : await applyMysqlMigrations(pool, { ...options, database });
  } catch (error) {
    await pool.end().catch(() => {});
    throw error;
  }
  let v1RuntimeControlPlane = null;
  let v1RuntimePool = null;
  let v1RuntimeHeartbeatPool = null;
  let v1RuntimeRegistrarPool = null;
  let v1RuntimeWorkerPool = null;
  let v1RuntimeInspectorPool = null;
  let runtimePrincipalReadiness = null;
  let runtimePrincipalReadinessStatus = runtimePrincipalReadinessModule
    .disabledMysqlRuntimePrincipalReadinessStatus();
  try {
    const runtimeControlEnabled = strictOptionalBooleanFlag(
      policyEnv,
      "MYROOT_V1_RUNTIME_CONTROL_PLANE_ENABLED"
    );
    const runtimeReadinessRequired = strictOptionalBooleanFlag(
      policyEnv,
      "ROOT_V1_RUNTIME_READY_REQUIRED"
    );
    if (
      runtimeControlEnabled
      || runtimeReadinessRequired
      || Object.prototype.hasOwnProperty.call(dependencies, "createV1RuntimeControlPlane")
    ) {
      // Runtime governance holds a named-lock connection while phase work and
      // heartbeat renewal need independent capacity. A dedicated pool keeps
      // ordinary Store traffic from consuming that capacity at this Seam.
      const runtimeConnectionLimit = v1RuntimeConnectionLimit(policyEnv);
      const runtimePoolOptions = Object.freeze({
        ...mysqlPoolOptions,
        connectionLimit: runtimeConnectionLimit,
      });
      v1RuntimePool = mysql.createPool({ ...runtimePoolOptions });
      const deliveryMode = runtimeAlertDeliveryMode(policyEnv);
      const controlEnv = {
        ...policyEnv,
        MYSQL_DATABASE: database,
        MYSQL_HOST: String(mergedConfig.host),
        MYSQL_PORT: String(mergedConfig.port || 3306),
        MYSQL_USERNAME: String(mergedConfig.user),
        MYSQL_CONNECTION_LIMIT: String(runtimeConnectionLimit),
        MYROOT_V1_MAIN_CONNECTION_LIMIT: String(mysqlPoolOptions.connectionLimit),
        MYROOT_V1_RUNTIME_CONNECTION_LIMIT: String(runtimeConnectionLimit),
        MYROOT_V1_RUNTIME_HEARTBEAT_CONNECTION_LIMIT: "1",
      };
      let controlOptions;
      if (deliveryMode === "DISABLED") {
        // renewCycle alone uses this one-connection Adapter, so readiness or
        // preview traffic cannot consume the lease heartbeat reservation.
        v1RuntimeHeartbeatPool = mysql.createPool({
          ...runtimePoolOptions,
          connectionLimit: 1,
        });
        controlOptions = {
          pool: v1RuntimePool,
          heartbeatPool: v1RuntimeHeartbeatPool,
          env: Object.freeze(controlEnv),
        };
      } else {
        const registrar = v1RuntimeAlertRoleMysqlConfig(policyEnv, "REGISTRAR");
        const inspector = v1RuntimeAlertRoleMysqlConfig(policyEnv, "INSPECTOR");
        const worker = deliveryMode === "CONTROLLED"
          ? v1RuntimeAlertRoleMysqlConfig(policyEnv, "WORKER") : null;
        for (const role of ["REGISTRAR", "WORKER", "INSPECTOR"]) {
          for (const suffix of ["USERNAME", "PASSWORD", "CURRENT_USER", "CONNECTION_LIMIT"]) {
            delete controlEnv[`MYROOT_V1_RUNTIME_ALERT_${role}_MYSQL_${suffix}`];
          }
        }
        const rolePoolOptions = (role) => ({
          ...mysqlPoolOptions,
          user: role.user,
          password: role.password,
          connectionLimit: role.connectionLimit,
        });
        v1RuntimeRegistrarPool = mysql.createPool(rolePoolOptions(registrar));
        v1RuntimeHeartbeatPool = mysql.createPool({
          ...rolePoolOptions(registrar),
          connectionLimit: 1,
        });
        v1RuntimeInspectorPool = mysql.createPool(rolePoolOptions(inspector));
        if (worker) v1RuntimeWorkerPool = mysql.createPool(rolePoolOptions(worker));
        runtimePrincipalReadiness = createMysqlRuntimePrincipalReadiness({
          database,
          registrationMode: deliveryMode,
          registrarPool: v1RuntimeRegistrarPool,
          registrarCurrentUser: registrar.expectedCurrentUser,
          ...(worker ? {
            workerPool: v1RuntimeWorkerPool,
            workerCurrentUser: worker.expectedCurrentUser,
          } : {}),
          inspectorPool: v1RuntimeInspectorPool,
          inspectorCurrentUser: inspector.expectedCurrentUser,
        });
        if (!runtimePrincipalReadiness
          || typeof runtimePrincipalReadiness.inspect !== "function"
          || typeof runtimePrincipalReadiness.getStatus !== "function") {
          throw new Error("MySQL runtime principal readiness Interface is unavailable");
        }
        runtimePrincipalReadinessStatus = assertMysqlRuntimePrincipalReadinessStatus(
          runtimePrincipalReadiness.getStatus(),
          true
        );
        controlEnv.MYROOT_V1_RUNTIME_ALERT_REGISTRAR_CONNECTION_LIMIT =
          String(registrar.connectionLimit);
        controlEnv.MYROOT_V1_RUNTIME_ALERT_WORKER_CONNECTION_LIMIT =
          String(worker ? worker.connectionLimit : 0);
        controlEnv.MYROOT_V1_RUNTIME_ALERT_INSPECTOR_CONNECTION_LIMIT =
          String(inspector.connectionLimit);
        controlOptions = {
          orchestrationPool: v1RuntimePool,
          registrarPool: v1RuntimeRegistrarPool,
          registrarHeartbeatPool: v1RuntimeHeartbeatPool,
          ...(worker ? { runtimeAlertWorkerPool: v1RuntimeWorkerPool } : {}),
          runtimeAlertInspectorPool: v1RuntimeInspectorPool,
          runtimeAlertRegistrarCurrentUser: registrar.expectedCurrentUser,
          ...(worker ? { runtimeAlertWorkerCurrentUser: worker.expectedCurrentUser } : {}),
          runtimeAlertInspectorCurrentUser: inspector.expectedCurrentUser,
          env: Object.freeze(controlEnv),
        };
      }
      const implementation = createV1RuntimeControlPlane(controlOptions);
      const interfaceKeys = ["inspect", "previewScheduledCycle", "runScheduledCycle"];
      if (!implementation || interfaceKeys.some((key) => typeof implementation[key] !== "function")) {
        const error = new Error("v1 Runtime Control Plane Interface is unavailable");
        error.code = "V1_RUNTIME_CONTROL_PLANE_CONFIGURATION_INVALID";
        throw error;
      }
      // The Store exposes a deliberately narrow Interface. The raw pool and the
      // control plane implementation remain private to this Module.
      v1RuntimeControlPlane = Object.freeze({
        inspect: (...args) => implementation.inspect(...args),
        previewScheduledCycle: (...args) => implementation.previewScheduledCycle(...args),
        runScheduledCycle: (...args) => implementation.runScheduledCycle(...args),
      });
    }
  } catch (error) {
    await Promise.all([
      v1RuntimeHeartbeatPool ? v1RuntimeHeartbeatPool.end().catch(() => {}) : Promise.resolve(),
      v1RuntimeRegistrarPool ? v1RuntimeRegistrarPool.end().catch(() => {}) : Promise.resolve(),
      v1RuntimeWorkerPool ? v1RuntimeWorkerPool.end().catch(() => {}) : Promise.resolve(),
      v1RuntimeInspectorPool ? v1RuntimeInspectorPool.end().catch(() => {}) : Promise.resolve(),
      v1RuntimePool ? v1RuntimePool.end().catch(() => {}) : Promise.resolve(),
      pool.end().catch(() => {}),
    ]);
    throw error;
  }
  try {
  const initialData = normalizeStoreData(defaultsForOptions(options), options);
  const initialConnection = await pool.getConnection();
  try {
    await initialConnection.execute(
      `
        INSERT IGNORE INTO root_store_snapshot
          (store_key, schema_version, revision, payload_json, updated_at)
        VALUES (?, ?, 0, ?, CURRENT_TIMESTAMP(3))
      `,
      [MYSQL_STORE_KEY, MYSQL_SCHEMA_VERSION, JSON.stringify(initialData)]
    );
  } finally {
    initialConnection.release();
  }

  const [rows] = await pool.execute(
    "SELECT payload_json, updated_at, revision FROM root_store_snapshot WHERE store_key = ?",
    [MYSQL_STORE_KEY]
  );
  const data = normalizeStoreData(rows[0] ? parseMysqlPayload(rows[0].payload_json) : initialData, options);
  let operationQueue = Promise.resolve();
  let lastSavedAt = rows[0] ? String(rows[0].updated_at || "") : "";
  let lastReadAt = new Date().toISOString();
  let lastError = "";
  let revision = Number(rows[0] && rows[0].revision || 0);
  let closing = false;
  let lastProjection = { tables: [], rows: {} };

  function enqueue(operation) {
    if (closing) return Promise.reject(new Error("MySQL Store is closing"));
    const next = operationQueue.then(operation, operation);
    operationQueue = next.catch(() => {});
    return next;
  }

  async function selectSnapshot(connection, lock = false) {
    const [snapshotRows] = await connection.execute(
      `SELECT payload_json, updated_at, revision FROM root_store_snapshot WHERE store_key = ?${lock ? " FOR UPDATE" : ""}`,
      [MYSQL_STORE_KEY]
    );
    if (!snapshotRows[0]) throw new Error("MySQL root_store_snapshot row is missing");
    return snapshotRows[0];
  }

  async function writeSnapshot(connection, snapshot, nextRevision) {
    await connection.execute(
      `
        UPDATE root_store_snapshot
        SET schema_version = ?, revision = ?, payload_json = ?, updated_at = CURRENT_TIMESTAMP(3)
        WHERE store_key = ?
      `,
      [MYSQL_SCHEMA_VERSION, nextRevision, JSON.stringify(snapshot), MYSQL_STORE_KEY]
    );
  }

  async function persistSnapshot(snapshot, persistOptions = {}) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const row = await selectSnapshot(connection, true);
      const currentRevision = Number(row.revision || 0);
      if (persistOptions.expectedRevision !== undefined && currentRevision !== Number(persistOptions.expectedRevision)) {
        const error = new Error(`MySQL Store revision conflict: expected ${persistOptions.expectedRevision}, found ${currentRevision}`);
        error.code = "STORE_REVISION_CONFLICT";
        throw error;
      }
      const before = normalizeStoreData(parseMysqlPayload(row.payload_json), options);
      const sourceInvalidationRead = createSettlementSourceInvalidationReadAdapter(connection);
      const normalizedRequest = normalizeStoreData(clone(snapshot), options);
      const normalized = normalizeStoreData(
        sourceInvalidationRead.prepareSnapshotForPersistence(normalizedRequest),
        options
      );
      const authorityScopes = settlementAuthorityScopes(before, normalized);
      if (authorityScopes.length > 0) {
        const currentAuthority = await sourceInvalidationRead
          .assertCurrentScopesAvailable(before, authorityScopes);
        assertSettlementAuthorityAvailable(currentAuthority.candidates);
      }
      const changedKeys = changedCollectionKeys(before, normalized);
      const nextRevision = changedKeys.size ? currentRevision + 1 : currentRevision;
      if (changedKeys.size) await writeSnapshot(connection, normalized, nextRevision);
      lastProjection = await syncCoreProjections(connection, normalized, {
        force: persistOptions.forceProjection === true,
        changedKeys: persistOptions.forceProjection === true ? null : changedKeys,
      });
      await connection.commit();
      replaceStoreData(data, normalized, options);
      revision = nextRevision;
      lastReadAt = new Date().toISOString();
      if (changedKeys.size) lastSavedAt = lastReadAt;
      lastError = "";
      return { revision, projection: lastProjection };
    } catch (error) {
      await connection.rollback().catch(() => {});
      lastError = error.message;
      throw error;
    } finally {
      connection.release();
    }
  }

  async function projectLatestSnapshot() {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const row = await selectSnapshot(connection, true);
      const raw = parseMysqlPayload(row.payload_json);
      const latest = normalizeStoreData(clone(raw), options);
      const normalizedKeys = changedCollectionKeys(raw, latest);
      const currentRevision = Number(row.revision || 0);
      const nextRevision = normalizedKeys.size ? currentRevision + 1 : currentRevision;
      if (normalizedKeys.size) await writeSnapshot(connection, latest, nextRevision);
      lastProjection = await syncCoreProjections(connection, latest, { force: true });
      await connection.commit();
      replaceStoreData(data, latest, options);
      revision = nextRevision;
      lastReadAt = new Date().toISOString();
      lastSavedAt = normalizedKeys.size ? lastReadAt : String(row.updated_at || lastSavedAt || "");
      lastError = "";
      return { revision, projection: lastProjection };
    } catch (error) {
      await connection.rollback().catch(() => {});
      lastError = error.message;
      throw error;
    } finally {
      connection.release();
    }
  }

  const adapter = {
    kind: "mysql",
    data,
    config: {
      host: mergedConfig.host,
      port: Number(mergedConfig.port || 3306),
      database,
      user: mergedConfig.user,
      connectionLimit: Math.max(1, Number(mergedConfig.connectionLimit || 8)),
    },
    save() {
      const snapshot = clone(data);
      const expectedRevision = revision;
      return enqueue(() => persistSnapshot(snapshot, { expectedRevision }));
    },
    importSnapshot(snapshot) {
      const normalized = normalizeStoreData(snapshot, options);
      return enqueue(() => persistSnapshot(normalized, { forceProjection: true }));
    },
    exportSnapshot() {
      return clone(data);
    },
    validateSnapshot(snapshot = data) {
      return validateSnapshot(snapshot, options);
    },
    getStoreHealth() {
      return {
        kind: "mysql",
        schemaVersion: MYSQL_SCHEMA_VERSION,
        migrationVersion: migrationState.latestVersion,
        migrationCount: migrationState.versions.length,
        migrationMode: mysqlMigrationMode,
        revision,
        lastSavedAt,
        lastReadAt,
        lastError,
        persistent: true,
        connected: !lastError,
        transactional: true,
        multiInstanceSafe: true,
        projectionMode: "core-relational",
        projectionTables: lastProjection.tables,
        leastPrivilegeReady: privilegePolicy.ready === true,
        privilegeScope: privilegePolicy.scope,
        privilegePolicyEnforced: privilegePolicy.enforced === true,
        runtimeAlertDeliveryEnabled: runtimePrincipalReadinessStatus.enabled,
        runtimePrincipalReady: runtimePrincipalReadinessStatus.ready,
        runtimePrincipalRequiredRoleCount: runtimePrincipalReadinessStatus.requiredRoleCount,
        runtimePrincipalVerifiedRoleCount: runtimePrincipalReadinessStatus.verifiedRoleCount,
        runtimePrincipalRequiredRoutineCount: runtimePrincipalReadinessStatus.requiredRoutineCount,
        runtimePrincipalVerifiedRoutineCount: runtimePrincipalReadinessStatus.verifiedRoutineCount,
        runtimePrincipalIssueCount: runtimePrincipalReadinessStatus.issueCount,
        database,
        host: mergedConfig.host,
        port: Number(mergedConfig.port || 3306),
        connectionLimit: Math.max(1, Number(mergedConfig.connectionLimit || 8)),
      };
    },
    runRequest(requestOptions = {}, work) {
      return enqueue(async () => {
        const connection = await pool.getConnection();
        let before = null;
        let beforePersisted = null;
        let phase = "store";
        let transactionActive = false;
        let awaitingResume = false;
        let transactionEventTransport = null;
        let transactionEventTransportFacade = null;
        let transactionCommandIdempotency = null;
        let settlementSourceInvalidationRead = null;
        let settlementSourceInvalidationResolve = null;
        let transactionGeneration = 0;

        const createEventTransportFacade = (implementation) => {
          const generation = ++transactionGeneration;
          return Object.freeze({
            stageOutbox(envelope) {
              if (requestOptions.write === false) {
                const error = new Error("MySQL Store Event Transport requires a writable request");
                error.code = "STORE_EVENT_TRANSPORT_READ_ONLY";
                throw error;
              }
              if (
                !transactionActive ||
                awaitingResume ||
                !transactionEventTransport ||
                transactionEventTransport !== implementation ||
                transactionGeneration !== generation
              ) {
                const error = new Error("MySQL Store Event Transport requires an active transaction generation");
                error.code = "STORE_EVENT_TRANSPORT_NOT_ACTIVE";
                throw error;
              }
              return implementation.stageOutbox(envelope);
            },
          });
        };

        const beginRequestTransaction = async () => {
          await connection.beginTransaction();
          transactionActive = true;
          transactionEventTransport = createMysqlEventTransportAdapter(connection);
          transactionEventTransportFacade = createEventTransportFacade(transactionEventTransport);
          transactionCommandIdempotency = createMysqlCommandIdempotencyAdapter(connection, {
            requestDigestCodec: commandRequestDigestCodec,
            resultCodec: commandResultCodec,
          });
          const row = await selectSnapshot(connection, requestOptions.write !== false);
          beforePersisted = normalizeStoreData(parseMysqlPayload(row.payload_json), options);
          settlementSourceInvalidationRead = createSettlementSourceInvalidationReadAdapter(
            connection
          );
          settlementSourceInvalidationResolve = createSettlementSourceInvalidationResolveAdapter(
            connection,
            settlementSourceInvalidationRead
          );
          before = normalizeStoreData(clone(beforePersisted), options);
          replaceStoreData(data, before, options);
          revision = Number(row.revision || 0);
          lastReadAt = new Date().toISOString();
          return row;
        };

        const commandClaimCheckpointDirty = () => {
          const error = new Error("MySQL Store command claim checkpoint contains business changes");
          error.code = "STORE_COMMAND_CLAIM_CHECKPOINT_DIRTY";
          return error;
        };

        const commitCurrentTransaction = async (commitOptions = {}) => {
          const after = adapter.exportSnapshot();
          if (!settlementSourceInvalidationRead) {
            const error = new Error("Settlement source invalidation read Adapter is unavailable");
            error.code = "SETTLEMENT_SOURCE_INVALIDATION_READ_NOT_HYDRATED";
            throw error;
          }
          const afterPersisted = normalizeStoreData(
            settlementSourceInvalidationRead.prepareSnapshotForPersistence(after),
            options
          );
          const authorityScopes = settlementAuthorityScopes(
            beforePersisted,
            afterPersisted
          );
          if (authorityScopes.length > 0) {
            const currentAuthority = await settlementSourceInvalidationRead
              .assertCurrentScopesAvailable(beforePersisted, authorityScopes);
            assertSettlementAuthorityAvailable(currentAuthority.candidates);
          }
          const changedKeys = changedCollectionKeys(beforePersisted, afterPersisted);
          if (commitOptions.commandClaimOnly === true) {
            if (changedKeys.size) throw commandClaimCheckpointDirty();
            try {
              transactionEventTransport.assertNoStagedFacts();
            } catch (error) {
              if (error && error.code === "OUTBOX_STAGED_FACTS_PRESENT") {
                throw commandClaimCheckpointDirty();
              }
              throw error;
            }
          }
          const nextRevision = changedKeys.size ? revision + 1 : revision;
          if (changedKeys.size) {
            await writeSnapshot(connection, afterPersisted, nextRevision);
            lastProjection = await syncCoreProjections(connection, afterPersisted, {
              changedKeys,
            });
          }
          if (transactionEventTransport) await transactionEventTransport.flushBeforeCommit();
          await connection.commit();
          transactionActive = false;
          if (transactionEventTransport) transactionEventTransport.afterCommit();
          transactionEventTransport = null;
          if (transactionCommandIdempotency) transactionCommandIdempotency.discard();
          transactionCommandIdempotency = null;
          settlementSourceInvalidationResolve = null;
          revision = nextRevision;
          replaceStoreData(data, afterPersisted, options);
          before = normalizeStoreData(clone(afterPersisted), options);
          beforePersisted = normalizeStoreData(clone(afterPersisted), options);
          if (changedKeys.size) lastSavedAt = new Date().toISOString();
          lastError = "";
          return { revision, projection: lastProjection };
        };

        try {
          await beginRequestTransaction();
          phase = "work";
          const checkpointCurrentTransaction = async (checkpointOptions = {}) => {
            if (requestOptions.write === false) {
              const error = new Error("MySQL Store checkpoint requires a writable request");
              error.code = "STORE_CHECKPOINT_READ_ONLY";
              throw error;
            }
            if (!transactionActive || awaitingResume) {
              const error = new Error("MySQL Store checkpoint requires an active transaction");
              error.code = "STORE_CHECKPOINT_NOT_ACTIVE";
              throw error;
            }
            phase = "store";
            const committed = await commitCurrentTransaction(checkpointOptions);
            awaitingResume = true;
            phase = "work";
            return committed;
          };
          const resumeCurrentTransaction = async () => {
            if (transactionActive || !awaitingResume) {
              const error = new Error("MySQL Store resume requires a completed checkpoint");
              error.code = "STORE_RESUME_NOT_READY";
              throw error;
            }
            phase = "store";
            try {
              await beginRequestTransaction();
            } catch (error) {
              if (transactionActive) {
                await connection.rollback().catch(() => {});
                transactionActive = false;
              }
              lastError = error.message;
              throw error;
            }
            awaitingResume = false;
            phase = "work";
            return { revision, eventTransport: transactionEventTransportFacade };
          };
          const commandRecovery = createMysqlCommandRecovery({
            data,
            writable: requestOptions.write !== false,
            getAdapter() {
              if (!transactionActive || awaitingResume || !transactionCommandIdempotency) {
                const error = new Error("MySQL Store Command Recovery requires an active transaction generation");
                error.code = "STORE_COMMAND_RECOVERY_NOT_ACTIVE";
                throw error;
              }
              return transactionCommandIdempotency;
            },
            checkpoint: () => checkpointCurrentTransaction({ commandClaimOnly: true }),
            resume: resumeCurrentTransaction,
          });
          const checkpoint = async () => {
            if (commandRecovery.isActive()) {
              const error = new Error("MySQL Store checkpoint is forbidden during command recovery");
              error.code = "STORE_COMMAND_CHECKPOINT_FORBIDDEN";
              throw error;
            }
            return checkpointCurrentTransaction();
          };
          const resume = async () => {
            if (commandRecovery.isActive()) {
              const error = new Error("MySQL Store resume is forbidden during command recovery");
              error.code = "STORE_COMMAND_RESUME_FORBIDDEN";
              throw error;
            }
            return resumeCurrentTransaction();
          };
          const transactionControl = {
            checkpoint,
            resume,
            commandRecovery,
            activityTaskReadAdapter: createMysqlActivityTaskReadAdapter(connection),
            settlementSourceInvalidationRead: Object.freeze({
              async loadScopes(scopes) {
                if (!transactionActive || awaitingResume
                  || !settlementSourceInvalidationRead) {
                  const error = new Error(
                    "Settlement source invalidation read requires an active transaction"
                  );
                  error.code = "SETTLEMENT_SOURCE_INVALIDATION_READ_NOT_ACTIVE";
                  throw error;
                }
                const hydrated = await settlementSourceInvalidationRead
                  .hydrateRequestState(data, scopes);
                replaceStoreData(data, hydrated.data, options);
                before = normalizeStoreData(clone(hydrated.data), options);
                return Object.freeze({
                  candidateCount: hydrated.candidateCount,
                  loadedScopeCount: hydrated.loadedScopeCount,
                });
              },
            }),
            settlementSourceInvalidationResolve: Object.freeze({
              async resolve(input) {
                if (!transactionActive || awaitingResume
                  || !settlementSourceInvalidationResolve) {
                  const error = new Error(
                    "Settlement source invalidation resolution requires an active transaction"
                  );
                  error.code = "SETTLEMENT_SOURCE_RESOLUTION_NOT_ACTIVE";
                  throw error;
                }
                return settlementSourceInvalidationResolve.resolve(beforePersisted, input);
              },
            }),
            get eventTransport() {
              return transactionEventTransportFacade;
            },
          };
          const result = await work(data, transactionControl);
          if (awaitingResume) {
            const error = new Error("MySQL Store work completed before resuming its checkpoint");
            error.code = "STORE_CHECKPOINT_NOT_RESUMED";
            throw error;
          }
          const shouldCommit = typeof requestOptions.shouldCommit === "function"
            ? requestOptions.shouldCommit()
            : requestOptions.write !== false;
          if (!shouldCommit) {
            if (transactionActive) await connection.rollback();
            transactionActive = false;
            if (transactionEventTransport) transactionEventTransport.discard();
            transactionEventTransport = null;
            if (transactionCommandIdempotency) transactionCommandIdempotency.discard();
            transactionCommandIdempotency = null;
            settlementSourceInvalidationResolve = null;
            replaceStoreData(data, beforePersisted, options);
            lastError = "";
            return result;
          }
          if (!transactionActive) return result;
          phase = "store";
          await commitCurrentTransaction();
          return result;
        } catch (error) {
          const rollbackError = transactionActive
            ? await connection.rollback().then(() => null, (failure) => failure)
            : null;
          transactionActive = false;
          if (transactionEventTransport) transactionEventTransport.discard();
          transactionEventTransport = null;
          if (transactionCommandIdempotency) transactionCommandIdempotency.discard();
          transactionCommandIdempotency = null;
          settlementSourceInvalidationResolve = null;
          if (beforePersisted) replaceStoreData(data, beforePersisted, options);
          if (phase === "store" || rollbackError) lastError = (rollbackError || error).message;
          throw error;
        } finally {
          if (transactionEventTransport) transactionEventTransport.discard();
          if (transactionCommandIdempotency) transactionCommandIdempotency.discard();
          connection.release();
        }
      });
    },
    async checkHealth() {
      const connection = await pool.getConnection();
      try {
        await connection.query("SELECT 1 AS ok");
        privilegePolicy = await readMysqlPrivilegePolicyFromConnection(connection, { database, env: policyEnv });
        assertMysqlPrivilegePolicy(privilegePolicy);
        const [migrationRows] = await connection.query(
          "SELECT COUNT(*) AS migration_count, MAX(version) AS latest_version FROM schema_migrations"
        );
        const row = await selectSnapshot(connection, false);
        runtimePrincipalReadinessStatus = runtimePrincipalReadiness
          ? assertMysqlRuntimePrincipalReadinessStatus(
            await runtimePrincipalReadiness.inspect(),
            true
          )
          : runtimePrincipalReadinessModule.disabledMysqlRuntimePrincipalReadinessStatus();
        revision = Number(row.revision || 0);
        lastReadAt = new Date().toISOString();
        lastError = "";
        return {
          ok: true,
          revision,
          migrationVersion: migrationRows[0] && migrationRows[0].latest_version || "",
          migrationCount: Number(migrationRows[0] && migrationRows[0].migration_count || 0),
          leastPrivilegeReady: privilegePolicy.ready === true,
          privilegeScope: privilegePolicy.scope,
          privilegePolicyEnforced: privilegePolicy.enforced === true,
          runtimeAlertDeliveryEnabled: runtimePrincipalReadinessStatus.enabled,
          runtimePrincipalReady: runtimePrincipalReadinessStatus.ready,
          runtimePrincipalRequiredRoleCount: runtimePrincipalReadinessStatus.requiredRoleCount,
          runtimePrincipalVerifiedRoleCount: runtimePrincipalReadinessStatus.verifiedRoleCount,
          runtimePrincipalRequiredRoutineCount: runtimePrincipalReadinessStatus.requiredRoutineCount,
          runtimePrincipalVerifiedRoutineCount: runtimePrincipalReadinessStatus.verifiedRoutineCount,
          runtimePrincipalIssueCount: runtimePrincipalReadinessStatus.issueCount,
        };
      } catch (error) {
        lastError = error.message;
        return { ok: false, error: error.message };
      } finally {
        connection.release();
      }
    },
    async close() {
      await operationQueue;
      closing = true;
      const results = await Promise.allSettled([
        v1RuntimeHeartbeatPool ? v1RuntimeHeartbeatPool.end() : Promise.resolve(),
        v1RuntimeRegistrarPool ? v1RuntimeRegistrarPool.end() : Promise.resolve(),
        v1RuntimeWorkerPool ? v1RuntimeWorkerPool.end() : Promise.resolve(),
        v1RuntimeInspectorPool ? v1RuntimeInspectorPool.end() : Promise.resolve(),
        v1RuntimePool ? v1RuntimePool.end() : Promise.resolve(),
        pool.end(),
      ]);
      const failed = results.find((result) => result.status === "rejected");
      if (failed) throw failed.reason;
    },
  };
  Object.defineProperty(adapter, "v1RuntimeControlPlane", {
    value: v1RuntimeControlPlane,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  Object.defineProperty(adapter, "notificationDeliveryCore", {
    value: notificationDeliveryCore,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  await enqueue(projectLatestSnapshot);
  return adapter;
  } catch (error) {
    await Promise.all([
      v1RuntimeHeartbeatPool ? v1RuntimeHeartbeatPool.end().catch(() => {}) : Promise.resolve(),
      v1RuntimeRegistrarPool ? v1RuntimeRegistrarPool.end().catch(() => {}) : Promise.resolve(),
      v1RuntimeWorkerPool ? v1RuntimeWorkerPool.end().catch(() => {}) : Promise.resolve(),
      v1RuntimeInspectorPool ? v1RuntimeInspectorPool.end().catch(() => {}) : Promise.resolve(),
      v1RuntimePool ? v1RuntimePool.end().catch(() => {}) : Promise.resolve(),
      pool.end().catch(() => {}),
    ]);
    throw error;
  }
}

module.exports = {
  createJsonFileStore,
  createEmptyData,
  createMemoryStore,
  createMysqlStore,
  createSqliteStore,
  mysqlConfigFromEnv,
  normalizeStoreData,
  parseMysqlPayload,
  resolveMysqlMigrationMode,
  validateMysqlConfig,
  validateSnapshot,
};
