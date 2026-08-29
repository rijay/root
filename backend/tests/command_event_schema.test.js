const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  PROJECTIONS,
  assertSnapshotProjectionRegistrySafe,
} = require("../src/mysqlProjection");
const {
  listMigrationFiles,
  migrationChecksum,
  splitSqlStatements,
} = require("../src/mysqlMigrations");

const migrationsDir = path.join(__dirname, "..", "db", "migrations");
const migrationName = "006_command_event_foundation.sql";
const migrationPath = path.join(migrationsDir, migrationName);
const recoveryMigrationName = "007_command_recovery_lease.sql";
const recoveryMigrationPath = path.join(migrationsDir, recoveryMigrationName);
const cryptoMetadataMigrationName = "008_command_scope_crypto_metadata.sql";
const cryptoMetadataMigrationPath = path.join(migrationsDir, cryptoMetadataMigrationName);
const dispatcherMigrationName = "009_outbox_dispatcher_fencing.sql";
const dispatcherMigrationPath = path.join(migrationsDir, dispatcherMigrationName);
const inboxMigrationName = "010_durable_inbox_checkpoint.sql";
const inboxMigrationPath = path.join(migrationsDir, inboxMigrationName);
const checkpointMigrationName = "011_durable_consumer_checkpoint.sql";
const checkpointMigrationPath = path.join(migrationsDir, checkpointMigrationName);
const inboxDeadLetterMigrationName = "012_durable_inbox_dead_letter.sql";
const inboxDeadLetterMigrationPath = path.join(migrationsDir, inboxDeadLetterMigrationName);
const inboxContentProtectionMigrationName = "013_inbox_content_protection_metadata.sql";
const inboxContentProtectionMigrationPath = path.join(migrationsDir, inboxContentProtectionMigrationName);
const inboxHandlerIdentityMigrationName = "014_inbox_handler_identity.sql";
const inboxHandlerIdentityMigrationPath = path.join(migrationsDir, inboxHandlerIdentityMigrationName);
const taskShareProjectionMigrationName = "015_task_share_completion_projection.sql";
const taskShareProjectionMigrationPath = path.join(migrationsDir, taskShareProjectionMigrationName);
const inboxReplayRunMigrationName = "016_inbox_replay_run.sql";
const inboxReplayRunMigrationPath = path.join(migrationsDir, inboxReplayRunMigrationName);
const taskShareShadowProjectionMigrationName = "017_task_share_completion_shadow_projection.sql";
const taskShareShadowProjectionMigrationPath = path.join(
  migrationsDir,
  taskShareShadowProjectionMigrationName
);
const notificationDeliveryMigrationNames = Object.freeze([
  "018_notification_subscription_attempt.sql",
  "019_notification_subscription_grant.sql",
  "020_notification_job.sql",
  "021_notification_send_attempt.sql",
  "022_notification_send_attempt_transition.sql",
]);
const replayExecutorIdentityMigrationName = "023_inbox_replay_executor_identity.sql";
const replayExecutorIdentityMigrationPath = path.join(
  migrationsDir,
  replayExecutorIdentityMigrationName
);
const notificationContractMigrationNames = Object.freeze([
  "024_notification_native_decision_contract.sql",
  "025_notification_job_request_identity.sql",
  "026_notification_send_attempt_receipt_metadata.sql",
  "027_notification_send_transition_receipt_metadata.sql",
]);
const migrationExecutionMigrationNames = Object.freeze([
  "028_migration_contract_registry.sql",
  "029_migration_run.sql",
  "030_migration_lineage.sql",
  "031_task_share_migration_projection.sql",
]);
const v1RuntimeControlMigrationNames = Object.freeze([
  "032_v1_runtime_cycle.sql",
  "033_v1_runtime_alert.sql",
]);
const activityMigrationName = "034_activity_module.sql";
const activityRecoveryMigrationNames = Object.freeze([
  "035_activity_publication_session_event.sql",
  "036_activity_enrollment_event_generation_stage.sql",
  "037_activity_enrollment_event_generation_backfill.sql",
  "038_activity_enrollment_event_generation_enforce.sql",
  "039_activity_session_event.sql",
]);
const ACTIVITY_RECOVERY_CHECKSUMS = Object.freeze({
  "035_activity_publication_session_event.sql": "d5e37c2f4ed7849f0998e8defc115c9438037f185465583b080ef3dcb7c10832",
  "036_activity_enrollment_event_generation_stage.sql": "9caef234334cc06d469529d485d323e0736229f42876907d7d3f3b663164a712",
  "037_activity_enrollment_event_generation_backfill.sql": "127edaaf9c2f85769a4aa5a3c17a8f11bb04dc99ebc5ac537d6cf3585e448327",
  "038_activity_enrollment_event_generation_enforce.sql": "aff2145de7afb470b56ba39468727d3129ad86f22844ec1658da67844e14d0da",
  "039_activity_session_event.sql": "46604e7c7b01491ffa55b00f1d503ebaf80dda9d42985add88823c945640ba50",
});
const activityP0MigrationName = "040_activity_p0_content_and_session_policy.sql";
const activityTaskSourceMigrationNames = Object.freeze([
  "041_task_activity_assignment.sql",
  "042_task_source_invalidation_event.sql",
]);
const activityPolicyRecoveryMigrationNames = Object.freeze([
  "043_activity_session_cancel_close_stage.sql",
  "044_activity_session_cancel_close_backfill.sql",
  "045_activity_session_policy_enforce.sql",
]);
const taskEventIdempotencyMigrationNames = Object.freeze([
  "046_task_event_idempotency_scope_stage.sql",
  "047_task_event_idempotency_scope_backfill.sql",
  "048_task_event_idempotency_scope_enforce.sql",
]);
const wechatRecipientAuthorityMigrationNames = Object.freeze([
  "049_wechat_unionid_provenance_stage.sql",
  "050_wechat_unionid_provenance_backfill.sql",
  "051_wechat_unionid_provenance_enforce.sql",
  "052_notification_recipient_binding_legacy_stage.sql",
  "053_notification_recipient_binding_v1_stage.sql",
  "054_notification_recipient_binding_legacy_backfill.sql",
  "055_notification_recipient_binding_v1_backfill.sql",
  "056_notification_recipient_binding_legacy_enforce.sql",
  "057_notification_recipient_binding_v1_enforce.sql",
]);
const notificationProviderCallFenceMigrationNames = Object.freeze([
  "058_notification_provider_call_fence_stage.sql",
  "059_notification_provider_call_fence_backfill.sql",
  "060_notification_provider_call_fence_enforce.sql",
]);
const runtimeAlertDeliveryMigrationName = "061_v1_runtime_alert_delivery.sql";
const settlementSourceAuthorityMigrationName = "062_settlement_source_authority.sql";
const runtimeAlertDatabaseAuthorityMigrationName =
  "063_v1_runtime_alert_database_authority_stage.sql";
const runtimeControlLedgerAuthorityMigrationName =
  "064_v1_runtime_control_ledger_database_authority.sql";
const runtimeAlertRegistrationReturnRowMigrationName =
  "065_v1_runtime_alert_registration_return_row.sql";
const runtimeAlertSeveritySloAuthorityMigrationName =
  "066_v1_runtime_alert_delivery_severity_slo_authority.sql";
const formalLaunchCleanupMigrationName =
  "067_formal_launch_retired_runtime_cleanup.sql";
const confirmedPrelaunchCleanupMigrationName =
  "068_formal_launch_confirmed_prelaunch_cleanup.sql";
const v060MigrationNames = Object.freeze([
  "069_health_assessment.sql",
  "070_growth_engagement.sql",
  "071_product_analytics.sql",
  "072_health_advice_snapshot.sql",
  "073_channel_code_funnel.sql",
]);
const ACTIVITY_TASK_SOURCE_CHECKSUMS = Object.freeze({
  "040_activity_p0_content_and_session_policy.sql": "47957cd009b26ce848e9635f17d5e29b73e57bb956ffbff077a22a5d0ad03e59",
  "041_task_activity_assignment.sql": "ebb606a5353496a68a87e037ffaafd9dcec92e92d519467cfe0a6f140c90670c",
  "042_task_source_invalidation_event.sql": "34ab843b51b0884eeb2a8d3e808a3b010aac8b79d60900d15cb6c3aa1a23e16f",
  "043_activity_session_cancel_close_stage.sql": "f2c6973873e7f5681f952102d58230a40d2237c92a24c2dcd1c5f81da6d0d7cb",
  "044_activity_session_cancel_close_backfill.sql": "4081a8066c67853b4c2250c77608bd98c73ec79bc1732cf74aade15866431929",
  "045_activity_session_policy_enforce.sql": "17c23ecb96b34fe0d531a749093fadaae496ade366fb39192abaeadad7590855",
});
const TASK_EVENT_IDEMPOTENCY_CHECKSUMS = Object.freeze({
  "046_task_event_idempotency_scope_stage.sql": "b05eedef6686c6d7f7213bde8a20f5cc9a6043567a5bfb9491b7f74793a11cf6",
  "047_task_event_idempotency_scope_backfill.sql": "37f101458e8a98631b9d96cf2a4956d0be78afcc391f7880d48bde18f24362d7",
  "048_task_event_idempotency_scope_enforce.sql": "f149dbd865693ff875a14573e0d69ef21d19db329bf37e89d208f6f2b23185ac",
});
const WECHAT_RECIPIENT_AUTHORITY_CHECKSUMS = Object.freeze({
  "049_wechat_unionid_provenance_stage.sql": "ac7425acfb125d25869cc27b95bbb6074b63b274851d9b35e014b5c306e3fc4d",
  "050_wechat_unionid_provenance_backfill.sql": "3e447d2a01574fd1ea5f1c69da17f30d2e868b47264403fd50516aa22b6761c9",
  "051_wechat_unionid_provenance_enforce.sql": "df9b2629aa23c9730d319f1b5ab700f90b7ee5e10e2c7ba3e8be4a4d7eec2019",
  "052_notification_recipient_binding_legacy_stage.sql": "4c83d466b9e9bfd7c955df3bf65e8a232ecb20251fb9df4373cc73a773f468ba",
  "053_notification_recipient_binding_v1_stage.sql": "45a9ffe533e5de674180891bb6da1b748d4958938d1ce86ce51f0040cb98f945",
  "054_notification_recipient_binding_legacy_backfill.sql": "053c0464c37a98f56802dca4cb3b40ab888060570d22757fbf62800075b7173d",
  "055_notification_recipient_binding_v1_backfill.sql": "c72c290c4d376b8cb973a3d763a01b814a602d1d943f8a1a4c2c4626d3585bc7",
  "056_notification_recipient_binding_legacy_enforce.sql": "812b2f9444c46e07894e4cc30e0cdf6bc5563201cb956444f7d783dcc98dcf9b",
  "057_notification_recipient_binding_v1_enforce.sql": "9e8785c730a5945991fb027c623c661d467aa1d9ab6e9b0ae638039a4ac9ba9b",
});
const NOTIFICATION_PROVIDER_CALL_FENCE_CHECKSUMS = Object.freeze({
  "058_notification_provider_call_fence_stage.sql": "1eca2f1171127f851ce06f0c30f728d9231853f15dc8e3e5fc6411acbe95231f",
  "059_notification_provider_call_fence_backfill.sql": "1092eb6929f7e2e6aa54cffbe91e8c862ec1bf28abc6c57751545dc60fa2de81",
  "060_notification_provider_call_fence_enforce.sql": "158d5fbfaa8d02a3ed7a65effe3b5d03a85649ab9c5e7e8c1c0cb9323eef711a",
});
const RUNTIME_ALERT_DELIVERY_CHECKSUM =
  "dff221a9835467d6c9d127ea8fadad128f20b1fb881ea30fd311fcea41cbce92";
const SETTLEMENT_SOURCE_AUTHORITY_CHECKSUM =
  "d56a83a213290e4d62937bf41dd0ab44430d3d4f87eee0603692133afbf166a3";
const RUNTIME_ALERT_DATABASE_AUTHORITY_CHECKSUM =
  "2cad7a116e725d1463312b619eb5f34312b653b364964a5b208fbe42e4c61b36";
const RUNTIME_CONTROL_LEDGER_AUTHORITY_CHECKSUM =
  "ff3e05241cc024fe3ba533a325bfd65df08421a02a7f7e7e274ef80328f86e9e";
const RUNTIME_ALERT_REGISTRATION_RETURN_ROW_CHECKSUM =
  "263a4edb996596d9c8868471006ddc636e904dc17e7ce39813495fd3db20f39e";
