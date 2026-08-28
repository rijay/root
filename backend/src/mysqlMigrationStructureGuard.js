const crypto = require("node:crypto");

const STATES = Object.freeze({
  ABSENT: "ABSENT",
  COMPLETE: "COMPLETE",
  DRIFTED: "DRIFTED",
  UNSUPPORTED: "UNSUPPORTED",
});

const SUCCESSOR_MIGRATIONS = Object.freeze({
  "018_notification_subscription_attempt.sql": "024_notification_native_decision_contract.sql",
  "019_notification_subscription_grant.sql": "057_notification_recipient_binding_v1_enforce.sql",
  "020_notification_job.sql": "025_notification_job_request_identity.sql",
  "021_notification_send_attempt.sql": "026_notification_send_attempt_receipt_metadata.sql",
  "022_notification_send_attempt_transition.sql": "027_notification_send_transition_receipt_metadata.sql",
  "036_activity_enrollment_event_generation_stage.sql": "038_activity_enrollment_event_generation_enforce.sql",
  "043_activity_session_cancel_close_stage.sql": "045_activity_session_policy_enforce.sql",
  "044_activity_session_cancel_close_backfill.sql": "045_activity_session_policy_enforce.sql",
  "046_task_event_idempotency_scope_stage.sql": "048_task_event_idempotency_scope_enforce.sql",
  "049_wechat_unionid_provenance_stage.sql": "051_wechat_unionid_provenance_enforce.sql",
  "050_wechat_unionid_provenance_backfill.sql": "051_wechat_unionid_provenance_enforce.sql",
  "052_notification_recipient_binding_legacy_stage.sql": "056_notification_recipient_binding_legacy_enforce.sql",
  "053_notification_recipient_binding_v1_stage.sql": "057_notification_recipient_binding_v1_enforce.sql",
  "058_notification_provider_call_fence_stage.sql": "060_notification_provider_call_fence_enforce.sql",
  "059_notification_provider_call_fence_backfill.sql": "060_notification_provider_call_fence_enforce.sql",
});

const FORMAL_LAUNCH_CLEANUP_MIGRATION = "067_formal_launch_retired_runtime_cleanup.sql";
const CONFIRMED_PRELAUNCH_CLEANUP_MIGRATION = "068_formal_launch_confirmed_prelaunch_cleanup.sql";
const FORMAL_LAUNCH_RETIRED_MIGRATIONS = new Set([
  "009_outbox_dispatcher_fencing.sql",
  "010_durable_inbox_checkpoint.sql",
  "011_durable_consumer_checkpoint.sql",
  "012_durable_inbox_dead_letter.sql",
  "013_inbox_content_protection_metadata.sql",
  "014_inbox_handler_identity.sql",
  "015_task_share_completion_projection.sql",
  "016_inbox_replay_run.sql",
  "017_task_share_completion_shadow_projection.sql",
  "018_notification_subscription_attempt.sql",
  "019_notification_subscription_grant.sql",
  "020_notification_job.sql",
  "021_notification_send_attempt.sql",
  "022_notification_send_attempt_transition.sql",
  "023_inbox_replay_executor_identity.sql",
  "024_notification_native_decision_contract.sql",
  "025_notification_job_request_identity.sql",
  "026_notification_send_attempt_receipt_metadata.sql",
  "027_notification_send_transition_receipt_metadata.sql",
  "028_migration_contract_registry.sql",
  "029_migration_run.sql",
  "030_migration_lineage.sql",
  "031_task_share_migration_projection.sql",
  "032_v1_runtime_cycle.sql",
  "033_v1_runtime_alert.sql",
  "041_task_activity_assignment.sql",
  "042_task_source_invalidation_event.sql",
  "053_notification_recipient_binding_v1_stage.sql",
  "055_notification_recipient_binding_v1_backfill.sql",
  "057_notification_recipient_binding_v1_enforce.sql",
  "058_notification_provider_call_fence_stage.sql",
  "059_notification_provider_call_fence_backfill.sql",
  "060_notification_provider_call_fence_enforce.sql",
  "061_v1_runtime_alert_delivery.sql",
  "062_settlement_source_authority.sql",
  "063_v1_runtime_alert_database_authority_stage.sql",
  "064_v1_runtime_control_ledger_database_authority.sql",
  "065_v1_runtime_alert_registration_return_row.sql",
  "066_v1_runtime_alert_delivery_severity_slo_authority.sql",
]);
const CONFIRMED_PRELAUNCH_RETIRED_MIGRATIONS = new Set([
  "046_task_event_idempotency_scope_stage.sql",
  "047_task_event_idempotency_scope_backfill.sql",
  "048_task_event_idempotency_scope_enforce.sql",
  "052_notification_recipient_binding_legacy_stage.sql",
  "054_notification_recipient_binding_legacy_backfill.sql",
  "056_notification_recipient_binding_legacy_enforce.sql",
]);

const COMPATIBLE_SUCCESSOR_MIGRATIONS = Object.freeze({
  "019_notification_subscription_grant.sql": Object.freeze([
    "053_notification_recipient_binding_v1_stage.sql",
    "057_notification_recipient_binding_v1_enforce.sql",
  ]),
});

function column(name, type, options = {}) {
  return Object.freeze({
    name,
    type,
    nullable: options.nullable || "NO",
    defaultValue: options.defaultValue === undefined ? null : options.defaultValue,
    charset: options.charset || null,
    collation: options.collation || null,
    extra: "",
    generationExpression: "",
  });
}

function ascii(name, type, options = {}) {
  return column(name, type, { ...options, charset: "ascii", collation: "ascii_bin" });
}

function utf8(name, type, options = {}) {
  return column(name, type, { ...options, charset: "utf8mb4", collation: "utf8mb4_0900_bin" });
}

function unicode(name, type, options = {}) {
  return column(name, type, { ...options, charset: "utf8mb4", collation: "utf8mb4_unicode_ci" });
}

function index(name, nonUnique, ...columns) {
  return Object.freeze({ name, nonUnique, columns: Object.freeze(columns) });
}

function foreignKey(name, columns, referencedTable, referencedColumns) {
  return Object.freeze({
    name,
    columns: Object.freeze(columns),
    referencedTable,
    referencedColumns: Object.freeze(referencedColumns),
    updateRule: "RESTRICT",
    deleteRule: "RESTRICT",
  });
}

