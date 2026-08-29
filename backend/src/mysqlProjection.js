const { nowISO } = require("./dates");
const { WECHAT_UNIONID_TRUST_STATUS } = require("./wechatIdentityAuthority");

const SNAPSHOT_PROJECTION_AUTHORITY_TABLES = new Set([
  "command_idempotency",
]);

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
  return true;
}

const JSON_COLUMNS = new Set([
  "allowed_target_pages_json",
  "answers_json",
  "advice_json",
  "conditions_json",
  "config_json",
  "data_json",
  "data_schema_json",
  "dimensions_json",
  "evidence",
  "external_result_json",
  "external_status_json",
  "metadata",
  "metadata_json",
  "payload_json",
  "purposes_json",
  "questions_json",
  "raw_result_json",
  "request_json",
  "response_json",
  "result_json",
  "result_copies_json",
  "result_rules_json",
  "rewards_json",
  "setting_json",
  "safety_rules_json",
  "snapshot_json",
  "states_json",
  "data_categories_json",
]);

const BOOLEAN_COLUMNS = new Set([
  "allow_reapply",
  "inventory_released",
  "is_retest",
  "occurred_at_client_supplied",
  "required",
  "subscribed",
  "verified",
]);
const DATE_COLUMNS = new Set([
  "acted_at",
  "attributed_at",
  "authorization_verified_at",
  "cancel_close_at",
  "claimed_at",
  "completed_at",
  "computed_at",
  "consumed_at",
  "created_at",
  "delivered_at",
  "end_at",
  "evaluated_at",
  "expired_at",
  "external_status_checked_at",
  "granted_at",
  "generated_at",
  "health_data_redacted_at",
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
  "started_at",
  "status_checked_at",
  "submitted_at",
  "updated_at",
  "used_at",
  "viewed_at",
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

function healthAssessmentDefinitionRows(data) {
  const rows = Array.isArray(data.healthAssessmentDefinitions) ? data.healthAssessmentDefinitions : [];
  return rows.map((row) => ({
    ...row,
    questions_json: row.questions_json || row.questions || [],
    dimensions_json: row.dimensions_json || row.dimensions || [],
    safety_rules_json: row.safety_rules_json || row.safety_rules || [],
    result_rules_json: row.result_rules_json || row.result_rules || [],
    result_copies_json: row.result_copies_json || row.result_copies || [],
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
    table: "health_assessment_definition",
    source: "healthAssessmentDefinitions",
    id: "assessment_definition_id",
    rows: healthAssessmentDefinitionRows,
    columns: [
      "assessment_definition_id", "assessment_type", "questionnaire_id", "questionnaire_version",
      "title", "description", "estimated_minutes", "status", "content_review_status",
      "professional_review_status", "compliance_review_status", "result_copy_version",
      "questions_json", "dimensions_json", "safety_rules_json", "result_rules_json",
      "result_copies_json", "default_result_code", "created_at", "updated_at",
    ],
  },
  {
    table: "health_assessment_attempt",
    source: "healthAssessmentAttempts",
    id: "assessment_id",
    columns: [
      "assessment_id", "root_user_id", "assessment_definition_id", "assessment_type",
      "questionnaire_id", "questionnaire_version", "status", "safety_state", "is_retest",
      "answers_json", "dimensions_json", "result_json", "result_copy_version", "source_channel",
      "source_campaign_id", "source_qr_code_id", "source_visit_id",
      "started_at", "completed_at", "health_data_redacted_at", "created_at", "updated_at",
    ],
  },
  {
    table: "health_advice_snapshot",
    source: "healthAdviceSnapshots",
    id: "health_advice_snapshot_id",
    columns: [
      "health_advice_snapshot_id", "root_user_id", "initial_assessment_id", "gut_assessment_id",
      "states_json", "advice_json", "advice_source", "adapter_id", "model_name",
      "prompt_version", "content_version", "rule_version", "generated_at", "created_at", "updated_at",
    ],
  },
  {
    table: "channel_definition",
    source: "channelDefinitions",
    id: "channel_definition_id",
    columns: [
      "channel_definition_id", "channel_id", "campaign_id", "status", "signature_key_id",
      "allowed_target_pages_json", "start_at", "end_at", "created_at", "updated_at",
    ],
  },
  {
    table: "channel_qr_code",
    source: "channelQrCodes",
    id: "channel_qr_code_id",
    columns: [
      "channel_qr_code_id", "channel_definition_id", "channel_id", "campaign_id", "short_code",
      "label", "target_page", "status", "start_at", "end_at", "env_version", "created_by",
      "created_at", "updated_at",
    ],
  },
  {
    table: "channel_attribution",
    source: "channelAttributions",
    id: "channel_attribution_id",
    columns: [
      "channel_attribution_id", "root_user_id", "channel_definition_id", "channel_id",
      "campaign_id", "target_page", "signature_key_id", "signature_scheme", "attributed_at", "created_at",
    ],
  },
  {
    table: "channel_attribution_attempt",
    source: "channelAttributionAttempts",
    id: "channel_attribution_attempt_id",
    columns: [
      "channel_attribution_attempt_id", "root_user_id", "requested_channel_id", "requested_campaign_id",
      "requested_target_page", "result", "reason", "occurred_at", "created_at",
    ],
  },
  {
    table: "channel_funnel_visit",
    source: "channelFunnelVisits",
    id: "channel_funnel_visit_id",
    columns: [
      "channel_funnel_visit_id", "client_visit_id", "channel_qr_code_id", "short_code",
      "channel_definition_id", "channel_id", "campaign_id", "target_page", "root_user_id",
      "assessment_id", "opened_at", "created_at", "updated_at",
    ],
  },
  {
    table: "channel_funnel_event",
    source: "channelFunnelEvents",
    id: "channel_funnel_event_id",
    columns: [
      "channel_funnel_event_id", "channel_funnel_visit_id", "channel_qr_code_id", "channel_id",
      "campaign_id", "root_user_id", "assessment_id", "stage", "occurred_at", "created_at",
    ],
  },
  {
    table: "campaign_popup_receipt",
    source: "campaignPopupReceipts",
    id: "campaign_popup_receipt_id",
    columns: [
      "campaign_popup_receipt_id", "root_user_id", "login_session_id", "campaign_id", "popup_id",
      "popup_version", "status", "action_type", "claimed_at", "viewed_at", "acted_at", "created_at", "updated_at",
    ],
  },
  {
    table: "analytics_event",
    source: "analyticsEvents",
    id: "analytics_event_id",
    columns: [
      "analytics_event_id", "root_user_id", "event_name", "payload_json", "source", "occurred_at", "created_at",
    ],
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
      "member_requirement",
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
    table: "questionnaire_answer",
    source: "questionnaireAnswers",
    id: "questionnaire_answer_id",
    columns: ["questionnaire_answer_id", "root_user_id", "campaign_id", "questionnaire_id", "version", "answers_json", "submitted_at", "idempotency_key"],
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
  if (!ids.length) {
    await connection.query(`DELETE FROM \`${projection.table}\``);
    return;
  }
  const placeholders = ids.map(() => "?").join(", ");
  await connection.execute(
    `DELETE FROM \`${projection.table}\` WHERE \`${projection.id}\` NOT IN (${placeholders})`,
    ids
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
  toMysqlDateTime,
};