const RUNTIME_ALERT_SEVERITY_SLO_AUTHORITY_CHECKSUM =
  "411f29a8ac26eb8ee3261555bdbd33c20f46dde315fa7d642b308d4b832e64ac";
const IMMUTABLE_FOUNDATION_CHECKSUM = "723c148f24df8edb456362da47fec8105bda643c9f78500b093ac6b6d4e44857";
const IMMUTABLE_RECOVERY_CHECKSUM = "0916e7f855bafdf69aaeafd153649b04b1fb622471555348ea296a7eceb9504d";
const IMMUTABLE_CRYPTO_METADATA_CHECKSUM = "b8ce188acb22ef713d2fe2e92d7643f99152a8e88dd8b03c03d878965a814b2a";
const IMMUTABLE_DISPATCHER_CHECKSUM = "a897d65edf8b5b87e5394264536e4c1998906d94d9b45e941ac8ca0f09183d54";
const IMMUTABLE_INBOX_CHECKSUM = "4f298d03d28c76c8046908866c1cf4de8306851b536aaadacd7d6d90ae0c5be2";
const IMMUTABLE_CHECKPOINT_CHECKSUM = "fd5dd674e526d271652070d361d9c48cdd049581718a3c6a570a1ca93388ff47";
const IMMUTABLE_INBOX_DEAD_LETTER_CHECKSUM = "6e1fd02fb7f8c80b6bc94482895e3c8396d76120d19fa8e2e48ae996178cdeec";
const IMMUTABLE_INBOX_CONTENT_PROTECTION_CHECKSUM = "6f39bf27595c65de9787281ac7754e66377a75464986f2a5a3377a3ad52b8e38";
const INBOX_HANDLER_IDENTITY_CHECKSUM = "9e0999b6583282a14b0e7e031c6a51ab4830a922e7599a342cd839d6fee87d02";
const TASK_SHARE_PROJECTION_CHECKSUM = "772905d013a9b6a80dbf7073281deaae0aa1f7077a92eaed48e6a9c8ffa761d3";
const INBOX_REPLAY_RUN_CHECKSUM = "1ed341bfc59a655be03910b0229138c0a412571403cbd6bdd16cc9588cd239b8";
const TASK_SHARE_SHADOW_PROJECTION_CHECKSUM = "658ae562e9a19b68a04c2427d17ce8b841d9145bb7a56aa5ca30bfe91a1e27c7";
const NOTIFICATION_DELIVERY_CHECKSUMS = Object.freeze({
  "018_notification_subscription_attempt.sql": "5746a1adf4105c2a1bfe50d28389c6e070101817061e0352af27905a72a752fe",
  "019_notification_subscription_grant.sql": "55b8a33171df856b58e448cadd158ba0e7af414123a0a91cd2849a7a8bc3d9bb",
  "020_notification_job.sql": "34b31679b8b9f1fada28182a17d299a776dfe7c524aec2a5bcf52537491193d1",
  "021_notification_send_attempt.sql": "3a1045dd549d42f3e76baaa668362ad5ef6e17c43a4ebbcb11dcd7dc471bbcf4",
  "022_notification_send_attempt_transition.sql": "38681ef5e508ff2a4d480a35165f03c810cba38a0062d9df44f8d829db0cddcb",
});
const REPLAY_EXECUTOR_IDENTITY_CHECKSUM = "84a1876a4b573f645b2cbecf6da67cd1634c4b20f070222b34364636f063c0fa";
const NOTIFICATION_CONTRACT_CHECKSUMS = Object.freeze({
  "024_notification_native_decision_contract.sql": "817b1e83864b475a8c80711ef181136bebc7aaf53148793d16748d14f5b86418",
  "025_notification_job_request_identity.sql": "2250462991ab547fbb57c28cca67c91d2999a87a7ea6785f3ea52cff4f17042e",
  "026_notification_send_attempt_receipt_metadata.sql": "cbeedd89b84c3f15b3eee3136536e0f4d02dd733b6fd3ad610ef9725bd37ad5e",
  "027_notification_send_transition_receipt_metadata.sql": "b8db4701daa83785c0e8f5c142dcdac6807c239863cdd6e60a280a13961f62b9",
});
const MIGRATION_EXECUTION_CHECKSUMS = Object.freeze({
  "028_migration_contract_registry.sql": "cd4f8eabeb07c4642e6c9acdc170e5d85b98526e28c4c23661d9d9a070d035c1",
  "029_migration_run.sql": "489e429e25b2f0242794a91e969916dd3a0383a35186f67033996b7c17610e6e",
  "030_migration_lineage.sql": "a44e6e8f5b2c02ec2e9ddb3e997b658adb8a8eef581a0b67d1c31b915cd86a18",
  "031_task_share_migration_projection.sql": "b1fb65c5ed4cf15b7ef2b9d58c03bfbb34246d9b47224f794b0388af89f47261",
});
const V1_RUNTIME_CONTROL_CHECKSUMS = Object.freeze({
  "032_v1_runtime_cycle.sql": "5f037db99648d3a3fdb4d80672fed80bdff54ba001326b6b761bc0aad40bc219",
  "033_v1_runtime_alert.sql": "6cfd007977bd81cf51743338646e9f13f07a505e05236e9ea0e17af9b2c7014a",
});
const ACTIVITY_MIGRATION_CHECKSUM = "e031706bc52025855339665971629226931a1c2d8d3f85fd381cbe911f43def6";

function migrationSql() {
  return fs.readFileSync(migrationPath, "utf8");
}

function recoveryMigrationSql() {
  return fs.readFileSync(recoveryMigrationPath, "utf8");
}

function cryptoMetadataMigrationSql() {
  return fs.readFileSync(cryptoMetadataMigrationPath, "utf8");
}

function dispatcherMigrationSql() {
  return fs.readFileSync(dispatcherMigrationPath, "utf8");
}

function inboxMigrationSql() {
  return fs.readFileSync(inboxMigrationPath, "utf8");
}

function checkpointMigrationSql() {
  return fs.readFileSync(checkpointMigrationPath, "utf8");
}

function inboxDeadLetterMigrationSql() {
  return fs.readFileSync(inboxDeadLetterMigrationPath, "utf8");
}

function inboxContentProtectionMigrationSql() {
  return fs.readFileSync(inboxContentProtectionMigrationPath, "utf8");
}

function inboxHandlerIdentityMigrationSql() {
  return fs.readFileSync(inboxHandlerIdentityMigrationPath, "utf8");
}

function taskShareProjectionMigrationSql() {
  return fs.readFileSync(taskShareProjectionMigrationPath, "utf8");
}

function inboxReplayRunMigrationSql() {
  return fs.readFileSync(inboxReplayRunMigrationPath, "utf8");
}

function taskShareShadowProjectionMigrationSql() {
  return fs.readFileSync(taskShareShadowProjectionMigrationPath, "utf8");
}

function notificationDeliveryMigrationSql(migrationName) {
  return fs.readFileSync(path.join(migrationsDir, migrationName), "utf8");
}

function replayExecutorIdentityMigrationSql() {
  return fs.readFileSync(replayExecutorIdentityMigrationPath, "utf8");
}

function compact(sql) {
  return String(sql).replace(/\s+/g, " ").trim();
}

function assertSql(sql, expression, message) {
  assert.match(compact(sql), expression, message);
}

function permanentAlterStatements(sql) {
  return splitSqlStatements(sql).filter((statement) => /^ALTER TABLE\b/i.test(statement));
}