const DEFINITIONS = Object.freeze({
  "014_inbox_handler_identity.sql": Object.freeze({
    tableName: "inbox_receipt",
    alter: true,
    anchorColumn: "handler_version",
    columns: Object.freeze([
      ascii("handler_id", "varchar(96)"),
      column("handler_registry_version", "int unsigned"),
      ascii("handler_descriptor_digest", "char(64)"),
      ascii("handler_source_digest", "char(64)"),
      ascii("handler_registration_digest", "char(64)"),
    ]),
    indexes: Object.freeze([
      index(
        "idx_inbox_handler_inventory",
        1,
        "handler_registry_version",
        "handler_id",
        "handler_descriptor_digest",
        "handler_source_digest",
        "handler_registration_digest",
        "status"
      ),
    ]),
    checks: Object.freeze({
      chk_inbox_handler_id_supported: "0ed44821c5a8285845cfc08321ca4f152462b6a59182019edb45d794247e0030",
      chk_inbox_handler_registry_version_positive: "124c803aa28eade20a966c8d716617d7352410a1e0d4149b79bfa7923d51e282",
      chk_inbox_handler_descriptor_digest_lower_hex: "55f0a84373c82e56b32f29cc84abd295339464486a7bb69a8cc995af5ccb3300",
      chk_inbox_handler_source_digest_lower_hex: "99a811c38798f0159dc0537f078326f66984d157890d6583a8512440139df6b2",
      chk_inbox_handler_registration_digest_lower_hex: "495803a0794f8c6fe587b585758563292e7fc28108feaa52ee57e4ddbc0a120b",
    }),
    foreignKeys: Object.freeze([]),
  }),
  "015_task_share_completion_projection.sql": Object.freeze({
    tableName: "task_share_completion_projection",
    columns: Object.freeze([
      ascii("projection_id", "varchar(64)"),
      column("projection_generation", "tinyint unsigned", { defaultValue: "1" }),
      utf8("task_event_id", "varchar(64)"),
      utf8("source_event_id", "varchar(64)"),
      ascii("source_event_type", "varchar(128)"),
      ascii("source_schema_version", "varchar(32)"),
      utf8("source_name", "varchar(96)"),
      utf8("source_partition_key", "varchar(191)"),
      column("source_partition_position", "bigint unsigned"),
      column("source_aggregate_version", "bigint unsigned"),
      ascii("task_type", "varchar(32)"),
      ascii("completion_event_type", "varchar(128)"),
      column("occurred_at", "datetime(3)"),
      ascii("handler_version", "varchar(64)"),
      ascii("handler_registration_digest", "char(64)"),
      column("created_at", "datetime(3)"),
    ]),
    indexes: Object.freeze([
      index("PRIMARY", 0, "projection_id"),
      index("uk_task_share_projection_task_event", 0, "projection_generation", "task_event_id"),
      index("uk_task_share_projection_source_event", 0, "projection_generation", "source_event_id"),
    ]),
    checks: Object.freeze({
      chk_task_share_projection_generation: "68b7b47d8fe3598b859f2c8352a5ce5c7ac73448bde270bf2d99ba7dd78a5124",
      chk_task_share_projection_source_contract: "4852c096e62503b8ffe7a58810140f449ef684bd7dece6d9be93aa5e13bf064f",
      chk_task_share_projection_outcome_contract: "543fda26fded273ad630c51279f99420f186b0d1023ecb8d1e5ad8e437eec293",
      chk_task_share_projection_handler_version: "1e51f11450e51b5954cac8a8fc556e9a7b9e31c743f130e4e3c297f929e5375c",
      chk_task_share_projection_registration_digest: "495803a0794f8c6fe587b585758563292e7fc28108feaa52ee57e4ddbc0a120b",
    }),
    foreignKeys: Object.freeze([]),
  }),
  "016_inbox_replay_run.sql": Object.freeze({
    tableName: "inbox_replay_run",
    allowAdditional: true,
    columns: Object.freeze([
      ascii("replay_run_id", "varchar(64)"),
      ascii("replay_mode", "varchar(32)"),
      ascii("status", "varchar(32)"),
      ascii("reason_code", "varchar(64)"),
      column("policy_registry_version", "int unsigned"),
      ascii("policy_registry_digest", "char(64)"),
      ascii("policy_id", "varchar(96)"),
      column("policy_version", "int unsigned"),
      ascii("policy_digest", "char(64)"),
      utf8("consumer_name", "varchar(128)"),
      utf8("source_name", "varchar(96)"),
      utf8("event_type", "varchar(128)"),
      ascii("schema_version", "varchar(32)"),
      utf8("aggregate_type", "varchar(96)"),
      ascii("source_receipt_status", "varchar(32)"),
      ascii("source_handler_id", "varchar(96)"),
      ascii("source_handler_version", "varchar(64)"),
      column("source_handler_registry_version", "int unsigned"),
      ascii("source_handler_descriptor_digest", "char(64)"),
      ascii("source_handler_source_digest", "char(64)"),
      ascii("source_handler_registration_digest", "char(64)"),
      ascii("execution_consumer_name", "varchar(128)"),
      ascii("execution_handler_id", "varchar(96)"),
      ascii("execution_handler_version", "varchar(64)"),
      ascii("target_projection_policy", "varchar(64)"),
      column("shadow_generation", "bigint unsigned", { nullable: "YES" }),
      ascii("cursor_version", "varchar(64)"),
      ascii("selection_query_id", "varchar(128)"),
      ascii("selection_query_digest", "char(64)"),
      column("selection_after_first_received_at", "datetime(3)", { nullable: "YES" }),
      ascii("selection_after_receipt_id", "varchar(64)", { nullable: "YES" }),
      column("selection_through_first_received_at", "datetime(3)"),
      ascii("selection_through_receipt_id", "varchar(64)"),
      column("selection_snapshot_at", "datetime(3)"),
      ascii("selection_digest", "char(64)"),
      column("maximum_selected_count", "int unsigned"),
      column("selected_receipt_count", "bigint unsigned"),
      utf8("requested_by_actor_id", "varchar(128)"),
      column("requested_at", "datetime(3)"),
      utf8("authorized_by_actor_id", "varchar(128)"),
      column("authorized_at", "datetime(3)"),
      ascii("authorization_ticket_digest", "char(64)"),
      column("maximum_authorization_ttl_seconds", "int unsigned"),
      column("authorization_expires_at", "datetime(3)"),
      ascii("lease_owner", "varchar(128)", { nullable: "YES" }),
      column("lease_expires_at", "datetime(3)", { nullable: "YES" }),
      column("lease_generation", "bigint unsigned", { defaultValue: "0" }),
      ascii("replay_transition_id", "varchar(128)", { nullable: "YES" }),
      column("processed_receipt_count", "bigint unsigned", { defaultValue: "0" }),
      column("verified_receipt_count", "bigint unsigned", { defaultValue: "0" }),
      column("shadow_inserted_count", "bigint unsigned", { defaultValue: "0" }),
      column("shadow_replayed_count", "bigint unsigned", { defaultValue: "0" }),
      column("failed_receipt_count", "bigint unsigned", { defaultValue: "0" }),
      ascii("result_digest", "char(64)", { nullable: "YES" }),
      ascii("last_error_code", "varchar(64)", { nullable: "YES" }),
      column("started_at", "datetime(3)", { nullable: "YES" }),
      column("completed_at", "datetime(3)", { nullable: "YES" }),
      column("created_at", "datetime(3)"),
      column("updated_at", "datetime(3)"),
    ]),
    indexes: Object.freeze([
      index("PRIMARY", 0, "replay_run_id"),
      index("uk_inbox_replay_scope_generation", 0, "consumer_name", "source_name", "source_handler_id", "shadow_generation"),
      index("uk_inbox_replay_run_generation", 0, "replay_run_id", "shadow_generation"),
      index("uk_inbox_replay_execution_consumer", 0, "execution_consumer_name"),
      index("idx_inbox_replay_dispatch", 1, "status", "authorization_expires_at", "replay_run_id"),
      index("idx_inbox_replay_lease_recovery", 1, "status", "lease_expires_at", "lease_generation", "replay_run_id"),
      index("idx_inbox_replay_selection", 1, "consumer_name", "source_name", "event_type", "selection_through_first_received_at", "selection_through_receipt_id"),
      index("idx_inbox_replay_approval_inventory", 1, "requested_by_actor_id", "authorized_by_actor_id", "authorized_at"),
    ]),
    checks: Object.freeze({
      chk_inbox_replay_mode_supported: "c11c090446044a9dab8a3ddffa5385e14cd872ca7cdda94fe2aee46504436998",
      chk_inbox_replay_status_supported: "ffdf911525128c73d6783d28ecfa4edc9c1a6b56f1751f07138a0e9822b7620c",
      chk_inbox_replay_reason_supported: "c4214a3ac25b171caed2a30e3217c3977565baedbf061c3a3012da474243353a",
      chk_inbox_replay_policy_identity: "afe29ecbbf99735a8b0cf0061e5872c424b641ea0cfc2fb8e66d4a1ea0022f82",
      chk_inbox_replay_source_contract: "eb2d3f6cee101ef88dd461e849e372014ca2815bed6754d9a13dfbd17627049c",
      chk_inbox_replay_handler_identity: "f7c753c95d207dce34b8ccb6fa67226b282a8dc98a2af34b155e7e702aed3d4b",
      chk_inbox_replay_selection_query: "031ea0e365ace1372b38f2cf7c8991fa6b6d310f91c9ec7e6825a359993b471d",
      chk_inbox_replay_mode_generation: "d76be4317f1b545cb83489e65f2d501412a7f837597ed03e1fe03866c88d26b6",
      chk_inbox_replay_cursor_contract: "cd0c284aaf8de6d66f7ff1020e511d05d024844b15bf0d88428ea9d0a7348366",
      chk_inbox_replay_selection_sealed: "5fbd7c2d614a19e63ab74615f5120c1ea3615d0db45cbf82ca627572c58032cc",
      chk_inbox_replay_two_person_authorization: "7ed6799dda5f19da28887bdeb11acb850bd33c2e1dfccc0e8353b546bdf4c325",
      chk_inbox_replay_authorization_ttl: "8c9169198955bac8b81c2e6bb4460bd92d80d88d13efdde73ea5c1db5688cca4",
      chk_inbox_replay_count_bounds: "9348d846d01368a364b6584cd0a9315de8c12f0d50736ea8076c94c055e05fc7",
      chk_inbox_replay_state_shape: "93bc4084d3c0c5eea0bb5f7d14adeee5f4d4796395bbf6d711440984f7a06ead",
    }),
    foreignKeys: Object.freeze([]),
  }),
  "017_task_share_completion_shadow_projection.sql": Object.freeze({
    tableName: "task_share_completion_shadow_projection",
    columns: Object.freeze([
      ascii("shadow_projection_id", "varchar(64)"),
      ascii("replay_run_id", "varchar(64)"),
      column("projection_generation", "bigint unsigned"),
      ascii("source_receipt_id", "varchar(64)"),
      utf8("task_event_id", "varchar(64)"),
      utf8("source_event_id", "varchar(64)"),
      ascii("source_event_type", "varchar(128)"),
      ascii("source_schema_version", "varchar(32)"),
      utf8("source_name", "varchar(96)"),
      utf8("source_partition_key", "varchar(191)"),
      column("source_partition_position", "bigint unsigned"),
      column("source_aggregate_version", "bigint unsigned"),
      ascii("task_type", "varchar(32)"),
      ascii("completion_event_type", "varchar(128)"),
      column("occurred_at", "datetime(3)"),
      ascii("source_handler_registration_digest", "char(64)"),
      ascii("execution_handler_id", "varchar(96)"),
      ascii("execution_handler_version", "varchar(64)"),
      column("created_at", "datetime(3)"),
    ]),
    indexes: Object.freeze([
      index("PRIMARY", 0, "shadow_projection_id"),
      index("uk_task_share_shadow_receipt", 0, "replay_run_id", "source_receipt_id"),
      index("uk_task_share_shadow_task_event", 0, "projection_generation", "task_event_id"),
      index("uk_task_share_shadow_source_event", 0, "projection_generation", "source_event_id"),
      index("fk_task_share_shadow_replay_generation", 1, "replay_run_id", "projection_generation"),
      index("fk_task_share_shadow_source_receipt", 1, "source_receipt_id"),
    ]),
    checks: Object.freeze({
      chk_task_share_shadow_generation: "48ef5c6cdf6783f651faaa517fb30355902e73caa8ccdfd5eda88e6a8bc47c89",
      chk_task_share_shadow_source_contract: "4852c096e62503b8ffe7a58810140f449ef684bd7dece6d9be93aa5e13bf064f",
      chk_task_share_shadow_outcome_contract: "543fda26fded273ad630c51279f99420f186b0d1023ecb8d1e5ad8e437eec293",
      chk_task_share_shadow_handler_identity: "6ba7f100d273f011eacc9cb9eb0fb29047c779d87db45ad5b1f6e07414d5be8f",
    }),
    foreignKeys: Object.freeze([
      foreignKey(
        "fk_task_share_shadow_replay_generation",
        ["replay_run_id", "projection_generation"],
        "inbox_replay_run",
        ["replay_run_id", "shadow_generation"]
      ),
      foreignKey(
        "fk_task_share_shadow_source_receipt",
        ["source_receipt_id"],
        "inbox_receipt",
        ["inbox_receipt_id"]
      ),
    ]),
  }),
  "018_notification_subscription_attempt.sql": Object.freeze({
    tableName: "notification_subscription_attempt_v1",
    columns: Object.freeze([
      ascii("notification_subscription_attempt_id", "varchar(32)"),
      ascii("root_user_id", "varchar(32)"),
      ascii("task_id", "varchar(64)"),
      column("task_occurrence_date", "date"),
      ascii("template_version", "varchar(32)"),
      ascii("grant_request_id", "varchar(96)"),
      ascii("native_decision", "varchar(16)"),
      ascii("reason_code", "varchar(64)", { nullable: "YES" }),
      ascii("idempotency_key", "varchar(160)"),
      column("decided_at", "datetime(3)"),
      ascii("release_id", "varchar(64)"),
      column("created_at", "datetime(3)"),
      column("updated_at", "datetime(3)"),
    ]),
    indexes: Object.freeze([
      index("PRIMARY", 0, "notification_subscription_attempt_id"),
      index("uk_notification_subscription_attempt_v1_grant_request", 0, "grant_request_id"),
      index(
        "uk_notification_subscription_attempt_v1_occurrence",
        0,
        "root_user_id",
        "task_id",
        "task_occurrence_date",
        "template_version"
      ),
      index("uk_notification_subscription_attempt_v1_idempotency", 0, "idempotency_key"),
    ]),
    checks: Object.freeze({
      chk_notification_subscription_attempt_v1_decision: "a6cf15881d1f56b4bccc0a8c6e03d452093848f2c418ad08af12e8f89407ceb3",
    }),
    foreignKeys: Object.freeze([]),
  }),
  "019_notification_subscription_grant.sql": Object.freeze({
    tableName: "notification_subscription_grant_v1",
    columns: Object.freeze([
      ascii("notification_subscription_grant_id", "varchar(32)"),
      ascii("notification_subscription_attempt_id", "varchar(32)"),
      ascii("root_user_id", "varchar(32)"),
      ascii("task_id", "varchar(64)"),
      column("task_occurrence_date", "date"),
      ascii("template_version", "varchar(32)"),
      ascii("grant_request_id", "varchar(96)"),
      ascii("status", "varchar(32)"),
      ascii("reserved_job_id", "varchar(32)", { nullable: "YES" }),
      ascii("status_reason_code", "varchar(64)", { nullable: "YES" }),
      column("granted_at", "datetime(3)"),
      column("reserved_at", "datetime(3)", { nullable: "YES" }),
      column("consumed_at", "datetime(3)", { nullable: "YES" }),
      column("invalidated_at", "datetime(3)", { nullable: "YES" }),
      column("review_required_at", "datetime(3)", { nullable: "YES" }),
      ascii("release_id", "varchar(64)"),
      column("created_at", "datetime(3)"),
      column("updated_at", "datetime(3)"),
    ]),
    indexes: Object.freeze([
      index("PRIMARY", 0, "notification_subscription_grant_id"),
      index("uk_notification_subscription_grant_v1_attempt", 0, "notification_subscription_attempt_id"),
      index("uk_notification_subscription_grant_v1_grant_request", 0, "grant_request_id"),
      index(
        "uk_notification_subscription_grant_v1_occurrence",
        0,
        "root_user_id",
        "task_id",
        "task_occurrence_date",
        "template_version"
      ),
      index("uk_notification_subscription_grant_v1_reserved_job", 0, "reserved_job_id"),
    ]),
    checks: Object.freeze({
      chk_notification_subscription_grant_v1_status: "fede6ab7ea25643f77a7e38657eab50f3f65a991561dce28df5d585535d9768c",
    }),
    foreignKeys: Object.freeze([
      foreignKey(
        "fk_notification_subscription_grant_attempt",
        ["notification_subscription_attempt_id"],
        "notification_subscription_attempt_v1",
        ["notification_subscription_attempt_id"]
      ),
    ]),
  }),
  "020_notification_job.sql": Object.freeze({
    tableName: "notification_job_v1",
    columns: Object.freeze([
      ascii("notification_job_id", "varchar(32)"),
      ascii("notification_subscription_grant_id", "varchar(32)"),
      ascii("root_user_id", "varchar(32)"),
      ascii("task_id", "varchar(64)"),
      column("task_occurrence_date", "date"),
      ascii("template_version", "varchar(32)"),
      ascii("status", "varchar(32)"),
      column("due_at", "datetime(3)"),
      ascii("send_attempt_id", "varchar(32)", { nullable: "YES" }),
      ascii("stable_error_code", "varchar(64)", { nullable: "YES" }),
      ascii("release_id", "varchar(64)"),
      column("created_at", "datetime(3)"),
      column("updated_at", "datetime(3)"),
    ]),
    indexes: Object.freeze([
      index("PRIMARY", 0, "notification_job_id"),
      index("uk_notification_job_v1_grant", 0, "notification_subscription_grant_id"),
      index(
        "uk_notification_job_v1_occurrence",
        0,
        "root_user_id",
        "task_id",
        "task_occurrence_date",
        "template_version"
      ),
      index("uk_notification_job_v1_send_attempt", 0, "send_attempt_id"),
      index("idx_notification_job_v1_due", 1, "status", "due_at"),
    ]),
    checks: Object.freeze({
      chk_notification_job_v1_status: "7374a14e44003d7c1e518a60f3fe28bc459d4d2076cb1bfb55e2bd8f8eaba835",
    }),
    foreignKeys: Object.freeze([
      foreignKey(
        "fk_notification_job_grant",
        ["notification_subscription_grant_id"],
        "notification_subscription_grant_v1",
        ["notification_subscription_grant_id"]
      ),
    ]),
  }),
  "021_notification_send_attempt.sql": Object.freeze({
    tableName: "notification_send_attempt",
    columns: Object.freeze([
      ascii("notification_send_attempt_id", "varchar(32)"),
      ascii("notification_job_id", "varchar(32)"),
      column("attempt_number", "int unsigned"),
      ascii("provider", "varchar(32)"),
      ascii("status", "varchar(16)"),
      column("transition_version", "bigint unsigned"),
      ascii("transition_fence_digest", "char(64)"),
      ascii("request_digest", "char(64)"),
      ascii("provider_receipt_digest", "char(64)", { nullable: "YES" }),
      ascii("stable_error_code", "varchar(64)", { nullable: "YES" }),
      column("started_at", "datetime(3)"),
      column("completed_at", "datetime(3)", { nullable: "YES" }),
      ascii("release_id", "varchar(64)"),
      column("created_at", "datetime(3)"),
      column("updated_at", "datetime(3)"),
    ]),
    indexes: Object.freeze([
      index("PRIMARY", 0, "notification_send_attempt_id"),
      index("uk_notification_send_attempt_job", 0, "notification_job_id"),
      index("uk_notification_send_attempt_job_number", 0, "notification_job_id", "attempt_number"),
      index("uk_notification_send_attempt_fence", 0, "transition_fence_digest"),
      index("uk_notification_send_attempt_provider_receipt", 0, "provider_receipt_digest"),
    ]),
    checks: Object.freeze({
      chk_notification_send_attempt_number: "62b42406b17baf3ca15769174d1f99e556ab31b12c0d8c5b9ee0b4ba74f06ae9",
      chk_notification_send_attempt_provider: "5d08bd39ca4534ccb0de288bc770742447d05a6c7d8ed17f7208d3c79a7bf6d6",
      chk_notification_send_attempt_status: "5cf64350e66584346a759442e4da70d777c91bcc1f3b77a0855fb81848edb476",
      chk_notification_send_attempt_accepted_receipt: "fa3e6322d5a6f4386dbcdb179746ee505d54f4fd92200dc5cf1e4db3f14b648b",
      chk_notification_send_attempt_completed: "c07193bfa205f77c7f8407377289a0fcc723be1525edf570c0ba876ab4d5909c",
    }),
    foreignKeys: Object.freeze([
      foreignKey(
        "fk_notification_send_attempt_job",
        ["notification_job_id"],
        "notification_job_v1",
        ["notification_job_id"]
      ),
    ]),
  }),
  "022_notification_send_attempt_transition.sql": Object.freeze({
    tableName: "notification_send_attempt_transition",
    columns: Object.freeze([
      ascii("notification_send_attempt_transition_id", "varchar(32)"),
      ascii("notification_send_attempt_id", "varchar(32)"),
      column("transition_number", "bigint unsigned"),
      ascii("from_status", "varchar(16)", { nullable: "YES" }),
      ascii("to_status", "varchar(16)"),
      ascii("transition_fence_digest", "char(64)"),
      ascii("provider_receipt_digest", "char(64)", { nullable: "YES" }),
      ascii("stable_error_code", "varchar(64)", { nullable: "YES" }),
      ascii("release_id", "varchar(64)"),
      column("created_at", "datetime(3)"),
    ]),
    indexes: Object.freeze([
      index("PRIMARY", 0, "notification_send_attempt_transition_id"),
      index(
        "uk_notification_send_attempt_transition_number",
        0,
        "notification_send_attempt_id",
        "transition_number"
      ),
      index("uk_notification_send_attempt_transition_fence", 0, "transition_fence_digest"),
    ]),
    checks: Object.freeze({
      chk_notification_send_attempt_transition_from: "2b6d2963d4b818d4e7cc7945b6d15d4eeb26189f7a120f08571ac53ebe45a4e0",
      chk_notification_send_attempt_transition_to: "bac5cb9d87fbd277f9be9eac43783d7c6aca887c1145bd2fd305d83a066161aa",
      chk_notification_send_attempt_transition_receipt: "cdad9810d049943470e1c69e39f72ce007802982c0c1a2bc7e8266c7911a5b69",
    }),
    foreignKeys: Object.freeze([
      foreignKey(
        "fk_notification_send_attempt_transition_attempt",
        ["notification_send_attempt_id"],
        "notification_send_attempt",
        ["notification_send_attempt_id"]
      ),
    ]),
  }),
  "023_inbox_replay_executor_identity.sql": Object.freeze({
    tableName: "inbox_replay_run",
    alter: true,
    anchorColumn: "execution_handler_version",
    columns: Object.freeze([
      column("execution_executor_registry_version", "int unsigned", { nullable: "YES" }),
      ascii("execution_executor_registry_digest", "char(64)", { nullable: "YES" }),
      ascii("execution_executor_descriptor_digest", "char(64)", { nullable: "YES" }),
      ascii("execution_executor_source_digest", "char(64)", { nullable: "YES" }),
      ascii("execution_executor_registration_digest", "char(64)", { nullable: "YES" }),
    ]),
    indexes: Object.freeze([]),
    checks: Object.freeze({
      chk_inbox_replay_executor_identity: "b5f3a5df1b8c390be6f68a2603c3f5fb8c5384aca0031ea17a70f7c1135bee18",
    }),
    foreignKeys: Object.freeze([]),
  }),
  "024_notification_native_decision_contract.sql": Object.freeze({
    tableName: "notification_subscription_attempt_v1",
    alter: true,
    anchorColumn: "grant_request_id",
    columns: Object.freeze([
      ascii("native_decision", "varchar(32)"),
    ]),
    indexes: Object.freeze([]),
    checks: Object.freeze({
      chk_notification_subscription_attempt_v1_decision: "ae2d5c481db0197545165217c883a2567a3ff90daadd1d433c4eabdc88f3be11",
      chk_notification_subscription_attempt_v1_reason: "0fc5f4e0d93588ccbead215ab7e1f57c5a226f2cbf21a572ac1d042dffa5e087",
    }),
    precondition: Object.freeze({
      columns: Object.freeze([ascii("native_decision", "varchar(16)")]),
      indexes: Object.freeze([]),
      checks: Object.freeze({
        chk_notification_subscription_attempt_v1_decision: "a6cf15881d1f56b4bccc0a8c6e03d452093848f2c418ad08af12e8f89407ceb3",
      }),
    }),
    foreignKeys: Object.freeze([]),
  }),
  "025_notification_job_request_identity.sql": Object.freeze({
    tableName: "notification_job_v1",
    alter: true,
    anchorColumn: "due_at",
    columns: Object.freeze([
      ascii("idempotency_key", "varchar(191)"),
      ascii("request_digest", "char(64)"),
    ]),
    indexes: Object.freeze([
      index("uk_notification_job_v1_idempotency", 0, "idempotency_key"),
    ]),
    checks: Object.freeze({
      chk_notification_job_v1_request_digest: "f5a7c03f43d8c6336af155ce9f83441d37beecdd81aa1e15a898c5f96ca4b219",
      chk_notification_job_v1_stable_error: "7a43775bdd193cb58f4bd6096e18245e9bd7c95251d51c2e0da282a032248119",
    }),
    precondition: Object.freeze({
      columns: Object.freeze([]),
      indexes: Object.freeze([]),
      checks: Object.freeze({}),
    }),
    foreignKeys: Object.freeze([]),
  }),
  "026_notification_send_attempt_receipt_metadata.sql": Object.freeze({
    tableName: "notification_send_attempt",
    alter: true,
    anchorColumn: "provider_receipt_digest",
    columns: Object.freeze([
      ascii("provider_receipt_digest_scheme", "varchar(32)", { nullable: "YES" }),
      ascii("provider_receipt_digest_key_id", "varchar(64)", { nullable: "YES" }),
    ]),
    indexes: Object.freeze([]),
    checks: Object.freeze({
      chk_notification_send_attempt_receipt_digest: "3d2d42b5a8652dfe8f36c50343e56e43f7a0d5741d4e249a3ef689fb1b3dde2b",
      chk_notification_send_attempt_accepted_receipt: "279bfcd570e4feb5785373b8390c615c6072740a1f90b5783e84536373b63bb6",
      chk_notification_send_attempt_stable_error: "f61ae931fd5a702748f5e7ed015bb074b70ba21349f96577ab9c486e0f994ae3",
    }),
    precondition: Object.freeze({
      columns: Object.freeze([]),
      indexes: Object.freeze([]),
      checks: Object.freeze({
        chk_notification_send_attempt_accepted_receipt: "fa3e6322d5a6f4386dbcdb179746ee505d54f4fd92200dc5cf1e4db3f14b648b",
      }),
    }),
    foreignKeys: Object.freeze([]),
  }),
  "027_notification_send_transition_receipt_metadata.sql": Object.freeze({
    tableName: "notification_send_attempt_transition",
    alter: true,
    anchorColumn: "provider_receipt_digest",
    columns: Object.freeze([
      ascii("provider_receipt_digest_scheme", "varchar(32)", { nullable: "YES" }),
      ascii("provider_receipt_digest_key_id", "varchar(64)", { nullable: "YES" }),
    ]),
    indexes: Object.freeze([]),
    checks: Object.freeze({
      chk_notification_send_attempt_transition_digest: "3d2d42b5a8652dfe8f36c50343e56e43f7a0d5741d4e249a3ef689fb1b3dde2b",
      chk_notification_send_attempt_transition_receipt: "4612404ccdadfdc4ae902494a9daf0b327b52e3a171f7652570cff5651a5b73f",
      chk_notification_send_attempt_transition_error: "8e365ae89f8ef74957130dc4cad264eeb73c62b91422900f848e42f95a33434a",
    }),
    precondition: Object.freeze({
      columns: Object.freeze([]),
      indexes: Object.freeze([]),
      checks: Object.freeze({
        chk_notification_send_attempt_transition_receipt: "cdad9810d049943470e1c69e39f72ce007802982c0c1a2bc7e8266c7911a5b69",
      }),
    }),
    foreignKeys: Object.freeze([]),
  }),
  "028_migration_contract_registry.sql": Object.freeze({
    tableName: "migration_contract_registry",
    columns: Object.freeze([
      ascii("contract_id", "varchar(96)"),
      column("contract_version", "int unsigned"),
      column("registry_version", "int unsigned"),
      ascii("registry_digest", "char(64)"),
      ascii("fact_type", "varchar(64)"),
      ascii("authoritative_source", "varchar(96)"),
      ascii("source_type", "varchar(96)"),
      ascii("source_query_id", "varchar(128)"),
      ascii("source_query_digest", "char(64)"),
      ascii("source_adapter_id", "varchar(128)"),
      ascii("source_adapter_digest", "char(64)"),
      ascii("target_type", "varchar(96)"),
      ascii("target_schema_version", "varchar(64)"),
      ascii("target_adapter_id", "varchar(128)"),
      ascii("target_adapter_digest", "char(64)"),
      ascii("parity_adapter_id", "varchar(128)"),
      ascii("parity_adapter_digest", "char(64)"),
      ascii("cursor_type", "varchar(64)"),
      column("inclusive", "tinyint(1)"),
      column("maximum_batch_size", "int unsigned"),
      column("allows_network", "tinyint(1)"),
      column("allows_outbox", "tinyint(1)"),
      ascii("contract_digest", "char(64)"),
      ascii("status", "varchar(24)"),
      column("created_at", "datetime(3)"),
      column("updated_at", "datetime(3)"),
    ]),
    indexes: Object.freeze([
      index("PRIMARY", 0, "contract_id", "contract_version"),
      index("uk_migration_contract_identity", 0, "contract_id", "contract_version", "contract_digest"),
    ]),
    checks: Object.freeze({
      chk_migration_contract_registered_scope: "d46f91b5427371edc4959c5bc0a6b30a6227a33da5a6a1dc9396ff2e236f3e59",
      chk_migration_contract_digest_shape: "dd8e6a587702197ae7cc8bd3884fef5de647b99294fd9058e89548f2401e7732",
    }),
    foreignKeys: Object.freeze([]),
  }),
  "029_migration_run.sql": Object.freeze({
    tableName: "migration_run",
    columns: Object.freeze([
      ascii("migration_run_id", "varchar(64)"),
      column("registry_version", "int unsigned"),
      ascii("registry_digest", "char(64)"),
      ascii("contract_id", "varchar(96)"),
      column("contract_version", "int unsigned"),
      ascii("contract_digest", "char(64)"),
      ascii("migration_mode", "varchar(32)"),
      ascii("status", "varchar(32)"),
      ascii("request_id", "varchar(128)"),
      ascii("snapshot_id", "varchar(128)"),
      ascii("snapshot_revision", "varchar(128)"),
      column("snapshot_at", "datetime(3)"),
      ascii("source_query_id", "varchar(128)"),
      ascii("source_query_digest", "char(64)"),
      ascii("source_adapter_digest", "char(64)"),
      ascii("target_adapter_digest", "char(64)"),
      ascii("parity_adapter_digest", "char(64)"),
      ascii("target_schema_version", "varchar(64)"),
      ascii("replay_source_run_id", "varchar(64)", { nullable: "YES" }),
      ascii("replay_source_result_digest", "char(64)", { nullable: "YES" }),
      ascii("replay_through_cursor_value", "varchar(128)", { nullable: "YES" }),
      ascii("replay_through_tie_breaker", "varchar(128)", { nullable: "YES" }),
      ascii("cursor_type", "varchar(64)"),
      ascii("cursor_value", "varchar(128)", { nullable: "YES" }),
      ascii("cursor_tie_breaker", "varchar(128)", { nullable: "YES" }),
      column("inclusive", "tinyint(1)"),
      ascii("last_contiguous_cursor_value", "varchar(128)", { nullable: "YES" }),
      ascii("last_contiguous_tie_breaker", "varchar(128)", { nullable: "YES" }),
      ascii("lease_owner", "varchar(128)", { nullable: "YES" }),
      column("lease_expires_at", "datetime(3)", { nullable: "YES" }),
      column("lease_generation", "bigint unsigned", { defaultValue: "0" }),
      ascii("transition_id", "varchar(128)", { nullable: "YES" }),
      column("processed_count", "bigint unsigned", { defaultValue: "0" }),
      column("migrated_count", "bigint unsigned", { defaultValue: "0" }),
      column("idempotent_count", "bigint unsigned", { defaultValue: "0" }),
      column("conflict_count", "bigint unsigned", { defaultValue: "0" }),
      column("quarantined_count", "bigint unsigned", { defaultValue: "0" }),
      column("review_required_count", "bigint unsigned", { defaultValue: "0" }),
      column("batch_count", "bigint unsigned", { defaultValue: "0" }),
      ascii("result_digest", "char(64)", { nullable: "YES" }),
      ascii("last_error_code", "varchar(64)", { nullable: "YES" }),
      column("opened_at", "datetime(3)"),
      column("verified_at", "datetime(3)", { nullable: "YES" }),
      column("completed_at", "datetime(3)", { nullable: "YES" }),
      column("created_at", "datetime(3)"),
      column("updated_at", "datetime(3)"),
    ]),
    indexes: Object.freeze([
      index("PRIMARY", 0, "migration_run_id"),
      index("uk_migration_run_request", 0, "contract_id", "request_id"),
      index("idx_migration_run_dispatch", 1, "status", "lease_expires_at", "migration_run_id"),
      index("idx_migration_run_snapshot", 1, "contract_id", "snapshot_id", "snapshot_revision"),
      index("idx_migration_run_replay_source", 1, "replay_source_run_id"),
      index("fk_migration_run_contract", 1, "contract_id", "contract_version", "contract_digest"),
    ]),
    checks: Object.freeze({
      chk_migration_run_mode: "13eb9f52c7a3fe418bccf394c725e7abb62d8df9dd88c5364ed7b48f1c369e20",
      chk_migration_run_status: "3dbb488ac0192b91a0a77966db0141a59e811d8766bf5d77e45a1a50018c4b34",
      chk_migration_run_digest_shape: "4008a2ca2e4ace6788edf2bb837b2d386e625d8932fcf29a5eca2516bc77f908",
      chk_migration_run_cursor_shape: "973de04cd45d5bb888a10c17ef7704704ce28fa2568ddd1d54dde67e719a02b3",
      chk_migration_run_replay_binding: "ab1e3349acd87229e9a55852f03ed16aaf1b767bf237aaae5b25d6fe99620eb1",
      chk_migration_run_lease_shape: "4b8065684a8a6831679ac76eb5569450eeb1964d725235d4e283c157852faad5",
      chk_migration_run_count_shape: "457997be507318423e151e8d896298c6b880faa5533d0ddd7bf32be443fb645d",
      chk_migration_run_terminal_shape: "9c855cda242c11e9fc2f9b203c920e5740b9e545c3406da72600361688e6de21",
      chk_migration_run_error_code: "9d9669484408240f576602594feb715d35d3e04bddac1d222307eabbc2edc902",
    }),
    foreignKeys: Object.freeze([
      foreignKey("fk_migration_run_contract", ["contract_id", "contract_version", "contract_digest"], "migration_contract_registry", ["contract_id", "contract_version", "contract_digest"]),
      foreignKey("fk_migration_run_replay_source", ["replay_source_run_id"], "migration_run", ["migration_run_id"]),
    ]),
  }),
  "030_migration_lineage.sql": Object.freeze({
    tableName: "migration_lineage",
    columns: Object.freeze([
      ascii("migration_lineage_id", "varchar(64)"),
      ascii("base_lineage_identity", "varchar(64)", { nullable: "YES" }),
      ascii("lineage_identity", "varchar(64)"),
      ascii("lineage_event_type", "varchar(32)"),
      column("event_sequence", "bigint unsigned"),
      ascii("migration_run_id", "varchar(64)"),
      ascii("contract_id", "varchar(96)"),
      column("contract_version", "int unsigned"),
      ascii("fact_type", "varchar(64)"),
      ascii("source_type", "varchar(96)"),
      ascii("source_id", "varchar(128)"),
      ascii("target_type", "varchar(96)"),
      ascii("target_id", "varchar(128)"),
      ascii("source_checksum", "char(64)"),
      ascii("target_checksum", "char(64)"),
      ascii("snapshot_id", "varchar(128)"),
      ascii("snapshot_revision", "varchar(128)"),
      ascii("batch_id", "varchar(128)"),
      ascii("request_id", "varchar(128)"),
      ascii("cursor_type", "varchar(64)"),
      ascii("cursor_value", "varchar(128)"),
      ascii("tie_breaker", "varchar(128)"),
      column("inclusive", "tinyint(1)"),
      ascii("target_schema_version", "varchar(64)"),
      ascii("status", "varchar(32)"),
      ascii("error_code", "varchar(64)", { nullable: "YES" }),
      column("replayed_at", "datetime(3)", { nullable: "YES" }),
      column("reversed_at", "datetime(3)", { nullable: "YES" }),
      column("created_at", "datetime(3)"),
    ]),
    indexes: Object.freeze([
      index("PRIMARY", 0, "migration_lineage_id"),
      index("uk_migration_lineage_base", 0, "base_lineage_identity"),
      index("uk_migration_lineage_sequence", 0, "lineage_identity", "event_sequence"),
      index("uk_migration_lineage_request", 0, "migration_run_id", "batch_id", "source_id", "lineage_event_type", "request_id"),
      index("idx_migration_lineage_run_status", 1, "migration_run_id", "status", "cursor_value", "tie_breaker"),
      index("idx_migration_lineage_source_target", 1, "contract_id", "source_type", "source_id", "target_schema_version"),
    ]),
    checks: Object.freeze({
      chk_migration_lineage_event_type: "7fa37f194a0dde0ee00bcf9d7f3924738587f933f9628f6c933d91c8a547bcea",
      chk_migration_lineage_status: "2cc6e9e6265f9ed7916230c3f914900ad01c6237f447cd4b4ef133e87abcb48e",
      chk_migration_lineage_identity_shape: "8a5be26cbc864e8cf013244acd282ac5b74795e2d1d0b64bebb99a9144ebffd5",
      chk_migration_lineage_checksum_shape: "56abf1166d686841ebaa14538e3e81a69e22d6d33b4a019049f48764788a8691",
      chk_migration_lineage_cursor_shape: "59219a78eb4e742921bfb7284f630a950d52f46dccbb2f417b9a531b6247dc05",
      chk_migration_lineage_temporal_shape: "1e98f4a78cf0f118a859fb4df394a2623312910f692b2797610fdc3b8e05e7af",
      chk_migration_lineage_error_shape: "33ed01b434655b404f23a36cb0444211d072847336889ae01ce7889ce84c3f85",
    }),
    foreignKeys: Object.freeze([
      foreignKey("fk_migration_lineage_run", ["migration_run_id"], "migration_run", ["migration_run_id"]),
    ]),
  }),
  "031_task_share_migration_projection.sql": Object.freeze({
    tableName: "task_share_migration_projection",
    columns: Object.freeze([
      ascii("target_record_id", "varchar(64)"),
      ascii("contract_id", "varchar(96)"),
      ascii("source_task_event_id", "varchar(32)"),
      ascii("target_schema_version", "varchar(64)"),
      ascii("task_type", "varchar(32)"),
      ascii("completion_event_type", "varchar(48)"),
      column("occurred_at", "datetime(3)"),
      ascii("source_checksum", "char(64)"),
      ascii("target_checksum", "char(64)"),
      column("created_at", "datetime(3)"),
    ]),
    indexes: Object.freeze([
      index("PRIMARY", 0, "target_record_id"),
      index("uk_task_share_migration_source_schema", 0, "contract_id", "source_task_event_id", "target_schema_version"),
    ]),
    checks: Object.freeze({
      chk_task_share_migration_scope: "675f07b5271c788ba0bee9dd3efcf6cb905b506b89f13643a758f11c597b3c92",
      chk_task_share_migration_checksum_shape: "56abf1166d686841ebaa14538e3e81a69e22d6d33b4a019049f48764788a8691",
    }),
    foreignKeys: Object.freeze([]),
  }),
  "032_v1_runtime_cycle.sql": Object.freeze({
    tableName: "v1_runtime_cycle",
    columns: Object.freeze([
      ascii("runtime_cycle_id", "char(64)"),
      ascii("environment_id", "varchar(96)"),
      ascii("schedule_id", "varchar(128)"),
      column("scheduled_at", "datetime(3)"),
      ascii("input_digest", "char(64)"),
      ascii("status", "varchar(32)"),
      ascii("lease_owner", "varchar(128)", { nullable: "YES" }),
      column("lease_expires_at", "datetime(3)", { nullable: "YES" }),
      column("lease_generation", "bigint unsigned", { defaultValue: "0" }),
      ascii("claim_digest", "char(64)"),
      ascii("finalization_digest", "char(64)", { nullable: "YES" }),
      ascii("result_digest", "char(64)", { nullable: "YES" }),
      column("blocker_count", "bigint unsigned", { defaultValue: "0" }),
      ascii("error_code", "varchar(64)", { nullable: "YES" }),
      column("claimed_at", "datetime(3)"),
      column("completed_at", "datetime(3)", { nullable: "YES" }),
      column("created_at", "datetime(3)"),
      column("updated_at", "datetime(3)"),
    ]),
    indexes: Object.freeze([
      index("PRIMARY", 0, "runtime_cycle_id"),
      index("uk_v1_runtime_cycle_schedule", 0, "environment_id", "schedule_id"),
      index(
        "uk_v1_runtime_cycle_scope_identity",
        0,
        "runtime_cycle_id",
        "environment_id",
        "schedule_id",
        "input_digest"
      ),
      index(
        "idx_v1_runtime_cycle_recovery",
        1,
        "environment_id",
        "status",
        "lease_expires_at",
        "runtime_cycle_id"
      ),
      index(
        "idx_v1_runtime_cycle_attestation",
        1,
        "environment_id",
        "status",
        "completed_at",
        "runtime_cycle_id"
      ),
    ]),
    checks: Object.freeze({
      chk_v1_runtime_cycle_status: "e12aca0df0da2a7407fb3a0a4c2f12900f7af8d73b5f09a428a83d68aca75536",
      chk_v1_runtime_cycle_digest_shape: "96c9a9771b26fe64066ea829acb8b334c3a607322de9001698f0e8a9776b6220",
      chk_v1_runtime_cycle_error_code: "ee8253795e50418f25f85ce4fe05bc33d5cd52d4d5c547d3e282bf6ea4120a4a",
      chk_v1_runtime_cycle_state_shape: "5e6b6fd9733590e9c65f859dcee9adfe6610b7da41484023654f2786ebf1ec8d",
    }),
    foreignKeys: Object.freeze([]),
  }),
  "033_v1_runtime_alert.sql": Object.freeze({
    tableName: "v1_runtime_alert",
    columns: Object.freeze([
      ascii("runtime_alert_id", "char(64)"),
      ascii("runtime_cycle_id", "char(64)"),
      ascii("environment_id", "varchar(96)"),
      ascii("schedule_id", "varchar(128)"),
      ascii("input_digest", "char(64)"),
      ascii("alert_code", "varchar(64)"),
      ascii("severity", "varchar(16)"),
      ascii("dedupe_digest", "char(64)"),
      column("observed_at", "datetime(3)"),
      column("created_at", "datetime(3)"),
    ]),
    indexes: Object.freeze([
      index("PRIMARY", 0, "runtime_alert_id"),
      index("uk_v1_runtime_alert_dedupe", 0, "runtime_cycle_id", "dedupe_digest"),
      index(
        "idx_v1_runtime_alert_open",
        1,
        "environment_id",
        "severity",
        "observed_at",
        "runtime_alert_id"
      ),
      index(
        "fk_v1_runtime_alert_cycle",
        1,
        "runtime_cycle_id",
        "environment_id",
        "schedule_id",
        "input_digest"
      ),
    ]),
    checks: Object.freeze({
      chk_v1_runtime_alert_severity: "2da26ba8fd8c090a41a19b8af82c8eda4504cf8dd8cf1241e2369eaf7c2fff7c",
      chk_v1_runtime_alert_digest_shape: "60c2f35bdef712343586d25849b61858daed15005041fe50caab46ebaf2c8aaf",
      chk_v1_runtime_alert_code: "53b2a6fde2e75755416144dd75a1f4d40d0e5a002fe18c0bab80d2f6b4c8a42f",
    }),
    foreignKeys: Object.freeze([
      foreignKey(
        "fk_v1_runtime_alert_cycle",
        ["runtime_cycle_id", "environment_id", "schedule_id", "input_digest"],
        "v1_runtime_cycle",
        ["runtime_cycle_id", "environment_id", "schedule_id", "input_digest"]
      ),
    ]),
  }),
  "035_activity_publication_session_event.sql": Object.freeze({
    tableName: "activity_definition_version",
    alter: true,
    anchorColumn: "publish_owner_signer_ref",
    requiredTableCollation: "utf8mb4_unicode_ci",
    requiredTableEngine: "INNODB",
    requiredColumns: Object.freeze([
      ascii("status", "varchar(16)"),
      ascii("content_approval_ref", "varchar(160)"),
      ascii("publish_owner_signer_ref", "varchar(160)", { nullable: "YES" }),
    ]),
    columns: Object.freeze([
      ascii("publication_authorization_adapter_id", "varchar(160)", { nullable: "YES" }),
      ascii("publication_authorization_decision_ref", "varchar(160)", { nullable: "YES" }),
      ascii("publication_authorized_principal_ref", "varchar(160)", { nullable: "YES" }),
      ascii("controlled_approval_ref", "varchar(160)", { nullable: "YES" }),
      ascii("content_authorization_digest", "char(64)", { nullable: "YES" }),
      ascii("ued_acceptance_digest", "char(64)", { nullable: "YES" }),
      ascii("photography_authorization_digest", "char(64)", { nullable: "YES" }),
      ascii("artifact_provenance_digest", "char(64)", { nullable: "YES" }),
      column("authorization_verified_at", "datetime(3)", { nullable: "YES" }),
    ]),
    indexes: Object.freeze([
      index(
        "uk_activity_definition_publication_decision",
        0,
        "publication_authorization_adapter_id",
        "publication_authorization_decision_ref"
      ),
    ]),
    checks: Object.freeze({
      chk_activity_definition_authorization_shape: "347e8b5deb94c1e591a54c9e926240ed481ed155b248d745bdc26ffc3ecbf088",
    }),
    precondition: Object.freeze({
      columns: Object.freeze([]),
      indexes: Object.freeze([]),
      checks: Object.freeze({}),
    }),
    foreignKeys: Object.freeze([]),
  }),
  "036_activity_enrollment_event_generation_stage.sql": Object.freeze({
    tableName: "activity_enrollment_event",
    alter: true,
    anchorColumn: "root_user_id",
    requiredTableCollation: "utf8mb4_unicode_ci",
    requiredTableEngine: "INNODB",
    requiredColumns: Object.freeze([
      unicode("activity_enrollment_id", "varchar(64)"),
      unicode("activity_session_id", "varchar(64)"),
      unicode("root_user_id", "varchar(32)"),
      column("event_sequence", "int unsigned"),
      ascii("operation", "varchar(32)"),
    ]),
    columns: Object.freeze([
      column("attempt_generation", "int unsigned", { nullable: "YES" }),
    ]),
    indexes: Object.freeze([]),
    checks: Object.freeze({}),
    precondition: Object.freeze({
      columns: Object.freeze([]),
      indexes: Object.freeze([]),
      checks: Object.freeze({}),
    }),
    foreignKeys: Object.freeze([]),
  }),
  "038_activity_enrollment_event_generation_enforce.sql": Object.freeze({
    tableName: "activity_enrollment_event",
    alter: true,
    anchorColumn: "root_user_id",
    requiredTableCollation: "utf8mb4_unicode_ci",
    requiredTableEngine: "INNODB",
    requiredColumns: Object.freeze([
      unicode("activity_enrollment_id", "varchar(64)"),
      unicode("activity_session_id", "varchar(64)"),
      unicode("root_user_id", "varchar(32)"),
      column("event_sequence", "int unsigned"),
      ascii("operation", "varchar(32)"),
    ]),
    columns: Object.freeze([
      column("attempt_generation", "int unsigned"),
    ]),
    indexes: Object.freeze([]),
    checks: Object.freeze({
      chk_activity_enrollment_event_generation: "6bac59dc87f6f3d003a5056774b5471f346df2c586405b746910e10a7ebdcead",
    }),
    precondition: Object.freeze({
      columns: Object.freeze([
        column("attempt_generation", "int unsigned", { nullable: "YES" }),
      ]),
      indexes: Object.freeze([]),
      checks: Object.freeze({}),
    }),
    foreignKeys: Object.freeze([]),
  }),
  "039_activity_session_event.sql": Object.freeze({
    tableName: "activity_session_event",
    tableCollation: "utf8mb4_unicode_ci",
    columns: Object.freeze([
      unicode("activity_session_event_id", "varchar(64)"),
      unicode("activity_session_id", "varchar(64)"),
      column("event_sequence", "int unsigned"),
      ascii("operation", "varchar(32)"),
      ascii("from_status", "varchar(16)"),
      ascii("to_status", "varchar(16)"),
      ascii("reason_code", "varchar(32)"),
      unicode("reason_detail", "varchar(512)", { nullable: "YES" }),
      ascii("request_id", "varchar(128)"),
      ascii("actor_ref", "varchar(160)"),
      column("occurred_at", "datetime(3)"),
    ]),
    indexes: Object.freeze([
      index("PRIMARY", 0, "activity_session_event_id"),
      index("uk_activity_session_event_request", 0, "request_id"),
      index("uk_activity_session_event_sequence", 0, "activity_session_id", "event_sequence"),
      index("uk_activity_session_event_operation", 0, "activity_session_id", "operation"),
      index("idx_activity_session_event_occurred", 1, "occurred_at", "activity_session_id"),
    ]),
    checks: Object.freeze({
      chk_activity_session_event_sequence: "064f672166ac34eb8a13b6e0b5273c80ba0dbf9a9d35d5a7b789967859bcb8bb",
      chk_activity_session_event_operation: "0d2a29867b64da8c531d32ca5bdb9de66480c2762cffa82b299eb8d29fc0143b",
      chk_activity_session_event_from_status: "0784a4b939c4a134846b4b7c35d788eb9915c549eb91d21d15e6eb67f8aa55a1",
      chk_activity_session_event_to_status: "a80174ce5ae3b9cbb17ed4bbb4cc178f152ddd96486d57180ac7b869695bc1e0",
      chk_activity_session_event_reason: "38507c3ee9048e0483967a71cb334479bdda19e2c265a8ea0e137f8f2a6cf86b",
      chk_activity_session_event_other_reason: "c2a31dd4e74194f59495343012a01478fbf7eada1e9937b96b078142d51db2c7",
    }),
    foreignKeys: Object.freeze([
      foreignKey(
        "fk_activity_session_event_session",
        ["activity_session_id"],
        "activity_session",
        ["activity_session_id"]
      ),
    ]),
  }),
  "040_activity_p0_content_and_session_policy.sql": Object.freeze({
    structures: Object.freeze([
      Object.freeze({
        tableName: "activity_definition_version",
        alter: true,
        anchorColumn: "summary",
        requiredTableCollation: "utf8mb4_unicode_ci",
        requiredTableEngine: "INNODB",
        requiredColumns: Object.freeze([
          unicode("summary", "varchar(512)"),
        ]),
        columns: Object.freeze([
          unicode("objective", "varchar(1024)", { defaultValue: "" }),
          unicode("audience", "varchar(1024)", { defaultValue: "" }),
          unicode("agenda", "varchar(2048)", { defaultValue: "" }),
          unicode("organizer", "varchar(256)", { defaultValue: "" }),
          unicode("fee_description", "varchar(256)", { defaultValue: "" }),
          unicode("bring_items", "varchar(1024)", { defaultValue: "" }),
          unicode("cancel_policy", "varchar(1024)", { defaultValue: "" }),
          unicode("privacy_notice_text", "varchar(2048)", { defaultValue: "" }),
          unicode("photography_notice_text", "varchar(2048)", { defaultValue: "" }),
          unicode("contact_display", "varchar(256)", { defaultValue: "" }),
        ]),
        indexes: Object.freeze([]),
        checks: Object.freeze({}),
        precondition: Object.freeze({
          columns: Object.freeze([]),
          indexes: Object.freeze([]),
          checks: Object.freeze({}),
        }),
        foreignKeys: Object.freeze([]),
      }),
      Object.freeze({
        tableName: "activity_definition_version",
        alter: true,
        anchorColumn: "prebound_task_definition_id",
        requiredTableCollation: "utf8mb4_unicode_ci",
        requiredTableEngine: "INNODB",
        requiredColumns: Object.freeze([
          unicode("prebound_task_definition_id", "varchar(32)", { nullable: "YES" }),
        ]),
        columns: Object.freeze([
          ascii("prebound_task_definition_version", "varchar(64)", { nullable: "YES" }),
        ]),
        indexes: Object.freeze([]),
        checks: Object.freeze({}),
        precondition: Object.freeze({
          columns: Object.freeze([]),
          indexes: Object.freeze([]),
          checks: Object.freeze({}),
        }),
        foreignKeys: Object.freeze([]),
      }),
    ]),
  }),
  "041_task_activity_assignment.sql": Object.freeze({
    tableName: "task_activity_assignment",
    tableCollation: "utf8mb4_unicode_ci",
    columns: Object.freeze([
      ascii("task_activity_assignment_id", "varchar(64)"),
      unicode("root_user_id", "varchar(32)"),
      unicode("task_definition_id", "varchar(32)"),
      ascii("task_definition_version", "varchar(64)"),
      unicode("activity_enrollment_id", "varchar(64)"),
      unicode("activity_session_id", "varchar(64)"),
      ascii("initial_status", "varchar(32)"),
      utf8("source_confirmed_event_id", "varchar(64)"),
      ascii("source_confirmed_event_type", "varchar(128)"),
      column("source_confirmed_at", "datetime(3)"),
      column("created_at", "datetime(3)"),
      column("updated_at", "datetime(3)"),
    ]),
    indexes: Object.freeze([
      index("PRIMARY", 0, "task_activity_assignment_id"),
      index(
        "uk_task_activity_assignment_source",
        0,
        "activity_enrollment_id",
        "task_definition_id",
        "task_definition_version"
      ),
      index("uk_task_activity_assignment_confirmed_event", 0, "source_confirmed_event_id"),
      index("idx_task_activity_assignment_user_status", 1, "root_user_id", "initial_status", "updated_at"),
      index("idx_task_activity_assignment_session", 1, "activity_session_id", "initial_status"),
      index("fk_task_activity_assignment_definition", 1, "task_definition_id"),
    ]),
    checks: Object.freeze({
      chk_task_activity_assignment_initial_status: "707cd822a6ca1aafcf5b2af295a5ef7e3c478520f0bc966dd7dd2e644e459772",
      chk_task_activity_assignment_confirmed_contract: "a78c5077ef80a4ef9340c0b1a47c084505047e0b29b2ed615a27319996d46a34",
    }),
    foreignKeys: Object.freeze([
      foreignKey(
        "fk_task_activity_assignment_definition",
        ["task_definition_id"],
        "task_definition",
        ["task_definition_id"]
      ),
      foreignKey(
        "fk_task_activity_assignment_enrollment",
        ["activity_enrollment_id"],
        "activity_enrollment",
        ["activity_enrollment_id"]
      ),
      foreignKey(
        "fk_task_activity_assignment_session",
        ["activity_session_id"],
        "activity_session",
        ["activity_session_id"]
      ),
      foreignKey("fk_task_activity_assignment_user", ["root_user_id"], "root_user", ["root_user_id"]),
    ]),
  }),
  "042_task_source_invalidation_event.sql": Object.freeze({
    tableName: "task_source_invalidation_event",
    tableCollation: "utf8mb4_unicode_ci",
    columns: Object.freeze([
      ascii("task_source_invalidation_event_id", "varchar(64)"),
      ascii("task_activity_assignment_id", "varchar(64)"),
      utf8("source_event_id", "varchar(64)"),
      ascii("source_event_type", "varchar(128)"),
      ascii("reason_code", "varchar(32)"),
      column("occurred_at", "datetime(3)"),
      column("created_at", "datetime(3)"),
    ]),
    indexes: Object.freeze([
      index("PRIMARY", 0, "task_source_invalidation_event_id"),
      index("uk_task_source_invalidation_source_event", 0, "source_event_id"),
      index(
        "uk_task_source_invalidation_assignment",
        0,
        "task_activity_assignment_id",
        "source_event_id"
      ),
      index("idx_task_source_invalidation_occurred", 1, "occurred_at", "task_activity_assignment_id"),
    ]),
    checks: Object.freeze({
      chk_task_source_invalidation_event_type: "18af7ef1acc182bcb2ac9fb82a44d24fc0966872d31bb43b3f862e9d760ba1c9",
      chk_task_source_invalidation_reason: "edc9ffd3aadeab93d09cf2413453d63afedbfcf543feae45b1e34dbc84204325",
    }),
    foreignKeys: Object.freeze([
      foreignKey(
        "fk_task_source_invalidation_assignment",
        ["task_activity_assignment_id"],
        "task_activity_assignment",
        ["task_activity_assignment_id"]
      ),
    ]),
  }),
  "043_activity_session_cancel_close_stage.sql": Object.freeze({
    tableName: "activity_session",
    alter: true,
    anchorColumn: "registration_close_at",
    requiredTableCollation: "utf8mb4_unicode_ci",
    requiredTableEngine: "INNODB",
    requiredColumns: Object.freeze([
      column("registration_close_at", "datetime(3)"),
    ]),
    columns: Object.freeze([
      column("cancel_close_at", "datetime(3)", { nullable: "YES" }),
    ]),
    indexes: Object.freeze([]),
    checks: Object.freeze({}),
    precondition: Object.freeze({
      columns: Object.freeze([]),
      indexes: Object.freeze([]),
      checks: Object.freeze({}),
    }),
    foreignKeys: Object.freeze([]),
  }),
  "044_activity_session_cancel_close_backfill.sql": Object.freeze({
    tableName: "activity_session",
    alter: true,
    allowAdditional: true,
    anchorColumn: "registration_close_at",
    requiredTableCollation: "utf8mb4_unicode_ci",
    requiredTableEngine: "INNODB",
    requiredColumns: Object.freeze([
      column("registration_close_at", "datetime(3)"),
    ]),
    columns: Object.freeze([
      column("cancel_close_at", "datetime(3)", { nullable: "YES" }),
    ]),
    indexes: Object.freeze([]),
    checks: Object.freeze({}),
    foreignKeys: Object.freeze([]),
    dataInspection: "ACTIVITY_SESSION_CANCEL_CLOSE_BACKFILLED",
  }),
  "045_activity_session_policy_enforce.sql": Object.freeze({
    tableName: "activity_session",
    alter: true,
    anchorColumn: "registration_close_at",
    requiredTableCollation: "utf8mb4_unicode_ci",
    requiredTableEngine: "INNODB",
    requiredColumns: Object.freeze([
      unicode("activity_version_id", "varchar(64)"),
      column("registration_open_at", "datetime(3)"),
      column("registration_close_at", "datetime(3)"),
      column("session_start_at", "datetime(3)"),
    ]),
    columns: Object.freeze([
      column("cancel_close_at", "datetime(3)"),
    ]),
    indexes: Object.freeze([
      index("uk_activity_session_business_time", 0, "activity_version_id", "session_start_at"),
    ]),
    checks: Object.freeze({
      chk_activity_session_cancel_window: "6e8d51253a9dde6758ca2dd97fd4ac99a8cb7d08a6a6bbf1e35208a5e60354ae",
    }),
    precondition: Object.freeze({
      columns: Object.freeze([
        column("cancel_close_at", "datetime(3)", { nullable: "YES" }),
      ]),
      indexes: Object.freeze([]),
      checks: Object.freeze({}),
    }),
    foreignKeys: Object.freeze([]),
  }),
  "046_task_event_idempotency_scope_stage.sql": Object.freeze({
    tableName: "task_event",
    alter: true,
    anchorColumn: "idempotency_key",
    requiredTableCollation: "utf8mb4_unicode_ci",
    requiredTableEngine: "INNODB",
    requiredColumns: Object.freeze([
      unicode("root_user_id", "varchar(32)"),
    ]),
    columns: Object.freeze([
      ascii("idempotency_operation", "varchar(64)", {
        nullable: "YES",
        defaultValue: "RECORD_TASK_EVENT:v1",
      }),
      ascii("request_canonical_version", "varchar(32)", { nullable: "YES" }),
      ascii("request_digest", "char(64)", { nullable: "YES" }),
      ascii("request_digest_scheme", "varchar(64)", { nullable: "YES" }),
      ascii("request_digest_key_id", "varchar(128)", { nullable: "YES" }),
      column("occurred_at_client_supplied", "tinyint(1)", { nullable: "YES" }),
    ]),
    indexes: Object.freeze([]),
    checks: Object.freeze({}),
    precondition: Object.freeze({
      columns: Object.freeze([]),
      indexes: Object.freeze([]),
      checks: Object.freeze({}),
    }),
    foreignKeys: Object.freeze([]),
  }),
  "048_task_event_idempotency_scope_enforce.sql": Object.freeze({
    tableName: "task_event",
    alter: true,
    anchorColumn: "payload_json",
    requiredTableCollation: "utf8mb4_unicode_ci",
    requiredTableEngine: "INNODB",
    requiredColumns: Object.freeze([
      unicode("root_user_id", "varchar(32)"),
    ]),
    columns: Object.freeze([
      ascii("idempotency_key", "varchar(128)"),
      ascii("idempotency_operation", "varchar(64)", { defaultValue: "RECORD_TASK_EVENT:v1" }),
      ascii("request_canonical_version", "varchar(32)", { nullable: "YES" }),
      ascii("request_digest", "char(64)", { nullable: "YES" }),
      ascii("request_digest_scheme", "varchar(64)", { nullable: "YES" }),
      ascii("request_digest_key_id", "varchar(128)", { nullable: "YES" }),
      column("occurred_at_client_supplied", "tinyint(1)", { nullable: "YES" }),
    ]),
    indexes: Object.freeze([
      index(
        "uk_task_event_idempotency_scope",
        0,
        "root_user_id",
        "idempotency_operation",
        "idempotency_key"
      ),
      index(
        "idx_task_event_request_digest_crypto",
        1,
        "request_digest_scheme",
        "request_digest_key_id",
        "task_event_id"
      ),
    ]),
    checks: Object.freeze({
      chk_task_event_idempotency_operation: "ba7f6db5c739199ecc0ddd36c139541811b867f897fff959740bf17f6c0d0757",
      chk_task_event_request_digest_metadata: "6d8debe354d57814e8d65e3ed02e9c3ec05ee34ef9f1bc093b2275be66076e9f",
      chk_task_event_occurred_at_provenance: "7bb87a6bea1516399bc9ad42aa4f38df9312734680ca437f73f2f0d6b6f42d26",
    }),
    precondition: Object.freeze({
      columns: Object.freeze([
        unicode("idempotency_key", "varchar(128)"),
        ascii("idempotency_operation", "varchar(64)", {
          nullable: "YES",
          defaultValue: "RECORD_TASK_EVENT:v1",
        }),
        ascii("request_canonical_version", "varchar(32)", { nullable: "YES" }),
        ascii("request_digest", "char(64)", { nullable: "YES" }),
        ascii("request_digest_scheme", "varchar(64)", { nullable: "YES" }),
        ascii("request_digest_key_id", "varchar(128)", { nullable: "YES" }),
        column("occurred_at_client_supplied", "tinyint(1)", { nullable: "YES" }),
      ]),
      indexes: Object.freeze([]),
      checks: Object.freeze({}),
    }),
    foreignKeys: Object.freeze([]),
  }),
  "049_wechat_unionid_provenance_stage.sql": Object.freeze({
    tableName: "wechat_identity",
    alter: true,
    anchorColumn: "unionid_status",
    requiredTableCollation: "utf8mb4_unicode_ci",
    requiredTableEngine: "INNODB",
    requiredColumns: Object.freeze([unicode("root_user_id", "varchar(32)")]),
    columns: Object.freeze([
      ascii("unionid_trust_status", "varchar(16)", { nullable: "YES" }),
      ascii("unionid_provenance_source", "varchar(32)", { nullable: "YES" }),
      column("unionid_verified_at", "datetime(3)", { nullable: "YES" }),
      ascii("unionid_provenance_canonical_version", "varchar(32)", { nullable: "YES" }),
      ascii("unionid_provenance_digest", "char(64)", { nullable: "YES" }),
      ascii("unionid_provenance_digest_scheme", "varchar(64)", { nullable: "YES" }),
      ascii("unionid_provenance_key_id", "varchar(128)", { nullable: "YES" }),
    ]),
    indexes: Object.freeze([]),
    checks: Object.freeze({}),
    precondition: Object.freeze({ columns: Object.freeze([]), indexes: Object.freeze([]), checks: Object.freeze({}) }),
    foreignKeys: Object.freeze([]),
  }),
  "051_wechat_unionid_provenance_enforce.sql": Object.freeze({
    tableName: "wechat_identity",
    alter: true,
    anchorColumn: "unionid_status",
    requiredTableCollation: "utf8mb4_unicode_ci",
    requiredTableEngine: "INNODB",
    requiredColumns: Object.freeze([unicode("root_user_id", "varchar(32)")]),
    columns: Object.freeze([
      ascii("unionid_trust_status", "varchar(16)", { defaultValue: "UNVERIFIED" }),
      ascii("unionid_provenance_source", "varchar(32)", { nullable: "YES" }),
      column("unionid_verified_at", "datetime(3)", { nullable: "YES" }),
      ascii("unionid_provenance_canonical_version", "varchar(32)", { nullable: "YES" }),
      ascii("unionid_provenance_digest", "char(64)", { nullable: "YES" }),
      ascii("unionid_provenance_digest_scheme", "varchar(64)", { nullable: "YES" }),
      ascii("unionid_provenance_key_id", "varchar(128)", { nullable: "YES" }),
    ]),
    indexes: Object.freeze([
      index("uk_wechat_identity_root_app", 0, "root_user_id", "app_code"),
      index("idx_wechat_identity_unionid_authority", 1, "unionid", "unionid_trust_status", "root_user_id"),
      index("idx_wechat_identity_provenance_crypto", 1, "unionid_provenance_digest_scheme", "unionid_provenance_key_id", "wechat_identity_id"),
    ]),
    checks: Object.freeze({
      chk_wechat_identity_unionid_provenance: "4f68cd738e62224a5b1c224cd057616f6bdbf78c113cdfc7c198d19c0622b40c",
    }),
    precondition: Object.freeze({
      columns: Object.freeze([
        ascii("unionid_trust_status", "varchar(16)", { nullable: "YES" }),
        ascii("unionid_provenance_source", "varchar(32)", { nullable: "YES" }),
        column("unionid_verified_at", "datetime(3)", { nullable: "YES" }),
        ascii("unionid_provenance_canonical_version", "varchar(32)", { nullable: "YES" }),
        ascii("unionid_provenance_digest", "char(64)", { nullable: "YES" }),
        ascii("unionid_provenance_digest_scheme", "varchar(64)", { nullable: "YES" }),
        ascii("unionid_provenance_key_id", "varchar(128)", { nullable: "YES" }),
      ]),
      indexes: Object.freeze([]),
      checks: Object.freeze({}),
    }),
    foreignKeys: Object.freeze([]),
  }),
  "052_notification_recipient_binding_legacy_stage.sql": Object.freeze({
    tableName: "notification_subscription_grant",
    alter: true,
    anchorColumn: "source_channel",
    columns: Object.freeze([
      ascii("recipient_binding_status", "varchar(16)", { nullable: "YES" }),
      ascii("recipient_wechat_identity_id", "varchar(32)", { nullable: "YES" }),
      ascii("recipient_app_code", "varchar(32)", { nullable: "YES" }),
      ascii("recipient_binding_canonical_version", "varchar(32)", { nullable: "YES" }),
      ascii("recipient_binding_digest", "char(64)", { nullable: "YES" }),
      ascii("recipient_binding_digest_scheme", "varchar(64)", { nullable: "YES" }),
      ascii("recipient_binding_key_id", "varchar(128)", { nullable: "YES" }),
    ]),
    indexes: Object.freeze([]), checks: Object.freeze({}), foreignKeys: Object.freeze([]),
  }),
  "053_notification_recipient_binding_v1_stage.sql": Object.freeze({
    tableName: "notification_subscription_grant_v1",
    alter: true,
    anchorColumn: "review_required_at",
    columns: Object.freeze([
      ascii("recipient_binding_status", "varchar(16)", { nullable: "YES" }),
      ascii("recipient_wechat_identity_id", "varchar(32)", { nullable: "YES" }),
      ascii("recipient_app_code", "varchar(32)", { nullable: "YES" }),
      ascii("recipient_binding_canonical_version", "varchar(32)", { nullable: "YES" }),
      ascii("recipient_binding_digest", "char(64)", { nullable: "YES" }),
      ascii("recipient_binding_digest_scheme", "varchar(64)", { nullable: "YES" }),
      ascii("recipient_binding_key_id", "varchar(128)", { nullable: "YES" }),
    ]),
    indexes: Object.freeze([]), checks: Object.freeze({}), foreignKeys: Object.freeze([]),
  }),
  "056_notification_recipient_binding_legacy_enforce.sql": Object.freeze({
    tableName: "notification_subscription_grant",
    alter: true,
    anchorColumn: "source_channel",
    columns: Object.freeze([
      ascii("recipient_binding_status", "varchar(16)", { defaultValue: "UNVERIFIED" }),
      ascii("recipient_wechat_identity_id", "varchar(32)", { nullable: "YES" }),
      ascii("recipient_app_code", "varchar(32)", { nullable: "YES" }),
      ascii("recipient_binding_canonical_version", "varchar(32)", { nullable: "YES" }),
      ascii("recipient_binding_digest", "char(64)", { nullable: "YES" }),
      ascii("recipient_binding_digest_scheme", "varchar(64)", { nullable: "YES" }),
      ascii("recipient_binding_key_id", "varchar(128)", { nullable: "YES" }),
    ]),
    indexes: Object.freeze([
      index("idx_notification_recipient_binding_crypto", 1, "recipient_binding_digest_scheme", "recipient_binding_key_id", "notification_subscription_grant_id"),
      index("idx_notification_recipient_identity", 1, "recipient_wechat_identity_id", "recipient_binding_status", "notification_subscription_grant_id"),
    ]),
    checks: Object.freeze({ chk_notification_recipient_binding: "9ce2707d8b270dd117dfbb88c17cb108f52509e59ec8b897760806d7862a654d" }),
    precondition: Object.freeze({
      columns: Object.freeze([
        ascii("recipient_binding_status", "varchar(16)", { nullable: "YES" }),
        ascii("recipient_wechat_identity_id", "varchar(32)", { nullable: "YES" }),
        ascii("recipient_app_code", "varchar(32)", { nullable: "YES" }),
        ascii("recipient_binding_canonical_version", "varchar(32)", { nullable: "YES" }),
        ascii("recipient_binding_digest", "char(64)", { nullable: "YES" }),
        ascii("recipient_binding_digest_scheme", "varchar(64)", { nullable: "YES" }),
        ascii("recipient_binding_key_id", "varchar(128)", { nullable: "YES" }),
      ]),
      indexes: Object.freeze([]), checks: Object.freeze({}),
    }),
    foreignKeys: Object.freeze([]),
  }),
  "057_notification_recipient_binding_v1_enforce.sql": Object.freeze({
    tableName: "notification_subscription_grant_v1",
    alter: true,
    anchorColumn: "review_required_at",
    columns: Object.freeze([
      ascii("recipient_binding_status", "varchar(16)", { defaultValue: "UNVERIFIED" }),
      ascii("recipient_wechat_identity_id", "varchar(32)", { nullable: "YES" }),
      ascii("recipient_app_code", "varchar(32)", { nullable: "YES" }),
      ascii("recipient_binding_canonical_version", "varchar(32)", { nullable: "YES" }),
      ascii("recipient_binding_digest", "char(64)", { nullable: "YES" }),
      ascii("recipient_binding_digest_scheme", "varchar(64)", { nullable: "YES" }),
      ascii("recipient_binding_key_id", "varchar(128)", { nullable: "YES" }),
    ]),
    indexes: Object.freeze([
      index("idx_notification_recipient_binding_v1_crypto", 1, "recipient_binding_digest_scheme", "recipient_binding_key_id", "notification_subscription_grant_id"),
      index("idx_notification_recipient_identity_v1", 1, "recipient_wechat_identity_id", "recipient_binding_status", "notification_subscription_grant_id"),
    ]),
    checks: Object.freeze({ chk_notification_recipient_binding_v1: "9ce2707d8b270dd117dfbb88c17cb108f52509e59ec8b897760806d7862a654d" }),
    precondition: Object.freeze({
      columns: Object.freeze([
        ascii("recipient_binding_status", "varchar(16)", { nullable: "YES" }),
        ascii("recipient_wechat_identity_id", "varchar(32)", { nullable: "YES" }),
        ascii("recipient_app_code", "varchar(32)", { nullable: "YES" }),
        ascii("recipient_binding_canonical_version", "varchar(32)", { nullable: "YES" }),
        ascii("recipient_binding_digest", "char(64)", { nullable: "YES" }),
        ascii("recipient_binding_digest_scheme", "varchar(64)", { nullable: "YES" }),
        ascii("recipient_binding_key_id", "varchar(128)", { nullable: "YES" }),
      ]),
      indexes: Object.freeze([]), checks: Object.freeze({}),
    }),
    foreignKeys: Object.freeze([]),
  }),
  "058_notification_provider_call_fence_stage.sql": Object.freeze({
    tableName: "notification_send_attempt",
    alter: true,
    anchorColumn: "request_digest",
    columns: Object.freeze([
      ascii("provider_call_state", "varchar(24)", { nullable: "YES" }),
      ascii("provider_call_owner", "varchar(32)", { nullable: "YES" }),
      column("provider_call_lease_expires_at", "datetime(3)", { nullable: "YES" }),
      column("provider_call_generation", "bigint unsigned", { nullable: "YES" }),
      column("provider_call_started_at", "datetime(3)", { nullable: "YES" }),
    ]),
    indexes: Object.freeze([]),
    checks: Object.freeze({}),
    foreignKeys: Object.freeze([]),
  }),
  "060_notification_provider_call_fence_enforce.sql": Object.freeze({
    tableName: "notification_send_attempt",
    alter: true,
    anchorColumn: "request_digest",
    columns: Object.freeze([
      ascii("provider_call_state", "varchar(24)"),
      ascii("provider_call_owner", "varchar(32)", { nullable: "YES" }),
      column("provider_call_lease_expires_at", "datetime(3)", { nullable: "YES" }),
      column("provider_call_generation", "bigint unsigned", { defaultValue: "0" }),
      column("provider_call_started_at", "datetime(3)", { nullable: "YES" }),
    ]),
    indexes: Object.freeze([
      index(
        "idx_notification_provider_call_recovery",
        1,
        "status",
        "provider_call_state",
        "provider_call_lease_expires_at",
        "notification_send_attempt_id"
      ),
      index(
        "idx_notification_provider_call_owner",
        1,
        "provider_call_owner",
        "provider_call_generation",
        "notification_send_attempt_id"
      ),
    ]),
    checks: Object.freeze({
      chk_notification_provider_call_fence: "ab2f5c6cf2b26ec2735fcf356ffb2499f096b24c503d0711c48727aaf8542dc3",
    }),
    precondition: Object.freeze({
      columns: Object.freeze([
        ascii("provider_call_state", "varchar(24)", { nullable: "YES" }),
        ascii("provider_call_owner", "varchar(32)", { nullable: "YES" }),
        column("provider_call_lease_expires_at", "datetime(3)", { nullable: "YES" }),
        column("provider_call_generation", "bigint unsigned", { nullable: "YES" }),
        column("provider_call_started_at", "datetime(3)", { nullable: "YES" }),
      ]),
      indexes: Object.freeze([]),
      checks: Object.freeze({}),
    }),
    foreignKeys: Object.freeze([]),
  }),
  "061_v1_runtime_alert_delivery.sql": Object.freeze({
    tableName: "v1_runtime_alert_delivery",
    columns: Object.freeze([
      ascii("runtime_alert_delivery_id", "char(64)"),
      ascii("runtime_alert_id", "char(64)"),
      ascii("environment_id", "varchar(96)"),
      ascii("registration_mode", "varchar(16)"),
      ascii("receiver_binding_authority_version", "varchar(48)"),
      ascii("receiver_binding_ref", "varchar(128)"),
      ascii("receiver_binding_digest", "char(64)"),
      ascii("receiver_binding_digest_scheme", "varchar(32)"),
      ascii("receiver_binding_digest_key_id", "varchar(64)"),
      ascii("payload_schema_version", "varchar(48)"),
      ascii("payload_canonical_version", "varchar(32)"),
      ascii("payload_digest", "char(64)"),
      ascii("payload_digest_scheme", "varchar(32)"),
      ascii("payload_digest_key_id", "varchar(64)"),
      ascii("slo_class", "varchar(32)"),
      column("slo_target_seconds", "int unsigned"),
      ascii("retry_policy_version", "varchar(48)"),
      column("maximum_attempts", "tinyint unsigned"),
      ascii("status", "varchar(24)"),
      column("attempt_count", "tinyint unsigned", { defaultValue: "0" }),
      column("available_at", "datetime(3)"),
      ascii("lease_owner", "varchar(128)", { nullable: "YES" }),
      column("lease_expires_at", "datetime(3)", { nullable: "YES" }),
      column("lease_generation", "bigint unsigned", { defaultValue: "0" }),
      column("provider_started_at", "datetime(3)", { nullable: "YES" }),
      column("provider_completed_at", "datetime(3)", { nullable: "YES" }),
      ascii("receipt_digest", "char(64)", { nullable: "YES" }),
      ascii("receipt_digest_scheme", "varchar(32)", { nullable: "YES" }),
      ascii("receipt_digest_key_id", "varchar(64)", { nullable: "YES" }),
      ascii("stable_error_code", "varchar(64)", { nullable: "YES" }),
      column("created_at", "datetime(3)"),
      column("updated_at", "datetime(3)"),
    ]),
    indexes: Object.freeze([
      index("PRIMARY", 0, "runtime_alert_delivery_id"),
      index(
        "uk_v1_runtime_alert_delivery_alert_authority",
        0,
        "runtime_alert_id"
      ),
      index(
        "idx_v1_runtime_alert_delivery_due",
        1,
        "environment_id",
        "registration_mode",
        "receiver_binding_ref",
        "receiver_binding_authority_version",
        "status",
        "available_at",
        "slo_target_seconds",
        "runtime_alert_delivery_id"
      ),
      index(
        "idx_v1_runtime_alert_delivery_recovery",
        1,
        "environment_id",
        "registration_mode",
        "receiver_binding_ref",
        "receiver_binding_authority_version",
        "status",
        "lease_expires_at",
        "runtime_alert_delivery_id"
      ),
      index(
        "idx_v1_runtime_alert_delivery_crypto",
        1,
        "receiver_binding_digest_key_id",
        "payload_digest_key_id",
        "receipt_digest_key_id",
        "runtime_alert_delivery_id"
      ),
    ]),
    checks: Object.freeze({
      chk_v1_runtime_alert_delivery_status: "66dae938d545586b9737cc2c72b043880085b85436ffe393b8bfd9e9435481dd",
      chk_v1_runtime_alert_delivery_identity: "c0c568dc280861d496170c0feabba77c23dbef3101fa2736be1519250210cb46",
      chk_v1_runtime_alert_delivery_authority: "31189629a4749827f80cf57537423aec7cefd92064124bf09b0479bfdfd435e9",
      chk_v1_runtime_alert_delivery_payload: "62bb8f48c5b19c1042873057d51d09987bd57a94ca44572285b9c227a421c462",
      chk_v1_runtime_alert_delivery_slo: "1285b31d5b115eb57cb596f1c405fd71f4fb7cb84edb373a02d1f67a8cd7d901",
      chk_v1_runtime_alert_delivery_attempts: "7041e5d60f4cf578c23651df5d901dd2166da4f1c29ce3e1cfcb877d4c459451",
      chk_v1_runtime_alert_delivery_receipt: "66ace9b3aef148cfb83a1e87f39b6d2fdb00e1c6e1bc966bd9a0aca9d563c4f2",
      chk_v1_runtime_alert_delivery_error: "b98079851b8b0356b1637b76bee757cd5d358ca0f2e19984f81f285718c68c75",
      chk_v1_runtime_alert_delivery_state: "d4c5e608dcaf3e5aa933bb3cbaed8d9aca5e788ca34928dc64125e016de3eb68",
    }),
    foreignKeys: Object.freeze([
      foreignKey(
        "fk_v1_runtime_alert_delivery_alert",
        ["runtime_alert_id"],
        "v1_runtime_alert",
        ["runtime_alert_id"]
      ),
    ]),
  }),
  "062_settlement_source_authority.sql": Object.freeze({
    structures: Object.freeze([
      Object.freeze({
        tableName: "settlement_source_authority",
        tableCollation: "utf8mb4_unicode_ci",
        columns: Object.freeze([
          unicode("root_user_id", "varchar(32)"),
          unicode("campaign_id", "varchar(64)"),
          column("created_at", "datetime(3)"),
          column("updated_at", "datetime(3)"),
        ]),
        indexes: Object.freeze([
          index("PRIMARY", 0, "root_user_id", "campaign_id"),
        ]),
        checks: Object.freeze({}),
        foreignKeys: Object.freeze([]),
      }),
      Object.freeze({
        tableName: "settlement_source_resolution_audit",
        tableCollation: "utf8mb4_unicode_ci",
        columns: Object.freeze([
          ascii("settlement_source_resolution_audit_id", "char(64)"),
          unicode("manual_review_item_id", "varchar(32)"),
          unicode("root_user_id", "varchar(32)"),
          unicode("campaign_id", "varchar(64)"),
          ascii("request_id", "varchar(128)"),
          utf8("operator_id", "varchar(64)"),
          ascii("resolution", "varchar(64)"),
          utf8("resolution_note", "varchar(512)"),
          utf8("public_note", "varchar(512)", { nullable: "YES" }),
          ascii("before_status", "varchar(24)"),
          ascii("after_status", "varchar(24)"),
          column("candidate_resolved_at", "datetime(3)"),
          column("created_at", "datetime(3)"),
        ]),
        indexes: Object.freeze([
          index("PRIMARY", 0, "settlement_source_resolution_audit_id"),
          index(
            "uk_settlement_source_resolution_candidate",
            0,
            "manual_review_item_id"
          ),
          index("uk_settlement_source_resolution_request", 0, "request_id"),
          index(
            "idx_settlement_source_resolution_scope",
            1,
            "root_user_id",
            "campaign_id",
            "created_at",
            "settlement_source_resolution_audit_id"
          ),
        ]),
        checks: Object.freeze({}),
        foreignKeys: Object.freeze([
          foreignKey(
            "fk_settlement_source_resolution_authority",
            ["root_user_id", "campaign_id"],
            "settlement_source_authority",
            ["root_user_id", "campaign_id"]
          ),
          foreignKey(
            "fk_settlement_source_resolution_candidate",
            ["manual_review_item_id"],
            "manual_review_item",
            ["manual_review_item_id"]
          ),
        ]),
      }),
      Object.freeze({
        tableName: "manual_review_item",
        alter: true,
        anchorColumn: "manual_review_item_id",
        columns: Object.freeze([]),
        indexes: Object.freeze([
          index(
            "idx_manual_review_source_scope",
            1,
            "source_type",
            "root_user_id",
            "campaign_id",
            "created_at",
            "manual_review_item_id"
          ),
        ]),
        checks: Object.freeze({}),
        foreignKeys: Object.freeze([]),
      }),
    ]),
  }),
});

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]));
}

