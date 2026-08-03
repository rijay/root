const { nowISO } = require("./dates");
const { TASK_EVENT_IDEMPOTENCY_OPERATION } = require("./taskEventIdempotency");
const { WECHAT_UNIONID_TRUST_STATUS } = require("./wechatIdentityAuthority");

const SNAPSHOT_PROJECTION_AUTHORITY_TABLES = new Set([
  "command_idempotency",
  "outbox_event",
  "inbox_receipt",
  "event_dead_letter",
  "consumer_checkpoint",
]);
const HANDLER_OWNED_MANUAL_REVIEW_SOURCE_TYPES = Object.freeze([
  "TASK_SOURCE_INVALIDATION",
]);

function handlerOwnedManualReviewSourceType(value) {
  if (typeof value !== "string") return false;
  const key = value.trimEnd().normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  return HANDLER_OWNED_MANUAL_REVIEW_SOURCE_TYPES.some((sourceType) => (
    sourceType.toLowerCase() === key
  ));
}

function assertSnapshotProjectionRegistrySafe(projections) {
  const forbidden = Array.isArray(projections)
    ? projections
      .map((projection) => String((projection && projection.table) || "").trim().toLowerCase())
      .filter((table) => SNAPSHOT_PROJECTION_AUTHORITY_TABLES.has(table))
    : Array.from(SNAPSHOT_PROJECTION_AUTHORITY_TABLES);
  if (forbidden.length) {
    const error = new Error(
      `Snapshot projections cannot own command/event authority tables: ${Array.from(new Set(forbidden)).join(", ")}`
    );
    error.code = "MYSQL_SNAPSHOT_PROJECTION_AUTHORITY_TABLE_FORBIDDEN";
    throw error;
  }
  const invalidPreservation = Array.isArray(projections)
    && projections.some((projection) => (
      projection
      && projection.preservedSourceTypes !== undefined
      && (projection.table !== "manual_review_item"
        || !Array.isArray(projection.preservedSourceTypes)
        || projection.preservedSourceTypes.length === 0
        || projection.preservedSourceTypes.some((sourceType) => (
          !HANDLER_OWNED_MANUAL_REVIEW_SOURCE_TYPES.includes(sourceType)
        )))
    ));
  if (invalidPreservation) {
    const error = new Error("Snapshot projection preservation is invalid");
    error.code = "MYSQL_SNAPSHOT_PROJECTION_PRESERVATION_INVALID";
    throw error;
  }
  return true;
}

const JSON_COLUMNS = new Set([
  "answers_json",
  "conditions_json",
  "config_json",
  "data_json",
  "data_schema_json",
  "evidence",
  "external_result_json",
  "external_status_json",
  "metadata",
  "metadata_json",
  "payload_json",
  "purposes_json",
  "raw_result_json",
  "request_json",
  "response_json",
  "result_json",
  "rewards_json",
  "setting_json",
  "snapshot_json",
  "data_categories_json",
]);

const BOOLEAN_COLUMNS = new Set([
  "allow_reapply",
  "inventory_released",
  "occurred_at_client_supplied",
  "required",
  "subscribed",
  "verified",
]);
const DATE_COLUMNS = new Set([
  "authorization_verified_at",
  "computed_at",
  "consumed_at",
  "created_at",
  "delivered_at",
  "end_at",
  "evaluated_at",
  "expired_at",
  "external_status_checked_at",
  "granted_at",
  "invalidated_at",
  "joined_at",
  "last_seen_at",
  "next_retry_at",
  "occurred_at",
  "published_at",
  "recovered_at",
  "registration_close_at",
  "registration_open_at",
  "released_at",
  "review_deadline",
  "review_required_at",
  "reserved_at",
  "resolved_at",
  "scheduled_at",
  "sent_at",
  "session_end_at",
  "session_start_at",
  "skipped_at",
  "start_at",
  "status_checked_at",
  "submitted_at",
  "updated_at",
  "used_at",
  "unionid_verified_at",
]);