test("historical migrations remain immutable while 067 retires unused runtime storage", () => {
  const files = listMigrationFiles(migrationsDir);
  assert.deepEqual(files, [
    "001_store_snapshot.sql",
    "002_core_relational.sql",
    "003_privacy_consent.sql",
    "004_external_evidence_minimization.sql",
    "005_notification_subscription_grants.sql",
    migrationName,
    recoveryMigrationName,
    cryptoMetadataMigrationName,
    dispatcherMigrationName,
    inboxMigrationName,
    checkpointMigrationName,
    inboxDeadLetterMigrationName,
    inboxContentProtectionMigrationName,
    inboxHandlerIdentityMigrationName,
    taskShareProjectionMigrationName,
    inboxReplayRunMigrationName,
    taskShareShadowProjectionMigrationName,
    ...notificationDeliveryMigrationNames,
    replayExecutorIdentityMigrationName,
    ...notificationContractMigrationNames,
    ...migrationExecutionMigrationNames,
    ...v1RuntimeControlMigrationNames,
    activityMigrationName,
    ...activityRecoveryMigrationNames,
    activityP0MigrationName,
    ...activityTaskSourceMigrationNames,
    ...activityPolicyRecoveryMigrationNames,
    ...taskEventIdempotencyMigrationNames,
    ...wechatRecipientAuthorityMigrationNames,
    ...notificationProviderCallFenceMigrationNames,
    runtimeAlertDeliveryMigrationName,
    settlementSourceAuthorityMigrationName,
    runtimeAlertDatabaseAuthorityMigrationName,
    runtimeControlLedgerAuthorityMigrationName,
    runtimeAlertRegistrationReturnRowMigrationName,
    runtimeAlertSeveritySloAuthorityMigrationName,
    formalLaunchCleanupMigrationName,
    confirmedPrelaunchCleanupMigrationName,
    ...v060MigrationNames,
  ]);

  const sql = migrationSql();
  assert.equal(splitSqlStatements(sql).length, 5);
  const manifest = JSON.parse(fs.readFileSync(path.join(migrationsDir, "checksums.json"), "utf8"));
  assert.equal(Object.keys(manifest.files).length, 73);
  v060MigrationNames.forEach((fileName) => {
    const sql = fs.readFileSync(path.join(migrationsDir, fileName), "utf8");
    assert.equal(manifest.files[fileName], migrationChecksum(sql));
  });
  assert.equal(migrationChecksum(sql), IMMUTABLE_FOUNDATION_CHECKSUM);
  assert.equal(migrationChecksum(recoveryMigrationSql()), IMMUTABLE_RECOVERY_CHECKSUM);
  assert.equal(migrationChecksum(cryptoMetadataMigrationSql()), IMMUTABLE_CRYPTO_METADATA_CHECKSUM);
  assert.equal(migrationChecksum(dispatcherMigrationSql()), IMMUTABLE_DISPATCHER_CHECKSUM);
  assert.equal(manifest.files[migrationName], IMMUTABLE_FOUNDATION_CHECKSUM);
  assert.equal(manifest.files[recoveryMigrationName], IMMUTABLE_RECOVERY_CHECKSUM);
  assert.equal(manifest.files[cryptoMetadataMigrationName], IMMUTABLE_CRYPTO_METADATA_CHECKSUM);
  assert.equal(manifest.files[dispatcherMigrationName], IMMUTABLE_DISPATCHER_CHECKSUM);
  assert.equal(migrationChecksum(inboxMigrationSql()), IMMUTABLE_INBOX_CHECKSUM);
  assert.equal(migrationChecksum(checkpointMigrationSql()), IMMUTABLE_CHECKPOINT_CHECKSUM);
  assert.equal(migrationChecksum(inboxDeadLetterMigrationSql()), IMMUTABLE_INBOX_DEAD_LETTER_CHECKSUM);
  assert.equal(manifest.files[inboxMigrationName], IMMUTABLE_INBOX_CHECKSUM);
  assert.equal(manifest.files[checkpointMigrationName], IMMUTABLE_CHECKPOINT_CHECKSUM);
  assert.equal(manifest.files[inboxDeadLetterMigrationName], IMMUTABLE_INBOX_DEAD_LETTER_CHECKSUM);
  assert.equal(
    manifest.files[inboxContentProtectionMigrationName],
    IMMUTABLE_INBOX_CONTENT_PROTECTION_CHECKSUM
  );
  assert.equal(
    migrationChecksum(inboxContentProtectionMigrationSql()),
    IMMUTABLE_INBOX_CONTENT_PROTECTION_CHECKSUM
  );
  assert.equal(manifest.files[inboxHandlerIdentityMigrationName], INBOX_HANDLER_IDENTITY_CHECKSUM);
  assert.equal(migrationChecksum(inboxHandlerIdentityMigrationSql()), INBOX_HANDLER_IDENTITY_CHECKSUM);
  assert.equal(manifest.files[taskShareProjectionMigrationName], TASK_SHARE_PROJECTION_CHECKSUM);
  assert.equal(migrationChecksum(taskShareProjectionMigrationSql()), TASK_SHARE_PROJECTION_CHECKSUM);
  assert.equal(manifest.files[inboxReplayRunMigrationName], INBOX_REPLAY_RUN_CHECKSUM);
  assert.equal(migrationChecksum(inboxReplayRunMigrationSql()), INBOX_REPLAY_RUN_CHECKSUM);
  assert.equal(
    manifest.files[taskShareShadowProjectionMigrationName],
    TASK_SHARE_SHADOW_PROJECTION_CHECKSUM
  );
  assert.equal(
    migrationChecksum(taskShareShadowProjectionMigrationSql()),
    TASK_SHARE_SHADOW_PROJECTION_CHECKSUM
  );
  for (const migrationName of notificationDeliveryMigrationNames) {
    assert.equal(manifest.files[migrationName], NOTIFICATION_DELIVERY_CHECKSUMS[migrationName]);
    assert.equal(
      migrationChecksum(notificationDeliveryMigrationSql(migrationName)),
      NOTIFICATION_DELIVERY_CHECKSUMS[migrationName]
    );
    assert.equal(splitSqlStatements(notificationDeliveryMigrationSql(migrationName)).length, 1);
  }
  assert.equal(
    manifest.files[replayExecutorIdentityMigrationName],
    REPLAY_EXECUTOR_IDENTITY_CHECKSUM
  );
  assert.equal(
    migrationChecksum(replayExecutorIdentityMigrationSql()),
    REPLAY_EXECUTOR_IDENTITY_CHECKSUM
  );
  assert.equal(splitSqlStatements(replayExecutorIdentityMigrationSql()).length, 6);
  for (const migrationName of notificationContractMigrationNames) {
    const migration = notificationDeliveryMigrationSql(migrationName);
    assert.equal(manifest.files[migrationName], NOTIFICATION_CONTRACT_CHECKSUMS[migrationName]);
    assert.equal(migrationChecksum(migration), NOTIFICATION_CONTRACT_CHECKSUMS[migrationName]);
    assert.equal(splitSqlStatements(migration).length, 6);
    assert.equal(permanentAlterStatements(migration).length, 1);
  }
  for (const migrationName of migrationExecutionMigrationNames) {
    const migration = notificationDeliveryMigrationSql(migrationName);
    assert.equal(manifest.files[migrationName], MIGRATION_EXECUTION_CHECKSUMS[migrationName]);
    assert.equal(migrationChecksum(migration), MIGRATION_EXECUTION_CHECKSUMS[migrationName]);
    assert.equal(splitSqlStatements(migration).length, 1);
  }
  for (const migrationName of v1RuntimeControlMigrationNames) {
    const migration = notificationDeliveryMigrationSql(migrationName);
    assert.equal(manifest.files[migrationName], V1_RUNTIME_CONTROL_CHECKSUMS[migrationName]);
    assert.equal(migrationChecksum(migration), V1_RUNTIME_CONTROL_CHECKSUMS[migrationName]);
    assert.equal(splitSqlStatements(migration).length, 1);
  }
  const activityMigration = notificationDeliveryMigrationSql(activityMigrationName);
  assert.equal(manifest.files[activityMigrationName], ACTIVITY_MIGRATION_CHECKSUM);
  assert.equal(migrationChecksum(activityMigration), ACTIVITY_MIGRATION_CHECKSUM);
  assert.equal(splitSqlStatements(activityMigration).length, 4);
  assert.match(activityMigration, /UNIQUE KEY uk_activity_enrollment_session_user \(activity_session_id, root_user_id\)/);
  assert.match(activityMigration, /source = 'OPS_BACKEND'/);
  assert.match(activityMigration, /operation IN \('ENROLL', 'REVIEW', 'REVIEW_TIMEOUT', 'CANCEL', 'SESSION_CANCEL'\)/);
  for (const migrationName of activityRecoveryMigrationNames) {
    const migration = notificationDeliveryMigrationSql(migrationName);
    assert.equal(manifest.files[migrationName], ACTIVITY_RECOVERY_CHECKSUMS[migrationName]);
    assert.equal(migrationChecksum(migration), ACTIVITY_RECOVERY_CHECKSUMS[migrationName]);
  }
  const activityAuthorizationMigration = notificationDeliveryMigrationSql(activityRecoveryMigrationNames[0]);
  const activityGenerationStageMigration = notificationDeliveryMigrationSql(activityRecoveryMigrationNames[1]);
  const activityGenerationBackfillMigration = notificationDeliveryMigrationSql(activityRecoveryMigrationNames[2]);
  const activityGenerationEnforceMigration = notificationDeliveryMigrationSql(activityRecoveryMigrationNames[3]);
  const activitySessionEventMigration = notificationDeliveryMigrationSql(activityRecoveryMigrationNames[4]);
  assert.equal(splitSqlStatements(activityAuthorizationMigration).length, 1);
  assert.equal(splitSqlStatements(activityGenerationStageMigration).length, 1);
  assert.equal(splitSqlStatements(activityGenerationBackfillMigration).length, 16);
  assert.equal(splitSqlStatements(activityGenerationEnforceMigration).length, 6);
  assert.equal(splitSqlStatements(activitySessionEventMigration).length, 1);
  assert.equal(permanentAlterStatements(activityAuthorizationMigration).length, 1);
  assert.equal(permanentAlterStatements(activityGenerationStageMigration).length, 1);
  assert.equal(permanentAlterStatements(activityGenerationEnforceMigration).length, 1);
  assert.match(activityAuthorizationMigration, /UNIQUE KEY uk_activity_definition_publication_decision/);
  assert.match(activityAuthorizationMigration, /controlled_approval_ref IS NOT NULL/);
  assert.match(activityAuthorizationMigration, /content_authorization_digest IS NOT NULL/);
  assert.match(activityAuthorizationMigration, /ued_acceptance_digest IS NOT NULL/);
  assert.match(activityAuthorizationMigration, /photography_authorization_digest IS NOT NULL/);
  assert.match(activityAuthorizationMigration, /artifact_provenance_digest IS NOT NULL/);
  assert.match(activityAuthorizationMigration, /artifact_provenance_digest CHAR\(64\)/);
  assert.match(activityAuthorizationMigration, /status = 'PUBLISHED'[\s\S]+authorization_verified_at IS NOT NULL/);
  assert.match(activityGenerationStageMigration, /ADD COLUMN attempt_generation INT UNSIGNED NULL/);
  assert.match(activityGenerationBackfillMigration, /SUM\(CASE WHEN operation = 'ENROLL' THEN 1 ELSE 0 END\) OVER/);
  assert.match(activityGenerationBackfillMigration, /ROW_NUMBER\(\) OVER/);
  assert.match(activityGenerationBackfillMigration, /LAG\(to_status\) OVER/);
  assert.match(activityGenerationBackfillMigration, /stream\.final_generation <> enrollment\.attempt_generation/);
  assert.match(
    activityGenerationBackfillMigration,
    /CREATE TEMPORARY TABLE migration_037_activity_event_generation_stream/
  );
  assert.match(
    activityGenerationBackfillMigration,
    /JOIN migration_037_activity_event_generation_stream AS stream/
  );
  assert.doesNotMatch(
    activityGenerationBackfillMigration,
    /JOIN \(\s*SELECT[\s\S]*FROM migration_037_activity_event_generation_derived[\s\S]*\) AS stream/
  );
  assert.match(activityGenerationBackfillMigration, /LEFT JOIN migration_037_activity_event_generation_derived/);
  assert.match(activityGenerationBackfillMigration, /WHERE event\.attempt_generation IS NULL/);
  assert.match(activityGenerationEnforceMigration, /MODIFY COLUMN attempt_generation INT UNSIGNED NOT NULL/);
  assert.match(activityGenerationEnforceMigration, /chk_activity_enrollment_event_generation/);
  assert.match(activitySessionEventMigration, /CREATE TABLE IF NOT EXISTS activity_session_event/);
  assert.match(activitySessionEventMigration, /UNIQUE KEY uk_activity_session_event_request \(request_id\)/);
  assert.match(activitySessionEventMigration, /UNIQUE KEY uk_activity_session_event_operation \(activity_session_id, operation\)/);

  for (const migrationName of [
    activityP0MigrationName,
    ...activityTaskSourceMigrationNames,
    ...activityPolicyRecoveryMigrationNames,
  ]) {
    const migration = notificationDeliveryMigrationSql(migrationName);
    assert.equal(manifest.files[migrationName], ACTIVITY_TASK_SOURCE_CHECKSUMS[migrationName]);
    assert.equal(migrationChecksum(migration), ACTIVITY_TASK_SOURCE_CHECKSUMS[migrationName]);
  }
  for (const migrationName of taskEventIdempotencyMigrationNames) {
    const migration = notificationDeliveryMigrationSql(migrationName);
    assert.equal(manifest.files[migrationName], TASK_EVENT_IDEMPOTENCY_CHECKSUMS[migrationName]);
    assert.equal(migrationChecksum(migration), TASK_EVENT_IDEMPOTENCY_CHECKSUMS[migrationName]);
  }
  for (const migrationName of wechatRecipientAuthorityMigrationNames) {
    const migration = notificationDeliveryMigrationSql(migrationName);
    assert.equal(manifest.files[migrationName], WECHAT_RECIPIENT_AUTHORITY_CHECKSUMS[migrationName]);
    assert.equal(migrationChecksum(migration), WECHAT_RECIPIENT_AUTHORITY_CHECKSUMS[migrationName]);
  }
  for (const [index, migrationName] of notificationProviderCallFenceMigrationNames.entries()) {
    const migration = notificationDeliveryMigrationSql(migrationName);
    assert.equal(
      manifest.files[migrationName],
      NOTIFICATION_PROVIDER_CALL_FENCE_CHECKSUMS[migrationName]
    );
    assert.equal(
      migrationChecksum(migration),
      NOTIFICATION_PROVIDER_CALL_FENCE_CHECKSUMS[migrationName]
    );
    assert.equal(splitSqlStatements(migration).length, [1, 1, 6][index]);
    assert.equal(permanentAlterStatements(migration).length, [1, 0, 1][index]);
  }
  const runtimeAlertDeliveryMigration = notificationDeliveryMigrationSql(
    runtimeAlertDeliveryMigrationName
  );
  assert.equal(
    manifest.files[runtimeAlertDeliveryMigrationName],
    RUNTIME_ALERT_DELIVERY_CHECKSUM
  );
  assert.equal(
    migrationChecksum(runtimeAlertDeliveryMigration),
    RUNTIME_ALERT_DELIVERY_CHECKSUM
  );
  assert.equal(splitSqlStatements(runtimeAlertDeliveryMigration).length, 1);
  assert.equal(permanentAlterStatements(runtimeAlertDeliveryMigration).length, 0);
  const settlementSourceAuthorityMigration = notificationDeliveryMigrationSql(
    settlementSourceAuthorityMigrationName
  );
  assert.equal(
    manifest.files[settlementSourceAuthorityMigrationName],
    SETTLEMENT_SOURCE_AUTHORITY_CHECKSUM
  );
  assert.equal(
    migrationChecksum(settlementSourceAuthorityMigration),
    SETTLEMENT_SOURCE_AUTHORITY_CHECKSUM
  );
  assert.equal(splitSqlStatements(settlementSourceAuthorityMigration).length, 3);
  assert.equal(permanentAlterStatements(settlementSourceAuthorityMigration).length, 1);
  const runtimeAlertDatabaseAuthorityMigration = notificationDeliveryMigrationSql(
    runtimeAlertDatabaseAuthorityMigrationName
  );
  assert.equal(
    manifest.files[runtimeAlertDatabaseAuthorityMigrationName],
    RUNTIME_ALERT_DATABASE_AUTHORITY_CHECKSUM
  );
  assert.equal(
    migrationChecksum(runtimeAlertDatabaseAuthorityMigration),
    RUNTIME_ALERT_DATABASE_AUTHORITY_CHECKSUM
  );
  assert.equal(splitSqlStatements(runtimeAlertDatabaseAuthorityMigration).length, 25);
  assert.equal(permanentAlterStatements(runtimeAlertDatabaseAuthorityMigration).length, 0);
  const runtimeControlLedgerAuthorityMigration = notificationDeliveryMigrationSql(
    runtimeControlLedgerAuthorityMigrationName
  );
  assert.equal(
    manifest.files[runtimeControlLedgerAuthorityMigrationName],
    RUNTIME_CONTROL_LEDGER_AUTHORITY_CHECKSUM
  );
  assert.equal(
    migrationChecksum(runtimeControlLedgerAuthorityMigration),
    RUNTIME_CONTROL_LEDGER_AUTHORITY_CHECKSUM
  );
  assert.equal(permanentAlterStatements(runtimeControlLedgerAuthorityMigration).length, 0);
  const runtimeAlertRegistrationReturnRowMigration = notificationDeliveryMigrationSql(
    runtimeAlertRegistrationReturnRowMigrationName
  );
  assert.equal(
    manifest.files[runtimeAlertRegistrationReturnRowMigrationName],
    RUNTIME_ALERT_REGISTRATION_RETURN_ROW_CHECKSUM
  );
  assert.equal(
    migrationChecksum(runtimeAlertRegistrationReturnRowMigration),
    RUNTIME_ALERT_REGISTRATION_RETURN_ROW_CHECKSUM
  );
  assert.equal(splitSqlStatements(runtimeAlertRegistrationReturnRowMigration).length, 4);
  assert.equal(permanentAlterStatements(runtimeAlertRegistrationReturnRowMigration).length, 0);
  const runtimeAlertSeveritySloAuthorityMigration = notificationDeliveryMigrationSql(
    runtimeAlertSeveritySloAuthorityMigrationName
  );
  assert.equal(
    manifest.files[runtimeAlertSeveritySloAuthorityMigrationName],
    RUNTIME_ALERT_SEVERITY_SLO_AUTHORITY_CHECKSUM
  );
  assert.equal(
    migrationChecksum(runtimeAlertSeveritySloAuthorityMigration),
    RUNTIME_ALERT_SEVERITY_SLO_AUTHORITY_CHECKSUM
  );
  assert.equal(splitSqlStatements(runtimeAlertSeveritySloAuthorityMigration).length, 4);
  assert.equal(permanentAlterStatements(runtimeAlertSeveritySloAuthorityMigration).length, 0);
  for (const migrationName of wechatRecipientAuthorityMigrationNames.slice(3, 5)) {
    const migration = notificationDeliveryMigrationSql(migrationName);
    assert.equal(splitSqlStatements(migration).length, 1, migrationName);
    assert.equal(permanentAlterStatements(migration).length, 1, migrationName);
  }
  for (const migrationName of wechatRecipientAuthorityMigrationNames.slice(5, 7)) {
    const migration = notificationDeliveryMigrationSql(migrationName);
    assert.equal(splitSqlStatements(migration).length, 1, migrationName);
    assert.equal(permanentAlterStatements(migration).length, 0, migrationName);
    assert.match(
      compact(splitSqlStatements(migration)[0]),
      /^UPDATE notification_subscription_grant(?:_v1)?\b/i
    );
  }
  for (const migrationName of wechatRecipientAuthorityMigrationNames.slice(7)) {
    const migration = notificationDeliveryMigrationSql(migrationName);
    assert.equal(splitSqlStatements(migration).length, 6, migrationName);
    assert.equal(permanentAlterStatements(migration).length, 1, migrationName);
  }
  const activityP0Migration = notificationDeliveryMigrationSql(activityP0MigrationName);
  const taskActivityAssignmentMigration = notificationDeliveryMigrationSql(
    activityTaskSourceMigrationNames[0]
  );
  const taskSourceInvalidationMigration = notificationDeliveryMigrationSql(
    activityTaskSourceMigrationNames[1]
  );
  const activityCancelStageMigration = notificationDeliveryMigrationSql(
    activityPolicyRecoveryMigrationNames[0]
  );
  const activityCancelBackfillMigration = notificationDeliveryMigrationSql(
    activityPolicyRecoveryMigrationNames[1]
  );
  const activityPolicyEnforceMigration = notificationDeliveryMigrationSql(
    activityPolicyRecoveryMigrationNames[2]
  );
  assert.equal(splitSqlStatements(activityP0Migration).length, 6);
  assert.equal(permanentAlterStatements(activityP0Migration).length, 1);
  assert.match(activityP0Migration, /prebound_task_definition_version VARCHAR\(64\)/);
  assert.equal(splitSqlStatements(taskActivityAssignmentMigration).length, 1);
  assert.equal(splitSqlStatements(taskSourceInvalidationMigration).length, 1);
  assert.equal(splitSqlStatements(activityCancelStageMigration).length, 1);
  assert.equal(splitSqlStatements(activityCancelBackfillMigration).length, 1);
  assert.equal(splitSqlStatements(activityPolicyEnforceMigration).length, 6);
  assert.equal(permanentAlterStatements(activityPolicyEnforceMigration).length, 1);
  assert.match(activityCancelStageMigration, /ADD COLUMN cancel_close_at DATETIME\(3\) NULL/);
  assert.match(activityCancelBackfillMigration, /WHERE cancel_close_at IS NULL/);
  assert.match(activityPolicyEnforceMigration, /uk_activity_session_business_time/);
  assert.match(activityPolicyEnforceMigration, /chk_activity_session_cancel_window/);
  assert.match(taskActivityAssignmentMigration, /CREATE TABLE IF NOT EXISTS task_activity_assignment/);
  assert.match(taskActivityAssignmentMigration, /UNIQUE KEY uk_task_activity_assignment_source/);
  assert.match(taskActivityAssignmentMigration, /task_definition_version VARCHAR\(64\)/);
  assert.match(taskActivityAssignmentMigration, /initial_status = 'AVAILABLE'/);
  assert.match(taskSourceInvalidationMigration, /CREATE TABLE IF NOT EXISTS task_source_invalidation_event/);
  assert.match(taskSourceInvalidationMigration, /UNIQUE KEY uk_task_source_invalidation_source_event/);
  assert.match(taskSourceInvalidationMigration, /source_event_type = 'activity\.enrollment\.canceled\.v1'/);

  const storeSource = fs.readFileSync(path.join(__dirname, "..", "src", "store.js"), "utf8");
  assert.match(storeSource, /const MYSQL_SCHEMA_VERSION = 28;/);
});