function structureDigest(definition) {
  return sha256(JSON.stringify(stableObject(definition)));
}

function stripOuterParentheses(value) {
  let result = value;
  while (result.startsWith("(") && result.endsWith(")")) {
    let depth = 0;
    let quoted = false;
    let wrapsAll = true;
    for (let index = 0; index < result.length; index += 1) {
      const character = result[index];
      if (character === "'") {
        if (quoted && result[index + 1] === "'") {
          index += 1;
          continue;
        }
        quoted = !quoted;
      } else if (!quoted && character === "(") {
        depth += 1;
      } else if (!quoted && character === ")") {
        depth -= 1;
        if (depth === 0 && index < result.length - 1) {
          wrapsAll = false;
          break;
        }
      }
    }
    if (!wrapsAll || depth !== 0) break;
    result = result.slice(1, -1);
  }
  return result;
}

function normalizeRegexpLikeCalls(value) {
  let result = value;
  let searchFrom = 0;
  while (searchFrom < result.length) {
    let start = -1;
    let quoted = false;
    for (let index = searchFrom; index <= result.length - "regexp_like(".length; index += 1) {
      const character = result[index];
      if (character === "'") {
        if (quoted && result[index + 1] === "'") {
          index += 1;
          continue;
        }
        quoted = !quoted;
        continue;
      }
      if (!quoted && result.startsWith("regexp_like(", index)) {
        start = index;
        break;
      }
    }
    if (start < 0) break;
    const argumentStart = start + "regexp_like(".length;
    let depth = 1;
    let comma = -1;
    let end = -1;
    quoted = false;
    for (let index = argumentStart; index < result.length; index += 1) {
      const character = result[index];
      if (character === "'") {
        if (quoted && result[index + 1] === "'") {
          index += 1;
          continue;
        }
        quoted = !quoted;
      } else if (!quoted && character === "(") {
        depth += 1;
      } else if (!quoted && character === ")") {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      } else if (!quoted && character === "," && depth === 1) {
        if (comma >= 0) {
          comma = -2;
          break;
        }
        comma = index;
      }
    }
    if (end < 0 || comma < argumentStart) {
      searchFrom = argumentStart;
      continue;
    }
    const left = result.slice(argumentStart, comma);
    const right = result.slice(comma + 1, end);
    if (!left || !right) {
      searchFrom = argumentStart;
      continue;
    }
    const replacement = `${left}regexp${right}`;
    result = `${result.slice(0, start)}${replacement}${result.slice(end + 1)}`;
    searchFrom = start + replacement.length;
  }
  return result;
}