function rootUserRows(data) {
  const rootUsers = Array.isArray(data.rootUsers) ? data.rootUsers : [];
  const legacyUsers = Array.isArray(data.users) ? data.users : [];
  const identities = Array.isArray(data.wechatIdentities) ? data.wechatIdentities : [];
  const byId = new Map();
  rootUsers.forEach((item) => byId.set(item.root_user_id, {
    ...item,
    unionid: "",
    unionid_status: "PENDING",
  }));
  legacyUsers.forEach((user) => {
    const rootUserId = user.root_user_id || user.user_id;
    if (!rootUserId) return;
    const current = byId.get(rootUserId) || {
      root_user_id: rootUserId,
      lifecycle_status: user.state || "UNREGISTERED",
      source_channel: user.source_channel || "",
      unionid_status: "PENDING",
      created_at: user.created_at || nowISO(),
      updated_at: user.updated_at || user.created_at || nowISO(),
    };
    current.lifecycle_status = current.lifecycle_status || user.state || "UNREGISTERED";
    current.unionid = "";
    current.unionid_status = "PENDING";
    byId.set(rootUserId, current);
  });
  identities.forEach((identity) => {
    const current = byId.get(identity.root_user_id);
    if (current
      && !current.unionid
      && identity.unionid
      && identity.unionid_trust_status === WECHAT_UNIONID_TRUST_STATUS.VERIFIED) {
      current.unionid = identity.unionid;
      current.unionid_status = "LINKED";
    }
  });
  return Array.from(byId.values());
}

function taskEventRows(data) {
  return (Array.isArray(data.taskEvents) ? data.taskEvents : []).map((row) => ({
    ...row,
    idempotency_operation: row.idempotency_operation || TASK_EVENT_IDEMPOTENCY_OPERATION,
    occurred_at_client_supplied: row.occurred_at_client_supplied === true
      ? true
      : row.occurred_at_client_supplied === false
        ? false
        : null,
  }));
}