test("runtime alert delivery schema is privacy-minimized, fenced, and terminally fail-closed", () => {
  const sql = notificationDeliveryMigrationSql(runtimeAlertDeliveryMigrationName);
  const executableSql = compact(splitSqlStatements(sql).join(" "));
  assertSql(sql, /CREATE TABLE IF NOT EXISTS v1_runtime_alert_delivery/i);
  assertSql(
    sql,
    /UNIQUE KEY uk_v1_runtime_alert_delivery_alert_authority \(runtime_alert_id\)/i
  );
  assertSql(sql, /receiver_binding_digest_scheme = 'hmac-sha256:v1'/i);
  assertSql(sql, /registration_mode IN \('DRY_RUN', 'CONTROLLED'\)/i);
  assertSql(
    sql,
    /receiver_binding_authority_version = 'runtime-alert-receiver-authority:v1'/i
  );
  assertSql(sql, /payload_digest_scheme = 'hmac-sha256:v1'/i);
  assertSql(sql, /receipt_digest_scheme = 'hmac-sha256:v1'/i);
  assertSql(
    sql,
    /status = 'DELIVERED'.*receipt_digest IS NOT NULL.*receipt_digest_scheme IS NOT NULL.*receipt_digest_key_id IS NOT NULL/i
  );
  assertSql(
    sql,
    /status IN \('RETRY_WAIT', 'DEAD_LETTER', 'UNKNOWN'\).*stable_error_code IS NOT NULL.*stable_error_code REGEXP/i
  );
  assertSql(
    sql,
    /status IN \( 'PENDING', 'CLAIMED', 'RETRY_WAIT', 'STARTED', 'DELIVERED', 'DEAD_LETTER', 'UNKNOWN' \)/i
  );
  assertSql(
    sql,
    /status = 'STARTED'.*provider_started_at IS NOT NULL.*provider_started_at < lease_expires_at.*provider_completed_at IS NULL/i
  );
  assertSql(
    sql,
    /status = 'UNKNOWN'.*lease_owner IS NULL.*lease_expires_at IS NULL.*provider_started_at IS NOT NULL.*provider_completed_at IS NOT NULL/i
  );
  assertSql(
    sql,
    /status = 'DEAD_LETTER'.*provider_started_at IS NULL.*provider_completed_at IS NOT NULL/i
  );
  assertSql(sql, /slo_class = 'BLOCKER_IMMEDIATE' AND slo_target_seconds = 300/i);
  assertSql(sql, /slo_class = 'WARNING_STANDARD' AND slo_target_seconds = 1800/i);
  assertSql(sql, /maximum_attempts BETWEEN 1 AND 5/i);
  assertSql(sql, /retry_policy_version = 'pre-provider-exponential:v1'/i);
  assert.doesNotMatch(
    executableSql,
    /\b(?:endpoint|secret|person_name|recipient_name|root_user_id|openid|unionid|phone|health|answer|payload_json|receipt_json)\b/i
  );
  assert.doesNotMatch(executableSql, /^(?:UPDATE|DELETE|ALTER)\b/i);
});