function hasTopLevelBooleanOperator(value) {
  let depth = 0;
  let quoted = false;
  let betweenPending = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "'") {
      if (quoted && value[index + 1] === "'") {
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (character === "(") {
      depth += 1;
      continue;
    }
    if (character === ")") {
      depth -= 1;
      continue;
    }
    if (depth !== 0 || !/[A-Za-z]/.test(character)) continue;
    const token = value.slice(index).match(/^[A-Za-z_]+/);
    if (!token) continue;
    const normalized = token[0].toLowerCase();
    if (normalized === "between") betweenPending = true;
    else if (normalized === "and" && betweenPending) betweenPending = false;
    else if (["and", "or"].includes(normalized)) return true;
    index += token[0].length - 1;
  }
  return false;
}

function topLevelArithmeticOperators(value) {
  const operators = new Set();
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "'") {
      if (quoted && value[index + 1] === "'") {
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (depth === 0 && ["+", "-", "*", "/"].includes(character)) operators.add(character);
  }
  return operators;
}

function normalizeRedundantPredicateParentheses(value) {
  let result = value;
  while (true) {
    const stack = [];
    const removable = [];
    let quoted = false;
    for (let index = 0; index < result.length; index += 1) {
      const character = result[index];
      if (character === "'") {
        if (quoted && result[index + 1] === "'") {
          index += 1;
          continue;
        }
        quoted = !quoted;
        continue;
      }
      if (quoted) continue;
      if (character === "(") {
        stack.push(index);
        continue;
      }
      if (character !== ")" || stack.length === 0) continue;
      const start = stack.pop();
      let previous = start - 1;
      while (previous >= 0 && /\s/.test(result[previous])) previous -= 1;
      if (previous >= 0 && /[A-Za-z0-9_$]/.test(result[previous])) {
        let tokenStart = previous;
        while (tokenStart > 0 && /[A-Za-z0-9_$]/.test(result[tokenStart - 1])) tokenStart -= 1;
        const previousToken = result.slice(tokenStart, previous + 1).toLowerCase();
        if (!["and", "or"].includes(previousToken)) continue;
      }
      const inner = result.slice(start + 1, index);
      if (hasTopLevelBooleanOperator(inner)) continue;
      const containsPredicate = /(?:=|<>|!=|>=|<=|<|>|\b(?:is|like|regexp|in|between)\b)/i.test(inner);
      if (!containsPredicate) {
        let next = index + 1;
        while (next < result.length && /\s/.test(result[next])) next += 1;
        const comparisonAdjacent = (previous >= 0 && /[=<>!]/.test(result[previous]))
          || (next < result.length && /[=<>!]/.test(result[next]));
        const arithmeticOperators = topLevelArithmeticOperators(inner);
        const leftAssociativeAddition = arithmeticOperators.size === 1
          && arithmeticOperators.has("+")
          && result[next] === "+";
        if (arithmeticOperators.size === 0
          || (!comparisonAdjacent && !leftAssociativeAddition)) continue;
      }
      if (removable.some(([nestedStart, nestedEnd]) => (
        nestedStart > start && nestedEnd < index
      ))) continue;
      removable.push([start, index]);
    }
    if (removable.length === 0) return result;
    removable.sort((left, right) => right[0] - left[0]);
    for (const [start, end] of removable) {
      result = `${result.slice(0, start)}${result.slice(start + 1, end)}${result.slice(end + 1)}`;
    }
  }
}