const PROJECTIONS = [
  {
    table: "root_user",
    source: "rootUsers",
    dependencies: ["rootUsers", "users", "wechatIdentities"],
    id: "root_user_id",
    rows: rootUserRows,
    columns: ["root_user_id", "unionid", "lifecycle_status", "source_channel", "unionid_status", "created_at", "updated_at"],
  },
  {
    table: "wechat_identity",
    source: "wechatIdentities",
    id: "wechat_identity_id",
    columns: ["wechat_identity_id", "root_user_id", "app_code", "openid", "unionid", "unionid_status", "unionid_trust_status", "unionid_provenance_source", "unionid_verified_at", "unionid_provenance_canonical_version", "unionid_provenance_digest", "unionid_provenance_digest_scheme", "unionid_provenance_key_id", "created_at", "updated_at", "last_seen_at"],
  },
  {
    table: "user_contact_method",
    source: "userContactMethods",
    id: "contact_method_id",
    columns: ["contact_method_id", "root_user_id", "contact_type", "phone_masked", "phone_hash", "verified", "evidence", "created_at", "updated_at"],
  },
  {
    table: "privacy_consent_record",
    source: "privacyConsentRecords",
    id: "privacy_consent_record_id",
    columns: ["privacy_consent_record_id", "root_user_id", "consent_type", "policy_version", "decision", "purposes_json", "data_categories_json", "source_channel", "occurred_at", "created_at"],
  },
  {
    table: "user_lifecycle_event",
    source: "userLifecycleEvents",
    id: "lifecycle_event_id",
    columns: ["lifecycle_event_id", "root_user_id", "event_type", "source_channel", "app_code", "metadata", "occurred_at"],
  },
  {
    table: "campaign_definition",
    source: "campaignDefinitions",
    id: "campaign_id",
    columns: ["campaign_id", "title", "status", "start_at", "end_at", "config_json", "created_at", "updated_at"],
  },
  {
    table: "campaign_participant",
    source: "campaignParticipants",
    id: "campaign_participant_id",
    columns: ["campaign_participant_id", "campaign_id", "root_user_id", "joined_at", "status", "source_channel", "metadata", "created_at", "updated_at"],
  },
  {
    table: "activity_definition_version",
    source: "activityDefinitionVersions",
    id: "activity_version_id",
    columns: [
      "activity_version_id", "activity_id", "version", "status", "title", "summary",
      "objective", "audience", "agenda", "organizer", "fee_description", "bring_items",
      "cancel_policy", "privacy_notice_text", "photography_notice_text", "contact_display", "detail_version",
      "city", "venue_summary", "activity_type", "hero_asset_ref", "privacy_notice_ref",
      "photography_notice_ref", "content_approval_ref", "contact_owner_signer_ref",
      "review_reason_code", "review_reason", "reviewer_signer_ref", "publish_owner_signer_ref",
      "publication_authorization_adapter_id", "publication_authorization_decision_ref",
      "publication_authorized_principal_ref", "controlled_approval_ref", "content_authorization_digest",
      "ued_acceptance_digest", "photography_authorization_digest", "artifact_provenance_digest",
      "authorization_verified_at",
      "withdraw_owner_signer_ref", "withdraw_reason", "archive_owner_signer_ref", "archive_reason",
      "source", "visibility",
      "member_requirement", "prebound_task_definition_id", "prebound_task_definition_version",
      "published_at", "created_at", "updated_at",
    ],
  },
  {
    table: "activity_session",
    source: "activitySessions",
    id: "activity_session_id",
    columns: [
      "activity_session_id", "activity_version_id", "status", "approval_mode", "capacity",
      "registration_open_at", "registration_close_at", "cancel_close_at", "review_deadline", "session_start_at", "session_end_at",
      "allow_reapply", "cancel_reason", "cancel_reason_detail", "created_at", "updated_at",
    ],
  },
  {
    table: "activity_session_event",
    source: "activitySessionEvents",
    id: "activity_session_event_id",
    columns: [
      "activity_session_event_id", "activity_session_id", "event_sequence", "operation",
      "from_status", "to_status", "reason_code", "reason_detail", "request_id", "actor_ref", "occurred_at",
    ],
  },
  {
    table: "activity_enrollment",
    source: "activityEnrollments",
    id: "activity_enrollment_id",
    columns: [
      "activity_enrollment_id", "activity_session_id", "root_user_id", "status", "reason_code",
      "attempt_generation", "created_at", "updated_at",
    ],
  },
  {
    table: "activity_enrollment_event",
    source: "activityEnrollmentEvents",
    id: "activity_enrollment_event_id",
    columns: [
      "activity_enrollment_event_id", "activity_enrollment_id", "activity_session_id", "root_user_id",
      "attempt_generation", "event_sequence", "operation", "from_status", "to_status", "reason_code", "request_id", "occurred_at",
    ],
  },
  {
    table: "task_definition",
    source: "taskDefinitions",
    id: "task_definition_id",
    columns: ["task_definition_id", "campaign_id", "task_type", "title", "description", "required", "display_order", "status", "config_json", "created_at", "updated_at"],
  },
  {
    table: "task_event",
    source: "taskEvents",
    id: "task_event_id",
    rows: taskEventRows,
    columns: [
      "task_event_id", "root_user_id", "campaign_id", "task_definition_id", "task_type", "event_type",
      "task_date", "payload_json", "idempotency_key", "idempotency_operation",
      "request_canonical_version", "request_digest", "request_digest_scheme", "request_digest_key_id",
      "status", "source_channel", "occurred_at", "occurred_at_client_supplied", "created_at",
    ],
  },
  {
    table: "task_progress_snapshot",
    source: "taskProgressSnapshots",
    id: "task_progress_snapshot_id",
    columns: ["task_progress_snapshot_id", "root_user_id", "campaign_id", "snapshot_json", "computed_at", "created_at", "updated_at"],
  },
  {
    table: "questionnaire_answer",
    source: "questionnaireAnswers",
    id: "questionnaire_answer_id",
    columns: ["questionnaire_answer_id", "root_user_id", "campaign_id", "questionnaire_id", "version", "answers_json", "submitted_at", "idempotency_key"],
  },
  {
    table: "notification_template",
    source: "notificationTemplates",
    id: "notification_template_id",
    columns: ["notification_template_id", "template_key", "template_id", "template_version", "title", "page", "reminder_hour", "miniprogram_state", "lang", "status", "source", "data_schema_json", "created_at", "updated_at"],
  },
  {
    table: "notification_subscription",
    source: "notificationSubscriptions",
    id: "notification_subscription_id",
    columns: ["notification_subscription_id", "root_user_id", "template_key", "template_id", "template_version", "status", "result", "subscribed", "trigger", "campaign_id", "raw_result_json", "setting_json", "source_channel", "created_at", "updated_at"],
  },
  {
    table: "notification_subscription_grant",
    source: "notificationSubscriptionGrants",
    id: "notification_subscription_grant_id",
    columns: ["notification_subscription_grant_id", "notification_subscription_id", "root_user_id", "campaign_id", "template_key", "template_id", "template_version", "grant_request_id", "status", "notification_job_id", "last_notification_job_id", "idempotency_key", "source_channel", "recipient_binding_status", "recipient_wechat_identity_id", "recipient_app_code", "recipient_binding_canonical_version", "recipient_binding_digest", "recipient_binding_digest_scheme", "recipient_binding_key_id", "granted_at", "reserved_at", "consumed_at", "released_at", "invalidated_at", "review_required_at", "release_reason", "created_at", "updated_at"],
  },
  {
    table: "notification_job",
    source: "notificationJobs",
    id: "notification_job_id",
    columns: ["notification_job_id", "root_user_id", "campaign_id", "template_key", "template_id", "template_version", "notification_subscription_grant_id", "reminder_date", "scheduled_at", "page", "miniprogram_state", "lang", "data_json", "status", "attempts", "last_error", "idempotency_key", "source_channel", "sent_at", "skipped_at", "created_at", "updated_at"],
  },
  {
    table: "notification_delivery",
    source: "notificationDeliveries",
    id: "notification_delivery_id",
    columns: ["notification_delivery_id", "notification_job_id", "root_user_id", "campaign_id", "template_key", "template_id", "template_version", "notification_subscription_grant_id", "status", "error_code", "external_error_code", "error_message", "delivery_outcome", "request_json", "response_json", "delivered_at", "created_at"],
  },
  {
    table: "campaign_rule_version",
    source: "campaignRuleVersions",
    id: "campaign_rule_version_id",
    columns: ["campaign_rule_version_id", "campaign_id", "version", "status", "conditions_json", "rewards_json", "published_at", "created_at", "updated_at"],
  },
  {
    table: "settlement_record",
    source: "settlementRecords",
    id: "settlement_record_id",
    columns: ["settlement_record_id", "root_user_id", "campaign_id", "rule_version", "campaign_rule_version_id", "status", "result_json", "rewards_json", "evaluated_at", "created_at"],
  },
  {
    table: "manual_review_item",
    source: "manualReviewItems",
    id: "manual_review_item_id",
    rows(data) {
      const rows = Array.isArray(data.manualReviewItems) ? data.manualReviewItems : [];
      return rows.filter((row) => (
        row && !handlerOwnedManualReviewSourceType(row.source_type)
      ));
    },
    preservedSourceTypes: HANDLER_OWNED_MANUAL_REVIEW_SOURCE_TYPES,
    columns: ["manual_review_item_id", "root_user_id", "campaign_id", "review_type", "source_type", "source_id", "reason", "status", "priority", "metadata", "idempotency_key", "operator_id", "resolved_at", "resolution", "created_at", "updated_at"],
  },
];