test("durable inbox receipt migration fails closed before its only permanent DDL", () => {
  const sql = inboxMigrationSql();
  assert.equal(splitSqlStatements(sql).length, 6);
  assertSql(
    sql,
    /CREATE TEMPORARY TABLE migration_010_durable_inbox_preflight \( guard_id TINYINT UNSIGNED PRIMARY KEY \) ENGINE = InnoDB/i
  );
  assertSql(
    sql,
    /INSERT INTO migration_010_durable_inbox_preflight \(guard_id\) VALUES \(1\)/i
  );
  assertSql(
    sql,
    /INSERT INTO migration_010_durable_inbox_preflight \(guard_id\) SELECT 1 FROM inbox_receipt LIMIT 1/i
  );
  assertSql(sql, /DROP TEMPORARY TABLE migration_010_durable_inbox_preflight/i);
  assert.doesNotMatch(compact(sql), /UPDATE inbox_receipt SET/i);
  assert.doesNotMatch(compact(sql), /UPDATE consumer_checkpoint SET/i);
  assert.equal(permanentAlterStatements(sql).length, 1);
  assert.doesNotMatch(compact(sql), /ALTER TABLE consumer_checkpoint/i);
  assert.doesNotMatch(compact(sql), /ALTER TABLE event_dead_letter/i);

  assertSql(sql, /ALTER TABLE inbox_receipt/i);
  for (const [column, length] of [
    ["consumer_name", 128],
    ["source_name", 96],
    ["partition_key", 191],
    ["event_id", 64],
    ["event_type", 128],
    ["aggregate_type", 96],
    ["aggregate_id", 191],
  ]) {
    assertSql(
      sql,
      new RegExp(`MODIFY COLUMN ${column} VARCHAR\\(${length}\\) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`, "i")
    );
  }
  for (const [column, length] of [
    ["schema_version", 32],
    ["handler_version", 64],
  ]) {
    assertSql(
      sql,
      new RegExp(`MODIFY COLUMN ${column} VARCHAR\\(${length}\\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL`, "i")
    );
  }
  assertSql(
    sql,
    /MODIFY COLUMN payload_digest CHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/i
  );
  assertSql(
    sql,
    /MODIFY COLUMN status VARCHAR\(32\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/i
  );
  assertSql(sql, /MODIFY COLUMN attempt_count INT UNSIGNED NOT NULL DEFAULT 0/i);

  assertSql(sql, /ADD COLUMN occurred_at DATETIME\(3\) NOT NULL AFTER aggregate_version/i);
  assertSql(
    sql,
    /ADD COLUMN producer_version VARCHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL AFTER occurred_at/i
  );
  assertSql(
    sql,
    /ADD COLUMN correlation_id VARCHAR\(128\) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL AFTER producer_version/i
  );
  assertSql(
    sql,
    /ADD COLUMN causation_id VARCHAR\(128\) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL AFTER correlation_id/i
  );
  assertSql(
    sql,
    /ADD COLUMN idempotency_key VARCHAR\(191\) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL AFTER causation_id/i
  );
  assertSql(sql, /ADD COLUMN max_attempts INT UNSIGNED NOT NULL DEFAULT 5/i);
  assertSql(
    sql,
    /ADD COLUMN retry_policy_version VARCHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'inbox-retry-v1'/i
  );
  assertSql(sql, /ADD COLUMN next_retry_at DATETIME\(3\) NULL/i);
  assertSql(
    sql,
    /ADD COLUMN lease_owner VARCHAR\(128\) CHARACTER SET ascii COLLATE ascii_bin NULL/i
  );
  assertSql(sql, /ADD COLUMN lease_expires_at DATETIME\(3\) NULL/i);
  assertSql(sql, /ADD COLUMN lease_generation BIGINT UNSIGNED NOT NULL DEFAULT 0/i);
  assertSql(
    sql,
    /ADD COLUMN inbox_transition_id VARCHAR\(128\) CHARACTER SET ascii COLLATE ascii_bin NULL/i
  );
  assertSql(
    sql,
    /ADD COLUMN result_digest CHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NULL/i
  );
  assertSql(
    sql,
    /ADD COLUMN completion_manifest_digest CHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NULL/i
  );
  assertSql(sql, /ADD COLUMN dead_lettered_at DATETIME\(3\) NULL/i);

  for (const status of [
    "RECEIVED",
    "CLAIMED",
    "RETRY_PENDING",
    "SUCCEEDED",
    "DEAD_LETTER",
    "REVIEW_REQUIRED",
  ]) {
    assertSql(sql, new RegExp(`'${status}'`, "i"));
  }
  assertSql(sql, /ADD CONSTRAINT chk_inbox_receipt_status_supported CHECK \(status IN/i);
  assertSql(sql, /ADD CONSTRAINT chk_inbox_partition_position_positive CHECK \(partition_position >= 1\)/i);
  assertSql(sql, /ADD CONSTRAINT chk_inbox_attempt_bounds CHECK \(max_attempts >= 1 AND attempt_count <= max_attempts\)/i);
  assertSql(sql, /ADD CONSTRAINT chk_inbox_lease_shape CHECK/i);
  assertSql(sql, /ADD CONSTRAINT chk_inbox_retry_shape CHECK/i);
  assertSql(sql, /ADD CONSTRAINT chk_inbox_completion_shape CHECK/i);
  assertSql(sql, /status = 'SUCCEEDED'.*result_json IS NOT NULL.*result_digest IS NOT NULL.*completion_manifest_digest IS NOT NULL.*inbox_transition_id IS NOT NULL/i);
  assertSql(sql, /ADD CONSTRAINT chk_inbox_dead_letter_shape CHECK/i);

  assertSql(
    sql,
    /ADD KEY idx_inbox_retry_due \( status, retry_policy_version, next_retry_at, inbox_receipt_id \)/i
  );
  assertSql(
    sql,
    /ADD KEY idx_inbox_lease_recovery \( status, lease_expires_at, inbox_receipt_id \)/i
  );
  assertSql(
    sql,
    /ADD KEY idx_inbox_lease_owner \( lease_owner, status, lease_generation \)/i
  );
  assertSql(
    sql,
    /ADD KEY idx_inbox_transition \( inbox_transition_id, inbox_receipt_id \)/i
  );
  assertSql(
    sql,
    /ADD KEY idx_inbox_partition_head \( consumer_name, source_name, partition_key, partition_position, status \)/i
  );
  assertSql(
    sql,
    /ADD KEY idx_inbox_idempotency \( consumer_name, idempotency_key, event_id \)/i
  );
});

test("durable consumer checkpoint migration fails closed before its only permanent DDL", () => {
  const sql = checkpointMigrationSql();
  assert.equal(splitSqlStatements(sql).length, 6);
  assertSql(
    sql,
    /CREATE TEMPORARY TABLE migration_011_consumer_checkpoint_preflight \( guard_id TINYINT UNSIGNED PRIMARY KEY \) ENGINE = InnoDB/i
  );
  assertSql(
    sql,
    /INSERT INTO migration_011_consumer_checkpoint_preflight \(guard_id\) SELECT 1 FROM consumer_checkpoint LIMIT 1/i
  );
  assertSql(sql, /DROP TEMPORARY TABLE migration_011_consumer_checkpoint_preflight/i);
  assert.equal(permanentAlterStatements(sql).length, 1);
  assert.doesNotMatch(compact(sql), /ALTER TABLE inbox_receipt/i);
  assert.doesNotMatch(compact(sql), /ALTER TABLE event_dead_letter/i);
  assertSql(sql, /ALTER TABLE consumer_checkpoint/i);
  for (const [column, length] of [
    ["consumer_name", 128],
    ["source_name", 96],
    ["partition_key", 191],
  ]) {
    assertSql(
      sql,
      new RegExp(`MODIFY COLUMN ${column} VARCHAR\\(${length}\\) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`, "i")
    );
  }
  assertSql(sql, /ADD COLUMN state_generation BIGINT UNSIGNED NOT NULL DEFAULT 0/i);
  assertSql(
    sql,
    /ADD COLUMN checkpoint_transition_id VARCHAR\(128\) CHARACTER SET ascii COLLATE ascii_bin NULL/i
  );
  assertSql(
    sql,
    /ADD COLUMN gap_reason_code VARCHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NULL/i
  );
  assertSql(
    sql,
    /ADD COLUMN blocked_receipt_id VARCHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NULL/i
  );
  assertSql(
    sql,
    /ADD CONSTRAINT chk_checkpoint_position_order CHECK \(last_contiguous_position <= high_watermark_position\)/i
  );
  assertSql(sql, /ADD CONSTRAINT chk_checkpoint_last_receipt_shape CHECK/i);
  assertSql(sql, /ADD CONSTRAINT chk_checkpoint_gap_shape CHECK/i);
  assertSql(sql, /gap_from_position = last_contiguous_position \+ 1/i);
  assertSql(sql, /gap_to_position <= high_watermark_position/i);
  for (const status of ["CLEAR", "MISSING", "BLOCKED_DEAD_LETTER", "REVIEW_REQUIRED"]) {
    assertSql(sql, new RegExp(`gap_status = '${status}'`, "i"));
  }
  assertSql(
    sql,
    /ADD KEY idx_checkpoint_dispatch \( gap_status, consumer_name, source_name, partition_key \)/i
  );
  assertSql(
    sql,
    /ADD KEY idx_checkpoint_handler \( handler_version, gap_status, updated_at \)/i
  );
  assertSql(
    sql,
    /ADD KEY idx_checkpoint_transition \( checkpoint_transition_id, consumer_checkpoint_id \)/i
  );
});

test("durable inbox dead-letter migration fails closed before its only permanent DDL", () => {
  const sql = inboxDeadLetterMigrationSql();
  assert.equal(splitSqlStatements(sql).length, 6);
  assertSql(
    sql,
    /CREATE TEMPORARY TABLE migration_012_inbox_dead_letter_preflight \( guard_id TINYINT UNSIGNED PRIMARY KEY \) ENGINE = InnoDB/i
  );
  assertSql(
    sql,
    /INSERT INTO migration_012_inbox_dead_letter_preflight \(guard_id\) SELECT 1 FROM event_dead_letter WHERE direction = 'INBOX' LIMIT 1/i
  );
  assertSql(sql, /DROP TEMPORARY TABLE migration_012_inbox_dead_letter_preflight/i);
  assert.equal(permanentAlterStatements(sql).length, 1);
  assert.doesNotMatch(compact(sql), /ALTER TABLE inbox_receipt/i);
  assert.doesNotMatch(compact(sql), /ALTER TABLE consumer_checkpoint/i);
  assertSql(sql, /ALTER TABLE event_dead_letter/i);
  assertSql(sql, /ADD COLUMN source_lease_generation BIGINT UNSIGNED NULL/i);
  assertSql(
    sql,
    /ADD COLUMN source_transition_id VARCHAR\(128\) CHARACTER SET ascii COLLATE ascii_bin NULL/i
  );
  assertSql(
    sql,
    /ALTER TABLE event_dead_letter .* MODIFY COLUMN event_type VARCHAR\(128\) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL/i
  );
  assertSql(
    sql,
    /ADD CONSTRAINT chk_dead_letter_direction_supported CHECK \(direction IN \('OUTBOX', 'INBOX'\)\)/i
  );
  assertSql(sql, /ADD CONSTRAINT chk_dead_letter_inbox_metadata CHECK/i);
  assertSql(sql, /direction <> 'INBOX'.*consumer_name IS NOT NULL.*source_lease_generation IS NOT NULL.*source_transition_id IS NOT NULL.*payload_json IS NULL/i);
  assertSql(
    sql,
    /ADD KEY idx_dead_letter_source_transition \( direction, source_transition_id, source_record_id \)/i
  );
  assertSql(
    sql,
    /ADD KEY idx_dead_letter_inbox_open \( direction, consumer_name, status, created_at \)/i
  );
});

test("durable inbox content protection metadata fails closed and makes key inventory queryable", () => {
  const sql = inboxContentProtectionMigrationSql();
  assert.equal(splitSqlStatements(sql).length, 6);
  assertSql(
    sql,
    /CREATE TEMPORARY TABLE migration_013_inbox_content_protection_preflight \( guard_id TINYINT UNSIGNED PRIMARY KEY \) ENGINE = InnoDB/i
  );
  assertSql(
    sql,
    /INSERT INTO migration_013_inbox_content_protection_preflight \(guard_id\) VALUES \(1\)/i
  );
  assertSql(
    sql,
    /INSERT INTO migration_013_inbox_content_protection_preflight \(guard_id\) SELECT 1 FROM inbox_receipt LIMIT 1/i
  );
  assertSql(sql, /DROP TEMPORARY TABLE migration_013_inbox_content_protection_preflight/i);
  assert.doesNotMatch(compact(sql), /UPDATE inbox_receipt SET/i);
  assert.equal(permanentAlterStatements(sql).length, 1);
  assert.doesNotMatch(compact(sql), /ALTER TABLE consumer_checkpoint/i);
  assert.doesNotMatch(compact(sql), /ALTER TABLE event_dead_letter/i);
  assertSql(sql, /ALTER TABLE inbox_receipt/i);

  for (const column of [
    "payload_codec_version",
    "payload_digest_scheme",
    "result_codec_version",
    "result_digest_scheme",
    "completion_manifest_digest_scheme",
  ]) {
    assertSql(
      sql,
      new RegExp(`ADD COLUMN ${column} VARCHAR\\(32\\) CHARACTER SET ascii COLLATE ascii_bin`, "i")
    );
  }
  for (const column of ["payload_key_id", "result_key_id"]) {
    assertSql(
      sql,
      new RegExp(`ADD COLUMN ${column} VARCHAR\\(64\\) CHARACTER SET ascii COLLATE ascii_bin`, "i")
    );
  }

  assertSql(sql, /ADD CONSTRAINT chk_inbox_payload_protection_metadata CHECK/i);
  assertSql(sql, /payload_codec_version = 'A256GCM:v1'/i);
  assertSql(sql, /payload_digest_scheme = 'hmac-sha256:v1'/i);
  assertSql(sql, /payload_key_id REGEXP '\^\[A-Za-z0-9\]\[A-Za-z0-9\._-\]\{0,63\}\$'/i);
  assertSql(sql, /payload_digest REGEXP '\^\[0-9a-f\]\{64\}\$'/i);
  assertSql(sql, /JSON_TYPE\(payload_json\) = 'OBJECT'/i);
  assertSql(sql, /JSON_LENGTH\(payload_json\) = 10/i);
  assertSql(sql, /JSON_CONTAINS_PATH\( payload_json, 'all', '\$\.bindingDigest'.*'\$\.tag' \) = 1/i);
  assertSql(sql, /JSON_UNQUOTE\(JSON_EXTRACT\(payload_json, '\$\.purpose'\)\) = 'PAYLOAD'/i);
  assertSql(sql, /JSON_UNQUOTE\(JSON_EXTRACT\(payload_json, '\$\.contentDigest'\)\) = payload_digest/i);
  assertSql(sql, /JSON_UNQUOTE\(JSON_EXTRACT\(payload_json, '\$\.bindingDigest'\)\) REGEXP '\^\[0-9a-f\]\{64\}\$'/i);
  for (const field of ["ciphertext", "iv", "tag"]) {
    assertSql(
      sql,
      new RegExp(`JSON_TYPE\\(JSON_EXTRACT\\(payload_json, '\\\$.${field}'\\)\\) = 'STRING'`, "i")
    );
  }

  assertSql(sql, /ADD CONSTRAINT chk_inbox_result_protection_metadata CHECK/i);
  assertSql(sql, /status = 'SUCCEEDED'.*result_codec_version = 'A256GCM:v1'/i);
  assertSql(sql, /result_digest_scheme = 'hmac-sha256:v1'/i);
  assertSql(sql, /completion_manifest_digest_scheme = 'hmac-sha256:v1'/i);
  assertSql(sql, /result_key_id REGEXP '\^\[A-Za-z0-9\]\[A-Za-z0-9\._-\]\{0,63\}\$'/i);
  assertSql(sql, /result_digest REGEXP '\^\[0-9a-f\]\{64\}\$'/i);
  assertSql(sql, /completion_manifest_digest REGEXP '\^\[0-9a-f\]\{64\}\$'/i);
  assertSql(sql, /JSON_TYPE\(result_json\) = 'OBJECT'/i);
  assertSql(sql, /JSON_LENGTH\(result_json\) = 10/i);
  assertSql(sql, /JSON_CONTAINS_PATH\( result_json, 'all', '\$\.bindingDigest'.*'\$\.tag' \) = 1/i);
  assertSql(sql, /JSON_UNQUOTE\(JSON_EXTRACT\(result_json, '\$\.purpose'\)\) = 'RESULT'/i);
  assertSql(sql, /status <> 'SUCCEEDED'.*result_codec_version IS NULL.*result_key_id IS NULL.*result_digest_scheme IS NULL.*completion_manifest_digest_scheme IS NULL/i);

  assertSql(
    sql,
    /ADD KEY idx_inbox_payload_key_inventory \(payload_codec_version, payload_key_id, status\)/i
  );
  assertSql(
    sql,
    /ADD KEY idx_inbox_result_key_inventory \(result_codec_version, result_key_id, status\)/i
  );
});

test("durable inbox handler identity fails closed before its only permanent DDL", () => {
  const sql = inboxHandlerIdentityMigrationSql();
  assert.equal(splitSqlStatements(sql).length, 6);
  assertSql(
    sql,
    /CREATE TEMPORARY TABLE migration_014_inbox_handler_identity_preflight \( guard_id TINYINT UNSIGNED PRIMARY KEY \) ENGINE = InnoDB/i
  );
  assertSql(
    sql,
    /INSERT INTO migration_014_inbox_handler_identity_preflight \(guard_id\) VALUES \(1\)/i
  );
  assertSql(
    sql,
    /INSERT INTO migration_014_inbox_handler_identity_preflight \(guard_id\) SELECT 1 FROM inbox_receipt LIMIT 1/i
  );
  assertSql(sql, /DROP TEMPORARY TABLE migration_014_inbox_handler_identity_preflight/i);
  assert.doesNotMatch(compact(sql), /UPDATE inbox_receipt SET/i);
  assert.equal(permanentAlterStatements(sql).length, 1);
  assert.doesNotMatch(compact(sql), /ALTER TABLE consumer_checkpoint/i);
  assert.doesNotMatch(compact(sql), /ALTER TABLE event_dead_letter/i);
  assertSql(sql, /ALTER TABLE inbox_receipt/i);
  assertSql(
    sql,
    /ADD COLUMN handler_id VARCHAR\(96\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL AFTER handler_version/i
  );
  assertSql(
    sql,
    /ADD COLUMN handler_registry_version INT UNSIGNED NOT NULL AFTER handler_id/i
  );
  assertSql(
    sql,
    /ADD COLUMN handler_descriptor_digest CHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL AFTER handler_registry_version/i
  );
  assertSql(
    sql,
    /ADD COLUMN handler_source_digest CHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL AFTER handler_descriptor_digest/i
  );
  assertSql(
    sql,
    /ADD COLUMN handler_registration_digest CHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL AFTER handler_source_digest/i
  );
  assertSql(sql, /ADD CONSTRAINT chk_inbox_handler_id_supported CHECK \(handler_id REGEXP '\^\[A-Za-z0-9\]\[A-Za-z0-9\._:-\]\{0,95\}\$'\)/i);
  assertSql(sql, /ADD CONSTRAINT chk_inbox_handler_registry_version_positive CHECK \(handler_registry_version >= 1\)/i);
  assertSql(sql, /ADD CONSTRAINT chk_inbox_handler_descriptor_digest_lower_hex CHECK \(handler_descriptor_digest REGEXP '\^\[0-9a-f\]\{64\}\$'\)/i);
  assertSql(sql, /ADD CONSTRAINT chk_inbox_handler_source_digest_lower_hex CHECK \(handler_source_digest REGEXP '\^\[0-9a-f\]\{64\}\$'\)/i);
  assertSql(sql, /ADD CONSTRAINT chk_inbox_handler_registration_digest_lower_hex CHECK \(handler_registration_digest REGEXP '\^\[0-9a-f\]\{64\}\$'\)/i);
  assertSql(
    sql,
    /ADD KEY idx_inbox_handler_inventory \( handler_registry_version, handler_id, handler_descriptor_digest, handler_source_digest, handler_registration_digest, status \)/i
  );
});

test("task SHARE completion projection is privacy-minimized and freezes the handler contract", () => {
  const sql = taskShareProjectionMigrationSql();
  const executableSql = compact(splitSqlStatements(sql).join(" "));
  assert.equal(splitSqlStatements(sql).length, 1);
  assert.equal(permanentAlterStatements(sql).length, 0);
  assertSql(sql, /CREATE TABLE IF NOT EXISTS task_share_completion_projection \(/i);
  assertSql(sql, /projection_id VARCHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/i);
  assertSql(sql, /projection_generation TINYINT UNSIGNED NOT NULL DEFAULT 1/i);
  assertSql(sql, /task_event_id VARCHAR\(64\) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL/i);
  assertSql(sql, /source_event_id VARCHAR\(64\) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL/i);
  for (const [column, length] of [
    ["source_event_type", 128],
    ["source_schema_version", 32],
    ["task_type", 32],
    ["completion_event_type", 128],
    ["handler_version", 64],
  ]) {
    assertSql(
      sql,
      new RegExp(`${column} VARCHAR\\(${length}\\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL`, "i")
    );
  }
  assertSql(sql, /source_name VARCHAR\(96\) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL/i);
  assertSql(sql, /source_partition_key VARCHAR\(191\) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL/i);
  assertSql(sql, /source_partition_position BIGINT UNSIGNED NOT NULL/i);
  assertSql(sql, /source_aggregate_version BIGINT UNSIGNED NOT NULL/i);
  assertSql(sql, /occurred_at DATETIME\(3\) NOT NULL/i);
  assertSql(sql, /handler_registration_digest CHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/i);
  assertSql(sql, /created_at DATETIME\(3\) NOT NULL/i);
  assertSql(sql, /PRIMARY KEY \(projection_id\)/i);
  assertSql(
    sql,
    /UNIQUE KEY uk_task_share_projection_task_event \( projection_generation, task_event_id \)/i
  );
  assertSql(
    sql,
    /UNIQUE KEY uk_task_share_projection_source_event \( projection_generation, source_event_id \)/i
  );
  assertSql(sql, /CHECK \(projection_generation = 1\)/i);
  assertSql(sql, /source_event_type = 'task\.event\.recorded\.v1'/i);
  assertSql(sql, /source_schema_version = '1'/i);
  assertSql(sql, /source_name = 'myroot-api'/i);
  assertSql(sql, /source_partition_key = CONCAT\('task_event:', task_event_id\)/i);
  assertSql(sql, /source_partition_position = 1/i);
  assertSql(sql, /source_aggregate_version = 1/i);
  assertSql(sql, /task_type = 'SHARE'/i);
  assertSql(sql, /completion_event_type = 'SHARE_COMPLETED'/i);
  assertSql(sql, /handler_version = 'task-share-completion-v1'/i);
  assertSql(sql, /handler_registration_digest REGEXP '\^\[0-9a-f\]\{64\}\$'/i);
  assert.doesNotMatch(
    executableSql,
    /\b(?:root_user_id|user_id|member_id|openid|unionid|phone|payload_json|result_json|health|answer)\b/i
  );
  assert.doesNotMatch(executableSql, /\b(?:UPDATE|DELETE|ALTER)\b/i);
});

test("governed Replay run seals selection, requires two people and fences execution", () => {
  const sql = inboxReplayRunMigrationSql();
  const executableSql = compact(splitSqlStatements(sql).join(" "));
  assert.equal(splitSqlStatements(sql).length, 1);
  assert.equal(permanentAlterStatements(sql).length, 0);
  assertSql(sql, /CREATE TABLE IF NOT EXISTS inbox_replay_run \(/i);
  assertSql(sql, /replay_run_id VARCHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/i);
  assertSql(sql, /replay_mode VARCHAR\(32\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/i);
  assertSql(sql, /status VARCHAR\(32\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/i);
  assertSql(sql, /PRIMARY KEY \(replay_run_id\)/i);

  assertSql(sql, /CHECK \(replay_mode IN \('VERIFY_ONLY', 'SHADOW_REBUILD'\)\)/i);
  for (const status of [
    "APPROVED",
    "RUNNING",
    "SUCCEEDED",
    "FAILED",
    "EXPIRED",
    "REVIEW_REQUIRED",
  ]) {
    assertSql(sql, new RegExp(`'${status}'`, "i"));
  }
  for (const reasonCode of [
    "HANDLER_UPGRADE_VALIDATION",
    "INCIDENT_VERIFICATION",
    "MIGRATION_PARITY_REVIEW",
  ]) {
    assertSql(sql, new RegExp(`'${reasonCode}'`, "i"));
  }
  assertSql(sql, /policy_registry_version INT UNSIGNED NOT NULL/i);
  assertSql(sql, /policy_registry_digest CHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/i);
  assertSql(sql, /policy_id VARCHAR\(96\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/i);
  assertSql(sql, /policy_version INT UNSIGNED NOT NULL/i);
  assertSql(sql, /policy_digest CHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/i);
  assertSql(sql, /policy_registry_version = 1/i);
  assertSql(sql, /policy_registry_digest REGEXP '\^\[0-9a-f\]\{64\}\$'/i);
  assertSql(sql, /policy_version = 1/i);
  assertSql(sql, /policy_digest REGEXP '\^\[0-9a-f\]\{64\}\$'/i);
  assertSql(sql, /replay_mode = 'VERIFY_ONLY'.*policy_id = 'TASK_SHARE_VERIFY_V1'.*target_projection_policy = 'PRODUCTION_GENERATION_1_READ_ONLY'.*shadow_generation IS NULL/i);
  assertSql(sql, /replay_mode = 'SHADOW_REBUILD'.*policy_id = 'TASK_SHARE_SHADOW_REBUILD_V1'.*target_projection_policy = 'SHADOW_GENERATION_GE_2'.*shadow_generation >= 2/i);
  assertSql(
    sql,
    /UNIQUE KEY uk_inbox_replay_scope_generation \( consumer_name, source_name, source_handler_id, shadow_generation \)/i
  );
  assertSql(
    sql,
    /UNIQUE KEY uk_inbox_replay_run_generation \( replay_run_id, shadow_generation \)/i
  );
  assertSql(
    sql,
    /UNIQUE KEY uk_inbox_replay_execution_consumer \( execution_consumer_name \)/i
  );

  assertSql(sql, /consumer_name = 'task-share-completion-projection'/i);
  assertSql(sql, /source_name = 'myroot-api'/i);
  assertSql(sql, /event_type = 'task\.event\.recorded\.v1'/i);
  assertSql(sql, /schema_version = '1'/i);
  assertSql(sql, /aggregate_type = 'TASK_EVENT'/i);
  assertSql(sql, /source_receipt_status = 'SUCCEEDED'/i);
  assertSql(sql, /source_handler_id = 'task-share-completion-projection-v1'/i);
  assertSql(sql, /source_handler_version = 'task-share-completion-v1'/i);
  assertSql(sql, /source_handler_registry_version = 1/i);
  for (const digestColumn of [
    "source_handler_descriptor_digest",
    "source_handler_source_digest",
    "source_handler_registration_digest",
  ]) {
    assertSql(sql, new RegExp(`${digestColumn} REGEXP '\\^\\[0-9a-f\\]\\{64\\}\\$'`, "i"));
  }
  assertSql(sql, /execution_consumer_name REGEXP '\^task-share-verify-v1:\[0-9a-f\]\{32\}\$'/i);
  assertSql(sql, /execution_consumer_name REGEXP '\^task-share-shadow-rebuild-v1:\[0-9a-f\]\{32\}\$'/i);
  assertSql(sql, /execution_handler_id = 'task-share-completion-verify-v1'/i);
  assertSql(sql, /execution_handler_version = 'task-share-verify-v1'/i);
  assertSql(sql, /execution_handler_id = 'task-share-completion-shadow-v1'/i);
  assertSql(sql, /execution_handler_version = 'task-share-shadow-v1'/i);

  assertSql(
    sql,
    /cursor_version = 'FIRST_RECEIVED_AT_RECEIPT_ID_V1'/i
  );
  assertSql(sql, /selection_query_id = 'task_share_succeeded_receipts_by_received_at_v1'/i);
  assertSql(sql, /selection_query_digest REGEXP '\^\[0-9a-f\]\{64\}\$'/i);
  assertSql(sql, /selection_after_first_received_at DATETIME\(3\) NULL/i);
  assertSql(
    sql,
    /selection_after_receipt_id VARCHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NULL/i
  );
  assertSql(sql, /selection_through_first_received_at DATETIME\(3\) NOT NULL/i);
  assertSql(
    sql,
    /selection_through_receipt_id VARCHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/i
  );
  assertSql(sql, /selection_after_first_received_at < selection_through_first_received_at/i);
  assertSql(sql, /selection_after_receipt_id < selection_through_receipt_id/i);
  assertSql(sql, /selection_digest REGEXP '\^\[0-9a-f\]\{64\}\$'/i);
  assertSql(sql, /maximum_selected_count = 10000/i);
  assertSql(sql, /selected_receipt_count BETWEEN 1 AND maximum_selected_count/i);
  assertSql(sql, /authorized_at <= selection_snapshot_at/i);
  assertSql(sql, /selection_snapshot_at < authorization_expires_at/i);

  assertSql(
    sql,
    /requested_by_actor_id VARCHAR\(128\) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL/i
  );
  assertSql(
    sql,
    /authorized_by_actor_id VARCHAR\(128\) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL/i
  );
  assertSql(sql, /requested_by_actor_id <> authorized_by_actor_id/i);
  assertSql(sql, /requested_at <= authorized_at/i);
  assertSql(sql, /authorization_ticket_digest REGEXP '\^\[0-9a-f\]\{64\}\$'/i);
  assertSql(sql, /maximum_authorization_ttl_seconds = 3600/i);
  assertSql(
    sql,
    /authorization_expires_at >= TIMESTAMPADD\( SECOND, 60, authorized_at \)/i
  );
  assertSql(
    sql,
    /authorization_expires_at <= TIMESTAMPADD\( SECOND, maximum_authorization_ttl_seconds, authorized_at \)/i
  );

  assertSql(sql, /lease_generation BIGINT UNSIGNED NOT NULL DEFAULT 0/i);
  assertSql(
    sql,
    /replay_transition_id VARCHAR\(128\) CHARACTER SET ascii COLLATE ascii_bin NULL/i
  );
  assertSql(sql, /status = 'RUNNING'.*lease_owner IS NOT NULL.*lease_expires_at IS NOT NULL.*lease_generation >= 1.*replay_transition_id IS NOT NULL/i);
  assertSql(sql, /status = 'SUCCEEDED'.*lease_owner IS NULL.*lease_expires_at IS NULL.*lease_generation >= 1.*replay_transition_id IS NOT NULL/i);
  assertSql(
    sql,
    /KEY idx_inbox_replay_lease_recovery \( status, lease_expires_at, lease_generation, replay_run_id \)/i
  );

  assertSql(sql, /processed_receipt_count <= selected_receipt_count/i);
  assertSql(
    sql,
    /verified_receipt_count \+ failed_receipt_count = processed_receipt_count/i
  );
  assertSql(
    sql,
    /replay_mode = 'VERIFY_ONLY'.*shadow_inserted_count = 0.*shadow_replayed_count = 0/i
  );
  assertSql(
    sql,
    /replay_mode = 'SHADOW_REBUILD'.*shadow_inserted_count \+ shadow_replayed_count = verified_receipt_count/i
  );
  assertSql(
    sql,
    /status = 'SUCCEEDED'.*processed_receipt_count = selected_receipt_count.*verified_receipt_count = selected_receipt_count.*failed_receipt_count = 0/i
  );

  assert.doesNotMatch(
    executableSql,
    /\b(?:root_user_id|user_id|member_id|openid|unionid|phone|payload_json|result_json|health|answer|reason_text|error_json)\b/i
  );
  assert.doesNotMatch(executableSql, /\b(?:UPDATE|DELETE|ALTER)\b/i);
});

test("task SHARE Replay shadow is generation-isolated, privacy-minimized and bound to authority", () => {
  const sql = taskShareShadowProjectionMigrationSql();
  const executableSql = compact(splitSqlStatements(sql).join(" "));
  assert.equal(splitSqlStatements(sql).length, 1);
  assert.equal(permanentAlterStatements(sql).length, 0);
  assertSql(
    sql,
    /CREATE TABLE IF NOT EXISTS task_share_completion_shadow_projection \(/i
  );
  assertSql(
    sql,
    /shadow_projection_id VARCHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/i
  );
  assertSql(
    sql,
    /replay_run_id VARCHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/i
  );
  assertSql(sql, /projection_generation BIGINT UNSIGNED NOT NULL/i);
  assertSql(sql, /CHECK \(projection_generation >= 2\)/i);
  assert.doesNotMatch(executableSql, /projection_generation\s*=\s*1/i);
  assertSql(
    sql,
    /source_receipt_id VARCHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/i
  );
  assertSql(sql, /PRIMARY KEY \(shadow_projection_id\)/i);
  assertSql(
    sql,
    /UNIQUE KEY uk_task_share_shadow_receipt \( replay_run_id, source_receipt_id \)/i
  );
  assertSql(
    sql,
    /UNIQUE KEY uk_task_share_shadow_task_event \( projection_generation, task_event_id \)/i
  );
  assertSql(
    sql,
    /UNIQUE KEY uk_task_share_shadow_source_event \( projection_generation, source_event_id \)/i
  );
  assertSql(
    sql,
    /FOREIGN KEY \(replay_run_id, projection_generation\) REFERENCES inbox_replay_run \(replay_run_id, shadow_generation\) ON UPDATE RESTRICT ON DELETE RESTRICT/i
  );
  assertSql(
    sql,
    /FOREIGN KEY \(source_receipt_id\) REFERENCES inbox_receipt \(inbox_receipt_id\) ON UPDATE RESTRICT ON DELETE RESTRICT/i
  );

  assertSql(sql, /source_event_type = 'task\.event\.recorded\.v1'/i);
  assertSql(sql, /source_schema_version = '1'/i);
  assertSql(sql, /source_name = 'myroot-api'/i);
  assertSql(sql, /source_partition_key = CONCAT\('task_event:', task_event_id\)/i);
  assertSql(sql, /source_partition_position = 1/i);
  assertSql(sql, /source_aggregate_version = 1/i);
  assertSql(sql, /task_type = 'SHARE'/i);
  assertSql(sql, /completion_event_type = 'SHARE_COMPLETED'/i);
  assertSql(sql, /source_handler_registration_digest REGEXP '\^\[0-9a-f\]\{64\}\$'/i);
  assertSql(sql, /execution_handler_id = 'task-share-completion-shadow-v1'/i);
  assertSql(sql, /execution_handler_version = 'task-share-shadow-v1'/i);
  assert.doesNotMatch(
    executableSql,
    /\b(?:root_user_id|user_id|member_id|openid|unionid|phone|payload_json|result_json|health|answer)\b/i
  );
  assert.doesNotMatch(executableSql, /^(?:UPDATE|DELETE|ALTER)\b/i);
});

test("Replay executor identity migration fails closed before one exact additive ALTER", () => {
  const sql = replayExecutorIdentityMigrationSql();
  const executableSql = compact(splitSqlStatements(sql).join(" "));
  assert.equal(splitSqlStatements(sql).length, 6);
  assert.equal(permanentAlterStatements(sql).length, 1);
  assertSql(
    sql,
    /CREATE TEMPORARY TABLE migration_023_replay_executor_identity_preflight \( guard_id TINYINT UNSIGNED PRIMARY KEY \) ENGINE = InnoDB/i
  );
  assertSql(
    sql,
    /INSERT INTO migration_023_replay_executor_identity_preflight \(guard_id\) VALUES \(1\)/i
  );
  assertSql(
    sql,
    /INSERT INTO migration_023_replay_executor_identity_preflight \(guard_id\) SELECT 1 FROM inbox_replay_run LIMIT 1/i
  );
  assertSql(
    sql,
    /DROP TEMPORARY TABLE migration_023_replay_executor_identity_preflight/i
  );
  assert.doesNotMatch(executableSql, /UPDATE inbox_replay_run SET/i);

  assertSql(sql, /ALTER TABLE inbox_replay_run/i);
  assertSql(
    sql,
    /ADD COLUMN execution_executor_registry_version INT UNSIGNED NULL AFTER execution_handler_version/i
  );
  for (const [column, anchor] of [
    ["execution_executor_registry_digest", "execution_executor_registry_version"],
    ["execution_executor_descriptor_digest", "execution_executor_registry_digest"],
    ["execution_executor_source_digest", "execution_executor_descriptor_digest"],
    ["execution_executor_registration_digest", "execution_executor_source_digest"],
  ]) {
    assertSql(
      sql,
      new RegExp(
        `ADD COLUMN ${column} CHAR\\(64\\) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER ${anchor}`,
        "i"
      )
    );
  }
  assertSql(
    sql,
    /replay_mode = 'VERIFY_ONLY'.*execution_executor_registry_version IS NULL.*execution_executor_registry_digest IS NULL.*execution_executor_descriptor_digest IS NULL.*execution_executor_source_digest IS NULL.*execution_executor_registration_digest IS NULL/i
  );
  assertSql(
    sql,
    /replay_mode = 'SHADOW_REBUILD'.*execution_executor_registry_version = 1.*execution_executor_registry_digest = '9e4ebb37cb7cb07c5c51308826ca0ab50647255a9097c78f136868b67788802f'.*execution_executor_descriptor_digest = 'b6bed52a15aacf6bc75e3ea6fc1aa2ad7b5a2c61ab017f27b11f0b971034e0f3'.*execution_executor_source_digest = '344558609a1315f3b259766002ab777ce1c3bcdcca8d1d37db0f4ca0ef460046'.*execution_executor_registration_digest = 'c73ffac6b513505bf17b88ae073c9ff5c19d5c5ec63dcf9032c0a8b9b4a60cb7'/i
  );
  assert.doesNotMatch(
    executableSql,
    /\b(?:root_user_id|user_id|member_id|openid|unionid|phone|payload_json|result_json|health|answer)\b/i
  );
});

test("Notification contract ALTER migrations fail closed before one exact permanent DDL", () => {
  for (const [migrationName, preflightName, tableName] of [
    [notificationContractMigrationNames[0], "migration_024_notification_native_preflight", "notification_subscription_attempt_v1"],
    [notificationContractMigrationNames[1], "migration_025_notification_job_preflight", "notification_job_v1"],
    [notificationContractMigrationNames[2], "migration_026_notification_attempt_preflight", "notification_send_attempt"],
    [notificationContractMigrationNames[3], "migration_027_notification_transition_preflight", "notification_send_attempt_transition"],
  ]) {
    const sql = notificationDeliveryMigrationSql(migrationName);
    const executableSql = compact(splitSqlStatements(sql).join(" "));
    assert.equal(splitSqlStatements(sql).length, 6, migrationName);
    assert.equal(permanentAlterStatements(sql).length, 1, migrationName);
    assertSql(
      sql,
      new RegExp(`CREATE TEMPORARY TABLE ${preflightName} \\( guard_id TINYINT UNSIGNED PRIMARY KEY \\) ENGINE = InnoDB`, "i")
    );
    assertSql(
      sql,
      new RegExp(`INSERT INTO ${preflightName} \\(guard_id\\) SELECT 1 FROM ${tableName} LIMIT 1`, "i")
    );
    assertSql(sql, new RegExp(`ALTER TABLE ${tableName}`, "i"));
    assert.doesNotMatch(executableSql, new RegExp(`(?:UPDATE|DELETE FROM) ${tableName}`, "i"));
  }
});

test("Migration Execution Foundation schema is static, lineage-complete, and fail-closed", () => {
  const registrySql = notificationDeliveryMigrationSql(migrationExecutionMigrationNames[0]);
  const runSql = notificationDeliveryMigrationSql(migrationExecutionMigrationNames[1]);
  const lineageSql = notificationDeliveryMigrationSql(migrationExecutionMigrationNames[2]);
  const targetSql = notificationDeliveryMigrationSql(migrationExecutionMigrationNames[3]);
  const executableSql = compact([
    ...splitSqlStatements(registrySql),
    ...splitSqlStatements(runSql),
    ...splitSqlStatements(lineageSql),
    ...splitSqlStatements(targetSql),
  ].join(" "));

  assertSql(registrySql, /CREATE TABLE IF NOT EXISTS migration_contract_registry/i);
  assertSql(registrySql, /contract_id = 'TASK_SHARE_SYNTHETIC_V1'/i);
  assertSql(registrySql, /allows_network = 0/i);
  assertSql(registrySql, /allows_outbox = 0/i);
  assertSql(runSql, /CREATE TABLE IF NOT EXISTS migration_run/i);
  assertSql(runSql, /migration_mode IN \('DRY_RUN', 'APPLY', 'FORWARD_REPLAY'\)/i);
  assertSql(runSql, /replay_source_run_id IS NOT NULL.*replay_source_result_digest IS NOT NULL.*replay_through_cursor_value IS NOT NULL.*replay_through_tie_breaker IS NOT NULL/i);
  assertSql(runSql, /FOREIGN KEY \(replay_source_run_id\) REFERENCES migration_run \(migration_run_id\) ON UPDATE RESTRICT ON DELETE RESTRICT/i);
  assertSql(lineageSql, /CREATE TABLE IF NOT EXISTS migration_lineage/i);
  for (const column of [
    "source_id", "target_id", "source_checksum", "target_checksum", "snapshot_id",
    "snapshot_revision", "batch_id", "request_id", "cursor_type", "cursor_value",
    "tie_breaker", "inclusive", "target_schema_version", "status", "error_code",
    "replayed_at", "reversed_at",
  ]) assertSql(lineageSql, new RegExp(`\\b${column}\\b`, "i"));
  assertSql(lineageSql, /UNIQUE KEY uk_migration_lineage_base \(base_lineage_identity\)/i);
  assertSql(lineageSql, /'APPLY_AFTER_DRY_RUN', 'IDEMPOTENT_RETRY'/i);
  assertSql(lineageSql, /status IN \('CONFLICT', 'QUARANTINED', 'REVIEW_REQUIRED'\).*error_code IS NOT NULL.*error_code IN/i);
  assertSql(targetSql, /CREATE TABLE IF NOT EXISTS task_share_migration_projection/i);
  assertSql(targetSql, /UNIQUE KEY uk_task_share_migration_source_schema \( contract_id, source_task_event_id, target_schema_version \)/i);
  assert.doesNotMatch(executableSql, /\b(?:openid|unionid|phone|payload_json|health|answer)\b/i);
  assert.doesNotMatch(executableSql, /\b(?:UPDATE|DELETE)\s+(?:migration_lineage|task_share_migration_projection)\b/i);
});

test("outbox dispatcher scope, lease generation and ACK-unknown lookups are explicit", () => {
  const sql = dispatcherMigrationSql();
  assert.equal(splitSqlStatements(sql).length, 2);
  assertSql(sql, /ALTER TABLE outbox_event/i);
  assertSql(
    sql,
    /MODIFY COLUMN topic VARCHAR\(128\) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL/i
  );
  assertSql(
    sql,
    /MODIFY COLUMN dedupe_key VARCHAR\(191\) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL/i
  );
  assertSql(
    sql,
    /MODIFY COLUMN source_name VARCHAR\(96\) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL/i
  );
  assertSql(
    sql,
    /MODIFY COLUMN partition_key VARCHAR\(191\) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL/i
  );
  assertSql(
    sql,
    /MODIFY COLUMN payload_digest CHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/i
  );
  assertSql(
    sql,
    /ADD COLUMN retry_policy_version VARCHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'outbox-retry-v1'/i
  );
  assertSql(sql, /ADD COLUMN lease_generation BIGINT UNSIGNED NOT NULL DEFAULT 0/i);
  assertSql(
    sql,
    /ADD COLUMN dispatch_transition_id VARCHAR\(128\) CHARACTER SET ascii COLLATE ascii_bin NULL/i
  );
  assertSql(
    sql,
    /ADD CONSTRAINT chk_outbox_partition_position_positive CHECK \(partition_position >= 1\)/i
  );
  assertSql(
    sql,
    /MODIFY COLUMN lease_owner VARCHAR\(128\) CHARACTER SET ascii COLLATE ascii_bin NULL/i
  );
  assertSql(
    sql,
    /ADD KEY idx_outbox_lease_owner \(\s*lease_owner, status, lease_generation\s*\)/i
  );
  assertSql(
    sql,
    /ADD KEY idx_outbox_transition \(\s*dispatch_transition_id, outbox_event_id\s*\)/i
  );
  assertSql(
    sql,
    /ADD KEY idx_outbox_lease_recovery \(\s*status, lease_expires_at, outbox_event_id\s*\)/i
  );
  assertSql(
    sql,
    /ADD KEY idx_outbox_pending_due \(\s*status, retry_policy_version, available_at, outbox_event_id\s*\)/i
  );
  assertSql(
    sql,
    /ADD KEY idx_outbox_retry_due \(\s*status, retry_policy_version, next_retry_at, outbox_event_id\s*\)/i
  );
  assertSql(
    sql,
    /ADD KEY idx_outbox_partition_head \(\s*source_name, partition_key, partition_position, status\s*\)/i
  );
  assertSql(sql, /ALTER TABLE event_dead_letter/i);
  assertSql(
    sql,
    /MODIFY COLUMN source_name VARCHAR\(96\) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL/i
  );
  assertSql(
    sql,
    /MODIFY COLUMN partition_key VARCHAR\(191\) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL/i
  );
});

test("command scope comparison and crypto metadata are explicit and rotation-queryable", () => {
  const sql = cryptoMetadataMigrationSql();
  assert.equal(splitSqlStatements(sql).length, 1);
  assertSql(sql, /ALTER TABLE command_idempotency/i);
  assertSql(
    sql,
    /MODIFY COLUMN command_name VARCHAR\(96\) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL/i
  );
  assertSql(
    sql,
    /MODIFY COLUMN actor_id VARCHAR\(128\) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL/i
  );
  assertSql(
    sql,
    /MODIFY COLUMN idempotency_key VARCHAR\(191\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/i
  );
  assertSql(
    sql,
    /MODIFY COLUMN request_digest CHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/i
  );
  assertSql(
    sql,
    /ADD COLUMN request_digest_scheme VARCHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'sha256:v0'/i
  );
  assertSql(
    sql,
    /ADD COLUMN request_digest_key_id VARCHAR\(128\) CHARACTER SET ascii COLLATE ascii_bin NULL/i
  );
  assertSql(
    sql,
    /ADD COLUMN result_codec_version VARCHAR\(32\) CHARACTER SET ascii COLLATE ascii_bin NULL/i
  );
  assertSql(
    sql,
    /ADD COLUMN result_key_id VARCHAR\(128\) CHARACTER SET ascii COLLATE ascii_bin NULL/i
  );
  assertSql(
    sql,
    /ADD COLUMN retention_policy_version VARCHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'command-retention-v1'/i
  );
  assertSql(
    sql,
    /ADD COLUMN tombstone_reason VARCHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NULL/i
  );
  assertSql(
    sql,
    /ADD KEY idx_command_idempotency_digest_crypto \(\s*request_digest_scheme, request_digest_key_id, command_idempotency_id\s*\)/i
  );
  assertSql(
    sql,
    /ADD KEY idx_command_idempotency_result_crypto \(\s*result_codec_version, result_key_id, command_idempotency_id\s*\)/i
  );
  assertSql(
    sql,
    /ADD KEY idx_command_idempotency_retention_policy \(\s*retention_policy_version, retain_until, tombstoned_at\s*\)/i
  );
  assertSql(
    sql,
    /ADD KEY idx_command_idempotency_tombstone \(\s*tombstoned_at, tombstone_reason, command_idempotency_id\s*\)/i
  );
});

test("command recovery has an explicit lease owner, expiry and monotonic generation", () => {
  const sql = recoveryMigrationSql();
  assert.equal(splitSqlStatements(sql).length, 1);
  assertSql(sql, /ALTER TABLE command_idempotency/i);
  assertSql(sql, /ADD COLUMN lease_owner VARCHAR\(128\) NULL/i);
  assertSql(sql, /ADD COLUMN lease_expires_at DATETIME\(3\) NULL/i);
  assertSql(sql, /ADD COLUMN lease_generation BIGINT UNSIGNED NOT NULL DEFAULT 0/i);
  assertSql(
    sql,
    /ADD KEY idx_command_idempotency_recovery \(\s*status, lease_expires_at, command_idempotency_id\s*\)/i
  );
});

test("command idempotency has persistent scope uniqueness, digest, result and retention facts", () => {
  const sql = migrationSql();
  assertSql(sql, /CREATE TABLE IF NOT EXISTS command_idempotency \(/i);
  assertSql(sql, /command_idempotency_id VARCHAR\(64\) PRIMARY KEY/i);
  assertSql(sql, /request_digest CHAR\(64\) NOT NULL/i);
  assertSql(sql, /result_json JSON NULL/i);
  assertSql(sql, /error_json JSON NULL/i);
  assertSql(sql, /tombstoned_at DATETIME\(3\) NULL/i);
  assertSql(sql, /UNIQUE KEY uk_command_idempotency_scope \(command_name, actor_id, idempotency_key\)/i);
  assertSql(sql, /KEY idx_command_idempotency_status \(status, updated_at\)/i);
  assertSql(sql, /KEY idx_command_idempotency_retention \(retain_until, tombstoned_at\)/i);
});

test("outbox and inbox enforce producer and consumer deduplication plus ordered positions", () => {
  const sql = migrationSql();
  assertSql(sql, /CREATE TABLE IF NOT EXISTS outbox_event \(/i);
  assertSql(sql, /outbox_event_id VARCHAR\(64\) PRIMARY KEY/i);
  assertSql(sql, /payload_digest CHAR\(64\) NOT NULL/i);
  assertSql(sql, /UNIQUE KEY uk_outbox_topic_dedupe \(topic, dedupe_key\)/i);
  assertSql(sql, /UNIQUE KEY uk_outbox_partition_position \(source_name, partition_key, partition_position\)/i);
  assertSql(sql, /KEY idx_outbox_dispatch \(status, available_at, lease_expires_at, partition_position\)/i);
  assertSql(sql, /KEY idx_outbox_aggregate_version \(aggregate_type, aggregate_id, aggregate_version\)/i);

  assertSql(sql, /CREATE TABLE IF NOT EXISTS inbox_receipt \(/i);
  assertSql(sql, /inbox_receipt_id VARCHAR\(64\) PRIMARY KEY/i);
  assertSql(sql, /handler_version VARCHAR\(64\) NOT NULL/i);
  assertSql(sql, /UNIQUE KEY uk_inbox_consumer_event \(consumer_name, event_id\)/i);
  assertSql(sql, /UNIQUE KEY uk_inbox_consumer_position \(consumer_name, source_name, partition_key, partition_position\)/i);
  assertSql(sql, /KEY idx_inbox_processing \(consumer_name, status, updated_at\)/i);
});

test("dead letters and checkpoints preserve recovery state without skipping gaps", () => {
  const sql = migrationSql();
  assertSql(sql, /CREATE TABLE IF NOT EXISTS event_dead_letter \(/i);
  assertSql(sql, /event_dead_letter_id VARCHAR\(64\) PRIMARY KEY/i);
  assertSql(sql, /UNIQUE KEY uk_event_dead_letter_source \(direction, source_record_id\)/i);
  assertSql(sql, /KEY idx_event_dead_letter_open \(status, next_retry_at, created_at\)/i);
  assertSql(sql, /KEY idx_event_dead_letter_partition \(consumer_name, source_name, partition_key, partition_position\)/i);

  assertSql(sql, /CREATE TABLE IF NOT EXISTS consumer_checkpoint \(/i);
  assertSql(sql, /consumer_checkpoint_id VARCHAR\(64\) PRIMARY KEY/i);
  assertSql(sql, /last_contiguous_position BIGINT UNSIGNED NOT NULL DEFAULT 0/i);
  assertSql(sql, /high_watermark_position BIGINT UNSIGNED NOT NULL DEFAULT 0/i);
  assertSql(sql, /gap_status VARCHAR\(32\) NOT NULL/i);
  assertSql(sql, /UNIQUE KEY uk_consumer_checkpoint_partition \(consumer_name, source_name, partition_key\)/i);
  assertSql(sql, /KEY idx_consumer_checkpoint_gap \(gap_status, updated_at\)/i);
});

test("transport authority is not registered as a deletable snapshot projection", () => {
  const operationalTables = new Set([
    "command_idempotency",
  ]);
  const registered = PROJECTIONS.map((projection) => projection.table)
    .filter((table) => operationalTables.has(table));
  assert.deepEqual(registered, []);
});

test("snapshot projection registry fails closed for command and event authority tables", () => {
  assert.equal(assertSnapshotProjectionRegistrySafe(PROJECTIONS), true);
  for (const table of [
    "command_idempotency",
    "COMMAND_IDEMPOTENCY",
  ]) {
    assert.throws(
      () => assertSnapshotProjectionRegistrySafe([
        ...PROJECTIONS,
        {
          table,
          source: "unsafeSnapshotCollection",
          id: "unsafe_id",
          columns: ["unsafe_id"],
        },
      ]),
      (error) => {
        assert.equal(error.code, "MYSQL_SNAPSHOT_PROJECTION_AUTHORITY_TABLE_FORBIDDEN");
        assert.match(error.message, new RegExp(table.toLowerCase()));
        return true;
      }
    );
  }
  assert.equal(Object.isFrozen(PROJECTIONS), true);
  assert.equal(PROJECTIONS.every((projection) => Object.isFrozen(projection)), true);
});