function normalizeTimestampAddCalls(value) {
  let result = value;
  let searchFrom = 0;
  while (searchFrom < result.length) {
    const start = result.indexOf("timestampadd(", searchFrom);
    if (start < 0) break;
    const argumentStart = start + "timestampadd(".length;
    let depth = 1;
    let quoted = false;
    let end = -1;
    const commas = [];
    for (let index = argumentStart; index < result.length; index += 1) {
      const character = result[index];
      if (character === "'") {
        if (quoted && result[index + 1] === "'") {
          index += 1;
          continue;
        }
        quoted = !quoted;
      } else if (!quoted && character === "(") {
        depth += 1;
      } else if (!quoted && character === ")") {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      } else if (!quoted && character === "," && depth === 1) {
        commas.push(index);
      }
    }
    if (end < 0 || commas.length !== 2) {
      searchFrom = argumentStart;
      continue;
    }
    const unit = result.slice(argumentStart, commas[0]);
    const amount = result.slice(commas[0] + 1, commas[1]);
    const base = result.slice(commas[1] + 1, end);
    if (unit !== "second" || !amount || !base) {
      searchFrom = end + 1;
      continue;
    }
    const replacement = `${base}+interval${amount}second`;
    result = `${result.slice(0, start)}${replacement}${result.slice(end + 1)}`;
    searchFrom = start + replacement.length;
  }
  return result;
}