assertSnapshotProjectionRegistrySafe(PROJECTIONS);
PROJECTIONS.forEach((projection) => Object.freeze(projection));
Object.freeze(PROJECTIONS);

function toMysqlDateTime(value) {
  if (!value) return null;
  const text = String(value).trim();
  const match = text.match(
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})?$/
  );
  if (!match) return null;
  const normalized = `${match[1]}T${match[2]}.${String(match[3] || "0").padEnd(3, "0")}${match[4] || "+08:00"}`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getTime() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 23)
    .replace("T", " ");
}

function projectionValue(row, column) {
  const value = row[column];
  if (JSON_COLUMNS.has(column)) return value === undefined || value === null ? null : JSON.stringify(value);
  if (BOOLEAN_COLUMNS.has(column)) {
    if (column === "occurred_at_client_supplied" && (value === undefined || value === null)) return null;
    return value ? 1 : 0;
  }
  if (DATE_COLUMNS.has(column)) {
    const fallback = column === "updated_at" ? row.created_at : null;
    return toMysqlDateTime(value || fallback);
  }
  if (value === undefined || value === "") return null;
  return value;
}

function projectionRows(projection, data) {
  const rows = projection.rows ? projection.rows(data) : (Array.isArray(data[projection.source]) ? data[projection.source] : []);
  return rows.filter((row) => row && row[projection.id]);
}

