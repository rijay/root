const { nowISO } = require("./dates");

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

const BOOLEAN_COLUMNS = new Set(["inventory_released", "required", "subscribed", "verified"]);
const DATE_COLUMNS = new Set([
  "computed_at",
  "created_at",
  "delivered_at",
  "end_at",
  "evaluated_at",
  "expired_at",
  "external_status_checked_at",
  "joined_at",
  "last_seen_at",
  "next_retry_at",
  "occurred_at",
  "published_at",
  "recovered_at",
  "released_at",
  "reserved_at",
  "resolved_at",
  "scheduled_at",
  "sent_at",
  "skipped_at",
  "start_at",
  "status_checked_at",
  "submitted_at",
  "updated_at",
  "used_at",
]);

function rootUserRows(data) {
  const rootUsers = Array.isArray(data.rootUsers) ? data.rootUsers : [];
  const legacyUsers = Array.isArray(data.users) ? data.users : [];
  const identities = Array.isArray(data.wechatIdentities) ? data.wechatIdentities : [];
  const byId = new Map();
  rootUsers.forEach((item) => byId.set(item.root_user_id, { ...item }));
  legacyUsers.forEach((user) => {
    const rootUserId = user.root_user_id || user.user_id;
    if (!rootUserId) return;
    const current = byId.get(rootUserId) || {
      root_user_id: rootUserId,
      lifecycle_status: user.state || "UNREGISTERED",
      source_channel: user.source_channel || "",
      unionid_status: user.unionid ? "LINKED" : "PENDING",
      created_at: user.created_at || nowISO(),
      updated_at: user.updated_at || user.created_at || nowISO(),
    };
    current.unionid = current.unionid || user.unionid || "";
    current.lifecycle_status = current.lifecycle_status || user.state || "UNREGISTERED";
    current.unionid_status = current.unionid ? "LINKED" : (current.unionid_status || "PENDING");
    byId.set(rootUserId, current);
  });
  identities.forEach((identity) => {
    const current = byId.get(identity.root_user_id);
    if (current && !current.unionid && identity.unionid) {
      current.unionid = identity.unionid;
      current.unionid_status = "LINKED";
    }
  });
  return Array.from(byId.values());
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
    columns: ["wechat_identity_id", "root_user_id", "app_code", "openid", "unionid", "unionid_status", "created_at", "updated_at", "last_seen_at"],
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
    table: "task_definition",
    source: "taskDefinitions",
    id: "task_definition_id",
    columns: ["task_definition_id", "campaign_id", "task_type", "title", "description", "required", "display_order", "status", "config_json", "created_at", "updated_at"],
  },
  {
    table: "task_event",
    source: "taskEvents",
    id: "task_event_id",
    columns: ["task_event_id", "root_user_id", "campaign_id", "task_definition_id", "task_type", "event_type", "task_date", "payload_json", "idempotency_key", "status", "source_channel", "occurred_at", "created_at"],
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
    table: "notification_job",
    source: "notificationJobs",
    id: "notification_job_id",
    columns: ["notification_job_id", "root_user_id", "campaign_id", "template_key", "template_id", "template_version", "reminder_date", "scheduled_at", "page", "miniprogram_state", "lang", "data_json", "status", "attempts", "last_error", "idempotency_key", "source_channel", "sent_at", "skipped_at", "created_at", "updated_at"],
  },
  {
    table: "notification_delivery",
    source: "notificationDeliveries",
    id: "notification_delivery_id",
    columns: ["notification_delivery_id", "notification_job_id", "root_user_id", "campaign_id", "template_key", "template_id", "template_version", "status", "error_code", "error_message", "request_json", "response_json", "delivered_at", "created_at"],
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
    table: "reward_inventory_pool",
    source: "rewardInventoryPools",
    id: "reward_inventory_pool_id",
    columns: ["reward_inventory_pool_id", "campaign_id", "quota_key", "quota_limit", "status", "created_at", "updated_at"],
  },
  {
    table: "reward_inventory_reservation",
    source: "rewardInventoryReservations",
    id: "reward_inventory_reservation_id",
    columns: ["reward_inventory_reservation_id", "reward_inventory_pool_id", "campaign_id", "quota_key", "root_user_id", "reward_type", "reward_key", "settlement_record_id", "reward_grant_id", "status", "idempotency_key", "release_reason", "reserved_at", "released_at", "created_at", "updated_at"],
  },
  {
    table: "reward_grant",
    source: "rewardGrants",
    id: "reward_grant_id",
    columns: ["reward_grant_id", "root_user_id", "campaign_id", "settlement_record_id", "order_id", "reward_type", "reward_key", "quota_key", "quota_limit", "inventory_reservation_id", "title", "description", "status", "payload_json", "external_ref", "external_status", "external_status_checked_at", "external_status_json", "used_at", "expired_at", "delivered_at", "recovery_status", "recovery_reason", "recovery_record_id", "recovered_at", "idempotency_key", "created_at", "updated_at"],
  },
  {
    table: "reward_recovery_record",
    source: "rewardRecoveryRecords",
    id: "reward_recovery_record_id",
    columns: ["reward_recovery_record_id", "reward_grant_id", "root_user_id", "campaign_id", "order_id", "source_type", "source_id", "recovery_type", "status", "inventory_released", "reason", "metadata_json", "idempotency_key", "created_at", "updated_at"],
  },
  {
    table: "reward_delivery_job",
    source: "rewardDeliveryJobs",
    id: "reward_delivery_job_id",
    columns: ["reward_delivery_job_id", "reward_grant_id", "adapter_type", "status", "attempt_count", "last_error", "next_retry_at", "delivered_at", "status_checked_at", "request_id", "external_result_json", "created_at", "updated_at"],
  },
  {
    table: "manual_review_item",
    source: "manualReviewItems",
    id: "manual_review_item_id",
    columns: ["manual_review_item_id", "root_user_id", "campaign_id", "review_type", "source_type", "source_id", "reason", "status", "priority", "metadata", "idempotency_key", "operator_id", "resolved_at", "resolution", "created_at", "updated_at"],
  },
];

function toMysqlDateTime(value) {
  if (!value) return null;
  const text = String(value).trim();
  const localMatch = text.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:\+08:00)?$/);
  if (localMatch) return `${localMatch[1]} ${localMatch[2]}`;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 19).replace("T", " ");
}

function projectionValue(row, column) {
  const value = row[column];
  if (JSON_COLUMNS.has(column)) return value === undefined || value === null ? null : JSON.stringify(value);
  if (BOOLEAN_COLUMNS.has(column)) return value ? 1 : 0;
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
  changedCollectionKeys,
  projectionValue,
  rootUserRows,
  syncCoreProjections,
  toMysqlDateTime,
};