function canonicalCheckClause(value) {
  // MySQL 8.0 returns CHECK_CLAUSE string delimiters as \\' through
  // information_schema. Normalize that metadata representation before parsing;
  // the literal content itself remains part of the canonical digest.
  const metadataSource = String(value || "");
  const unescapedSource = metadataSource.replace(/\\'/g, "'");
  const source = normalizeRedundantPredicateParentheses(unescapedSource);
  let result = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "'") {
      result += character;
      if (quoted && source[index + 1] === "'") {
        result += source[index + 1];
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (quoted) {
      result += character;
      continue;
    }
    if (/\s/.test(character) || character === "`") continue;
    if (character === "_"
      && (index === 0 || !/[A-Za-z0-9_$]/.test(source[index - 1]))) {
      const introducer = source.slice(index).match(/^_[A-Za-z0-9]+(?=')/);
      if (introducer) {
        index += introducer[0].length - 1;
        continue;
      }
    }
    result += character.toLowerCase();
  }
  result = normalizeRegexpLikeCalls(result);
  result = normalizeTimestampAddCalls(result);
  return stripOuterParentheses(result);
}

function rowValue(row, key) {
  if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  const upper = key.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(row, upper)) return row[upper];
  return undefined;
}

function compareAscii(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function metadataRows(connection, sql, tableName) {
  const [rows] = await connection.execute(sql, [tableName]);
  return Array.isArray(rows) ? rows : [];
}

async function readStructure(connection, tableName) {
  const tables = await metadataRows(connection, `
    SELECT TABLE_NAME AS table_name, ENGINE AS engine, TABLE_COLLATION AS table_collation
    FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = ?
  `, tableName);
  if (tables.length === 0) return { exists: false };

  const columns = await metadataRows(connection, `
    SELECT COLUMN_NAME AS column_name, ORDINAL_POSITION AS ordinal_position,
      COLUMN_TYPE AS column_type, IS_NULLABLE AS is_nullable,
      COLUMN_DEFAULT AS column_default, CHARACTER_SET_NAME AS character_set_name,
      COLLATION_NAME AS collation_name, EXTRA AS extra,
      GENERATION_EXPRESSION AS generation_expression
    FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = ?
    ORDER BY ordinal_position
  `, tableName);
  const indexes = await metadataRows(connection, `
    SELECT INDEX_NAME AS index_name, NON_UNIQUE AS non_unique,
      SEQ_IN_INDEX AS seq_in_index, COLUMN_NAME AS column_name,
      SUB_PART AS sub_part, INDEX_TYPE AS index_type
    FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = ?
    ORDER BY index_name, seq_in_index
  `, tableName);
  const constraints = await metadataRows(connection, `
    SELECT CONSTRAINT_NAME AS constraint_name, CONSTRAINT_TYPE AS constraint_type
    FROM information_schema.table_constraints
    WHERE table_schema = DATABASE() AND table_name = ?
    ORDER BY constraint_name
  `, tableName);
  const checks = await metadataRows(connection, `
    SELECT tc.CONSTRAINT_NAME AS constraint_name, cc.CHECK_CLAUSE AS check_clause
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.check_constraints AS cc
      ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
      AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
    WHERE tc.table_schema = DATABASE() AND tc.table_name = ?
      AND tc.constraint_type = 'CHECK'
    ORDER BY tc.constraint_name
  `, tableName);
  const foreignKeyColumns = await metadataRows(connection, `
    SELECT CONSTRAINT_NAME AS constraint_name, ORDINAL_POSITION AS ordinal_position,
      COLUMN_NAME AS column_name, REFERENCED_TABLE_NAME AS referenced_table_name,
      REFERENCED_COLUMN_NAME AS referenced_column_name
    FROM information_schema.key_column_usage
    WHERE table_schema = DATABASE() AND table_name = ?
      AND referenced_table_name IS NOT NULL
    ORDER BY constraint_name, ordinal_position
  `, tableName);
  const foreignKeyRules = await metadataRows(connection, `
    SELECT CONSTRAINT_NAME AS constraint_name, UPDATE_RULE AS update_rule,
      DELETE_RULE AS delete_rule
    FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE() AND table_name = ?
    ORDER BY constraint_name
  `, tableName);

  return { exists: true, table: tables[0], columns, indexes, constraints, checks, foreignKeyColumns, foreignKeyRules };
}

function actualColumn(row) {
  const defaultValue = rowValue(row, "column_default");
  return {
    name: String(rowValue(row, "column_name") || ""),
    type: String(rowValue(row, "column_type") || "").toLowerCase(),
    nullable: String(rowValue(row, "is_nullable") || "").toUpperCase(),
    defaultValue: defaultValue === null || defaultValue === undefined ? null : String(defaultValue),
    charset: rowValue(row, "character_set_name") || null,
    collation: rowValue(row, "collation_name") || null,
    extra: String(rowValue(row, "extra") || ""),
    generationExpression: String(rowValue(row, "generation_expression") || ""),
  };
}

function groupIndexes(rows, allowedNames = null) {
  const grouped = new Map();
  for (const row of rows) {
    const name = String(rowValue(row, "index_name") || "");
    if (allowedNames && !allowedNames.has(name)) continue;
    if (rowValue(row, "sub_part") !== null && rowValue(row, "sub_part") !== undefined) {
      grouped.set(name, { invalid: true });
      continue;
    }
    if (!grouped.has(name)) {
      grouped.set(name, {
        name,
        nonUnique: Number(rowValue(row, "non_unique")),
        indexType: String(rowValue(row, "index_type") || "").toUpperCase(),
        columns: [],
      });
    }
    const current = grouped.get(name);
    if (!current.invalid) current.columns.push(String(rowValue(row, "column_name") || ""));
  }
  return [...grouped.values()].sort((left, right) => compareAscii(left.name, right.name));
}

function groupForeignKeys(structure, allowedNames = null) {
  const rules = new Map(structure.foreignKeyRules.map((row) => [String(rowValue(row, "constraint_name")), row]));
  const grouped = new Map();
  for (const row of structure.foreignKeyColumns) {
    const name = String(rowValue(row, "constraint_name") || "");
    if (allowedNames && !allowedNames.has(name)) continue;
    if (!grouped.has(name)) {
      const rule = rules.get(name) || {};
      grouped.set(name, {
        name,
        columns: [],
        referencedTable: String(rowValue(row, "referenced_table_name") || ""),
        referencedColumns: [],
        updateRule: String(rowValue(rule, "update_rule") || "").toUpperCase(),
        deleteRule: String(rowValue(rule, "delete_rule") || "").toUpperCase(),
      });
    }
    const current = grouped.get(name);
    current.columns.push(String(rowValue(row, "column_name") || ""));
    current.referencedColumns.push(String(rowValue(row, "referenced_column_name") || ""));
  }
  return [...grouped.values()].sort((left, right) => compareAscii(left.name, right.name));
}

function equivalent(left, right) {
  return JSON.stringify(stableObject(left)) === JSON.stringify(stableObject(right));
}

function matchesAlterPrecondition(definition, structure) {
  if (!definition.alter || !definition.precondition) return false;
  const precondition = definition.precondition;
  const finalColumnNames = new Set(definition.columns.map((item) => item.name));
  const actualColumns = structure.columns
    .map(actualColumn)
    .filter((item) => finalColumnNames.has(item.name));
  if (!equivalent(actualColumns, precondition.columns)) return false;
  if (precondition.columns.length) {
    const positions = new Map(structure.columns.map((row) => [
      String(rowValue(row, "column_name")),
      Number(rowValue(row, "ordinal_position")),
    ]));
    const expectedOrder = [definition.anchorColumn, ...precondition.columns.map((item) => item.name)];
    for (let index = 1; index < expectedOrder.length; index += 1) {
      if (positions.get(expectedOrder[index]) !== positions.get(expectedOrder[index - 1]) + 1) return false;
    }
  }

  const finalIndexNames = new Set(definition.indexes.map((item) => item.name));
  const actualIndexes = groupIndexes(structure.indexes, finalIndexNames).map(({ indexType, ...item }) => {
    if (indexType && indexType !== "BTREE") item.invalid = true;
    return item;
  });
  const expectedIndexes = [...precondition.indexes].sort((left, right) => compareAscii(left.name, right.name));
  if (!equivalent(actualIndexes, expectedIndexes)) return false;

  const finalCheckNames = new Set(Object.keys(definition.checks));
  const actualChecks = Object.fromEntries(structure.checks
    .filter((row) => finalCheckNames.has(String(rowValue(row, "constraint_name"))))
    .map((row) => [
      String(rowValue(row, "constraint_name") || ""),
      sha256(canonicalCheckClause(rowValue(row, "check_clause"))),
    ]));
  return equivalent(actualChecks, precondition.checks);
}

function requiredStructureDifferences(definition, structure) {
  const differences = [];
  if (!structure.exists) return differences;
  if (definition.requiredTableEngine
    && String(rowValue(structure.table, "engine") || "").toUpperCase() !== definition.requiredTableEngine) {
    differences.push("required.table.engine");
  }
  if (definition.requiredTableCollation
    && String(rowValue(structure.table, "table_collation") || "") !== definition.requiredTableCollation) {
    differences.push("required.table.collation");
  }
  if (definition.requiredColumns) {
    const requiredNames = new Set(definition.requiredColumns.map((item) => item.name));
    const actual = structure.columns
      .map(actualColumn)
      .filter((item) => requiredNames.has(item.name))
      .sort((left, right) => compareAscii(left.name, right.name));
    const expected = [...definition.requiredColumns]
      .sort((left, right) => compareAscii(left.name, right.name));
    if (!equivalent(actual, expected)) differences.push("required.columns");
  }
  return differences;
}

function matchesSuccessorCompatiblePredecessor(definition, successor, structure) {
  if (!structure.exists) return false;
  const expectedEngine = definition.requiredTableEngine || "INNODB";
  const expectedCollation = definition.requiredTableCollation
    || successor.requiredTableCollation
    || successor.tableCollation
    || "utf8mb4_0900_bin";
  if (String(rowValue(structure.table, "engine") || "").toUpperCase() !== expectedEngine) return false;
  if (String(rowValue(structure.table, "table_collation") || "") !== expectedCollation) return false;

  const successorColumnNames = new Set(successor.columns.map((item) => item.name));
  const expectedColumns = definition.columns.filter((item) => !successorColumnNames.has(item.name));
  const expectedColumnNames = new Set(expectedColumns.map((item) => item.name));
  const actualColumns = structure.columns.map(actualColumn).filter((item) => expectedColumnNames.has(item.name));
  if (!equivalent(actualColumns, expectedColumns)) return false;

  const successorIndexNames = new Set(successor.indexes.map((item) => item.name));
  const expectedIndexes = definition.indexes
    .filter((item) => !successorIndexNames.has(item.name))
    .sort((left, right) => compareAscii(left.name, right.name));
  const expectedIndexNames = new Set(expectedIndexes.map((item) => item.name));
  const actualIndexes = groupIndexes(structure.indexes, expectedIndexNames).map(({ indexType, ...item }) => {
    if (indexType && indexType !== "BTREE") item.invalid = true;
    return item;
  });
  if (!equivalent(actualIndexes, expectedIndexes)) return false;

  const successorCheckNames = new Set(Object.keys(successor.checks));
  const expectedChecks = Object.fromEntries(Object.entries(definition.checks)
    .filter(([name]) => !successorCheckNames.has(name)));
  const expectedCheckNames = new Set(Object.keys(expectedChecks));
  const actualChecks = Object.fromEntries(structure.checks
    .filter((row) => expectedCheckNames.has(String(rowValue(row, "constraint_name"))))
    .map((row) => [
      String(rowValue(row, "constraint_name") || ""),
      sha256(canonicalCheckClause(rowValue(row, "check_clause"))),
    ]));
  if (!equivalent(actualChecks, expectedChecks)) return false;

  const expectedConstraintTypes = new Map();
  for (const item of expectedIndexes) {
    if (item.nonUnique === 0) expectedConstraintTypes.set(item.name, item.name === "PRIMARY" ? "PRIMARY KEY" : "UNIQUE");
  }
  for (const name of Object.keys(expectedChecks)) expectedConstraintTypes.set(name, "CHECK");
  for (const item of definition.foreignKeys) expectedConstraintTypes.set(item.name, "FOREIGN KEY");
  const actualConstraintTypes = new Map(structure.constraints
    .map((row) => [String(rowValue(row, "constraint_name") || ""), String(rowValue(row, "constraint_type") || "").toUpperCase()])
    .filter(([name]) => expectedConstraintTypes.has(name)));
  if (!equivalent(Object.fromEntries(actualConstraintTypes), Object.fromEntries(expectedConstraintTypes))) return false;

  const foreignKeyNames = new Set(definition.foreignKeys.map((item) => item.name));
  return equivalent(groupForeignKeys(structure, foreignKeyNames), definition.foreignKeys);
}

function successorDefinitionFor(definition, successorName) {
  const successor = DEFINITIONS[successorName];
  if (!successor || !successor.structures) return successor;
  return successor.structures.find((item) => item.tableName === definition.tableName);
}

function inspectDefinition(definition, structure) {
  if (!structure.exists) return { state: STATES.ABSENT, differences: [] };
  const requiredDifferences = requiredStructureDifferences(definition, structure);
  if (requiredDifferences.length) return { state: STATES.DRIFTED, differences: requiredDifferences };
  if (matchesAlterPrecondition(definition, structure)) {
    return { state: STATES.ABSENT, differences: [] };
  }
  const differences = [];
  const actualColumns = structure.columns.map(actualColumn);
  const expectedNames = new Set(definition.columns.map((item) => item.name));
  const relevantColumns = definition.alter || definition.allowAdditional
    ? actualColumns.filter((item) => expectedNames.has(item.name))
    : actualColumns;

  if (definition.alter && relevantColumns.length === 0) {
    const ownedConstraintNames = new Set(Object.keys(definition.checks));
    const ownedIndexNames = new Set(definition.indexes.map((item) => item.name));
    const hasOwnedConstraint = structure.constraints.some((row) => ownedConstraintNames.has(String(rowValue(row, "constraint_name"))));
    const hasOwnedIndex = structure.indexes.some((row) => ownedIndexNames.has(String(rowValue(row, "index_name"))));
    if (!hasOwnedConstraint && !hasOwnedIndex) return { state: STATES.ABSENT, differences: [] };
  }

  if (!definition.alter) {
    if (String(rowValue(structure.table, "engine") || "").toUpperCase() !== "INNODB") differences.push("table.engine");
    const expectedCollation = definition.tableCollation || "utf8mb4_0900_bin";
    if (String(rowValue(structure.table, "table_collation") || "") !== expectedCollation) differences.push("table.collation");
  }
  if (!equivalent(relevantColumns, definition.columns)) differences.push("columns");
  if (definition.alter) {
    const positions = new Map(structure.columns.map((row) => [String(rowValue(row, "column_name")), Number(rowValue(row, "ordinal_position"))]));
    const expectedOrder = [definition.anchorColumn, ...definition.columns.map((item) => item.name)];
    for (let index = 1; index < expectedOrder.length; index += 1) {
      if (positions.get(expectedOrder[index]) !== positions.get(expectedOrder[index - 1]) + 1) {
        differences.push("columns.order");
        break;
      }
    }
  }

  const indexNames = definition.alter || definition.allowAdditional
    ? new Set(definition.indexes.map((item) => item.name))
    : null;
  const actualIndexes = groupIndexes(structure.indexes, indexNames).map(({ indexType, ...item }) => {
    if (indexType && indexType !== "BTREE") item.invalid = true;
    return item;
  });
  const expectedIndexes = [...definition.indexes].sort((left, right) => compareAscii(left.name, right.name));
  if (!equivalent(actualIndexes, expectedIndexes)) differences.push("indexes");

  const checkNames = new Set(Object.keys(definition.checks));
  const actualChecks = Object.fromEntries(structure.checks
    .filter((row) => !(definition.alter || definition.allowAdditional)
      || checkNames.has(String(rowValue(row, "constraint_name"))))
    .map((row) => [
      String(rowValue(row, "constraint_name") || ""),
      sha256(canonicalCheckClause(rowValue(row, "check_clause"))),
    ]));
  if (!equivalent(actualChecks, definition.checks)) differences.push("checks");

  const expectedConstraintTypes = new Map();
  for (const item of definition.indexes) {
    if (item.nonUnique === 0) expectedConstraintTypes.set(item.name, item.name === "PRIMARY" ? "PRIMARY KEY" : "UNIQUE");
  }
  for (const name of Object.keys(definition.checks)) expectedConstraintTypes.set(name, "CHECK");
  for (const item of definition.foreignKeys) expectedConstraintTypes.set(item.name, "FOREIGN KEY");
  const actualConstraintTypes = new Map(structure.constraints
    .map((row) => [String(rowValue(row, "constraint_name") || ""), String(rowValue(row, "constraint_type") || "").toUpperCase()])
    .filter(([name]) => !(definition.alter || definition.allowAdditional)
      || expectedConstraintTypes.has(name)));
  if (!equivalent(Object.fromEntries(actualConstraintTypes), Object.fromEntries(expectedConstraintTypes))) {
    differences.push("constraints");
  }

  const foreignKeyNames = definition.alter || definition.allowAdditional
    ? new Set(definition.foreignKeys.map((item) => item.name))
    : null;
  if (!equivalent(groupForeignKeys(structure, foreignKeyNames), definition.foreignKeys)) differences.push("foreignKeys");
  return { state: differences.length ? STATES.DRIFTED : STATES.COMPLETE, differences };
}

async function inspectMysqlMigrationStructure(connection, migrationName) {
  const definition = DEFINITIONS[migrationName];
  if (!definition) {
    return Object.freeze({
      supported: false,
      migrationName,
      state: STATES.UNSUPPORTED,
      structureDigest: "",
      differences: Object.freeze([]),
    });
  }
  if (definition.structures) {
    const inspections = [];
    for (const item of definition.structures) {
      const inspection = inspectDefinition(item, await readStructure(connection, item.tableName));
      inspections.push({ definition: item, inspection });
    }
    const states = new Set(inspections.map((item) => item.inspection.state));
    let state = STATES.DRIFTED;
    if (states.size === 1 && states.has(STATES.COMPLETE)) state = STATES.COMPLETE;
    if (states.size === 1 && states.has(STATES.ABSENT)) state = STATES.ABSENT;
    const differences = inspections.flatMap(({ definition: item, inspection }) => (
      inspection.differences.map((difference) => `${item.tableName}.${difference}`)
    ));
    if (state === STATES.DRIFTED && differences.length === 0) differences.push("structures.partial");
    return Object.freeze({
      supported: true,
      migrationName,
      tableName: [...new Set(definition.structures.map((item) => item.tableName))].join(","),
      state,
      structureDigest: structureDigest(definition),
      differences: Object.freeze([...new Set(differences)].sort()),
    });
  }
  const structure = await readStructure(connection, definition.tableName);
  let inspection = inspectDefinition(definition, structure);
  if (inspection.state === STATES.COMPLETE
    && definition.dataInspection === "ACTIVITY_SESSION_CANCEL_CLOSE_BACKFILLED") {
    const [rows] = await connection.execute(
      `SELECT 1 AS violation
       FROM activity_session
       WHERE cancel_close_at IS NULL
       LIMIT 1`
    );
    if (Array.isArray(rows) && rows.length > 0) {
      inspection = { state: STATES.ABSENT, differences: [] };
    }
  }
  const successorNames = COMPATIBLE_SUCCESSOR_MIGRATIONS[migrationName]
    || Object.freeze([SUCCESSOR_MIGRATIONS[migrationName]].filter(Boolean));
  if (inspection.state === STATES.DRIFTED && successorNames.length) {
    for (const successorName of successorNames) {
      const successor = successorDefinitionFor(definition, successorName);
      if (!successor) continue;
      const successorInspection = inspectDefinition(successor, structure);
      if (successorInspection.state === STATES.COMPLETE
        && matchesSuccessorCompatiblePredecessor(definition, successor, structure)) {
        inspection = { state: STATES.COMPLETE, differences: [] };
        break;
      }
    }
  }
  return Object.freeze({
    supported: true,
    migrationName,
    tableName: definition.tableName,
    state: inspection.state,
    structureDigest: structureDigest(definition),
    differences: Object.freeze([...new Set(inspection.differences)].sort()),
  });
}

function migrationStructureDriftError(inspection) {
  const error = new Error(`MySQL migration structure drift detected: ${inspection.migrationName}`);
  error.code = "MYSQL_MIGRATION_STRUCTURE_DRIFT";
  error.migrationName = inspection.migrationName;
  error.structureDigest = inspection.structureDigest;
  error.differences = inspection.differences;
  return error;
}

function mysqlMigrationStructureSuccessor(migrationName) {
  return SUCCESSOR_MIGRATIONS[migrationName] || "";
}

function mysqlMigrationRetirementSuccessor(migrationName) {
  if (FORMAL_LAUNCH_RETIRED_MIGRATIONS.has(migrationName)) {
    return FORMAL_LAUNCH_CLEANUP_MIGRATION;
  }
  if (CONFIRMED_PRELAUNCH_RETIRED_MIGRATIONS.has(migrationName)) {
    return CONFIRMED_PRELAUNCH_CLEANUP_MIGRATION;
  }
  return "";
}

module.exports = {
  MYSQL_MIGRATION_STRUCTURE_STATES: STATES,
  inspectMysqlMigrationStructure,
  mysqlMigrationRetirementSuccessor,
  mysqlMigrationStructureSuccessor,
  migrationStructureDriftError,
};