function projectionChanged(projection, changedKeys) {
  if (!changedKeys) return true;
  const dependencies = projection.dependencies || [projection.source];
  return dependencies.some((key) => changedKeys.has(key));
}

async function upsertProjection(connection, projection, rows) {
  if (!rows.length) return;
  const columns = projection.columns;
  const quotedColumns = columns.map((column) => `\`${column}\``).join(", ");
  const updateColumns = columns.filter((column) => column !== projection.id);
  const chunkSize = 100;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const valueSql = chunk.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ");
    const updates = updateColumns.map((column) => `\`${column}\` = VALUES(\`${column}\`)`).join(", ");
    const values = chunk.flatMap((row) => columns.map((column) => projectionValue(row, column)));
    await connection.execute(
      `INSERT INTO \`${projection.table}\` (${quotedColumns}) VALUES ${valueSql} ON DUPLICATE KEY UPDATE ${updates}`,
      values
    );
  }
}

async function deleteStaleProjection(connection, projection, rows) {
  const ids = rows.map((row) => row[projection.id]);
  const preservedSourceTypes = Array.isArray(projection.preservedSourceTypes)
    ? projection.preservedSourceTypes
    : [];
  const ownershipSql = preservedSourceTypes.length
    ? `(\`source_type\` IS NULL OR \`source_type\` NOT IN (${preservedSourceTypes.map(() => "?").join(", ")}))`
    : "";
  const ownershipValues = [...preservedSourceTypes];
  if (!ids.length) {
    if (ownershipSql) {
      await connection.execute(
        `DELETE FROM \`${projection.table}\` WHERE ${ownershipSql}`,
        ownershipValues
      );
    } else {
      await connection.query(`DELETE FROM \`${projection.table}\``);
    }
    return;
  }
  const placeholders = ids.map(() => "?").join(", ");
  await connection.execute(
    `DELETE FROM \`${projection.table}\` WHERE ${ownershipSql ? `${ownershipSql} AND ` : ""}\`${projection.id}\` NOT IN (${placeholders})`,
    [...ownershipValues, ...ids]
  );
}

function changedCollectionKeys(before, after) {
  const keys = new Set();
  const names = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  names.forEach((name) => {
    if (JSON.stringify(before && before[name]) !== JSON.stringify(after && after[name])) keys.add(name);
  });
  return keys;
}

async function syncCoreProjections(connection, data, options = {}) {
  assertSnapshotProjectionRegistrySafe(PROJECTIONS);
  const selected = PROJECTIONS.filter((projection) => options.force || projectionChanged(projection, options.changedKeys));
  const rowMap = new Map(selected.map((projection) => [projection.table, projectionRows(projection, data)]));
  for (const projection of selected) {
    await upsertProjection(connection, projection, rowMap.get(projection.table));
  }
  for (const projection of selected.slice().reverse()) {
    await deleteStaleProjection(connection, projection, rowMap.get(projection.table));
  }
  return {
    tables: selected.map((projection) => projection.table),
    rows: Object.fromEntries(selected.map((projection) => [projection.table, rowMap.get(projection.table).length])),
  };
}

module.exports = {
  PROJECTIONS,
  assertSnapshotProjectionRegistrySafe,
  changedCollectionKeys,
  projectionValue,
  rootUserRows,
  syncCoreProjections,
  taskEventRows,
  toMysqlDateTime,
};
