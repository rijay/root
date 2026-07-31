const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const { createApp, hasElementAdminBuild, resolveElementAdminDir } = require("../src/app");
const domain = require("../src/domain");
const { shouldUseMysql } = require("../src/server");
const {
  createEmptyData,
  createJsonFileStore,
  createMemoryStore,
  createSqliteStore,
  mysqlConfigFromEnv,
  validateMysqlConfig,
  validateSnapshot,
} = require("../src/store");
const {
  acquireMigrationLock,
  listMigrationFiles,
  migrationLockName,
  releaseMigrationLock,
  splitSqlStatements,
} = require("../src/mysqlMigrations");
const { rootUserRows, syncCoreProjections, toMysqlDateTime } = require("../src/mysqlProjection");
const { stampVerifiedWechatUnionId } = require("../src/wechatIdentityAuthority");
const { freezeWechatRecipientBinding } = require("../src/wechatRecipientBinding");
const { parseArgs: parseStoreVerifyArgs, readMysqlSnapshot } = require("../scripts/store-verify");
const { parseArgs: parseStoreMigrateArgs } = require("../scripts/store-migrate");
const { buildCalibrationReport, determineExitCode } = require("../scripts/release-calibration");
const { buildSampleCalibrationReport, determineExitCode: determineSampleExitCode } = require("../scripts/sample-calibration");
const {
  buildAdapterRunReport,
  collectAdapterRun,
  determineExitCode: determineAdapterExitCode,
  normalizeSource,
  parseArgs: parseAdapterArgs,
} = require("../scripts/adapter-runner");
const {
  buildAdapterRetryJobReport,
  collectAdapterRetryJob,
  determineExitCode: determineAdapterRetryExitCode,
  parseArgs: parseAdapterRetryArgs,
} = require("../scripts/adapter-retry-scheduler");
const {
  buildOperationalAlertJobReport,
  collectOperationalAlertJob,
  determineExitCode: determineOperationalAlertExitCode,
  parseArgs: parseOperationalAlertArgs,
} = require("../scripts/operational-alert-runner");
const {
  buildWeWorkTouchJobReport,
  collectWeWorkTouchJob,
  determineExitCode: determineWeWorkTouchExitCode,
  parseArgs: parseWeWorkTouchArgs,
} = require("../scripts/wework-touch-runner");
const {
  buildLifecycleSettlementJobReport,
  collectLifecycleSettlementJob,
  determineExitCode: determineLifecycleSettlementExitCode,
  parseArgs: parseLifecycleSettlementArgs,
} = require("../scripts/lifecycle-settlement-scheduler");
const {
  buildLifecycleSettlementCleanupReport,
  collectLifecycleSettlementCleanup,
  determineExitCode: determineLifecycleSettlementCleanupExitCode,
  parseArgs: parseLifecycleSettlementCleanupArgs,
} = require("../scripts/lifecycle-settlement-cleanup");
const {
  buildLifecycleUsersExportReport,
  collectLifecycleUsersExport,
  determineExitCode: determineLifecycleUsersExportExitCode,
  parseArgs: parseLifecycleUsersExportArgs,
} = require("../scripts/lifecycle-users-export");
const {
  buildLifecycleUserExportsCleanupReport,
  collectLifecycleUserExportsCleanup,
  determineExitCode: determineLifecycleUserExportsCleanupExitCode,
  parseArgs: parseLifecycleUserExportsCleanupArgs,
} = require("../scripts/lifecycle-user-exports-cleanup");
const {
  buildLifecycleUserExportsDeliveryRetryReport,
  collectLifecycleUserExportsDeliveryRetry,
  determineExitCode: determineLifecycleUserExportsDeliveryRetryExitCode,
  parseArgs: parseLifecycleUserExportsDeliveryRetryArgs,
} = require("../scripts/lifecycle-user-exports-delivery-retry");
const {
  buildCloudbaseJobManifest,
  buildCloudbaseJobManifestReport,
  parseArgs: parseCloudbaseJobManifestArgs,
  resolveBaseUrl: resolveCloudbaseJobBaseUrl,
  validateCloudbaseJobManifest,
} = require("../scripts/cloudbase-job-manifest");
const { buildProductionEnvMatrix } = require("../src/productionEnvMatrix");
const { CUTOVER_ITEMS, buildProductionCutoverReadiness } = require("../src/productionCutoverReadiness");
const { assertProbeAllowed, isIsolatedDatabaseName } = require("../scripts/mysql-checkpoint-probe");
const {
  buildProductionEnvMatrixReport,
  determineExitCode: determineProductionEnvExitCode,
  parseArgs: parseProductionEnvArgs,
} = require("../scripts/production-env-matrix");
const { buildAdminTransitionReadiness } = require("../src/adminTransitionReadiness");
const { prepareBackendAdminDist, validateAdminDist } = require("../../scripts/prepare-backend-admin-dist");

const directPhoneLoginEnv = { ROOT_ALLOW_DIRECT_PHONE_LOGIN: "true" };
const verifiedWechatTestEnv = Object.freeze({
  NODE_ENV: "test",
  ROOT_COMMAND_REQUEST_DIGEST_KEY: "api-wechat-authority-test-key-with-strong-entropy-2026",
  ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: "api-wechat-authority-test-v1",
});

async function verifiedCloudbaseHeaderIdentityAdapter({ request: incomingRequest }) {
  const headers = incomingRequest && incomingRequest.headers ? incomingRequest.headers : {};
  const openid = String(headers["x-wx-openid"] || "").trim();
  if (!openid) return null;
  return {
    openid,
    unionid: String(headers["x-wx-unionid"] || "").trim(),
    appCode: "MYROOT",
    source: "CLOUDBASE",
  };
}

test("cloud hosting MySQL variables select the MySQL Store Adapter", () => {
  const env = {
    MYSQL_ADDRESS: "10.11.103.164:3306",
    MYSQL_USERNAME: "root",
    MYSQL_PASSWORD: "secret",
  };

  assert.equal(shouldUseMysql(env), true);
  assert.deepEqual(mysqlConfigFromEnv(env), {
    host: "10.11.103.164",
    port: 3306,
    user: "root",
    password: "secret",
    database: "root_checkin",
    connectionLimit: 8,
    connectTimeout: 10000,
  });
  assert.throws(() => validateMysqlConfig({ host: "db", user: "app", password: "", database: "root" }), /password/);
  assert.equal(shouldUseMysql({ ...env, ROOT_STORE_ADAPTER: "sqlite" }), false);
  assert.equal(shouldUseMysql({ ROOT_STORE_ADAPTER: "mysql" }), true);
});

test("MySQL checkpoint probe refuses production-like database names", () => {
  assert.equal(isIsolatedDatabaseName("root_checkin_probe"), true);
  assert.equal(isIsolatedDatabaseName("root_checkin"), false);
  assert.throws(
    () => assertProbeAllowed(["--confirm-isolated-database"], { database: "root_checkin" }),
    /refuses a database name/
  );
  assert.throws(
    () => assertProbeAllowed([], { database: "root_checkin_probe" }),
    /confirm-isolated-database/
  );
});

test("Store snapshot imports do not share mutable references with the source snapshot", () => {
  const source = createEmptyData();
  const store = createMemoryStore(undefined, { seedSampleData: false });
  store.importSnapshot(source);

  store.data.users.push({ user_id: "usr_snapshot_alias_guard" });
  store.data.idempotency.request = { code: 0 };

  assert.equal(source.users.length, 0);
  assert.equal(source.idempotency.request, undefined);
});

test("Store normalization removes persisted WeChat access-token cache without mutating the source", () => {
  const source = createEmptyData();
  source.wechatAccessToken = { token: "must-not-persist", expires_at: Date.now() + 3600000 };

  const store = createMemoryStore(source, { seedSampleData: false });

  assert.equal(store.data.wechatAccessToken, undefined);
  assert.equal(source.wechatAccessToken.token, "must-not-persist");
});

test("startup defaults use the transactional Store Interface when available", async () => {
  const base = createMemoryStore(undefined, { seedSampleData: false });
  let transactionCount = 0;
  let saveCount = 0;
  const storeAdapter = {
    ...base,
    async runRequest(options, work) {
      transactionCount += 1;
      assert.equal(options.write, true);
      return work(base.data);
    },
    save() {
      saveCount += 1;
    },
  };
  const server = createApp({
    storeAdapter,
    env: {
      ROOT_MEMBER_CENTER_APPID: "wxfb75c0b432670215",
      ROOT_MEMBER_CENTER_PRODUCT_PATH: "pages/goods/detail/index.html?alias=mysql-startup-product",
    },
  });
  await server.readyPromise;

  assert.equal(transactionCount, 1);
  assert.equal(saveCount, 0);
  assert.equal(server.store.youzanProducts.length, 1);
});

test("check-in reminder execution receives the transactional checkpoint before external send", async (t) => {
  const env = {
    ROOT_ALLOW_OPENID_LOGIN: "true",
    ROOT_ADMIN_JOB_TOKEN: "job-secret",
    ROOT_CHECKIN_REMINDER_TEMPLATE_ID: "tmpl_checkpoint_test",
    ROOT_CHECKIN_REMINDER_TEMPLATE_VERSION: "v2026-07-13-test",
    ROOT_CHECKIN_REMINDER_HOUR: "9",
  };
  const base = createMemoryStore(domain.createStore(), { seedSampleData: false });
  const login = await domain.loginWithWechat(base.data, {
    openid: "checkin_checkpoint_openid",
    appCode: "MYROOT",
  }, env);
  domain.joinCampaign(base.data, login.data.token, {}, { env, date: "2026-07-12" });
  domain.recordCheckinReminderSubscription(base.data, login.data.token, {
    templateKey: "CHECKIN_REMINDER_NEXT_DAY",
    templateId: "tmpl_checkpoint_test",
    templateVersion: "v2026-07-13-test",
    grantRequestId: "checkin-checkpoint-grant-1",
    result: "accept",
    subscribed: true,
    campaignId: "ROOT_7D_RESET",
  }, { env });

  const checkpointStates = [];
  let resumeCount = 0;
  const storeAdapter = {
    ...base,
    async runRequest(_options, work) {
      return work(base.data, {
        checkpoint: async (metadata) => {
          checkpointStates.push({
            metadata,
            jobStatus: base.data.notificationJobs[0].status,
            jobAttempts: base.data.notificationJobs[0].attempts,
            grantStatus: base.data.notificationSubscriptionGrants[0].status,
          });
        },
        resume: async () => {
          resumeCount += 1;
        },
      });
    },
  };
  const server = createApp({ storeAdapter, env });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const result = await request(baseUrl, "/api/v1/jobs/checkin-reminders", {
    method: "POST",
    headers: {
      "X-ROOT-ADMIN-TOKEN": "job-secret",
      "X-Request-Id": "checkin-checkpoint-execute-1",
    },
    body: JSON.stringify({ dryRun: false, now: "2026-07-13T09:00:00+08:00" }),
  });

  assert.equal(result.code, 0);
  assert.equal(result.data.results[0].status, "FAILED");
  assert.equal(result.data.results[0].deliveryOutcome, "NOT_SENT");
  assert.equal(checkpointStates.length, 1);
  assert.equal(checkpointStates[0].metadata.reason, "CHECKIN_REMINDER_SEND_RESERVED");
  assert.equal(checkpointStates[0].jobStatus, "SENDING");
  assert.equal(checkpointStates[0].jobAttempts, 1);
  assert.equal(checkpointStates[0].grantStatus, "RESERVED");
  assert.equal(resumeCount, 1);
  assert.equal(base.data.notificationJobs[0].status, "FAILED");
  assert.equal(base.data.notificationSubscriptionGrants[0].status, "AVAILABLE");
  assert.equal(base.data.commandIdempotencyRecords.length, 0);
});

test("check-in reminder HTTP Interface fails closed without a transactional Store checkpoint", async (t) => {
  const env = {
    ROOT_ALLOW_OPENID_LOGIN: "true",
    ROOT_ADMIN_JOB_TOKEN: "job-secret",
    ROOT_CHECKIN_REMINDER_TEMPLATE_ID: "tmpl_checkpoint_required",
    ROOT_CHECKIN_REMINDER_TEMPLATE_VERSION: "v2026-07-13-test",
    ROOT_CHECKIN_REMINDER_HOUR: "9",
  };
  const storeAdapter = createMemoryStore(domain.createStore(), { seedSampleData: false });
  const login = await domain.loginWithWechat(storeAdapter.data, {
    openid: "checkin_checkpoint_required_openid",
    appCode: "MYROOT",
  }, env);
  domain.joinCampaign(storeAdapter.data, login.data.token, {}, { env, date: "2026-07-12" });
  domain.recordCheckinReminderSubscription(storeAdapter.data, login.data.token, {
    templateKey: "CHECKIN_REMINDER_NEXT_DAY",
    templateId: "tmpl_checkpoint_required",
    templateVersion: "v2026-07-13-test",
    grantRequestId: "checkin-checkpoint-required-grant-1",
    result: "accept",
    subscribed: true,
    campaignId: "ROOT_7D_RESET",
  }, { env });

  const server = createApp({ storeAdapter, env });
  const baseUrl = await listen(server);
  t.after(() => server.close());
  const result = await request(baseUrl, "/api/v1/jobs/checkin-reminders", {
    method: "POST",
    headers: {
      "X-ROOT-ADMIN-TOKEN": "job-secret",
      "X-Request-Id": "checkin-checkpoint-required-execute-1",
    },
    body: JSON.stringify({ dryRun: false, now: "2026-07-13T09:00:00+08:00" }),
  });

  assert.equal(result.code, 50301);
  assert.match(result.message, /checkpoint\/resume/);
  assert.equal(storeAdapter.data.notificationJobs[0].status, "SCHEDULED");
  assert.equal(storeAdapter.data.notificationSubscriptionGrants[0].status, "AVAILABLE");
  assert.equal(storeAdapter.data.notificationDeliveries.length, 0);
});

test("MySQL Store verifier accepts mysql2 JSON object payloads", async () => {
  const snapshot = createEmptyData();
  snapshot.events.push({ event_id: "evt_mysql_verify_object" });
  let closed = false;
  const mysqlImpl = {
    async createConnection() {
      return {
        async execute() {
          return [[{ payload_json: snapshot }]];
        },
        async end() {
          closed = true;
        },
      };
    },
  };

  const loaded = await readMysqlSnapshot({
    MYSQL_ADDRESS: "127.0.0.1:3306",
    MYSQL_USERNAME: "myroot_app",
    MYSQL_PASSWORD: "test-only",
    MYSQL_DATABASE: "myroot_test",
  }, { mysqlImpl });

  assert.deepEqual(loaded, snapshot);
  assert.equal(closed, true);
});

test("MySQL migrations and core relational projection cover production Store facts", async () => {
  const migrationFiles = listMigrationFiles();
  assert.deepEqual(migrationFiles, [
    "001_store_snapshot.sql",
    "002_core_relational.sql",
    "003_privacy_consent.sql",
    "004_external_evidence_minimization.sql",
    "005_notification_subscription_grants.sql",
    "006_command_event_foundation.sql",
    "007_command_recovery_lease.sql",
    "008_command_scope_crypto_metadata.sql",
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
    "034_activity_module.sql",
    "035_activity_publication_session_event.sql",
    "036_activity_enrollment_event_generation_stage.sql",
    "037_activity_enrollment_event_generation_backfill.sql",
    "038_activity_enrollment_event_generation_enforce.sql",
    "039_activity_session_event.sql",
    "040_activity_p0_content_and_session_policy.sql",
    "041_task_activity_assignment.sql",
    "042_task_source_invalidation_event.sql",
    "043_activity_session_cancel_close_stage.sql",
    "044_activity_session_cancel_close_backfill.sql",
    "045_activity_session_policy_enforce.sql",
    "046_task_event_idempotency_scope_stage.sql",
    "047_task_event_idempotency_scope_backfill.sql",
    "048_task_event_idempotency_scope_enforce.sql",
    "049_wechat_unionid_provenance_stage.sql",
    "050_wechat_unionid_provenance_backfill.sql",
    "051_wechat_unionid_provenance_enforce.sql",
    "052_notification_recipient_binding_legacy_stage.sql",
    "053_notification_recipient_binding_v1_stage.sql",
    "054_notification_recipient_binding_legacy_backfill.sql",
    "055_notification_recipient_binding_v1_backfill.sql",
    "056_notification_recipient_binding_legacy_enforce.sql",
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
  migrationFiles.forEach((fileName) => {
    const sql = fs.readFileSync(path.join(__dirname, "..", "db", "migrations", fileName), "utf8");
    assert.ok(splitSqlStatements(sql).length > 0);
  });

  const data = createEmptyData();
  data.users.push({
    user_id: "usr_mysql_projection",
    root_user_id: "usr_mysql_projection",
    unionid: "union_mysql_projection",
    state: "ACTIVATED",
    created_at: "2026-07-11T10:00:00+08:00",
  });
  data.rootUsers.push({
    root_user_id: "usr_mysql_projection",
    lifecycle_status: "ACTIVATED",
    source_channel: "ROADSHOW",
    unionid_status: "LINKED",
    created_at: "2026-07-11T10:00:00+08:00",
    updated_at: "2026-07-11T10:00:00+08:00",
  });
  data.wechatIdentities.push(stampVerifiedWechatUnionId({
    wechat_identity_id: "wxi_mysql_projection",
    root_user_id: "usr_mysql_projection",
    app_code: "MYROOT",
    openid: "openid_mysql_projection",
    unionid: "union_mysql_projection",
    unionid_status: "LINKED",
    created_at: "2026-07-11T10:00:00+08:00",
    updated_at: "2026-07-11T10:00:00+08:00",
    last_seen_at: "2026-07-11T10:00:00+08:00",
  }, {
    source: "CLOUDBASE",
    verifiedAt: "2026-07-11T10:00:00+08:00",
  }, { env: verifiedWechatTestEnv }));
  data.taskEvents.push({
    task_event_id: "tev_mysql_projection",
    root_user_id: "usr_mysql_projection",
    campaign_id: "ROOT_7D_RESET",
    task_definition_id: "td_root_7d_checkin",
    task_type: "CHECKIN",
    event_type: "CHECKIN_COMPLETED",
    task_date: "2026-07-11",
    payload_json: { taskDate: "2026-07-11" },
    idempotency_key: "mysql-projection-checkin",
    status: "RECORDED",
    source_channel: "MYROOT",
    occurred_at: "2026-07-11T10:00:00+08:00",
    created_at: "2026-07-11T10:00:00+08:00",
  });
  data.privacyConsentRecords.push({
    privacy_consent_record_id: "pcr_mysql_projection",
    root_user_id: "usr_mysql_projection",
    consent_type: "HEALTH_SENSITIVE_INFO",
    policy_version: "health-sensitive-2026-07-11-v1",
    decision: "GRANTED",
    purposes_json: ["记录活动任务"],
    data_categories_json: ["身体反馈"],
    source_channel: "MYROOT",
    occurred_at: "2026-07-11T10:00:00+08:00",
    created_at: "2026-07-11T10:00:00+08:00",
  });
  data.notificationSubscriptionGrants.push({
    notification_subscription_grant_id: "nsg_mysql_projection",
    notification_subscription_id: "nts_mysql_projection",
    root_user_id: "usr_mysql_projection",
    campaign_id: "ROOT_7D_RESET",
    template_key: "CHECKIN_REMINDER_NEXT_DAY",
    template_id: "tmpl_mysql_projection",
    template_version: "v2026-06-28-test",
    grant_request_id: "checkin-subscribe-mysql-projection",
    status: "AVAILABLE",
    idempotency_key: "SUBSCRIPTION_GRANT:usr_mysql_projection:checkin-subscribe-mysql-projection",
    source_channel: "MYROOT",
    granted_at: "2026-07-11T10:00:00+08:00",
    created_at: "2026-07-11T10:00:00+08:00",
    updated_at: "2026-07-11T10:00:00+08:00",
    ...freezeWechatRecipientBinding(data, {
      rootUserId: "usr_mysql_projection",
      grantRequestId: "checkin-subscribe-mysql-projection",
      templateKey: "CHECKIN_REMINDER_NEXT_DAY",
      templateId: "tmpl_mysql_projection",
      templateVersion: "v2026-06-28-test",
    }, { env: verifiedWechatTestEnv }),
  });
  const calls = [];
  const connection = {
    execute: async (sql, values) => {
      calls.push({ sql, values });
      return [[], []];
    },
    query: async (sql, values) => {
      calls.push({ sql, values });
      return [[], []];
    },
  };
  const report = await syncCoreProjections(connection, data, { force: true });
  assert.ok(report.tables.includes("root_user"));
  assert.ok(report.tables.includes("task_event"));
  assert.ok(report.tables.includes("settlement_record"));
  assert.ok(report.tables.includes("notification_job"));
  assert.ok(report.tables.includes("notification_subscription_grant"));
  assert.ok(report.tables.includes("privacy_consent_record"));
  assert.ok(calls.some((call) => /INSERT INTO `root_user`/.test(call.sql)));
  assert.ok(calls.some((call) => /INSERT INTO `task_event`/.test(call.sql)));
  assert.ok(calls.some((call) => /INSERT INTO `privacy_consent_record`/.test(call.sql)));
  assert.ok(calls.some((call) => /INSERT INTO `notification_subscription_grant`/.test(call.sql)));
  assert.equal(rootUserRows(data)[0].unionid, "union_mysql_projection");
  assert.equal(toMysqlDateTime("2026-07-11T10:00:00+08:00"), "2026-07-11 10:00:00.000");
  assert.equal(toMysqlDateTime("2026-07-11T02:00:00Z"), "2026-07-11 10:00:00.000");
});

test("MySQL migrations use a database-scoped advisory lock", async () => {
  const calls = [];
  const connection = {
    async execute(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      return [[{ released: 1 }]];
    },
  };
  const expectedName = migrationLockName("myroot-prod-d5gl3gzg7115f149a");
  const lockName = await acquireMigrationLock(connection, {
    database: "myroot-prod-d5gl3gzg7115f149a",
    migrationLockTimeoutSeconds: 12,
  });
  await releaseMigrationLock(connection, lockName);

  assert.equal(lockName, expectedName);
  assert.deepEqual(calls[0].values, [expectedName, 12]);
  assert.deepEqual(calls[1].values, [expectedName]);
});

test("cloudbase job manifest captures scheduled job Interface and environment seams", () => {
  const manifest = buildCloudbaseJobManifest({
    baseUrl: "https://root.example.com",
    campaignId: "ROOT_7D_RESET",
  });
  const validation = validateCloudbaseJobManifest(manifest, { strict: true });
  const report = buildCloudbaseJobManifestReport(manifest, validation);

  assert.equal(validation.status, "PASS");
  assert.deepEqual(manifest.environment.requiredEnv, ["ROOT_JOB_BASE_URL"]);
  assert.deepEqual(manifest.environment.anyOfEnv, [[
    "ROOT_ADMIN_JOB_ROUTE_TOKENS",
    "ROOT_ADMIN_JOB_TOKEN",
    "ROOT_ADMIN_JOB_TOKENS",
  ]]);
  assert.deepEqual(manifest.jobs.map((job) => job.id), ["adapter_retry_due", "operational_alerts", "checkin_reminders", "wework_touch_due", "lifecycle_settlement_due", "lifecycle_settlement_cleanup", "lifecycle_users_export", "lifecycle_user_exports_delivery_retry", "lifecycle_user_exports_cleanup", "health_data_retention_cleanup", "youzan_identity_reconcile", "v1_runtime_cycle"]);
  assert.ok(manifest.jobs.every((job) => job.http.method === "POST"));
  assert.ok(manifest.jobs.every((job) => job.http.path.startsWith("/api/v1/jobs/")));
  assert.match(manifest.jobs[0].executeCommand, /npm run adapter-retry/);
  assert.match(manifest.jobs[1].executeCommand, /npm run operational-alerts/);
  assert.match(manifest.jobs[1].dryRunCommand, /ROOT_ALERT_CAMPAIGN_ID=ROOT_7D_RESET/);
  assert.match(manifest.jobs[2].executeCommand, /npm run checkin-reminders/);
  assert.equal(manifest.jobs[2].schedule.cron, "*/10 * * * *");
  assert.equal(manifest.jobs[2].http.path, "/api/v1/jobs/checkin-reminders");
  assert.equal(manifest.jobs[2].http.body.limit, 50);
  assert.match(manifest.jobs[3].executeCommand, /npm run wework-touch/);
  assert.equal(manifest.jobs[3].schedule.cron, "*/10 * * * *");
  assert.equal(manifest.jobs[3].http.path, "/api/v1/jobs/wework-touch-due");
  assert.equal(manifest.jobs[3].http.body.cooldownHours, 24);
  assert.equal(manifest.jobs[3].http.body.adapterMode, "AUTO");
  assert.match(manifest.jobs[4].executeCommand, /npm run lifecycle-settlement/);
  assert.equal(manifest.jobs[4].http.path, "/api/v1/jobs/lifecycle-settlement-due");
  assert.equal(manifest.jobs[4].http.body.batchSize, 20);
  assert.match(manifest.jobs[5].executeCommand, /npm run lifecycle-settlement-cleanup/);
  assert.equal(manifest.jobs[5].http.path, "/api/v1/jobs/lifecycle-settlement-cleanup");
  assert.equal(manifest.jobs[5].http.body.allowCancel, false);
  assert.match(manifest.jobs[6].executeCommand, /npm run lifecycle-users-export/);
  assert.match(manifest.jobs[6].executeCommand, /--sensitivity MASKED/);
  assert.equal(manifest.jobs[6].http.path, "/api/v1/jobs/lifecycle-users-export");
  assert.equal(manifest.jobs[6].http.body.retentionDays, 7);
  assert.equal(manifest.jobs[6].http.body.sensitivity, "MASKED");
  assert.equal(manifest.jobs[6].http.body.approvalRequired, false);
  assert.equal(manifest.jobs[6].http.body.deliveryEnabled, false);
  assert.equal(manifest.jobs[6].http.body.deliveryChannel, "NONE");
  assert.match(manifest.jobs[7].executeCommand, /npm run lifecycle-user-exports-delivery-retry/);
  assert.equal(manifest.jobs[7].http.path, "/api/v1/jobs/lifecycle-user-exports-delivery-retry");
  assert.equal(manifest.jobs[7].http.body.deliveryMaxAttempts, 3);
  assert.match(manifest.jobs[8].executeCommand, /npm run lifecycle-user-exports-cleanup/);
  assert.equal(manifest.jobs[8].http.path, "/api/v1/jobs/lifecycle-user-exports-cleanup");
  assert.equal(manifest.jobs[8].http.body.objectCleanup, true);
  assert.match(manifest.jobs[9].executeCommand, /npm run health-data-retention-cleanup/);
  assert.equal(manifest.jobs[9].schedule.cron, "15 4 * * *");
  assert.equal(manifest.jobs[9].http.path, "/api/v1/jobs/health-data-retention-cleanup");
  assert.equal(manifest.jobs[9].http.body.objectCleanup, true);
  assert.match(manifest.jobs[10].executeCommand, /npm run youzan-identity-reconcile/);
  assert.equal(manifest.jobs[10].schedule.cron, "25 * * * *");
  assert.equal(manifest.jobs[10].http.path, "/api/v1/jobs/youzan-identity-reconcile");
  assert.equal(manifest.jobs[10].http.body.batchSize, 5);
  assert.equal(manifest.jobs[11].schedule.cron, "* * * * *");
  assert.equal(manifest.jobs[11].http.path, "/api/v1/jobs/v1-runtime-cycle");
  assert.equal(manifest.jobs[11].http.body.dryRun, true);
  assert.equal(manifest.jobs[11].invocation.mode, "CLOUDBASE_TIMER_ONLY");
  assert.equal(manifest.jobs[11].invocation.functionName, "myroot-v1-runtime-scheduler");
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_LIMIT"), true);
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_CLEANUP_LIMIT"), true);
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_SENSITIVITY"), true);
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_APPROVAL_REQUIRED"), true);
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_DELIVERY_CHANNEL"), true);
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_URL"), true);
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_CHANNEL"), true);
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_TEMPLATE"), true);
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_DELIVERY_TIMEOUT_MS"), true);
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_BATCH_SIZE"), true);
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_DELIVERY_MAX_ATTEMPTS"), true);
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_DELAY_SECONDS"), true);
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_DOWNLOAD_SECRET"), true);
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_SIGNED_DOWNLOAD_ENABLED"), true);
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_SIGNED_DOWNLOAD_TTL_SECONDS"), true);
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_OBJECT_CLEANUP_ENABLED"), true);
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_OBJECT_DIR"), true);
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_HEALTH_DATA_RETENTION_CLEANUP_ENABLED"), true);
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_HEALTH_DATA_RETENTION_CLEANUP_LIMIT"), true);
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_PRIVACY_CONTROLLER_NAME"), true);
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_PRIVACY_CONTACT"), true);
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_CHECKIN_REMINDER_TEMPLATE_ID"), true);
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_CHECKIN_REMINDER_TEMPLATE_VERSION"), true);
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_WEWORK_TOUCH_COOLDOWN_HOURS"), true);
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_WEWORK_TOUCH_TEMPLATES"), true);
  assert.equal(manifest.environment.optionalEnv.includes("WEWORK_TOUCH_SEND_URL"), true);
  assert.equal(manifest.environment.optionalEnv.includes("WEWORK_TOUCH_ACCESS_TOKEN"), true);
  assert.match(report, /ROOT CloudBase Job 发布 Manifest/);
  assert.match(report, /adapter_retry_due/);
  assert.match(report, /checkin_reminders/);
  assert.match(report, /wework_touch_due/);
  assert.match(report, /lifecycle_settlement_due/);
  assert.match(report, /lifecycle_settlement_cleanup/);
  assert.match(report, /lifecycle_users_export/);
  assert.match(report, /lifecycle_user_exports_delivery_retry/);
  assert.match(report, /lifecycle_user_exports_cleanup/);
  assert.match(report, /health_data_retention_cleanup/);
  assert.match(report, /v1_runtime_cycle/);
  assert.equal(parseCloudbaseJobManifestArgs(["--base-url", "https://job.example.com/", "--campaign", "ROOT_CANARY"]).baseUrl, "https://job.example.com");
  assert.equal(parseCloudbaseJobManifestArgs(["--lifecycle-campaign", "ROOT_LIVE"]).lifecycleCampaignId, "ROOT_LIVE");
  assert.equal(parseCloudbaseJobManifestArgs(["--lifecycle-export-campaign", "ROOT_EXPORT"]).lifecycleExportCampaignId, "ROOT_EXPORT");
  assert.equal(resolveCloudbaseJobBaseUrl({ ROOT_JOB_BASE_URL: "https://job.example.com/", ROOT_PUBLIC_BASE_URL: "https://public.example.com" }), "https://job.example.com");
});

test("Element Plus admin dist can resolve from bundled deploy artifact", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "root-admin-dist-resolve-"));
  const missingSourceDir = path.join(tempDir, "missing-source");
  const bundledDir = path.join(tempDir, "backend-public-admin-dist");
  const explicitDir = path.join(tempDir, "explicit-admin-dist");
  fs.mkdirSync(path.join(bundledDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(bundledDir, "index.html"), "<script type=\"module\" src=\"/admin/assets/app.js\"></script>");
  fs.writeFileSync(path.join(bundledDir, "assets", "app.js"), "window.__BUNDLED_ADMIN__ = true;");
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  assert.equal(hasElementAdminBuild(missingSourceDir), false);
  assert.equal(hasElementAdminBuild(bundledDir), true);
  assert.equal(resolveElementAdminDir("", {}, [missingSourceDir, bundledDir]), path.resolve(bundledDir));
  assert.equal(resolveElementAdminDir(explicitDir, {}, [bundledDir]), path.resolve(explicitDir));
  assert.equal(resolveElementAdminDir("", { ROOT_ADMIN_DIST_DIR: explicitDir }, [bundledDir]), path.resolve(explicitDir));
});

test("prepare backend admin dist copies Element Plus build for backend-only deploy", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "root-admin-dist-prepare-"));
  const sourceDir = path.join(tempDir, "admin-dist");
  const targetDir = path.join(tempDir, "backend", "public", "admin-dist");
  fs.mkdirSync(path.join(sourceDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, "index.html"), "<script type=\"module\" src=\"/admin/assets/app.js\"></script>");
  fs.writeFileSync(path.join(sourceDir, "assets", "app.js"), "window.__PREPARED_ADMIN__ = true;");
  fs.writeFileSync(path.join(sourceDir, "assets", "app.css"), ".root-admin{}");
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const summary = prepareBackendAdminDist({ sourceDir, targetDir, clean: true });
  const target = validateAdminDist(targetDir);

  assert.equal(summary.source.ready, true);
  assert.equal(summary.target.ready, true);
  assert.equal(target.ready, true);
  assert.equal(target.usesAdminBase, true);
  assert.match(fs.readFileSync(path.join(targetDir, "assets", "app.js"), "utf8"), /__PREPARED_ADMIN__/);
  const buildManifest = JSON.parse(fs.readFileSync(path.join(targetDir, "admin-build-manifest.json"), "utf8"));
  assert.equal(buildManifest.releaseVersion, "0.5.13");
  assert.deepEqual(buildManifest.modules.map((item) => item.key), ["config", "users", "audit", "adapters", "analytics", "release"]);
});

test("admin transition readiness reads backend-only build evidence", (t) => {
  const backendRoot = fs.mkdtempSync(path.join(os.tmpdir(), "root-admin-backend-only-"));
  const bundledDir = path.join(backendRoot, "public", "admin-dist");
  fs.mkdirSync(path.join(bundledDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(bundledDir, "index.html"), '<script type="module" src="/admin/assets/app.js"></script>');
  fs.writeFileSync(path.join(bundledDir, "assets", "app.js"), "window.__ROOT_ADMIN__ = true;");
  fs.writeFileSync(path.join(bundledDir, "admin-build-manifest.json"), JSON.stringify({
    schemaVersion: 1,
    modules: ["config", "users", "audit", "adapters", "analytics", "release"],
  }));
  fs.writeFileSync(path.join(backendRoot, "public", "admin.html"), "ROOT legacy admin");
  t.after(() => fs.rmSync(backendRoot, { recursive: true, force: true }));

  const readiness = buildAdminTransitionReadiness({ projectRoot: backendRoot, env: {} });

  assert.equal(readiness.summary.readyModuleCount, 6);
  assert.equal(readiness.summary.bundledDistReady, true);
  assert.equal(readiness.summary.effectiveDistReady, true);
  assert.equal(readiness.summary.legacyFallbackAvailable, true);
  assert.equal(readiness.status, "NEEDS_REVIEW");
  assert.ok(readiness.moduleCoverage.every((item) => item.evidenceSource === "BUILD_MANIFEST"));
});

test("admin transition readiness gates legacy admin deprecation", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "root-admin-transition-"));
  const moduleFiles = [
    "modules/config/ConfigWorkbench.vue",
    "modules/users/UserLifecycle.vue",
    "modules/audit/AuditLogPage.vue",
    "modules/adapters/AdapterRunPage.vue",
    "modules/analytics/OperationalAnalytics.vue",
    "modules/release/ReleaseWorkbench.vue",
  ];
  const appVue = [
    'import ConfigWorkbench from "./modules/config/ConfigWorkbench.vue";',
    'import UserLifecycle from "./modules/users/UserLifecycle.vue";',
    'import AuditLogPage from "./modules/audit/AuditLogPage.vue";',
    'import AdapterRunPage from "./modules/adapters/AdapterRunPage.vue";',
    'import OperationalAnalytics from "./modules/analytics/OperationalAnalytics.vue";',
    'import ReleaseWorkbench from "./modules/release/ReleaseWorkbench.vue";',
    'const ADMIN_MODULES = [{ key: "config" }, { key: "users" }, { key: "audit" }, { key: "adapters" }, { key: "analytics" }, { key: "release" }];',
  ].join("\n");
  fs.mkdirSync(path.join(tempDir, "admin", "src"), { recursive: true });
  fs.writeFileSync(path.join(tempDir, "admin", "src", "App.vue"), appVue);
  moduleFiles.forEach((file) => {
    const fullPath = path.join(tempDir, "admin", "src", file);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, "<template />");
  });
  [path.join(tempDir, "admin", "dist"), path.join(tempDir, "backend", "public", "admin-dist")].forEach((dir) => {
    fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), '<script type="module" src="/admin/assets/app.js"></script>');
    fs.writeFileSync(path.join(dir, "assets", "app.js"), "window.__ROOT_ADMIN__ = true;");
  });
  fs.mkdirSync(path.join(tempDir, "backend", "public"), { recursive: true });
  fs.writeFileSync(path.join(tempDir, "backend", "public", "admin.html"), "ROOT 7日打卡后台");
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const pending = buildAdminTransitionReadiness({ projectRoot: tempDir, env: {} });
  const approved = buildAdminTransitionReadiness({
    projectRoot: tempDir,
    env: { ROOT_LEGACY_ADMIN_DEPRECATION_APPROVED: "true" },
  });
  const approvedByRecord = buildAdminTransitionReadiness({
    projectRoot: tempDir,
    env: {},
    deprecationDecisions: [{
      status: "APPROVED",
      evidenceRef: "https://root.example.com/admin-deprecation/proof",
      rollbackRef: "https://root.example.com/admin-deprecation/rollback",
      decidedAt: "2026-06-20T00:00:00.000Z",
    }],
  });
  const rejectedByRecord = buildAdminTransitionReadiness({
    projectRoot: tempDir,
    env: {},
    deprecationDecisions: [{
      status: "REJECTED",
      evidenceRef: "https://root.example.com/admin-deprecation/rejected",
      decidedAt: "2026-06-20T00:00:00.000Z",
    }],
  });
  fs.rmSync(path.join(tempDir, "backend", "public", "admin-dist"), { recursive: true, force: true });
  const blocked = buildAdminTransitionReadiness({
    projectRoot: tempDir,
    env: { ROOT_LEGACY_ADMIN_DEPRECATION_APPROVED: "true" },
  });

  assert.equal(pending.status, "NEEDS_REVIEW");
  assert.equal(pending.summary.readyModuleCount, 6);
  assert.equal(pending.summary.bundledDistReady, true);
  assert.ok(pending.warnings.some((item) => item.includes("旧静态后台下线尚未批准")));
  assert.equal(approved.status, "READY");
  assert.equal(approved.summary.deprecationApproved, true);
  assert.equal(approvedByRecord.status, "READY");
  assert.equal(approvedByRecord.summary.deprecationApproved, true);
  assert.equal(approvedByRecord.summary.deprecationSource, "RECORD");
  assert.equal(approvedByRecord.legacyDeprecationDecision.status, "APPROVED");
  assert.equal(rejectedByRecord.status, "NEEDS_REVIEW");
  assert.equal(rejectedByRecord.summary.deprecationDecisionStatus, "REJECTED");
  assert.ok(rejectedByRecord.warnings.some((item) => item.includes("REJECTED")));
  assert.equal(blocked.status, "BLOCKED");
  assert.ok(blocked.blockers.some((item) => item.includes("backend-only Admin dist")));
});

test("production cutover readiness gates live external proof", () => {
  const readyEnv = {
    ROOT_CUTOVER_WECHAT_OPEN_PLATFORM_CERTIFIED: "true",
    ROOT_CUTOVER_CLOUDBASE_UNIONID_VERIFIED: "verified",
    ROOT_CUTOVER_ROOT_MEMBER_CENTER_APPID_CONFIRMED: "yes",
    ROOT_CUTOVER_YOUZAN_FIELDS_CALIBRATED: "done",
    ROOT_CUTOVER_YOUZAN_REWARD_FIELDS_CALIBRATED: "done",
    ROOT_CUTOVER_WEWORK_FIELDS_CALIBRATED: "done",
    ROOT_CUTOVER_CLOUDBASE_JOBS_CREATED: "done",
    ROOT_CUTOVER_EXTERNAL_CHANNELS_VERIFIED: "done",
    ROOT_CUTOVER_EXPORT_STORAGE_VERIFIED: "done",
    ROOT_CUTOVER_ROLLBACK_DRILL_COMPLETED: "done",
    ROOT_CUTOVER_WECHAT_REMINDER_DELIVERY_VERIFIED: "done",
    ROOT_CUTOVER_CLOUDRUN_CANDIDATE_VERIFIED: "done",
    ROOT_CUTOVER_MINIPROGRAM_TRIAL_VERIFIED: "done",
    ROOT_CUTOVER_CLOUDRUN_CANARY_VERIFIED: "done",
    ROOT_CUTOVER_RELEASE_ARTIFACT_TRACEABILITY_VERIFIED: "done",
    WECHAT_APPID: "wx-root",
    WECHAT_APPSECRET: "wechat-secret",
    ROOT_PUBLIC_BASE_URL: "https://root.example.com",
    ROOT_CLOUDBASE_ENV_ID: "root-prod",
    ROOT_CHECKIN_REMINDER_ENABLED: "true",
    ROOT_CHECKIN_REMINDER_SEND_ENABLED: "true",
    ROOT_CHECKIN_REMINDER_TEMPLATE_ID: "reminder-template",
    ROOT_CHECKIN_REMINDER_TEMPLATE_VERSION: "1",
    ROOT_MEMBER_CENTER_APPID: "wx-root-member",
    YOUZAN_ORDER_LIST_URL: "https://youzan.example.com/orders",
    YOUZAN_CUSTOMER_LIST_URL: "https://youzan.example.com/customers",
    YOUZAN_COUPON_SEND_URL: "https://youzan.example.com/coupons/send",
    YOUZAN_COUPON_STATUS_URL: "https://youzan.example.com/coupons/status",
    WEWORK_CONTACT_LIST_URL: "https://wework.example.com/contacts",
    WEWORK_TAG_APPLY_URL: "https://wework.example.com/tags",
    WEWORK_CONTACT_WRITEBACK_URL: "https://wework.example.com/writeback",
    ROOT_JOB_BASE_URL: "https://root.example.com",
    ROOT_ADMIN_JOB_TOKEN: "job-token",
    ROOT_OPERATIONAL_ALERT_WEBHOOK_URL: "https://hooks.example.com/root-alert",
    ROOT_LIFECYCLE_EXPORT_OBJECT_BUCKET: "root-export",
  };
  const runtimeMetadata = { version: "0.5.13", releaseId: "myroot-api-test-053", releaseIdConfigured: true };
  const blocked = buildProductionCutoverReadiness({ env: {}, target: "production" });
  const gray = buildProductionCutoverReadiness({ env: {}, target: "gray" });
  const readyProofs = CUTOVER_ITEMS.map((item) => ({
    itemId: item.id,
    status: "VERIFIED",
    evidenceRef: `https://root.example.com/release-evidence/${item.id}`,
    releaseVersion: runtimeMetadata.version,
    releaseId: runtimeMetadata.releaseId,
    releaseIdConfigured: runtimeMetadata.releaseIdConfigured,
  }));
  const envOnlyProduction = buildProductionCutoverReadiness({ env: readyEnv, target: "production", runtimeMetadata });
  const ready = buildProductionCutoverReadiness({ env: readyEnv, target: "production", proofs: readyProofs, runtimeMetadata });
  const grayReady = buildProductionCutoverReadiness({ env: readyEnv, target: "gray" });
  const rotatingJobToken = buildProductionCutoverReadiness({
    env: { ...readyEnv, ROOT_ADMIN_JOB_TOKEN: "", ROOT_ADMIN_JOB_TOKENS: JSON.stringify(["job-old", "job-new"]) },
    target: "production",
    proofs: readyProofs,
    runtimeMetadata,
  });
  const partial = buildProductionCutoverReadiness({
    env: { ...readyEnv, ROOT_MEMBER_CENTER_APPID: "", YOUZAN_MINIPROGRAM_APPID: "" },
    target: "production",
    proofs: readyProofs,
    runtimeMetadata,
  });
  const legacyProofWithoutEvidence = buildProductionCutoverReadiness({
    env: readyEnv,
    target: "production",
    proofs: readyProofs.map((proof) => proof.itemId === "cloudbase_unionid" ? { ...proof, evidenceRef: "" } : proof),
    runtimeMetadata,
  });
  const staleReleaseProofs = readyProofs.map((proof) => {
    const item = CUTOVER_ITEMS.find((candidate) => candidate.id === proof.itemId);
    return item && item.proofScope === "RELEASE"
      ? { ...proof, releaseVersion: "0.5.11", releaseId: "myroot-api-026" }
      : proof;
  });
  const staleRelease = buildProductionCutoverReadiness({
    env: readyEnv,
    target: "production",
    proofs: staleReleaseProofs,
    runtimeMetadata,
  });
  const fallbackReleaseId = buildProductionCutoverReadiness({
    env: readyEnv,
    target: "production",
    proofs: readyProofs.map((proof) => ({
      ...proof,
      releaseId: "0.5.13",
      releaseIdConfigured: false,
    })),
    runtimeMetadata: { version: "0.5.13", releaseId: "0.5.13", releaseIdConfigured: false },
  });

  assert.equal(blocked.status, "BLOCKED");
  assert.equal(blocked.summary.requiredProofCount, 15);
  assert.equal(blocked.summary.blockerCount, 15);
  assert.ok(blocked.blockers.some((item) => item.includes("微信开放平台")));
  assert.equal(gray.status, "NEEDS_REVIEW");
  assert.equal(gray.summary.warningCount, 15);
  assert.equal(grayReady.status, "READY");
  assert.equal(grayReady.items[0].proofSource, "ENV");
  assert.equal(envOnlyProduction.status, "BLOCKED");
  assert.equal(envOnlyProduction.summary.readyProofCount, 0);
  assert.ok(envOnlyProduction.blockers.every((item) => item.includes("后台 VERIFIED 记录")));
  assert.equal(ready.status, "READY");
  assert.equal(ready.summary.readyProofCount, 15);
  assert.equal(ready.summary.releaseScopedProofCount, 5);
  assert.equal(ready.summary.releaseBoundReadyCount, 5);
  assert.ok(ready.items.every((item) => item.proofSource === "RECORD"));
  assert.ok(ready.items.filter((item) => item.proofScope === "ENVIRONMENT").every((item) => item.proofPolicy === "VERIFIED_RECORD_WITH_EVIDENCE"));
  assert.ok(ready.items.filter((item) => item.proofScope === "RELEASE").every((item) => item.proofPolicy === "VERIFIED_RECORD_WITH_EVIDENCE_AND_RELEASE_BINDING"));
  assert.equal(ready.items.find((item) => item.id === "wechat_checkin_reminder_delivery").status, "READY");
  assert.equal(ready.items.find((item) => item.id === "cloudrun_candidate_runtime").status, "READY");
  assert.equal(ready.items.find((item) => item.id === "miniprogram_trial_core_flow").status, "READY");
  assert.equal(ready.items.find((item) => item.id === "cloudrun_canary_observation").status, "READY");
  assert.equal(ready.items.find((item) => item.id === "release_artifact_traceability").status, "READY");
  assert.equal(rotatingJobToken.items.find((item) => item.id === "cloudbase_jobs_created").status, "READY");
  assert.equal(ready.groups.find((group) => group.group === "identity").status, "READY");
  assert.equal(partial.status, "BLOCKED");
  assert.ok(partial.blockers.some((item) => item.includes("Root 会员中心 appId")));
  assert.equal(legacyProofWithoutEvidence.status, "BLOCKED");
  assert.equal(legacyProofWithoutEvidence.summary.readyProofCount, 14);
  assert.ok(legacyProofWithoutEvidence.blockers.some((item) => item.includes("缺少 evidenceRef")));
  assert.equal(staleRelease.status, "BLOCKED");
  assert.equal(staleRelease.summary.readyProofCount, 10);
  assert.equal(staleRelease.summary.releaseBoundReadyCount, 0);
  assert.equal(staleRelease.items.find((item) => item.id === "cloudbase_unionid").status, "READY");
  assert.equal(staleRelease.items.find((item) => item.id === "cloudrun_candidate_runtime").status, "BLOCKED");
  assert.ok(staleRelease.blockers.some((item) => item.includes("与当前候选 0.5.13/myroot-api-test-053 不一致")));
  assert.equal(fallbackReleaseId.status, "BLOCKED");
  assert.equal(fallbackReleaseId.summary.readyProofCount, 10);
  assert.ok(fallbackReleaseId.blockers.some((item) => item.includes("显式 ROOT_RELEASE_ID")));
});

test("production environment matrix groups launch and Adapter variables", () => {
  const readyEnv = {
    WECHAT_APPID: "wx-root",
    WECHAT_APPSECRET: "wechat-secret",
    ROOT_PUBLIC_BASE_URL: "https://root.example.com",
    ROOT_RELEASE_ID: "myroot-api-test-052",
    ROOT_PHONE_HMAC_KEY: "test-phone-hmac-key",
    ROOT_COMMAND_REQUEST_DIGEST_KEY: "test-command-request-digest-key-with-strong-entropy-2026",
    ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: "test-command-request-v1",
    ROOT_COMMAND_REQUEST_DIGEST_VERIFICATION_KEYS_JSON: JSON.stringify({
      "test-command-request-v0": "test-command-request-previous-key-with-strong-entropy-2025",
    }),
    ROOT_COMMAND_RESULT_ENCRYPTION_KEY: "test-command-result-key-with-at-least-32-characters",
    ROOT_COMMAND_RESULT_KEY_ID: "test-command-result-v1",
    ROOT_COMMAND_RESULT_DECRYPTION_KEYS_JSON: JSON.stringify({
      "test-command-result-v0": "test-command-result-previous-key-with-strong-entropy-2025",
    }),
    ROOT_INBOX_CONTENT_ENCRYPTION_KEY: "test-inbox-content-key-with-at-least-32-characters",
    ROOT_INBOX_CONTENT_KEY_ID: "test-inbox-content-v1",
    ROOT_ADMIN_TOKEN: "admin-secret-with-strong-entropy-2026",
    ROOT_REQUIRE_HEALTH_CONSENT: "true",
    ROOT_PRIVACY_CONTROLLER_NAME: "ROOT 测试主体",
    ROOT_PRIVACY_CONTACT: "privacy@example.com",
    ROOT_HEALTH_DATA_RETENTION_DAYS: "180",
    ROOT_HEALTH_DATA_RETENTION_CLEANUP_ENABLED: "true",
    ROOT_STORE_ADAPTER: "mysql",
    ROOT_MYSQL_MIGRATION_MODE: "verify_only",
    MYSQL_ADDRESS: "10.11.103.164:3306",
    MYSQL_USERNAME: "root",
    MYSQL_PASSWORD: "mysql-secret",
    MYSQL_DATABASE: "root_checkin",
    MYSQL_CONNECTION_LIMIT: "8",
    MYROOT_V1_RUNTIME_CONTROL_PLANE_ENABLED: "true",
    ROOT_V1_RUNTIME_READY_REQUIRED: "true",
    MYROOT_V1_RUNTIME_KILL_SWITCH: "DISENGAGED",
    MYROOT_V1_RUNTIME_OWNER: "runtime-owner-production-test",
    MYROOT_V1_RUNTIME_ATTESTATION_MAX_AGE_SECONDS: "180",
    MYROOT_V1_RUNTIME_ENVIRONMENT_ID: "production-test",
    MYROOT_V1_RUNTIME_TARGET_GENERATION: "production-test-initial",
    K_REVISION: "myroot-api-00001-test",
    MYROOT_V1_RUNTIME_CONNECTION_LIMIT: "3",
    MYROOT_V1_RUNTIME_ALERT_DELIVERY_MODE: "controlled",
    ROOT_V1_RUNTIME_ALERT_RECEIVER_BINDING_REF: "runtime-alert-receiver-test-v1",
    ROOT_V1_RUNTIME_ALERT_RECEIVER_ENDPOINT: "https://alerts.example.test/myroot/runtime",
    ROOT_V1_RUNTIME_ALERT_RECEIVER_SECRET:
      "runtime-alert-receiver-secret-with-strong-entropy-2026",
    ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY:
      "runtime-alert-binding-digest-key-with-strong-entropy-2026",
    ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY_ID: "runtime-alert-binding-test-v1",
    ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY:
      "runtime-alert-payload-signing-key-with-strong-entropy-2026",
    ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY_ID: "runtime-alert-payload-test-v1",
    ROOT_V1_RUNTIME_ALERT_RECEIPT_DIGEST_KEY:
      "runtime-alert-receipt-digest-key-with-strong-entropy-2026",
    ROOT_V1_RUNTIME_ALERT_RECEIPT_DIGEST_KEY_ID: "runtime-alert-receipt-test-v1",
    MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_USERNAME: "runtime-alert-registrar",
    MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_PASSWORD: "registrar-role-secret-2026",
    MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_CURRENT_USER: "runtime-alert-registrar@%",
    MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_CONNECTION_LIMIT: "2",
    MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_USERNAME: "runtime-alert-worker",
    MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_PASSWORD: "worker-role-secret-2026",
    MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_CURRENT_USER: "runtime-alert-worker@%",
    MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_CONNECTION_LIMIT: "3",
    MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_USERNAME: "runtime-alert-inspector",
    MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_PASSWORD: "inspector-role-secret-2026",
    MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_CURRENT_USER: "runtime-alert-inspector@%",
    MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_CONNECTION_LIMIT: "1",
    MYROOT_CLOUDRUN_MAX_INSTANCES: "2",
    MYSQL_SERVER_MAX_CONNECTIONS: "100",
    MYROOT_MYSQL_CONNECTION_HEADROOM: "20",
    MYROOT_MYSQL_CAPACITY_EVIDENCE_REF: "candidate-mysql-capacity-proof",
    MYROOT_V1_RUNTIME_ORCHESTRATOR_ENABLED: "true",
    MYROOT_OUTBOX_INBOX_BRIDGE_ENABLED: "true",
    MYROOT_INBOX_WORKER_HARNESS_ENABLED: "true",
    ROOT_KEY_INVENTORY_READINESS_ENABLED: "true",
    ROOT_KEY_INVENTORY_RETIRED_KEY_IDS_JSON: JSON.stringify({
      REQUEST_DIGEST: [],
      COMMAND_RESULT: [],
      INBOX_CONTENT: [],
      NOTIFICATION_RECEIPT: [],
    }),
    ROOT_CLOUDBASE_STORE_DECISION: "MYSQL_ON_CLOUDBASE",
    ROOT_CLOUDBASE_ENV_ID: "root-prod-env",
    ROOT_CLOUDBASE_REGION: "ap-shanghai",
    ROOT_CLOUDBASE_STORE_BACKUP_PLAN: "每日快照 + 发布前快照",
    ROOT_CLOUDBASE_STORE_ROLLBACK_PLAN: "按发布前快照回滚",
    ROOT_CLOUDBASE_STORAGE_TRANSPORT: "HTTP",
    CLOUDBASE_APIKEY: "cloudbase-server-api-key",
    ROOT_JOB_BASE_URL: "https://root.example.com",
    ROOT_CLOUDBASE_JOB_INVOCATION_POLICY_EVIDENCE: "candidate-timer-only-policy-proof",
    ROOT_REQUIRE_SCOPED_JOB_TOKENS: "true",
    ROOT_ADMIN_JOB_ROUTE_TOKENS: JSON.stringify({
      "/api/v1/jobs/checkin-reminders": ["checkin-route-secret-with-strong-entropy-2026"],
      "/api/v1/jobs/v1-runtime-cycle": ["runtime-route-secret-with-strong-entropy-2026"],
    }),
    ROOT_ADMIN_JOB_TOKEN: "job-secret-with-strong-entropy-2026",
    ROOT_CHECKIN_REMINDER_ENABLED: "true",
    ROOT_CHECKIN_REMINDER_SEND_ENABLED: "true",
    ROOT_CHECKIN_REMINDER_TEMPLATE_ID: "template-checkin-next-day",
    ROOT_CHECKIN_REMINDER_TEMPLATE_VERSION: "v2026-06-28-tpl10850",
    MYROOT_NOTIFICATION_DELIVERY_FOUNDATION_ENABLED: "true",
    ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY:
      "test-notification-receipt-hmac-key-with-strong-entropy-2026",
    ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY_ID: "test-notification-receipt-v1",
    ROOT_MEMBER_CENTER_APPID: "wxfb75c0b432670215",
    ROOT_MEMBER_CENTER_PRODUCT_PATH: "pages/goods/detail/index.html?alias=36ep2dcgnia7nf0",
    ROOT_MEMBER_CENTER_ENV_VERSION: "release",
    YOUZAN_CLIENT_ID: "youzan-client",
    YOUZAN_GRANT_ID: "12345678",
    YOUZAN_ACCESS_TOKEN: "youzan-token",
    YOUZAN_ACCESS_TOKEN_EXPIRES_AT: "2099-01-01T00:00:00+08:00",
    YOUZAN_TOKEN_MANAGEMENT_MODE: "STATIC_ROTATION",
    YOUZAN_TOKEN_ROTATION_OWNER: "root-ops",
    YOUZAN_ORDER_LIST_URL: "https://youzan.example.com/orders",
    ROOT_AFTER_SALES_STATUS_MAP: JSON.stringify({ REFUND_SUCCESS: "REFUNDED" }),
    ROOT_AFTER_SALES_RECOVERY_STATUSES: "REFUNDED,PARTIAL_REFUND",
    ROOT_AFTER_SALES_FOLLOW_STATUSES: "REQUESTED,APPROVED",
    YOUZAN_CUSTOMER_LIST_URL: "https://youzan.example.com/customers",
    YOUZAN_USER_QUERY_URL: "https://youzan.example.com/users/query",
    ROOT_YOUZAN_IDENTITY_RECONCILE_ENABLED: "true",
    YOUZAN_COUPON_SEND_URL: "https://youzan.example.com/coupons/send",
    YOUZAN_COUPON_STATUS_URL: "https://youzan.example.com/coupons/status",
    ROOT_FULFILLMENT_LIST_URL: "https://logistics.example.com/events",
    ROOT_FULFILLMENT_SECRET: "fulfillment-secret",
    WEWORK_CORP_ID: "ww-root",
    WEWORK_CONTACT_LIST_URL: "https://wework.example.com/contacts",
    WEWORK_CONTACT_SECRET: "wework-secret",
    WEWORK_ACCESS_TOKEN: "wework-token",
    WEWORK_TAG_APPLY_URL: "https://wework.example.com/tags",
  };
  const ready = buildProductionEnvMatrix(readyEnv, { target: "production" });
  const rotatingJobToken = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_ADMIN_JOB_ROUTE_TOKENS: JSON.stringify({
      "/api/v1/jobs/checkin-reminders": [
        "checkin-route-old-secret-with-strong-entropy-2026",
        "checkin-route-new-secret-with-strong-entropy-2026",
      ],
      "/api/v1/jobs/v1-runtime-cycle": [
        "runtime-route-secret-with-strong-entropy-2026",
      ],
    }),
  }, { target: "production" });
  const blocked = buildProductionEnvMatrix({}, { target: "production" });
  const gray = buildProductionEnvMatrix({}, { target: "gray" });
  const disabledConsent = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_REQUIRE_HEALTH_CONSENT: "false",
  }, { target: "production" });
  const invalidRetention = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_HEALTH_DATA_RETENTION_DAYS: "0",
  }, { target: "production" });
  const invalidPrivacyContact = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_PRIVACY_CONTACT: "待确认",
  }, { target: "production" });
  const disabledReminder = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_CHECKIN_REMINDER_ENABLED: "false",
  }, { target: "production" });
  const disabledReminderSend = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_CHECKIN_REMINDER_SEND_ENABLED: "false",
  }, { target: "production" });
  const untrustedWechatOpenApiEndpoint = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_WECHAT_OPENAPI_BASE_URL: "https://attacker.example",
  }, { target: "production" });
  const untrustedWechatSubscribeEndpoint = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_WECHAT_SUBSCRIBE_SEND_URL: "https://attacker.example/cgi-bin/message/subscribe/send",
  }, { target: "production" });
  const exactWechatEndpoints = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_WECHAT_OPENAPI_BASE_URL: "https://api.weixin.qq.com",
    ROOT_WECHAT_SUBSCRIBE_SEND_URL: "https://api.weixin.qq.com/cgi-bin/message/subscribe/send",
  }, { target: "production" });
  const disabledNotificationDeliveryFoundation = buildProductionEnvMatrix({
    ...readyEnv,
    MYROOT_NOTIFICATION_DELIVERY_FOUNDATION_ENABLED: "false",
  }, { target: "production" });
  const weakNotificationReceiptKey = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY: "too-short",
  }, { target: "production" });
  const invalidNotificationReceiptKeyId = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY_ID: "invalid receipt key id",
  }, { target: "production" });
  const expiredYouzanToken = buildProductionEnvMatrix({
    ...readyEnv,
    YOUZAN_ACCESS_TOKEN_EXPIRES_AT: "2020-01-01T00:00:00+08:00",
  }, { target: "production" });
  const missingPhoneHmacKey = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_PHONE_HMAC_KEY: "",
  }, { target: "production" });
  const missingCommandResultKey = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_COMMAND_RESULT_ENCRYPTION_KEY: "",
  }, { target: "production" });
  const missingCommandResultKeyId = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_COMMAND_RESULT_KEY_ID: "",
  }, { target: "production" });
  const weakCommandResultKey = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_COMMAND_RESULT_ENCRYPTION_KEY: "too-short",
  }, { target: "production" });
  const missingInboxContentKey = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_INBOX_CONTENT_ENCRYPTION_KEY: "",
  }, { target: "production" });
  const missingInboxContentKeyId = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_INBOX_CONTENT_KEY_ID: "",
  }, { target: "production" });
  const missingCommandRequestDigestKey = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_COMMAND_REQUEST_DIGEST_KEY: "",
  }, { target: "production" });
  const invalidCommandRequestDigestKeyId = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_COMMAND_REQUEST_DIGEST_KEY_ID: "invalid key id",
  }, { target: "production" });
  const malformedRequestDigestKeyring = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_COMMAND_REQUEST_DIGEST_VERIFICATION_KEYS_JSON: "not-json",
  }, { target: "production" });
  const emptyConfiguredRequestDigestKeyring = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_COMMAND_REQUEST_DIGEST_VERIFICATION_KEYS_JSON: "",
  }, { target: "production" });
  const activeCommandResultInPreviousKeyring = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_COMMAND_RESULT_DECRYPTION_KEYS_JSON: JSON.stringify({
      [readyEnv.ROOT_COMMAND_RESULT_KEY_ID]: "duplicate-current-result-key-material-with-strong-entropy",
    }),
  }, { target: "production" });
  const malformedRetiredKeyIds = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_KEY_INVENTORY_RETIRED_KEY_IDS_JSON: JSON.stringify({
      COMMAND_RESULT: [],
      INBOX_CONTENT: [],
    }),
  }, { target: "production" });
  const overlappingRetiredKeyIds = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_KEY_INVENTORY_RETIRED_KEY_IDS_JSON: JSON.stringify({
      REQUEST_DIGEST: ["test-command-request-v0"],
      COMMAND_RESULT: [],
      INBOX_CONTENT: [],
      NOTIFICATION_RECEIPT: [],
    }),
  }, { target: "production" });
  const activeNotificationReceiptRetired = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_KEY_INVENTORY_RETIRED_KEY_IDS_JSON: JSON.stringify({
      REQUEST_DIGEST: [],
      COMMAND_RESULT: [],
      INBOX_CONTENT: [],
      NOTIFICATION_RECEIPT: [readyEnv.ROOT_NOTIFICATION_PROVIDER_RECEIPT_HMAC_KEY_ID],
    }),
  }, { target: "production" });
  const nonMysqlProductionStore = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_STORE_ADAPTER: "sqlite",
  }, { target: "production" });
  const invalidAdminCredentials = [
    { ROOT_ADMIN_TOKEN: "   ", ROOT_ADMIN_TOKENS: "" },
    { ROOT_ADMIN_TOKEN: "short", ROOT_ADMIN_TOKENS: "" },
    { ROOT_ADMIN_TOKEN: "", ROOT_ADMIN_TOKENS: JSON.stringify({ ops: { token: "   ", role: "operator" } }) },
    { ROOT_ADMIN_TOKEN: "", ROOT_ADMIN_TOKENS: JSON.stringify(["admin-secret-with-strong-entropy-2026"]) },
  ].map((override) => buildProductionEnvMatrix({ ...readyEnv, ...override }, { target: "production" }));
  const rotatingAdminToken = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_ADMIN_TOKEN: "",
    ROOT_ADMIN_TOKENS: JSON.stringify({
      previous: { token: "admin-old-secret-with-strong-entropy-2026", role: "admin" },
      current: { token: "admin-new-secret-with-strong-entropy-2026", role: "admin" },
    }),
  }, { target: "production" });
  const invalidMysqlAuthorities = [
    { MYSQL_ADDRESS: "db.example.com" },
    { MYSQL_ADDRESS: "db.example.com:0" },
    { MYSQL_ADDRESS: "db.example.com:65536" },
    { MYSQL_ADDRESS: "bad host:3306" },
    { MYSQL_USERNAME: "bad user" },
    { MYSQL_PASSWORD: "   " },
    { MYSQL_DATABASE: "bad/database" },
    { MYSQL_HOST: "bad host" },
    { MYSQL_PORT: "notaport" },
    { MYSQL_PORT: "0" },
    { MYSQL_PORT: "65536" },
  ].map((override) => buildProductionEnvMatrix({ ...readyEnv, ...override }, { target: "production" }));
  const invalidCloudbaseEnvironmentIds = [
    "bad env",
    "root/prod",
    `r${"x".repeat(128)}`,
  ].map((value) => buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_CLOUDBASE_ENV_ID: value,
    CLOUDBASE_APIKEY: "",
  }, { target: "production" }));
  const missingDeploymentIdentity = buildProductionEnvMatrix({
    ...readyEnv,
    K_REVISION: "",
    ROOT_RELEASE_ARTIFACT_DIGEST: "",
  }, { target: "production" });
  const invalidDeploymentIdentities = [
    { K_REVISION: "revision with spaces", ROOT_RELEASE_ARTIFACT_DIGEST: "" },
    { K_REVISION: "", ROOT_RELEASE_ARTIFACT_DIGEST: "ABC123" },
  ].map((override) => buildProductionEnvMatrix({ ...readyEnv, ...override }, { target: "production" }));
  const artifactDigestDeploymentIdentity = buildProductionEnvMatrix({
    ...readyEnv,
    K_REVISION: "",
    ROOT_RELEASE_ARTIFACT_DIGEST: "a".repeat(64),
  }, { target: "production" });
  const runtimeControlDisabled = buildProductionEnvMatrix({
    ...readyEnv,
    MYROOT_V1_RUNTIME_CONTROL_PLANE_ENABLED: "false",
  }, { target: "production" });
  const runtimeKillSwitchWrongCase = buildProductionEnvMatrix({
    ...readyEnv,
    MYROOT_V1_RUNTIME_KILL_SWITCH: "disengaged",
  }, { target: "production" });
  const runtimeOwnerInvalid = buildProductionEnvMatrix({
    ...readyEnv,
    MYROOT_V1_RUNTIME_OWNER: "owner with spaces",
  }, { target: "production" });
  const runtimeConnectionPoolTooSmall = buildProductionEnvMatrix({
    ...readyEnv,
    MYSQL_CONNECTION_LIMIT: "1",
  }, { target: "production" });
  const runtimeDedicatedPoolTooSmall = buildProductionEnvMatrix({
    ...readyEnv,
    MYROOT_V1_RUNTIME_CONNECTION_LIMIT: "2",
  }, { target: "production" });
  const runtimeDedicatedPoolTooLarge = buildProductionEnvMatrix({
    ...readyEnv,
    MYROOT_V1_RUNTIME_CONNECTION_LIMIT: "65",
    MYSQL_SERVER_MAX_CONNECTIONS: "500",
  }, { target: "production" });
  const runtimeDedicatedPoolMaximum = buildProductionEnvMatrix({
    ...readyEnv,
    MYROOT_V1_RUNTIME_CONNECTION_LIMIT: "64",
    MYSQL_SERVER_MAX_CONNECTIONS: "500",
  }, { target: "production" });
  const runtimeCapacityExceeded = buildProductionEnvMatrix({
    ...readyEnv,
    MYSQL_SERVER_MAX_CONNECTIONS: "30",
  }, { target: "production" });
  const runtimeCapacityExact = buildProductionEnvMatrix({
    ...readyEnv,
    MYSQL_SERVER_MAX_CONNECTIONS: "56",
  }, { target: "production" });
  const runtimeCapacityOneShort = buildProductionEnvMatrix({
    ...readyEnv,
    MYSQL_SERVER_MAX_CONNECTIONS: "55",
  }, { target: "production" });
  const missingRuntimeWorkerPassword = buildProductionEnvMatrix({
    ...readyEnv,
    MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_PASSWORD: "",
  }, { target: "production" });
  const missingRuntimeAlertDeliveryFields = [
    "ROOT_V1_RUNTIME_ALERT_RECEIVER_BINDING_REF",
    "ROOT_V1_RUNTIME_ALERT_RECEIVER_ENDPOINT",
    "ROOT_V1_RUNTIME_ALERT_RECEIVER_SECRET",
    "ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY",
    "ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY_ID",
    "ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY",
    "ROOT_V1_RUNTIME_ALERT_PAYLOAD_SIGNING_KEY_ID",
    "ROOT_V1_RUNTIME_ALERT_RECEIPT_DIGEST_KEY",
    "ROOT_V1_RUNTIME_ALERT_RECEIPT_DIGEST_KEY_ID",
  ].map((name) => ({
    name,
    matrix: buildProductionEnvMatrix({ ...readyEnv, [name]: "" }, { target: "production" }),
  }));
  const invalidRuntimeAlertEndpoint = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_V1_RUNTIME_ALERT_RECEIVER_ENDPOINT: "http://alerts.example.test/myroot/runtime",
  }, { target: "production" });
  const duplicateRuntimeAlertKeyId = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_V1_RUNTIME_ALERT_RECEIPT_DIGEST_KEY_ID:
      readyEnv.ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY_ID,
  }, { target: "production" });
  const duplicateRuntimeAlertKey = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_V1_RUNTIME_ALERT_RECEIPT_DIGEST_KEY:
      readyEnv.ROOT_V1_RUNTIME_ALERT_BINDING_DIGEST_KEY,
  }, { target: "production" });
  const weakRuntimeRegistrarPassword = buildProductionEnvMatrix({
    ...readyEnv,
    MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_PASSWORD: "too-short",
  }, { target: "production" });
  const invalidRuntimeInspectorCurrentUser = buildProductionEnvMatrix({
    ...readyEnv,
    MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_CURRENT_USER: "missing-at-sign",
  }, { target: "production" });
  const duplicateRuntimePrincipal = buildProductionEnvMatrix({
    ...readyEnv,
    MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_CURRENT_USER:
      readyEnv.MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_CURRENT_USER,
  }, { target: "production" });
  const duplicateRuntimeUsername = buildProductionEnvMatrix({
    ...readyEnv,
    MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_USERNAME:
      readyEnv.MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_USERNAME,
  }, { target: "production" });
  const duplicateRuntimeCredential = buildProductionEnvMatrix({
    ...readyEnv,
    MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_PASSWORD:
      readyEnv.MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_PASSWORD,
  }, { target: "production" });
  const invalidRuntimeRoleLimits = ["0", "65", "01", "1.0", "1e1", "+1"]
    .map((value) => buildProductionEnvMatrix({
      ...readyEnv,
      MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_CONNECTION_LIMIT: value,
    }, { target: "production" }));
  const invalidRuntimeCapacityBounds = [
    { MYSQL_CONNECTION_LIMIT: "1025", MYSQL_SERVER_MAX_CONNECTIONS: "5000" },
    { MYROOT_CLOUDRUN_MAX_INSTANCES: "10001", MYSQL_SERVER_MAX_CONNECTIONS: "1000000000" },
    { MYSQL_SERVER_MAX_CONNECTIONS: "1000000001" },
    { MYROOT_MYSQL_CONNECTION_HEADROOM: "1000000001", MYSQL_SERVER_MAX_CONNECTIONS: "1000000000" },
  ].map((override) => buildProductionEnvMatrix({ ...readyEnv, ...override }, { target: "production" }));
  const invalidRuntimeAttestationAges = ["0", "3601"].map((value) => buildProductionEnvMatrix({
    ...readyEnv,
    MYROOT_V1_RUNTIME_ATTESTATION_MAX_AGE_SECONDS: value,
  }, { target: "production" }));
  const validRuntimeAttestationBoundaries = ["1", "3600"].map((value) => buildProductionEnvMatrix({
    ...readyEnv,
    MYROOT_V1_RUNTIME_ATTESTATION_MAX_AGE_SECONDS: value,
  }, { target: "production" }));
  const invalidReleaseIds = ["release with spaces", "中午版本", `r${"x".repeat(128)}`]
    .map((value) => buildProductionEnvMatrix({ ...readyEnv, ROOT_RELEASE_ID: value }, { target: "production" }));
  const invalidJobBaseUrl = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_JOB_BASE_URL: "http://root.example.com",
  }, { target: "production" });
  const malformedJobRotation = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_ADMIN_JOB_ROUTE_TOKENS: "not-json",
  }, { target: "production" });
  const emptyJobRotation = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_ADMIN_JOB_ROUTE_TOKENS: "{}",
  }, { target: "production" });
  const whitespaceJobToken = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_ADMIN_JOB_ROUTE_TOKENS: JSON.stringify({
      "/api/v1/jobs/checkin-reminders": ["   "],
    }),
  }, { target: "production" });
  const invalidSchedulerOptions = [
    { ROOT_JOB_DRY_RUN: "yes" },
    { ROOT_V1_RUNTIME_SCHEDULER_DRY_RUN: "treu" },
    { ROOT_V1_RUNTIME_SCHEDULER_TIMEOUT_SECONDS: "26" },
    { ROOT_V1_RUNTIME_BRIDGE_LIMIT: "101" },
    { ROOT_V1_RUNTIME_RECOVERY_LIMIT: "0" },
    { ROOT_V1_RUNTIME_WORKER_LIMIT: "1.5" },
  ].map((override) => buildProductionEnvMatrix({ ...readyEnv, ...override }, { target: "production" }));
  const report = buildProductionEnvMatrixReport(ready);

  assert.equal(ready.status, "READY");
  assert.equal(ready.summary.blockers, 0);
  assert.equal(ready.groups.find((group) => group.id === "youzan_order").required.some((item) => item.name === "YOUZAN_CLIENT_SECRET"), false);
  assert.ok(ready.groups.some((group) => group.id === "cloudbase_store" && group.status === "PASS"));
  assert.ok(ready.groups.some((group) => group.id === "cloudbase_object_storage" && group.status === "PASS"));
  assert.ok(buildProductionEnvMatrix({
    ...readyEnv,
    CLOUDBASE_APIKEY: "",
  }, { target: "production" }).groups.some((group) =>
    group.id === "cloudbase_object_storage" && group.status === "BLOCKER"));
  assert.ok(ready.groups.some((group) => group.id === "cloudbase_jobs" && group.status === "PASS"));
  assert.ok(ready.groups.some((group) => group.id === "v1_runtime_control" && group.status === "PASS"));
  assert.ok(ready.groups.some((group) => group.id === "privacy_compliance" && group.status === "PASS"));
  assert.ok(disabledConsent.groups.some((group) => group.id === "privacy_compliance" && group.status === "BLOCKER"));
  assert.ok(invalidRetention.groups.some((group) => group.id === "privacy_compliance" && group.status === "BLOCKER"));
  assert.ok(invalidPrivacyContact.groups.some((group) => group.id === "privacy_compliance" && group.status === "BLOCKER"));
  assert.ok(disabledReminder.groups.some((group) => group.id === "checkin_reminder_subscription" && group.status === "BLOCKER"));
  assert.ok(disabledReminderSend.groups.some((group) =>
    group.id === "checkin_reminder_subscription" && group.status === "BLOCKER"));
  for (const untrustedEndpoint of [untrustedWechatOpenApiEndpoint, untrustedWechatSubscribeEndpoint]) {
    assert.ok(untrustedEndpoint.groups.some((group) =>
      group.id === "checkin_reminder_subscription" && group.status === "BLOCKER"));
  }
  assert.ok(exactWechatEndpoints.groups.some((group) =>
    group.id === "checkin_reminder_subscription" && group.status === "PASS"));
  for (const invalidNotificationDelivery of [
    disabledNotificationDeliveryFoundation,
    weakNotificationReceiptKey,
    invalidNotificationReceiptKeyId,
  ]) {
    assert.ok(invalidNotificationDelivery.groups.some((group) =>
      group.id === "checkin_reminder_subscription" && group.status === "BLOCKER"));
  }
  assert.ok(expiredYouzanToken.groups.some((group) => group.id === "youzan_order" && group.status === "BLOCKER"));
  assert.ok(missingPhoneHmacKey.groups.some((group) =>
    group.id === "runtime" && group.status === "BLOCKER" && group.missingRequired.includes("ROOT_PHONE_HMAC_KEY")));
  assert.ok(missingCommandResultKey.groups.some((group) =>
    group.id === "runtime" && group.status === "BLOCKER" && group.missingRequired.includes("ROOT_COMMAND_RESULT_ENCRYPTION_KEY")));
  assert.ok(missingCommandResultKeyId.groups.some((group) =>
    group.id === "runtime" && group.status === "BLOCKER" && group.missingRequired.includes("ROOT_COMMAND_RESULT_KEY_ID")));
  assert.ok(weakCommandResultKey.groups.some((group) =>
    group.id === "runtime" && group.status === "BLOCKER" && group.missingRequired.some((item) => item.startsWith("ROOT_COMMAND_RESULT_ENCRYPTION_KEY="))));
  assert.ok(missingInboxContentKey.groups.some((group) =>
    group.id === "runtime" && group.status === "BLOCKER" && group.missingRequired.includes("ROOT_INBOX_CONTENT_ENCRYPTION_KEY")));
  assert.ok(missingInboxContentKeyId.groups.some((group) =>
    group.id === "runtime" && group.status === "BLOCKER" && group.missingRequired.includes("ROOT_INBOX_CONTENT_KEY_ID")));
  assert.ok(missingCommandRequestDigestKey.groups.some((group) =>
    group.id === "runtime" && group.status === "BLOCKER" && group.missingRequired.includes("ROOT_COMMAND_REQUEST_DIGEST_KEY")));
  assert.ok(invalidCommandRequestDigestKeyId.groups.some((group) =>
    group.id === "runtime" && group.status === "BLOCKER" && group.missingRequired.some((item) => item.startsWith("ROOT_COMMAND_REQUEST_DIGEST_KEY_ID="))));
  assert.ok(malformedRequestDigestKeyring.groups.some((group) =>
    group.id === "runtime" && group.status === "BLOCKER"));
  assert.ok(emptyConfiguredRequestDigestKeyring.groups.some((group) =>
    group.id === "runtime" && group.status === "BLOCKER"));
  assert.ok(activeCommandResultInPreviousKeyring.groups.some((group) =>
    group.id === "runtime" && group.status === "BLOCKER"));
  assert.ok(malformedRetiredKeyIds.groups.some((group) =>
    group.id === "v1_runtime_control" && group.status === "BLOCKER"));
  assert.ok(overlappingRetiredKeyIds.groups.some((group) =>
    group.id === "v1_runtime_control" && group.status === "BLOCKER"));
  assert.ok(activeNotificationReceiptRetired.groups.some((group) =>
    group.id === "v1_runtime_control" && group.status === "BLOCKER"));
  assert.ok(nonMysqlProductionStore.groups.some((group) => group.id === "store" && group.status === "BLOCKER"));
  for (const invalidAdminCredential of invalidAdminCredentials) {
    assert.ok(invalidAdminCredential.groups.some((group) => group.id === "runtime" && group.status === "BLOCKER"));
  }
  assert.ok(rotatingAdminToken.groups.some((group) => group.id === "runtime" && group.status === "PASS"));
  for (const invalidMysqlAuthority of invalidMysqlAuthorities) {
    assert.ok(invalidMysqlAuthority.groups.some((group) => group.id === "store" && group.status === "BLOCKER"));
  }
  for (const invalidCloudbaseEnvironmentId of invalidCloudbaseEnvironmentIds) {
    assert.ok(invalidCloudbaseEnvironmentId.groups.some((group) =>
      ["cloudbase_store", "cloudbase_object_storage"].includes(group.id) && group.status === "BLOCKER"));
  }
  assert.ok(missingDeploymentIdentity.groups.some((group) =>
    group.id === "v1_runtime_control" && group.status === "BLOCKER"));
  for (const invalidDeploymentIdentity of invalidDeploymentIdentities) {
    assert.ok(invalidDeploymentIdentity.groups.some((group) =>
      group.id === "v1_runtime_control" && group.status === "BLOCKER"));
  }
  assert.ok(artifactDigestDeploymentIdentity.groups.some((group) =>
    group.id === "v1_runtime_control" && group.status === "PASS"));
  assert.ok(runtimeControlDisabled.groups.some((group) =>
    group.id === "v1_runtime_control" && group.status === "BLOCKER"
      && group.missingRequired.some((item) => item.startsWith("MYROOT_V1_RUNTIME_CONTROL_PLANE_ENABLED="))));
  assert.ok(runtimeKillSwitchWrongCase.groups.some((group) =>
    group.id === "v1_runtime_control" && group.status === "BLOCKER"
      && group.missingRequired.some((item) => item.startsWith("MYROOT_V1_RUNTIME_KILL_SWITCH="))));
  assert.ok(runtimeOwnerInvalid.groups.some((group) =>
    group.id === "v1_runtime_control" && group.status === "BLOCKER"
      && group.missingRequired.some((item) => item.startsWith("MYROOT_V1_RUNTIME_OWNER="))));
  assert.ok(runtimeConnectionPoolTooSmall.groups.some((group) =>
    group.id === "v1_runtime_control" && group.status === "BLOCKER"
      && group.missingRequired.some((item) => item.startsWith("MYSQL_CONNECTION_LIMIT="))));
  for (const invalidRuntimePool of [runtimeDedicatedPoolTooSmall, runtimeDedicatedPoolTooLarge]) {
    assert.ok(invalidRuntimePool.groups.some((group) =>
      group.id === "v1_runtime_control" && group.status === "BLOCKER"
        && group.missingRequired.some((item) => item.startsWith("MYROOT_V1_RUNTIME_CONNECTION_LIMIT="))));
  }
  assert.ok(runtimeDedicatedPoolMaximum.groups.some((group) =>
    group.id === "v1_runtime_control" && group.status === "PASS"));
  assert.ok(runtimeCapacityExceeded.groups.some((group) =>
    group.id === "v1_runtime_control" && group.status === "BLOCKER"
      && group.missingRequired.some((item) => item.startsWith("MYSQL_CONNECTION_CAPACITY_BUDGET="))));
  assert.ok(runtimeCapacityExact.groups.some((group) =>
    group.id === "v1_runtime_control" && group.status === "PASS"));
  assert.ok(runtimeCapacityOneShort.groups.some((group) =>
    group.id === "v1_runtime_control" && group.status === "BLOCKER"
      && group.missingRequired.includes("MYSQL_CONNECTION_CAPACITY_BUDGET=56<=55")));
  assert.ok(missingRuntimeWorkerPassword.groups.some((group) =>
    group.id === "v1_runtime_control" && group.status === "BLOCKER"
      && group.missingRequired.includes("MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_PASSWORD")));
  for (const { name, matrix } of missingRuntimeAlertDeliveryFields) {
    assert.ok(matrix.groups.some((group) =>
      group.id === "v1_runtime_control" && group.status === "BLOCKER"
        && group.missingRequired.includes(name)));
  }
  assert.ok(invalidRuntimeAlertEndpoint.groups.some((group) =>
    group.id === "v1_runtime_control" && group.status === "BLOCKER"
      && group.missingRequired.some((item) =>
        item.startsWith("ROOT_V1_RUNTIME_ALERT_RECEIVER_ENDPOINT="))));
  assert.ok(duplicateRuntimeAlertKeyId.groups.some((group) =>
    group.id === "v1_runtime_control" && group.status === "BLOCKER"
      && group.missingRequired.includes("ROOT_V1_RUNTIME_ALERT_DIGEST_KEY_IDS_DISTINCT=required")));
  assert.ok(duplicateRuntimeAlertKey.groups.some((group) =>
    group.id === "v1_runtime_control" && group.status === "BLOCKER"
      && group.missingRequired.includes("ROOT_V1_RUNTIME_ALERT_DIGEST_KEYS_DISTINCT=required")));
  assert.ok(weakRuntimeRegistrarPassword.groups.some((group) =>
    group.id === "v1_runtime_control" && group.status === "BLOCKER"
      && group.missingRequired.some((item) => item.startsWith("MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_PASSWORD="))));
  assert.ok(invalidRuntimeInspectorCurrentUser.groups.some((group) =>
    group.id === "v1_runtime_control" && group.status === "BLOCKER"
      && group.missingRequired.some((item) => item.startsWith("MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_CURRENT_USER="))));
  assert.ok(duplicateRuntimePrincipal.groups.some((group) =>
    group.id === "v1_runtime_control" && group.status === "BLOCKER"
      && group.missingRequired.includes("MYROOT_V1_RUNTIME_ALERT_MYSQL_PRINCIPALS_DISTINCT=required")));
  assert.ok(duplicateRuntimeUsername.groups.some((group) =>
    group.id === "v1_runtime_control" && group.status === "BLOCKER"
      && group.missingRequired.includes("MYROOT_V1_RUNTIME_ALERT_MYSQL_USERNAMES_DISTINCT=required")));
  assert.ok(duplicateRuntimeCredential.groups.some((group) =>
    group.id === "v1_runtime_control" && group.status === "BLOCKER"
      && group.missingRequired.includes("MYROOT_V1_RUNTIME_ALERT_MYSQL_CREDENTIALS_DISTINCT=required")));
  for (const invalidRoleLimit of invalidRuntimeRoleLimits) {
    assert.ok(invalidRoleLimit.groups.some((group) =>
      group.id === "v1_runtime_control" && group.status === "BLOCKER"
        && group.missingRequired.some((item) => item.startsWith("MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_CONNECTION_LIMIT="))));
  }
  const serializedReadyMatrix = JSON.stringify(ready);
  for (const secret of [
    readyEnv.MYROOT_V1_RUNTIME_ALERT_REGISTRAR_MYSQL_PASSWORD,
    readyEnv.MYROOT_V1_RUNTIME_ALERT_WORKER_MYSQL_PASSWORD,
    readyEnv.MYROOT_V1_RUNTIME_ALERT_INSPECTOR_MYSQL_PASSWORD,
  ]) assert.equal(serializedReadyMatrix.includes(secret), false);
  for (const invalidCapacityBound of invalidRuntimeCapacityBounds) {
    assert.ok(invalidCapacityBound.groups.some((group) =>
      group.id === "v1_runtime_control" && group.status === "BLOCKER"));
  }
  for (const invalidAge of invalidRuntimeAttestationAges) {
    assert.ok(invalidAge.groups.some((group) => group.id === "v1_runtime_control" && group.status === "BLOCKER"));
  }
  for (const validAge of validRuntimeAttestationBoundaries) {
    assert.ok(validAge.groups.some((group) => group.id === "v1_runtime_control" && group.status === "PASS"));
  }
  for (const invalidRelease of invalidReleaseIds) {
    assert.ok(invalidRelease.groups.some((group) => group.id === "runtime" && group.status === "BLOCKER"));
  }
  for (const invalidJob of [invalidJobBaseUrl, malformedJobRotation, emptyJobRotation, whitespaceJobToken]) {
    assert.ok(invalidJob.groups.some((group) => group.id === "cloudbase_jobs" && group.status === "BLOCKER"));
  }
  for (const invalidSchedulerOption of invalidSchedulerOptions) {
    assert.ok(invalidSchedulerOption.groups.some((group) =>
      group.id === "cloudbase_jobs" && group.status === "BLOCKER"));
  }
  assert.ok(rotatingJobToken.groups.some((group) =>
    group.id === "cloudbase_jobs" &&
    group.status === "PASS" &&
    group.required.some((item) => item.name === "ROOT_ADMIN_JOB_ROUTE_TOKENS" && item.present)));
  assert.ok(ready.groups.some((group) => group.id === "checkin_reminder_subscription" && group.status === "PASS"));
  assert.ok(ready.groups.some((group) => group.id === "root_member_center_jump" && group.status === "PASS"));
  assert.ok(ready.groups.some((group) => group.id === "order_after_sales" && group.status === "OPTIONAL"));
  assert.ok(ready.groups.some((group) => group.id === "order_after_sales" && group.optional.some((item) => item.name === "ROOT_AFTER_SALES_STATUS_MAP" && item.present)));
  assert.ok(ready.groups.some((group) => group.id === "order_after_sales" && group.optional.some((item) => item.name === "ROOT_AFTER_SALES_RECOVERY_STATUSES" && item.present)));
  assert.ok(ready.groups.some((group) => group.id === "order_after_sales" && group.optional.some((item) => item.name === "ROOT_AFTER_SALES_FOLLOW_STATUSES" && item.present)));
  assert.ok(ready.groups.some((group) => group.id === "cloudbase_jobs" && group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_RETENTION_DAYS")));
  assert.ok(ready.groups.some((group) => group.id === "cloudbase_jobs" && group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_CLEANUP_LIMIT")));
  assert.ok(ready.groups.some((group) => group.id === "cloudbase_jobs" && group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_SENSITIVITY")));
  assert.ok(ready.groups.some((group) => group.id === "cloudbase_jobs" && group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_APPROVAL_REQUIRED")));
  assert.ok(ready.groups.some((group) => group.id === "cloudbase_jobs" && group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_DELIVERY_CHANNEL")));
  assert.ok(ready.groups.some((group) => group.id === "cloudbase_jobs" && group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_CHANNEL")));
  assert.ok(ready.groups.some((group) => group.id === "cloudbase_jobs" && group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_TEMPLATE")));
  assert.ok(ready.groups.some((group) => group.id === "cloudbase_jobs" && group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_DELIVERY_TIMEOUT_MS")));
  assert.ok(ready.groups.some((group) => group.id === "cloudbase_jobs" && group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_DOWNLOAD_SECRET")));
  assert.ok(ready.groups.some((group) => group.id === "cloudbase_jobs" && group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_SIGNED_DOWNLOAD_ENABLED")));
  assert.ok(ready.groups.some((group) => group.id === "cloudbase_jobs" && group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_SIGNED_DOWNLOAD_TTL_SECONDS")));
  assert.ok(ready.groups.some((group) => group.id === "cloudbase_jobs" && group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_OBJECT_BASE_URL")));
  assert.ok(ready.groups.some((group) => group.id === "cloudbase_jobs" && group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_OBJECT_CLEANUP_ENABLED")));
  assert.ok(ready.groups.some((group) => group.id === "cloudbase_jobs" && group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_OBJECT_DIR")));
  assert.ok(ready.groups.some((group) => group.id === "alert_webhook" && group.status === "OPTIONAL"));
  assert.ok(ready.groups.some((group) => group.id === "manual_review_explanation" && group.status === "OPTIONAL"));
  assert.ok(ready.groups.some((group) => group.id === "manual_review_explanation" && group.optional.some((item) => item.name === "ROOT_MANUAL_REVIEW_EXPLANATION_TEMPLATES")));
  assert.equal(determineProductionEnvExitCode(ready), 0);
  assert.equal(blocked.status, "BLOCKED");
  assert.ok(blocked.missingEnv.some((item) => item.name === "ROOT_JOB_BASE_URL"));
  assert.equal(determineProductionEnvExitCode(blocked), 2);
  assert.equal(gray.status, "NEEDS_REVIEW");
  assert.equal(parseProductionEnvArgs(["--target", "gray", "--json"]).target, "gray");
  assert.match(report, /ROOT 生产环境变量矩阵/);
  assert.match(report, /CloudBase 定时 Job/);
});

test("store snapshot validation catches missing keys and script arguments", () => {
  const valid = validateSnapshot(createJsonFileStore(path.join(os.tmpdir(), `root-store-${Date.now()}.json`), { seedSampleData: false }).exportSnapshot());
  const invalid = validateSnapshot({ users: [] });

  assert.equal(valid.valid, true);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((item) => item.includes("missing key")));
  assert.deepEqual(parseStoreVerifyArgs(["--sqlite", "/tmp/root.sqlite"]), { mode: "sqlite", filePath: "/tmp/root.sqlite", normalize: false });
  assert.deepEqual(parseStoreVerifyArgs(["--json", "/tmp/root.json", "--normalize"]), { mode: "json", filePath: "/tmp/root.json", normalize: true });
  assert.deepEqual(parseStoreMigrateArgs(["--json", "/tmp/root.json", "--dry-run"]), { mode: "json", filePath: "/tmp/root.json", normalize: false, dryRun: true });
});

test("startup can seed the Root member-center product snapshot from environment", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "root-member-center-seed-"));
  const storePath = path.join(tempDir, "store.json");
  const storeAdapter = createJsonFileStore(storePath, { seedSampleData: false });
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const server = createApp({
    storeAdapter,
    env: {
      ROOT_ALLOW_OPENID_LOGIN: "true",
      ROOT_MEMBER_CENTER_APPID: "wxfb75c0b432670215",
      ROOT_MEMBER_CENTER_PRODUCT_PATH: "#小程序://ROOT会员中心/lnQOjYsk8gZoABH",
      ROOT_MEMBER_CENTER_DEFAULT_PRODUCT_TITLE: "Root 会员中心商品",
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ openid: "member_center_seed_openid", appCode: "MYROOT" }),
  });
  const products = await request(baseUrl, "/api/v1/products", {
    headers: { Authorization: `Bearer ${login.data.token}` },
  });
  const saved = JSON.parse(fs.readFileSync(storePath, "utf8"));

  assert.equal(products.code, 0);
  assert.equal(products.data.products[0].productId, "ROOT_MEMBER_CENTER_DEFAULT");
  assert.equal(products.data.products[0].title, "Root 会员中心商品");
  assert.equal(products.data.products[0].youzan.appId, "wxfb75c0b432670215");
  assert.equal(products.data.products[0].youzan.shortLink, "#小程序://ROOT会员中心/lnQOjYsk8gZoABH");
  assert.equal(saved.youzanProducts.some((product) => product.youzan_product_id === "ROOT_MEMBER_CENTER_DEFAULT"), true);
});

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  return response.json();
}

async function textRequest(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  return {
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    body: await response.text(),
  };
}

test("public privacy notice exposes approved controller metadata without login", async (t) => {
  const server = createApp({
    env: {
      ROOT_REQUIRE_HEALTH_CONSENT: "true",
      ROOT_PRIVACY_CONTROLLER_NAME: "杭州连生健康科技有限公司",
      ROOT_PRIVACY_CONTACT: "privacy@example.com",
      ROOT_HEALTH_DATA_RETENTION_DAYS: "180",
      ROOT_HEALTH_DATA_RETENTION_CLEANUP_ENABLED: "true",
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const notice = await request(baseUrl, "/api/v1/privacy/notice");

  assert.equal(notice.code, 0);
  assert.equal(notice.data.configured, true);
  assert.equal(notice.data.controllerName, "杭州连生健康科技有限公司");
  assert.equal(notice.data.contact, "privacy@example.com");
  assert.equal(notice.data.retentionDays, 180);
  assert.match(notice.data.retentionText, /180 天/);
  assert.equal(notice.data.version, "0.5.13");
  assert.equal(notice.data.releaseId, "0.5.13");
});

test("ready Interface exposes only safe MySQL least-privilege proof", async (t) => {
  const base = createMemoryStore(undefined, { seedSampleData: false });
  const storeAdapter = {
    ...base,
    kind: "mysql",
    async checkHealth() {
      return {
        ok: true,
        migrationVersion: "004_external_evidence_minimization.sql",
        revision: 19,
        leastPrivilegeReady: true,
        privilegeScope: "SCHEMA",
        privilegePolicyEnforced: true,
      };
    },
  };
  const server = createApp({ storeAdapter, env: {} });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const ready = await request(baseUrl, "/ready");
  const serialized = JSON.stringify(ready);

  assert.equal(ready.code, 0);
  assert.equal(ready.data.store.leastPrivilegeReady, true);
  assert.equal(ready.data.store.privilegeScope, "SCHEMA");
  assert.equal(ready.data.store.privilegePolicyEnforced, true);
  assert.equal(serialized.includes("myroot_app"), false);
  assert.equal(serialized.includes("SHOW GRANTS"), false);
});

test("admin profile Interface exposes operator role and capabilities", async (t) => {
  const localServer = createApp({ env: {} });
  const localBaseUrl = await listen(localServer);
  t.after(() => localServer.close());

  const localProfile = await request(localBaseUrl, "/api/v1/admin/me");
  assert.equal(localProfile.code, 0);
  assert.equal(localProfile.data.operatorId, "local-admin");
  assert.equal(localProfile.data.role, "admin");
  assert.equal(localProfile.data.tokenConfigured, false);
  assert.ok(localProfile.data.capabilities.includes("CONFIG_WRITE"));

  const server = createApp({
    env: {
      ROOT_ADMIN_TOKENS: JSON.stringify({
        viewer: { token: "viewer-secret", role: "viewer" },
        finance: { token: "finance-secret", role: "finance" },
      }),
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const viewer = await request(baseUrl, "/api/v1/admin/me", {
    headers: { "X-Admin-Token": "viewer-secret" },
  });
  const finance = await request(baseUrl, "/api/v1/admin/me", {
    headers: { "X-Admin-Token": "finance-secret" },
  });
  const denied = await request(baseUrl, "/api/v1/admin/me", {
    headers: { "X-Admin-Token": "bad-secret" },
  });

  assert.equal(viewer.code, 0);
  assert.equal(viewer.data.operatorId, "viewer");
  assert.equal(viewer.data.role, "viewer");
  assert.deepEqual(viewer.data.capabilities.sort(), ["ADMIN_READ", "AUDIT_READ"]);
  assert.equal(finance.data.capabilities.includes("REWARD_DELIVERY_WRITE"), true);
  assert.equal(finance.data.capabilities.includes("DATA_EXPORT_APPROVE"), true);
  assert.equal(finance.data.capabilities.includes("CONFIG_WRITE"), false);
  assert.equal(denied.code, 40101);
});

test("production and CloudBase admin Interface rejects unconfigured admin tokens", async (t) => {
  const productionServer = createApp({ env: { NODE_ENV: "production" } });
  const productionBaseUrl = await listen(productionServer);
  t.after(() => productionServer.close());

  const productionDenied = await request(productionBaseUrl, "/api/v1/admin/products/upsert", {
    method: "POST",
    body: JSON.stringify({
      youzanProductId: "ROOT_PRODUCT_DENIED",
      title: "不应写入",
    }),
  });
  assert.equal(productionDenied.code, 40101);
  assert.equal(productionServer.store.youzanProducts.some((product) => product.youzan_product_id === "ROOT_PRODUCT_DENIED"), false);

  const cloudServer = createApp({ env: { ROOT_CLOUDBASE_ENV_ID: "myroot-test-d4gclpzxx286deda6" } });
  const cloudBaseUrl = await listen(cloudServer);
  t.after(() => cloudServer.close());

  const cloudDenied = await request(cloudBaseUrl, "/api/v1/admin/me");
  assert.equal(cloudDenied.code, 40101);

  const tokenServer = createApp({ env: { NODE_ENV: "production", ROOT_ADMIN_TOKEN: "admin-secret" } });
  const tokenBaseUrl = await listen(tokenServer);
  t.after(() => tokenServer.close());

  const allowed = await request(tokenBaseUrl, "/api/v1/admin/me", {
    headers: { Authorization: "Bearer admin-secret" },
  });
  assert.equal(allowed.code, 0);
  assert.equal(allowed.data.operatorId, "admin");
  assert.equal(allowed.data.tokenConfigured, true);
});

test("serves the REST API and admin dashboard data", async (t) => {
  const tempAdminDir = fs.mkdtempSync(path.join(os.tmpdir(), "root-admin-dist-"));
  fs.mkdirSync(path.join(tempAdminDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(tempAdminDir, "index.html"), "<!doctype html><title>myRoot Admin</title><div id=\"app\"></div><script type=\"module\" src=\"/admin/assets/app.js\"></script>");
  fs.writeFileSync(path.join(tempAdminDir, "assets", "app.js"), "window.__ROOT_ADMIN_DIST__ = true;");
  const server = createApp({
    env: { ...directPhoneLoginEnv, ROOT_RELEASE_ID: "myroot-api-test-http" },
    adminDistDir: tempAdminDir,
    trustedWechatIdentityAdapter: verifiedCloudbaseHeaderIdentityAdapter,
  });
  const baseUrl = await listen(server);
  t.after(() => {
    server.close();
    fs.rmSync(tempAdminDir, { recursive: true, force: true });
  });

  const home = await textRequest(baseUrl, "/");
  assert.equal(home.status, 200);
  assert.match(home.contentType, /text\/html/);
  assert.match(home.body, /ROOT 7日打卡后台/);
  assert.match(home.body, /id="bulk-order-file"/);
  assert.match(home.body, /上传有赞 CSV 文件/);
  assert.match(home.body, /id="fulfillment-file"/);
  assert.match(home.body, /上传物流 CSV 文件/);
  const elementAdmin = await textRequest(baseUrl, "/admin");
  assert.equal(elementAdmin.status, 200);
  assert.match(elementAdmin.body, /myRoot Admin/);
  assert.doesNotMatch(elementAdmin.body, /ROOT 7日打卡后台/);
  const elementAdminAsset = await textRequest(baseUrl, "/admin/assets/app.js");
  assert.equal(elementAdminAsset.status, 200);
  assert.match(elementAdminAsset.contentType, /javascript/);
  assert.match(elementAdminAsset.body, /__ROOT_ADMIN_DIST__/);
  const legacyAdmin = await textRequest(baseUrl, "/admin-legacy");
  assert.match(legacyAdmin.body, /ROOT 7日打卡后台/);

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone: "13800000001" }),
  });
  const token = login.data.token;

  assert.equal(login.code, 0);
  assert.equal(login.data.user.state, "UNREGISTERED");

  const displayProfile = await request(baseUrl, "/api/v1/user/display-profile", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      nickname: "Root体验同学",
      avatarUrl: "cloud://prod-d3grtjkva76c93e00.avatars/avatar.jpg",
    }),
  });
  assert.equal(displayProfile.data.user.nickname, "Root体验同学");
  assert.equal(displayProfile.data.user.avatarUrl, "cloud://prod-d3grtjkva76c93e00.avatars/avatar.jpg");

  const profile = await request(baseUrl, "/api/v1/user/profile", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      joinReasons: ["health"],
      gutHealthStatus: "normal",
      improvementMethods: ["diet"],
      stoolType: "type4",
    }),
  });
  assert.equal(profile.data.user.state, "REGISTERED_IDLE");

  const audit = await request(baseUrl, "/api/v1/jobs/daily-audit", {
    method: "POST",
    body: JSON.stringify({ date: "2026-04-27" }),
  });
  assert.equal(audit.code, 0);
  assert.equal(audit.data.summary.date, "2026-04-27");

  const dashboard = await request(baseUrl, "/api/v1/admin/dashboard");
  assert.equal(dashboard.code, 0);
  assert.equal(dashboard.data.metrics.users, 1);
  assert.equal(dashboard.data.summary.date, "2026-04-27");
  assert.equal(dashboard.data.launchReadiness.status, "BLOCKED");
  assert.equal(Array.isArray(dashboard.data.opsUsers), true);
  assert.equal(dashboard.data.opsUsers[0].currentBlockage, "已送达未开始");

  const rawProbeOpenid = "openid_http_probe_123456";
  const rawProbeUnionid = "unionid_http_probe_abcdef";
  const cloudbaseProbe = await request(baseUrl, "/api/v1/admin/cloudbase-identity-probe?appCode=MYROOT", {
    headers: {
      "X-WX-OPENID": rawProbeOpenid,
      "X-WX-UNIONID": rawProbeUnionid,
    },
  });
  assert.equal(cloudbaseProbe.code, 0);
  assert.equal(cloudbaseProbe.data.status, "READY");
  assert.equal(cloudbaseProbe.data.readyForUnionPrimaryKey, true);
  assert.notEqual(cloudbaseProbe.data.openidPreview, rawProbeOpenid);
  assert.notEqual(cloudbaseProbe.data.unionidPreview, rawProbeUnionid);
  assert.equal(JSON.stringify(cloudbaseProbe.data).includes(rawProbeOpenid), false);
  assert.equal(JSON.stringify(cloudbaseProbe.data).includes(rawProbeUnionid), false);

  const readiness = await request(baseUrl, "/api/v1/admin/launch-readiness?target=production");
  assert.equal(readiness.code, 0);
  assert.equal(readiness.data.target, "production");
  assert.equal(readiness.data.status, "BLOCKED");
  assert.ok(readiness.data.checks.some((item) => item.id === "store_adapter" && item.status === "BLOCKER"));

  const releaseRecord = await request(baseUrl, "/api/v1/admin/release-record?target=gray");
  assert.equal(releaseRecord.code, 0);
  assert.equal(releaseRecord.data.target, "gray");
  assert.equal(releaseRecord.data.status, "BLOCKED");
  assert.ok(releaseRecord.data.evidence.launchReadiness.summary.total > 0);
  assert.ok(releaseRecord.data.evidence.externalChannelReadiness.summary.alertRulesReviewed >= 1);
  assert.ok(releaseRecord.data.evidence.externalChannelReadiness.alertOwnerRoutes.some((item) => item.targetType === "LIFECYCLE_EXPORT_DELIVERY_HEALTH"));
  assert.ok(releaseRecord.data.evidence.externalChannelReadiness.alertOwnerRoutes.some((item) => item.targetType === "CONSULTATION_SLA_OVERDUE"));
  assert.ok(releaseRecord.data.evidence.externalChannelReadiness.alertOwnerRoutes.some((item) => item.targetType === "CONSULTATION_SLA_ESCALATION"));
  assert.equal(releaseRecord.data.evidence.adminTransitionReadiness.summary.readyModuleCount, 6);
  assert.equal(releaseRecord.data.evidence.adminTransitionReadiness.summary.legacyFallbackAvailable, true);
  assert.equal(releaseRecord.data.evidence.adminTransitionReadiness.legacyDeprecationDecision.status, "PENDING");
  assert.equal(releaseRecord.data.evidence.adminTransitionReadiness.summary.deprecationSource, "NONE");
  assert.equal(releaseRecord.data.evidence.productionCutoverReadiness.status, "NEEDS_REVIEW");
  assert.equal(releaseRecord.data.evidence.productionCutoverReadiness.summary.requiredProofCount, 15);
  assert.ok(releaseRecord.data.evidence.productionCutoverReadiness.items.some((item) => item.proofEnv === "ROOT_CUTOVER_CLOUDBASE_UNIONID_VERIFIED"));
  assert.equal(releaseRecord.data.evidence.actionAdapterCalibration.status, "NEEDS_REVIEW");
  assert.equal(releaseRecord.data.evidence.actionAdapterCalibration.actions.length, 4);
  assert.equal(releaseRecord.data.evidence.legacyDataMigration.status, "READY");
  assert.equal(releaseRecord.data.evidence.legacyDataMigration.summary.legacySessionCount, 0);
  assert.equal(releaseRecord.data.evidence.productionEvidenceIntake.items.length, 15);
  assert.equal(releaseRecord.data.evidence.productionEvidenceIntake.items.find((item) => item.backlogId === "T-010").status, "READY");
  assert.equal(releaseRecord.data.evidence.cloudbaseStoreReadiness.status, "NEEDS_REVIEW");
  assert.equal(releaseRecord.data.evidence.cloudbaseStoreReadiness.selectedDecision, "UNDECIDED");
  assert.equal(releaseRecord.data.evidence.rootMemberCenterReadiness.status, "NEEDS_REVIEW");
  assert.equal(releaseRecord.data.evidence.rootMemberCenterReadiness.summary.missingAppIdCount, 1);
  assert.equal(releaseRecord.data.signoffGate.status, "NEEDS_REVIEW");
  assert.equal(releaseRecord.data.signoffGate.summary.pendingCount, 3);
  assert.equal(releaseRecord.data.mustFixBeforeRelease.length, releaseRecord.data.checklist.mustFixBeforeRelease.length);
  assert.ok(releaseRecord.data.rollback.some((item) => item.includes("MANUAL_SAMPLE")));

  const evidencePack = await request(baseUrl, "/api/v1/admin/release-evidence-pack?target=gray&baseUrl=https%3A%2F%2Froot.example.com%3Ftoken%3Dsecret&strict=true");
  assert.equal(evidencePack.code, 0);
  assert.equal(evidencePack.data.pack.baseUrl, "https://root.example.com");
  assert.equal(evidencePack.data.pack.status, "BLOCKED");
  assert.equal(evidencePack.data.validation.status, "PASS");
  assert.ok(evidencePack.data.pack.evidence.commands.some((item) => item.includes("release:evidence")));
  assert.ok(evidencePack.data.pack.evidence.externalChannelReadiness.alertOwnerRoutes.some((item) => item.targetType === "LIFECYCLE_EXPORT_DELIVERY_HEALTH"));
  assert.ok(evidencePack.data.pack.evidence.externalChannelReadiness.alertOwnerRoutes.some((item) => item.targetType === "CONSULTATION_SLA_OVERDUE"));
  assert.ok(evidencePack.data.pack.evidence.externalChannelReadiness.alertOwnerRoutes.some((item) => item.targetType === "CONSULTATION_SLA_ESCALATION"));
  assert.equal(evidencePack.data.pack.summary.signoffGateStatus, "NEEDS_REVIEW");
  assert.equal(evidencePack.data.pack.evidence.signoffGate.summary.pendingCount, 3);
  assert.equal(evidencePack.data.pack.evidence.adminTransitionReadiness.summary.readyModuleCount, 6);
  assert.equal(evidencePack.data.pack.evidence.adminTransitionReadiness.legacyDeprecationDecision.status, "PENDING");
  assert.equal(evidencePack.data.pack.summary.productionCutoverStatus, "NEEDS_REVIEW");
  assert.equal(evidencePack.data.pack.evidence.productionCutoverReadiness.summary.requiredProofCount, 15);
  assert.equal(evidencePack.data.pack.summary.actionAdapterCalibrationStatus, "NEEDS_REVIEW");
  assert.equal(evidencePack.data.pack.evidence.actionAdapterCalibration.actions.length, 4);
  assert.equal(evidencePack.data.pack.summary.legacyDataMigrationStatus, "READY");
  assert.equal(evidencePack.data.pack.evidence.legacyDataMigration.summary.legacySessionCount, 0);
  assert.equal(evidencePack.data.pack.summary.productionEvidenceIntakeStatus, "BLOCKED");
  assert.equal(evidencePack.data.pack.evidence.productionEvidenceIntake.items.length, 15);
  assert.equal(evidencePack.data.pack.summary.cloudbaseStoreStatus, "NEEDS_REVIEW");
  assert.equal(evidencePack.data.pack.evidence.cloudbaseStoreReadiness.selectedDecision, "UNDECIDED");
  assert.equal(evidencePack.data.pack.summary.rootMemberCenterStatus, "NEEDS_REVIEW");
  assert.equal(evidencePack.data.pack.evidence.rootMemberCenterReadiness.summary.missingAppIdCount, 1);
  assert.equal(JSON.stringify(evidencePack.data).includes("token=secret"), false);
  assert.equal(evidencePack.data.archives.length, 0);
  const archivedPayload = {
    target: "gray",
    baseUrl: "https://root.example.com?token=secret",
    strict: true,
    note: "HTTP 灰度证据留档",
    requestId: "http-release-evidence-archive-1",
  };
  const archivedEvidence = await request(baseUrl, "/api/v1/admin/release-evidence-pack/archive", {
    method: "POST",
    headers: { "X-Request-Id": "http-release-evidence-archive-1" },
    body: JSON.stringify(archivedPayload),
  });
  const archivedEvidenceRepeated = await request(baseUrl, "/api/v1/admin/release-evidence-pack/archive", {
    method: "POST",
    headers: { "X-Request-Id": "http-release-evidence-archive-1" },
    body: JSON.stringify(archivedPayload),
  });
  const archivedEvidenceDetail = await request(baseUrl, `/api/v1/admin/release-evidence-pack/archive?archiveId=${archivedEvidence.data.archive.archiveId}`);
  const releaseSignoff = await request(baseUrl, "/api/v1/admin/release-signoffs", {
    method: "POST",
    headers: { "X-Request-Id": "http-release-signoff-1" },
    body: JSON.stringify({
      target: "gray",
      role: "PRODUCT",
      status: "APPROVED",
      archiveId: archivedEvidence.data.archive.archiveId,
      note: "HTTP 产品确认灰度证据",
      requestId: "http-release-signoff-1",
    }),
  });
  const releaseSignoffRepeated = await request(baseUrl, "/api/v1/admin/release-signoffs", {
    method: "POST",
    headers: { "X-Request-Id": "http-release-signoff-1" },
    body: JSON.stringify({
      target: "gray",
      role: "PRODUCT",
      status: "APPROVED",
      archiveId: archivedEvidence.data.archive.archiveId,
      note: "HTTP 产品确认灰度证据",
      requestId: "http-release-signoff-1",
    }),
  });
  const adminLegacyDecision = await request(baseUrl, "/api/v1/admin/admin-legacy-deprecation-decisions", {
    method: "POST",
    headers: { "X-Request-Id": "http-admin-legacy-deprecation-decision-1" },
    body: JSON.stringify({
      target: "gray",
      status: "APPROVED",
      evidenceRef: "https://root.example.com/admin-legacy/deprecation?token=secret",
      rollbackRef: "https://root.example.com/admin-legacy/rollback?token=secret",
      note: "HTTP 旧后台下线批准 openid=raw-openid",
      requestId: "http-admin-legacy-deprecation-decision-1",
    }),
  });
  const adminLegacyDecisionRepeated = await request(baseUrl, "/api/v1/admin/admin-legacy-deprecation-decisions", {
    method: "POST",
    headers: { "X-Request-Id": "http-admin-legacy-deprecation-decision-1" },
    body: JSON.stringify({
      target: "gray",
      status: "APPROVED",
      evidenceRef: "https://root.example.com/admin-legacy/deprecation?token=secret",
      rollbackRef: "https://root.example.com/admin-legacy/rollback?token=secret",
      note: "HTTP 旧后台下线批准 openid=raw-openid",
      requestId: "http-admin-legacy-deprecation-decision-1",
    }),
  });
  const adminLegacyDecisions = await request(baseUrl, "/api/v1/admin/admin-legacy-deprecation-decisions?target=gray");
  const cutoverProofWithoutEvidence = await request(baseUrl, "/api/v1/admin/production-cutover-proofs", {
    method: "POST",
    headers: { "X-Request-Id": "http-production-cutover-proof-without-evidence" },
    body: JSON.stringify({
      target: "production",
      itemId: "cloudbase_unionid",
      status: "VERIFIED",
      requestId: "http-production-cutover-proof-without-evidence",
    }),
  });
  const cutoverProof = await request(baseUrl, "/api/v1/admin/production-cutover-proofs", {
    method: "POST",
    headers: { "X-Request-Id": "http-production-cutover-proof-1" },
    body: JSON.stringify({
      target: "gray",
      itemId: "cloudbase_unionid",
      status: "VERIFIED",
      evidenceRef: "https://root.example.com/probe?token=secret",
      note: "HTTP CloudBase unionid 脱敏探针通过 token=secret",
      requestId: "http-production-cutover-proof-1",
    }),
  });
  const releaseScopedCutoverProof = await request(baseUrl, "/api/v1/admin/production-cutover-proofs", {
    method: "POST",
    headers: { "X-Request-Id": "http-production-cutover-release-proof-1" },
    body: JSON.stringify({
      target: "production",
      itemId: "cloudrun_candidate_runtime",
      status: "VERIFIED",
      evidenceRef: "https://root.example.com/releases/candidate?token=secret",
      releaseVersion: "0.0.0-client-spoof",
      releaseId: "client-spoof",
      requestId: "http-production-cutover-release-proof-1",
    }),
  });
  const cutoverProofRepeated = await request(baseUrl, "/api/v1/admin/production-cutover-proofs", {
    method: "POST",
    headers: { "X-Request-Id": "http-production-cutover-proof-1" },
    body: JSON.stringify({
      target: "gray",
      itemId: "cloudbase_unionid",
      status: "VERIFIED",
      evidenceRef: "https://root.example.com/probe?token=secret",
      note: "HTTP CloudBase unionid 脱敏探针通过 token=secret",
      requestId: "http-production-cutover-proof-1",
    }),
  });
  const cutoverProofs = await request(baseUrl, "/api/v1/admin/production-cutover-proofs?target=gray");
  const rootJumpProof = await request(baseUrl, "/api/v1/admin/root-member-center-jump-proofs", {
    method: "POST",
    headers: { "X-Request-Id": "http-root-member-center-jump-proof-1" },
    body: JSON.stringify({
      target: "gray",
      productId: "ROOT_PREBIOTIC_TRIAL",
      status: "VERIFIED",
      appId: "wx_root_member_center",
      path: "pages/product/detail?id=ROOT_PREBIOTIC",
      evidenceRef: "https://root.example.com/root-member-center/jump?token=secret",
      note: "HTTP 体验版跳转通过 openid=raw-openid",
      requestId: "http-root-member-center-jump-proof-1",
    }),
  });
  const rootJumpProofRepeated = await request(baseUrl, "/api/v1/admin/root-member-center-jump-proofs", {
    method: "POST",
    headers: { "X-Request-Id": "http-root-member-center-jump-proof-1" },
    body: JSON.stringify({
      target: "gray",
      productId: "ROOT_PREBIOTIC_TRIAL",
      status: "VERIFIED",
      appId: "wx_root_member_center",
      path: "pages/product/detail?id=ROOT_PREBIOTIC",
      evidenceRef: "https://root.example.com/root-member-center/jump?token=secret",
      note: "HTTP 体验版跳转通过 openid=raw-openid",
      requestId: "http-root-member-center-jump-proof-1",
    }),
  });
  const rootJumpProofs = await request(baseUrl, "/api/v1/admin/root-member-center-jump-proofs?target=gray");
  const legacyDecision = await request(baseUrl, "/api/v1/admin/legacy-data-migration-decisions", {
    method: "POST",
    headers: { "X-Request-Id": "http-legacy-data-migration-decision-1" },
    body: JSON.stringify({
      target: "gray",
      policy: "NO_LEGACY_DATA",
      status: "APPROVED",
      evidenceRef: "https://root.example.com/legacy/no-data?token=secret",
      note: "HTTP 无旧数据确认 openid=raw-openid",
      requestId: "http-legacy-data-migration-decision-1",
    }),
  });
  const legacyDecisionRepeated = await request(baseUrl, "/api/v1/admin/legacy-data-migration-decisions", {
    method: "POST",
    headers: { "X-Request-Id": "http-legacy-data-migration-decision-1" },
    body: JSON.stringify({
      target: "gray",
      policy: "NO_LEGACY_DATA",
      status: "APPROVED",
      evidenceRef: "https://root.example.com/legacy/no-data?token=secret",
      note: "HTTP 无旧数据确认 openid=raw-openid",
      requestId: "http-legacy-data-migration-decision-1",
    }),
  });
  const legacyDecisions = await request(baseUrl, "/api/v1/admin/legacy-data-migration-decisions?target=gray");
  const legacyExecution = await request(baseUrl, "/api/v1/admin/legacy-data-migration-executions", {
    method: "POST",
    headers: { "X-Request-Id": "http-legacy-data-migration-execution-1" },
    body: JSON.stringify({
      target: "gray",
      action: "NO_OP_CONFIRMED",
      status: "VERIFIED",
      evidenceRef: "https://root.example.com/legacy/execution?token=secret",
      note: "HTTP 无旧数据执行确认 openid=raw-openid",
      requestId: "http-legacy-data-migration-execution-1",
    }),
  });
  const legacyExecutionRepeated = await request(baseUrl, "/api/v1/admin/legacy-data-migration-executions", {
    method: "POST",
    headers: { "X-Request-Id": "http-legacy-data-migration-execution-1" },
    body: JSON.stringify({
      target: "gray",
      action: "NO_OP_CONFIRMED",
      status: "VERIFIED",
      evidenceRef: "https://root.example.com/legacy/execution?token=secret",
      note: "HTTP 无旧数据执行确认 openid=raw-openid",
      requestId: "http-legacy-data-migration-execution-1",
    }),
  });
  const legacyExecutions = await request(baseUrl, "/api/v1/admin/legacy-data-migration-executions?target=gray");
  const signedReleaseRecord = await request(baseUrl, "/api/v1/admin/release-record?target=gray");
  const evidencePackAfterArchive = await request(baseUrl, "/api/v1/admin/release-evidence-pack?target=gray&baseUrl=https%3A%2F%2Froot.example.com&strict=true");
  assert.equal(archivedEvidence.code, 0);
  assert.equal(archivedEvidence.data.archive.status, "BLOCKED");
  assert.equal(archivedEvidence.data.archive.note, "HTTP 灰度证据留档");
  assert.equal(archivedEvidence.data.audit.action, "RELEASE_EVIDENCE_ARCHIVE_CREATE");
  assert.equal(archivedEvidenceRepeated.data.archive.archiveId, archivedEvidence.data.archive.archiveId);
  assert.equal(archivedEvidenceDetail.data.archive.archiveId, archivedEvidence.data.archive.archiveId);
  assert.equal(archivedEvidenceDetail.data.pack.status, "BLOCKED");
  assert.equal(archivedEvidenceDetail.data.validation.status, "PASS");
  assert.equal(releaseSignoff.code, 0);
  assert.equal(releaseSignoff.data.signoff.status, "APPROVED");
  assert.equal(releaseSignoff.data.signoff.archiveId, archivedEvidence.data.archive.archiveId);
  assert.equal(releaseSignoffRepeated.data.signoff.signoffId, releaseSignoff.data.signoff.signoffId);
  assert.equal(adminLegacyDecision.code, 0);
  assert.equal(adminLegacyDecision.data.decision.status, "APPROVED");
  assert.equal(adminLegacyDecision.data.decision.evidenceRef, "https://root.example.com/admin-legacy/deprecation");
  assert.equal(adminLegacyDecision.data.decision.rollbackRef, "https://root.example.com/admin-legacy/rollback");
  assert.equal(adminLegacyDecisionRepeated.data.decision.decisionId, adminLegacyDecision.data.decision.decisionId);
  assert.equal(adminLegacyDecisions.data.latest[0].status, "APPROVED");
  assert.equal(cutoverProofWithoutEvidence.code, 400);
  assert.match(cutoverProofWithoutEvidence.message, /evidence_ref/);
  assert.equal(cutoverProof.code, 0);
  assert.equal(cutoverProof.data.proof.status, "VERIFIED");
  assert.equal(cutoverProof.data.proof.evidenceRef, "https://root.example.com/probe");
  assert.equal(releaseScopedCutoverProof.code, 0);
  assert.equal(releaseScopedCutoverProof.data.proof.proofScope, "RELEASE");
  assert.equal(releaseScopedCutoverProof.data.proof.releaseVersion, "0.5.13");
  assert.equal(releaseScopedCutoverProof.data.proof.releaseId, "myroot-api-test-http");
  assert.equal(releaseScopedCutoverProof.data.proof.releaseIdConfigured, true);
  assert.equal(JSON.stringify(releaseScopedCutoverProof.data).includes("client-spoof"), false);
  assert.equal(cutoverProofRepeated.data.proof.proofId, cutoverProof.data.proof.proofId);
  assert.equal(cutoverProofs.data.latest.find((item) => item.itemId === "cloudbase_unionid").status, "VERIFIED");
  assert.equal(rootJumpProof.code, 0);
  assert.equal(rootJumpProof.data.proof.status, "VERIFIED");
  assert.equal(rootJumpProof.data.proof.evidenceRef, "https://root.example.com/root-member-center/jump");
  assert.equal(rootJumpProofRepeated.data.proof.proofId, rootJumpProof.data.proof.proofId);
  assert.equal(rootJumpProofs.data.latest.find((item) => item.productId === "ROOT_PREBIOTIC_TRIAL").status, "VERIFIED");
  assert.equal(legacyDecision.code, 0);
  assert.equal(legacyDecision.data.decision.status, "APPROVED");
  assert.equal(legacyDecision.data.decision.evidenceRef, "https://root.example.com/legacy/no-data");
  assert.equal(legacyDecisionRepeated.data.decision.decisionId, legacyDecision.data.decision.decisionId);
  assert.equal(legacyDecisions.data.latest[0].policy, "NO_LEGACY_DATA");
  assert.equal(legacyExecution.code, 0);
  assert.equal(legacyExecution.data.execution.status, "VERIFIED");
  assert.equal(legacyExecution.data.execution.evidenceRef, "https://root.example.com/legacy/execution");
  assert.equal(legacyExecutionRepeated.data.execution.executionId, legacyExecution.data.execution.executionId);
  assert.equal(legacyExecutions.data.latest[0].action, "NO_OP_CONFIRMED");
  assert.equal(signedReleaseRecord.data.signoffs.find((item) => item.role === "PRODUCT").status, "APPROVED");
  assert.equal(signedReleaseRecord.data.signoffGate.summary.approvedCount, 1);
  assert.equal(signedReleaseRecord.data.signoffGate.summary.pendingCount, 2);
  assert.equal(signedReleaseRecord.data.evidence.signoffGate.summary.approvedCount, 1);
  assert.equal(signedReleaseRecord.data.evidence.adminTransitionReadiness.legacyDeprecationDecision.status, "APPROVED");
  assert.equal(signedReleaseRecord.data.evidence.adminTransitionReadiness.summary.deprecationSource, "RECORD");
  assert.equal(signedReleaseRecord.data.evidence.productionEvidenceIntake.items.find((item) => item.backlogId === "T-008").status, "READY");
  assert.equal(signedReleaseRecord.data.evidence.productionCutoverReadiness.items.find((item) => item.id === "cloudbase_unionid").proofSource, "RECORD");
  assert.equal(signedReleaseRecord.data.evidence.legacyDataMigration.decision.status, "APPROVED");
  assert.equal(signedReleaseRecord.data.evidence.legacyDataMigration.execution.status, "VERIFIED");
  assert.equal(JSON.stringify(signedReleaseRecord.data.evidence.legacyDataMigration.execution).includes("raw-openid"), false);
  assert.equal(evidencePackAfterArchive.data.archives.length, 1);
  assert.equal(evidencePackAfterArchive.data.pack.evidence.signoffGate.summary.approvedCount, 1);
  assert.equal(evidencePackAfterArchive.data.pack.evidence.productionCutoverReadiness.summary.readyProofCount, 1);
  assert.equal(JSON.stringify(archivedEvidence.data).includes("token=secret"), false);
  assert.equal(JSON.stringify(archivedEvidenceDetail.data).includes("token=secret"), false);
  assert.equal(JSON.stringify(cutoverProof.data).includes("token=secret"), false);
  assert.equal(JSON.stringify(rootJumpProof.data).includes("token=secret"), false);
  assert.equal(JSON.stringify(rootJumpProof.data).includes("raw-openid"), false);
  assert.equal(JSON.stringify(adminLegacyDecision.data).includes("token=secret"), false);
  assert.equal(JSON.stringify(adminLegacyDecision.data).includes("raw-openid"), false);
  assert.equal(JSON.stringify(legacyDecision.data).includes("token=secret"), false);
  assert.equal(JSON.stringify(legacyDecision.data).includes("raw-openid"), false);

  const calibration = await request(baseUrl, "/api/v1/admin/adapter-calibration");
  const actionCalibration = await request(baseUrl, "/api/v1/admin/action-adapter-calibration?target=gray");
  assert.equal(actionCalibration.code, 0);
  assert.equal(actionCalibration.data.actions.length, 4);
  assert.equal(actionCalibration.data.status, "NEEDS_REVIEW");
  const adapters = await request(baseUrl, "/api/v1/admin/external-adapters");
  const calibrationReport = buildCalibrationReport({
    releaseRecord: releaseRecord.data,
    adapterCalibration: calibration.data,
    launchReadiness: readiness.data,
    externalAdapters: adapters.data,
  });
  assert.match(calibrationReport, /ROOT 7日打卡发布记录/);
  assert.match(calibrationReport, /Adapter 校准/);
  assert.match(calibrationReport, /外部通道与负责人/);
  assert.match(calibrationReport, /生产切换 Gate/);
  assert.equal(determineExitCode(releaseRecord.data), 2);
  assert.equal(determineExitCode(releaseRecord.data, { allowBlocked: true }), 0);

  const template = await request(baseUrl, "/api/v1/admin/external-samples/template?sourceType=FULFILLMENT");
  assert.equal(template.code, 0);
  assert.equal(template.data.sourceType, "FULFILLMENT");
  assert.equal(template.data.requiredSamples, 3);
  assert.match(template.data.csvHeader, /订单号/);

  const detail = await request(baseUrl, `/api/v1/admin/users/${login.data.user.userId}/detail`);
  assert.equal(detail.code, 0);
  assert.equal(detail.data.user.userId, login.data.user.userId);
  assert.equal(detail.data.opsSummary.currentBlockage, "已送达未开始");
  assert.deepEqual(detail.data.feedbacks, []);

  const follow = await request(baseUrl, `/api/v1/admin/users/${login.data.user.userId}/follow`, {
    method: "POST",
    body: JSON.stringify({ sourceType: "MANUAL", sourceId: "api-test", reason: "人工跟进测试" }),
  });
  assert.equal(follow.code, 0);
  assert.equal(follow.data.task.taskType, "FEEDBACK_FOLLOW");
});

test("admin data routes require the configured admin token", async (t) => {
  const server = createApp({
    env: {
      ...directPhoneLoginEnv,
      ROOT_ADMIN_TOKEN: "admin-secret",
      ROOT_ADMIN_JOB_TOKEN: "job-old-secret",
      ROOT_ADMIN_JOB_TOKENS: JSON.stringify(["job-old-secret", { token: "job-new-secret" }]),
      ROOT_ADMIN_TOKENS: JSON.stringify({ ops: { token: "ops-secret", role: "operator" } }),
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const denied = await request(baseUrl, "/api/v1/admin/dashboard");
  assert.equal(denied.code, 40101);
  const probeDenied = await request(baseUrl, "/api/v1/admin/cloudbase-identity-probe", {
    headers: { "X-WX-OPENID": "openid_should_not_be_visible_without_admin" },
  });
  assert.equal(probeDenied.code, 40101);

  const allowed = await request(baseUrl, "/api/v1/admin/dashboard", {
    headers: { "X-Admin-Token": "admin-secret" },
  });
  assert.equal(allowed.code, 0);
  assert.equal(typeof allowed.data.metrics.users, "number");
  const allowedByRootHeader = await request(baseUrl, "/api/v1/admin/dashboard", {
    headers: { "X-ROOT-ADMIN-TOKEN": "admin-secret" },
  });
  assert.equal(allowedByRootHeader.code, 0);
  const allowedByOperator = await request(baseUrl, "/api/v1/admin/dashboard", {
    headers: { "X-ROOT-ADMIN-TOKEN": "ops-secret" },
  });
  assert.equal(allowedByOperator.code, 0);
  const probeAllowed = await request(baseUrl, "/api/v1/admin/cloudbase-identity-probe", {
    headers: {
      "X-ROOT-ADMIN-TOKEN": "admin-secret",
      "X-WX-OPENID": "openid_admin_probe_1234",
    },
  });
  assert.equal(probeAllowed.code, 0);
  assert.equal(probeAllowed.data.status, "BLOCKED");
  assert.equal(probeAllowed.data.rawOpenidHeaderObserved, true);
  assert.equal(probeAllowed.data.openidPresent, false);

  const jobDenied = await request(baseUrl, "/api/v1/jobs/daily-audit", {
    method: "POST",
    body: JSON.stringify({}),
  });
  assert.equal(jobDenied.code, 40101);
  const retryJobDenied = await request(baseUrl, "/api/v1/jobs/adapter-retry-due", {
    method: "POST",
    body: JSON.stringify({ dryRun: true }),
  });
  assert.equal(retryJobDenied.code, 40101);
  const alertJobDenied = await request(baseUrl, "/api/v1/jobs/operational-alerts", {
    method: "POST",
    body: JSON.stringify({ dryRun: true }),
  });
  assert.equal(alertJobDenied.code, 40101);
  const checkinReminderJobDenied = await request(baseUrl, "/api/v1/jobs/checkin-reminders", {
    method: "POST",
    body: JSON.stringify({ dryRun: true }),
  });
  assert.equal(checkinReminderJobDenied.code, 40101);
  const lifecycleJobDenied = await request(baseUrl, "/api/v1/jobs/lifecycle-settlement-due", {
    method: "POST",
    body: JSON.stringify({ dryRun: true }),
  });
  assert.equal(lifecycleJobDenied.code, 40101);
  const lifecycleCleanupDenied = await request(baseUrl, "/api/v1/jobs/lifecycle-settlement-cleanup", {
    method: "POST",
    body: JSON.stringify({ dryRun: true }),
  });
  assert.equal(lifecycleCleanupDenied.code, 40101);
  const youzanIdentityJobDenied = await request(baseUrl, "/api/v1/jobs/youzan-identity-reconcile", {
    method: "POST",
    body: JSON.stringify({ dryRun: true }),
  });
  assert.equal(youzanIdentityJobDenied.code, 40101);

  const jobAllowed = await request(baseUrl, "/api/v1/jobs/checkin-reminders", {
    method: "POST",
    headers: { "X-ROOT-ADMIN-TOKEN": "job-old-secret" },
    body: JSON.stringify({ dryRun: true }),
  });
  assert.equal(jobAllowed.code, 0);

  const youzanIdentityJobAllowed = await request(baseUrl, "/api/v1/jobs/youzan-identity-reconcile", {
    method: "POST",
    headers: { "X-ROOT-ADMIN-TOKEN": "job-old-secret" },
    body: JSON.stringify({ dryRun: true, batchSize: 5 }),
  });
  assert.equal(youzanIdentityJobAllowed.code, 0);
  assert.equal(youzanIdentityJobAllowed.data.dryRun, true);

  const youzanIdentityJobDefaultsToPreview = await request(baseUrl, "/api/v1/jobs/youzan-identity-reconcile", {
    method: "POST",
    headers: { "X-ROOT-ADMIN-TOKEN": "job-old-secret" },
    body: JSON.stringify({}),
  });
  assert.equal(youzanIdentityJobDefaultsToPreview.code, 0);
  assert.equal(youzanIdentityJobDefaultsToPreview.data.dryRun, true);

  const youzanIdentityExecuteWithoutRequestId = await request(baseUrl, "/api/v1/jobs/youzan-identity-reconcile", {
    method: "POST",
    headers: { "X-ROOT-ADMIN-TOKEN": "job-old-secret" },
    body: JSON.stringify({ dryRun: false, batchSize: 1 }),
  });
  assert.equal(youzanIdentityExecuteWithoutRequestId.code, 400);

  const rotatedJobAllowed = await request(baseUrl, "/api/v1/jobs/checkin-reminders", {
    method: "POST",
    headers: { "X-ROOT-ADMIN-TOKEN": "job-new-secret" },
    body: JSON.stringify({ dryRun: true }),
  });
  assert.equal(rotatedJobAllowed.code, 0);

  const unknownJobDenied = await request(baseUrl, "/api/v1/jobs/checkin-reminders", {
    method: "POST",
    headers: { "X-ROOT-ADMIN-TOKEN": "job-unknown-secret" },
    body: JSON.stringify({ dryRun: true }),
  });
  assert.equal(unknownJobDenied.code, 40101);

  const jobTokenCannotReadAdmin = await request(baseUrl, "/api/v1/admin/me", {
    headers: { "X-ROOT-ADMIN-TOKEN": "job-new-secret" },
  });
  assert.equal(jobTokenCannotReadAdmin.code, 40101);
});

test("cloud container login uses WeChat cloud open Interface", async (t) => {
  let requestedPath = "";
  let requestedBody = "";
  const wechatServer = http.createServer((req, res) => {
    requestedPath = req.url;
    req.on("data", (chunk) => {
      requestedBody += chunk;
    });
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        phone_info: {
          phoneNumber: "13800000009",
          purePhoneNumber: "13800000009",
        },
      }));
    });
  });
  const wechatBaseUrl = await listen(wechatServer);
  t.after(() => wechatServer.close());

  const server = createApp({
    env: { NODE_ENV: "test", ROOT_WECHAT_OPENAPI_BASE_URL: wechatBaseUrl },
    trustedWechatIdentityAdapter: verifiedCloudbaseHeaderIdentityAdapter,
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    headers: { "x-wx-openid": "cloud_openid", "x-wx-unionid": "cloud_unionid" },
    body: JSON.stringify({ phoneCode: "phone_code" }),
  });

  assert.equal(login.code, 0);
  assert.equal(login.data.user.phone, "138****0009");
  assert.equal(requestedPath, "/wxa/business/getuserphonenumber");
  assert.deepEqual(JSON.parse(requestedBody), { code: "phone_code" });
});

test("WeChat code exchange completes before the serialized Store Interface starts", async (t) => {
  let releaseWechatResponse;
  let markWechatRequestStarted;
  const wechatRequestStarted = new Promise((resolve) => {
    markWechatRequestStarted = resolve;
  });
  const wechatResponseGate = new Promise((resolve) => {
    releaseWechatResponse = resolve;
  });
  const wechatServer = http.createServer(async (_req, res) => {
    markWechatRequestStarted();
    await wechatResponseGate;
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      openid: "outside_store_openid",
      unionid: "outside_store_unionid",
    }));
  });
  const wechatBaseUrl = await listen(wechatServer);
  t.after(() => wechatServer.close());

  const storeAdapter = createMemoryStore(createEmptyData());
  let storeRequestCount = 0;
  storeAdapter.runRequest = async (_options, work) => {
    storeRequestCount += 1;
    return work(storeAdapter.data, {});
  };
  const server = createApp({
    storeAdapter,
    env: {
      NODE_ENV: "test",
      ROOT_WECHAT_OPENAPI_BASE_URL: wechatBaseUrl,
      ROOT_WECHAT_APPID: "wx_test_app",
      ROOT_WECHAT_APPSECRET: "test_secret",
    },
  });
  await server.readyPromise;
  storeRequestCount = 0;
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const loginPromise = request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({
      appCode: "MYROOT",
      wxCode: "temporary_wechat_code",
    }),
  });
  await wechatRequestStarted;

  assert.equal(
    storeRequestCount,
    0,
    "the Store Interface must not start while WeChat network I/O is pending"
  );
  releaseWechatResponse();
  const login = await loginPromise;

  assert.equal(login.code, 0);
  assert.equal(login.data.identity.appCode, "MYROOT");
  assert.equal(storeRequestCount, 1);
});

test("cloud container openid login can enter before phone authorization", async (t) => {
  const server = createApp({ trustedWechatIdentityAdapter: verifiedCloudbaseHeaderIdentityAdapter });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    headers: { "x-wx-openid": "cloud_openid_no_phone", "x-wx-unionid": "cloud_unionid_no_phone" },
    body: JSON.stringify({ appCode: "MYROOT", sourceChannel: "ROADSHOW_QR" }),
  });
  const token = login.data.token;
  const state = await request(baseUrl, "/api/v1/user/state", {
    headers: { Authorization: `Bearer ${token}` },
  });

  assert.equal(login.code, 0);
  assert.equal(login.data.user.phone, "");
  assert.equal(login.data.user.unionidStatus, "LINKED");
  assert.equal(login.data.nextRoute, "/pages/register/index");
  assert.equal(state.data.route, "/pages/register/index");
  assert.equal(server.store.rootUsers.length, 1);
  assert.equal(server.store.wechatIdentities[0].openid, "cloud_openid_no_phone");
  assert.equal(server.store.wechatIdentities[0].unionid, "cloud_unionid_no_phone");
});

test("image upload Interface rejects local temporary paths and accepts CloudBase file IDs", async (t) => {
  const server = createApp({ trustedWechatIdentityAdapter: verifiedCloudbaseHeaderIdentityAdapter });
  const baseUrl = await listen(server);
  t.after(() => server.close());
  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    headers: { "x-wx-openid": "cloud_media_openid", "x-wx-unionid": "cloud_media_unionid" },
    body: JSON.stringify({ appCode: "MYROOT" }),
  });
  const headers = { Authorization: `Bearer ${login.data.token}` };
  const rejected = await request(baseUrl, "/api/v1/upload/image", {
    method: "POST",
    headers,
    body: JSON.stringify({ url: "wxfile://tmp/checkin.jpg" }),
  });
  const accepted = await request(baseUrl, "/api/v1/upload/image", {
    method: "POST",
    headers,
    body: JSON.stringify({ url: "cloud://myroot-prod.bucket/checkins/root-user/checkin.jpg" }),
  });
  assert.equal(rejected.code, 400);
  assert.equal(accepted.code, 0);
  assert.equal(accepted.data.url, "cloud://myroot-prod.bucket/checkins/root-user/checkin.jpg");
});

test("product mirror HTTP Interface lists products and records Youzan jumps", async (t) => {
  const server = createApp({
    env: {
      ...verifiedWechatTestEnv,
      ROOT_ALLOW_OPENID_LOGIN: "true",
      ...verifiedWechatTestEnv,
      ROOT_MEMBER_CENTER_APPID: "wx_root_member_center",
    },
    trustedWechatIdentityAdapter: verifiedCloudbaseHeaderIdentityAdapter,
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ openid: "http_product_openid", appCode: "MYROOT" }),
  });
  const auth = { Authorization: `Bearer ${login.data.token}` };
  const products = await request(baseUrl, "/api/v1/products", { headers: auth });
  const detail = await request(baseUrl, "/api/v1/products/ROOT_PREBIOTIC_TRIAL", { headers: auth });
  const jumped = await request(baseUrl, "/api/v1/products/jump", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ productId: "ROOT_PREBIOTIC_TRIAL" }),
  });

  assert.equal(products.code, 0);
  assert.equal(products.data.products[0].productId, "ROOT_PREBIOTIC_TRIAL");
  assert.equal(products.data.products[0].youzan.appId, "wx_root_member_center");
  assert.equal(detail.data.product.title, "ROOT 益生菌试饮装");
  assert.equal(jumped.data.jumpTarget.appId, "wx_root_member_center");
  assert.equal(server.store.productJumpLogs.length, 1);
  assert.equal(server.store.youzanOrders.some((order) => order.user_id === login.data.user.userId), false);
});

test("admin product upsert HTTP Interface supports manual product import", async (t) => {
  const server = createApp({
    env: {
      ROOT_ALLOW_OPENID_LOGIN: "true",
      ROOT_MEMBER_CENTER_APPID: "wx_root_member_center",
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const imported = await request(baseUrl, "/api/v1/admin/products/upsert", {
    method: "POST",
    body: JSON.stringify({
      youzanProductId: "ROOT_PRODUCT_HTTP",
      title: "ROOT 路演体验装",
      summary: "后台手工导入的商品快照",
      priceText: "价格以 Root 会员中心为准",
      campaignId: "ROOT_HTTP_CAMPAIGN",
      displayOrder: 1,
      youzanPath: "pages/product/detail?id=ROOT_PRODUCT_HTTP",
      skus: [{ skuId: "ROOT_PRODUCT_HTTP_DEFAULT", skuName: "默认规格", stockStatus: "UNKNOWN" }],
    }),
  });
  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ openid: "http_product_import_openid", appCode: "MYROOT" }),
  });
  const products = await request(baseUrl, "/api/v1/products?campaignId=ROOT_HTTP_CAMPAIGN", {
    headers: { Authorization: `Bearer ${login.data.token}` },
  });

  assert.equal(imported.code, 0);
  assert.equal(imported.data.product.productId, "ROOT_PRODUCT_HTTP");
  assert.equal(products.data.products.length, 1);
  assert.equal(products.data.products[0].productId, "ROOT_PRODUCT_HTTP");
});

test("admin product sync HTTP Interface previews and idempotently imports products", async (t) => {
  const server = createApp({
    env: {
      ROOT_ALLOW_OPENID_LOGIN: "true",
      ROOT_MEMBER_CENTER_APPID: "wx_root_member_center",
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());
  const sampleProducts = [
    {
      youzanProductId: "ROOT_PRODUCT_SYNC_HTTP",
      title: "ROOT 同步路演套装",
      priceText: "¥299",
      youzanPath: "pages/goods/detail?id=ROOT_PRODUCT_SYNC_HTTP",
      skus: [{ skuId: "ROOT_PRODUCT_SYNC_HTTP_DEFAULT", skuName: "默认规格", stockStatus: "UNKNOWN" }],
    },
  ];

  const preview = await request(baseUrl, "/api/v1/admin/products/sync-preview", {
    method: "POST",
    body: JSON.stringify({
      campaignId: "ROOT_HTTP_SYNC_CAMPAIGN",
      products: sampleProducts,
    }),
  });
  const imported = await request(baseUrl, "/api/v1/admin/products/sync-execute", {
    method: "POST",
    headers: { "X-Request-Id": "http-product-sync-1" },
    body: JSON.stringify({
      campaignId: "ROOT_HTTP_SYNC_CAMPAIGN",
      products: sampleProducts,
      confirmRisk: true,
      reason: "HTTP 商品同步",
    }),
  });
  const repeated = await request(baseUrl, "/api/v1/admin/products/sync-execute", {
    method: "POST",
    headers: { "X-Request-Id": "http-product-sync-1" },
    body: JSON.stringify({
      campaignId: "ROOT_HTTP_SYNC_CAMPAIGN",
      products: sampleProducts,
      confirmRisk: true,
      reason: "HTTP 商品同步",
    }),
  });
  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ openid: "http_product_sync_openid", appCode: "MYROOT" }),
  });
  const products = await request(baseUrl, "/api/v1/products?campaignId=ROOT_HTTP_SYNC_CAMPAIGN", {
    headers: { Authorization: `Bearer ${login.data.token}` },
  });
  const audit = await request(baseUrl, "/api/v1/admin/audit-logs?action=YOUZAN_PRODUCT_SYNC");

  assert.equal(preview.code, 0);
  assert.equal(preview.data.total, 1);
  assert.equal(preview.data.rows[0].importable, true);
  assert.equal(imported.code, 0);
  assert.equal(imported.data.importedCount, 1);
  assert.equal(repeated.data.audit.audit_log_id, imported.data.audit.audit_log_id);
  assert.equal(products.data.products.length, 1);
  assert.equal(products.data.products[0].productId, "ROOT_PRODUCT_SYNC_HTTP");
  assert.equal(audit.data.auditLogs[0].target_id, "http-product-sync-1");
  assert.equal(server.store.auditLogs.filter((log) => log.action === "YOUZAN_PRODUCT_SYNC").length, 1);
});

test("campaign task HTTP Interface records no-order task facts", async (t) => {
  const server = createApp({
    env: {
      ROOT_ALLOW_OPENID_LOGIN: "true",
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ openid: "http_task_progress_openid", appCode: "MYROOT" }),
  });
  const auth = { Authorization: `Bearer ${login.data.token}` };
  const active = await request(baseUrl, "/api/v1/campaigns/active", { headers: auth });
  const joined = await request(baseUrl, "/api/v1/campaigns/join", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ sourceChannel: "ROADSHOW_QR" }),
  });
  const event = await request(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      taskType: "CHECKIN",
      taskDate: "2026-06-19",
      payload: { taskDate: "2026-06-19", stoolType: "type4" },
      idempotencyKey: "http-task-progress-checkin-1",
    }),
  });
  const repeated = await request(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      taskType: "CHECKIN",
      taskDate: "2026-06-19",
      payload: { taskDate: "2026-06-19", stoolType: "type4" },
      idempotencyKey: "http-task-progress-checkin-1",
    }),
  });
  const progress = await request(baseUrl, "/api/v1/tasks/progress", { headers: auth });
  const checkinTask = progress.data.progress.tasks.find((task) => task.taskType === "CHECKIN");

  assert.equal(active.data.campaign.campaignId, "ROOT_7D_RESET");
  assert.equal(joined.data.created, true);
  assert.equal(event.data.created, true);
  assert.equal(repeated.data.created, false);
  assert.equal(checkinTask.completedCount, 1);
  assert.equal(checkinTask.targetCount, 7);
  assert.equal(server.store.taskEvents.length, 1);
  assert.equal(server.store.youzanOrders.some((order) => order.user_id === login.data.user.userId), false);
});

test("campaign task HTTP Interface rejects new check-in after task completion", async (t) => {
  const server = createApp({
    env: {
      ROOT_ALLOW_OPENID_LOGIN: "true",
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ openid: "http_task_done_openid", appCode: "MYROOT" }),
  });
  const auth = { Authorization: `Bearer ${login.data.token}` };
  await request(baseUrl, "/api/v1/campaigns/join", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ sourceChannel: "ROADSHOW_QR" }),
  });

  for (let day = 1; day <= 7; day += 1) {
    const taskDate = `2026-06-${String(18 + day).padStart(2, "0")}`;
    const event = await request(baseUrl, "/api/v1/tasks/events", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        taskType: "CHECKIN",
        taskDate,
        payload: { taskDate, stoolType: "type4" },
        idempotencyKey: `http-task-done-checkin-${day}`,
      }),
    });
    assert.equal(event.code, 0);
  }

  const repeatedDay7 = await request(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      taskType: "CHECKIN",
      taskDate: "2026-06-25",
      payload: { taskDate: "2026-06-25", stoolType: "type4" },
      idempotencyKey: "http-task-done-checkin-7",
    }),
  });
  const blocked = await request(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      taskType: "CHECKIN",
      taskDate: "2026-06-26",
      payload: { taskDate: "2026-06-26", stoolType: "type4" },
      idempotencyKey: "http-task-done-checkin-8",
    }),
  });

  assert.equal(repeatedDay7.data.created, false);
  assert.equal(blocked.code, 7003);
  assert.match(blocked.message, /每日任务已完成/);
  assert.equal(server.store.taskEvents.filter((event) => event.task_type === "CHECKIN").length, 7);
});

test("questionnaire answer HTTP Interface validates answers and records task progress", async (t) => {
  const server = createApp({
    env: {
      ROOT_ALLOW_OPENID_LOGIN: "true",
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ openid: "http_questionnaire_answer_openid", appCode: "MYROOT" }),
  });
  const auth = { Authorization: `Bearer ${login.data.token}` };
  const failed = await request(baseUrl, "/api/v1/questionnaire/answers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      questionnaireType: "DAY4_MIDPOINT",
      answers: { stoolChange: "better" },
      idempotencyKey: "http-questionnaire-answer-missing",
    }),
  });
  const branchFailed = await request(baseUrl, "/api/v1/questionnaire/answers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      campaignId: "ROOT_7D_RESET",
      questionnaireType: "DAY4_MIDPOINT",
      taskDate: "2026-06-22",
      answers: { stoolChange: "worse", comfortScore: 2, needsContact: true },
      idempotencyKey: "http-questionnaire-answer-branch-missing",
    }),
  });
  const submitted = await request(baseUrl, "/api/v1/questionnaire/answers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      campaignId: "ROOT_7D_RESET",
      questionnaireType: "DAY4_MIDPOINT",
      taskDate: "2026-06-22",
      answers: { stoolChange: "worse", comfortScore: 2, needsContact: true, contactReason: "舒适度低", feedback: "需要顾问联系" },
      idempotencyKey: "http-questionnaire-answer-day4",
    }),
  });
  const repeated = await request(baseUrl, "/api/v1/questionnaire/answers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      campaignId: "ROOT_7D_RESET",
      questionnaireType: "DAY4_MIDPOINT",
      taskDate: "2026-06-22",
      answers: { stoolChange: "better", comfortScore: 5 },
      idempotencyKey: "http-questionnaire-answer-day4",
    }),
  });
  const status = await request(baseUrl, "/api/v1/questionnaire/answers/status?campaignId=ROOT_7D_RESET", { headers: auth });
  const progress = await request(baseUrl, "/api/v1/tasks/progress", { headers: auth });
  const questionnaireTask = progress.data.progress.tasks.find((task) => task.taskType === "QUESTIONNAIRE" && task.config.questionnaireType === "DAY4_MIDPOINT");

  assert.equal(failed.code, 6002);
  assert.equal(branchFailed.code, 6002);
  assert.equal(submitted.code, 0);
  assert.equal(submitted.data.created, true);
  assert.equal(repeated.data.created, false);
  assert.equal(status.data.DAY4_MIDPOINT, true);
  assert.equal(status.data.answers.length, 1);
  assert.equal(questionnaireTask.status, "DONE");
  assert.equal(server.store.questionnaireAnswers.length, 1);
  assert.equal(server.store.questionnaireResponses.length, 0);
  assert.equal(server.store.taskEvents.filter((event) => event.task_type === "QUESTIONNAIRE").length, 1);
  assert.equal(server.store.operationTasks.some((task) => task.task_type === "QUESTIONNAIRE_FOLLOW"), true);
});

test("consultation follow-up HTTP Interface links support events to admin tasks", async (t) => {
  const server = createApp({
    env: {
      ROOT_ALLOW_OPENID_LOGIN: "true",
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ openid: "http_consultation_followup_openid", appCode: "MYROOT" }),
  });
  const auth = { Authorization: `Bearer ${login.data.token}` };
  const recorded = await request(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      taskType: "CONSULTATION",
      taskDate: "2026-06-19",
      sourceChannel: "MINIPROGRAM_SUPPORT",
      payload: { taskDate: "2026-06-19", consultationType: "BODY_FEEDBACK", scene: "SUPPORT_PAGE" },
      idempotencyKey: "http-consultation-followup-body-feedback",
    }),
  });
  const pending = await request(baseUrl, "/api/v1/user/consultations", { headers: auth });
  const lifecycle = await request(baseUrl, "/api/v1/admin/lifecycle-users");

  assert.equal(recorded.code, 0);
  assert.equal(recorded.data.followUp.created, true);
  assert.equal(recorded.data.followUp.task.task_type, "CONSULTATION_FOLLOW");
  assert.equal(pending.data.summary.pendingCount, 1);
  assert.equal(pending.data.consultations[0].consultationTypeLabel, "身体反馈");
  assert.equal(lifecycle.data.metrics.pendingConsultations, 1);

  const taskId = recorded.data.followUp.task.task_id;
  const assignment = await request(baseUrl, "/api/v1/admin/consultation-advisor-assignments", {
    method: "POST",
    headers: { "X-Request-Id": "http-consultation-advisor-assignment-1" },
    body: JSON.stringify({
      taskId,
      advisorId: "advisor-http",
      advisorName: "HTTP顾问",
      requestId: "http-consultation-advisor-assignment-1",
    }),
  });
  const repeatedAssignment = await request(baseUrl, "/api/v1/admin/consultation-advisor-assignments", {
    method: "POST",
    headers: { "X-Request-Id": "http-consultation-advisor-assignment-1" },
    body: JSON.stringify({
      taskId,
      advisorId: "advisor-http",
      advisorName: "HTTP顾问",
      requestId: "http-consultation-advisor-assignment-1",
    }),
  });
  const assignmentList = await request(baseUrl, `/api/v1/admin/consultation-advisor-assignments?taskId=${taskId}`);
  const assignedLifecycle = await request(baseUrl, "/api/v1/admin/lifecycle-users");

  assert.equal(assignment.code, 0);
  assert.equal(assignment.data.assignment.advisorId, "advisor-http");
  assert.equal(assignment.data.task.metadata.assignedAdvisorName, "HTTP顾问");
  assert.equal(repeatedAssignment.data.assignment.assignmentId, assignment.data.assignment.assignmentId);
  assert.equal(assignmentList.data.assignments.length, 1);
  assert.equal(assignedLifecycle.data.users[0].consultationSummary.latest.assignedAdvisorName, "HTTP顾问");

  server.store.operationTasks.find((item) => item.task_id === taskId).created_at = "2026-01-01T08:00:00+08:00";
  const consultationSla = await request(baseUrl, `/api/v1/admin/consultation-sla?rootUserId=${login.data.user.rootUserId}&slaMinutes=120&now=2026-01-01T11%3A30%3A00%2B08%3A00`);
  const consultationEscalation = await request(baseUrl, `/api/v1/admin/consultation-sla-escalations?rootUserId=${login.data.user.rootUserId}&slaMinutes=120&now=2026-01-01T11%3A30%3A00%2B08%3A00`);
  const advisorWorkbench = await request(baseUrl, "/api/v1/admin/consultation-advisor-workbench?slaMinutes=120&now=2026-01-01T11%3A30%3A00%2B08%3A00");
  const slaAnalytics = await request(baseUrl, "/api/v1/admin/operational-analytics?campaignId=ROOT_7D_RESET");

  assert.equal(consultationSla.code, 0);
  assert.equal(consultationSla.data.summary.overdueCount, 1);
  assert.equal(consultationSla.data.items[0].assignedAdvisorName, "HTTP顾问");
  assert.equal(consultationSla.data.items[0].overdueMinutes, 90);
  assert.equal(consultationEscalation.code, 0);
  assert.equal(consultationEscalation.data.summary.escalatedCount, 1);
  assert.equal(consultationEscalation.data.items[0].escalationLevel, 2);
  assert.equal(consultationEscalation.data.items[0].escalationOwnerRole, "运营");
  assert.equal(advisorWorkbench.code, 0);
  assert.equal(advisorWorkbench.data.summary.activeAdvisorCount, 1);
  assert.equal(advisorWorkbench.data.advisors[0].advisorName, "HTTP顾问");
  assert.equal(advisorWorkbench.data.advisors[0].status, "ATTENTION");
  assert.equal(advisorWorkbench.data.items[0].taskId, taskId);
  assert.ok(slaAnalytics.data.alertRules.some((item) => item.alertRuleId === "op_alert_consultation_sla_overdue"));
  assert.ok(slaAnalytics.data.alertRules.some((item) => item.alertRuleId === "op_alert_consultation_sla_escalation"));
  assert.ok(slaAnalytics.data.alerts.some((item) => item.key === `consultation_sla_overdue_${taskId}` && item.assignedAdvisorName === "HTTP顾问"));
  assert.ok(slaAnalytics.data.alerts.some((item) => item.key.startsWith(`consultation_sla_escalation_${taskId}_`) && item.escalationLevel >= 2));

  const completed = await request(baseUrl, "/api/v1/admin/consultation-wework-writebacks", {
    method: "POST",
    headers: { "X-Request-Id": "http-consultation-wework-writeback-1" },
    body: JSON.stringify({
      taskId,
      adapterMode: "MANUAL",
      result: "WEWORK_CONTACTED",
      note: "已跟进用户身体反馈 token=secret-token",
      requestId: "http-consultation-wework-writeback-1",
    }),
  });
  const repeated = await request(baseUrl, "/api/v1/admin/consultation-wework-writebacks", {
    method: "POST",
    headers: { "X-Request-Id": "http-consultation-wework-writeback-1" },
    body: JSON.stringify({
      taskId,
      adapterMode: "MANUAL",
      result: "WEWORK_CONTACTED",
      note: "已跟进用户身体反馈 token=secret-token",
      requestId: "http-consultation-wework-writeback-1",
    }),
  });
  const writebacks = await request(baseUrl, `/api/v1/admin/consultation-wework-writebacks?taskId=${taskId}`);
  const done = await request(baseUrl, "/api/v1/user/consultations", { headers: auth });

  assert.equal(completed.code, 0);
  assert.equal(completed.data.writeback.status, "DELIVERED");
  assert.equal(completed.data.task.taskType, "CONSULTATION_FOLLOW");
  assert.equal(repeated.data.writeback.writebackId, completed.data.writeback.writebackId);
  assert.equal(writebacks.code, 0);
  assert.equal(writebacks.data.writebacks.length, 1);
  assert.equal(done.data.summary.pendingCount, 0);
  assert.equal(done.data.summary.handledCount, 1);
  assert.equal(done.data.consultations[0].statusCopy, "已跟进用户身体反馈 token=***");
  assert.equal(JSON.stringify(writebacks.data).includes("secret-token"), false);
});

test("WeWork touch HTTP Interface plans and runs due follow-up jobs", async (t) => {
  const server = createApp({
    env: {
      ROOT_ALLOW_OPENID_LOGIN: "true",
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ openid: "http_wework_touch_openid", appCode: "MYROOT" }),
  });
  const auth = { Authorization: `Bearer ${login.data.token}` };
  const recorded = await request(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      taskType: "CONSULTATION",
      taskDate: "2026-06-20",
      sourceChannel: "MINIPROGRAM_SUPPORT",
      payload: { taskDate: "2026-06-20", consultationType: "BODY_FEEDBACK", scene: "SUPPORT_PAGE" },
      idempotencyKey: "http-wework-touch-consultation",
    }),
  });
  const taskId = recorded.data.followUp.task.task_id;
  server.store.leadProfiles.push({
    lead_id: "lead_http_wework_touch_001",
    user_id: recorded.data.followUp.task.user_id,
    root_user_id: login.data.user.rootUserId,
    external_contact_id: "wm_http_touch_001",
    wechat_remark_name: "HTTP自动触达用户",
    receiver_phone: "",
    source_channel: "WEWORK",
    offline_event_name: "",
    corp_wechat_status: "ADDED",
    operator_note: "",
    created_at: "2026-06-20T10:01:00.000Z",
    updated_at: "2026-06-20T10:01:00.000Z",
  });

  const preview = await request(baseUrl, "/api/v1/admin/wework-touch-jobs/plan", {
    method: "POST",
    body: JSON.stringify({
      dryRun: true,
      taskTypes: ["CONSULTATION_FOLLOW"],
      adapterMode: "MANUAL",
    }),
  });
  const planned = await request(baseUrl, "/api/v1/admin/wework-touch-jobs/plan", {
    method: "POST",
    headers: { "X-Request-Id": "http-wework-touch-plan-1" },
    body: JSON.stringify({
      dryRun: false,
      taskTypes: ["CONSULTATION_FOLLOW"],
      adapterMode: "MANUAL",
      requestId: "http-wework-touch-plan-1",
    }),
  });
  const runPreview = await request(baseUrl, "/api/v1/admin/wework-touch-jobs/run", {
    method: "POST",
    body: JSON.stringify({
      dryRun: true,
      taskTypes: ["CONSULTATION_FOLLOW"],
      batchSize: 5,
      adapterMode: "MANUAL",
    }),
  });
  const runnerArgs = parseWeWorkTouchArgs([
    "--base-url", baseUrl,
    "--execute",
    "--adapter-mode", "MANUAL",
    "--batch-size", "5",
    "--request-id", "http-wework-touch-runner-1",
  ]);
  const runner = await collectWeWorkTouchJob(runnerArgs);
  const runnerReport = buildWeWorkTouchJobReport(runner);
  const jobs = await request(baseUrl, `/api/v1/admin/wework-touch-jobs?taskId=${taskId}`);
  const done = await request(baseUrl, "/api/v1/user/consultations", { headers: auth });

  assert.equal(recorded.code, 0);
  assert.equal(preview.code, 0);
  assert.equal(preview.data.createdCount, 0);
  assert.equal(preview.data.candidates[0].externalContactId, "wm_http_touch_001");
  assert.equal(planned.code, 0);
  assert.equal(planned.data.createdCount, 1);
  assert.equal(planned.data.jobs[0].status, "PENDING");
  assert.equal(runPreview.code, 0);
  assert.equal(runPreview.data.selectedCount, 1);
  assert.equal(runPreview.data.executedCount, 0);
  assert.equal(runner.ok, true);
  assert.equal(runner.request.requestId, "http-wework-touch-runner-1");
  assert.equal(runner.data.successCount, 1);
  assert.equal(determineWeWorkTouchExitCode(runner), 0);
  assert.match(runnerReport, /ROOT 企微自动触达 Job 报告/);
  assert.match(runnerReport, /http-wework-touch-runner-1/);
  assert.equal(jobs.code, 0);
  assert.equal(jobs.data.jobs.length, 1);
  assert.equal(jobs.data.jobs[0].status, "DELIVERED");
  assert.equal(jobs.data.jobs[0].externalContactId, "wm_http_touch_001");
  assert.equal(done.data.summary.pendingCount, 0);
  assert.equal(done.data.summary.handledCount, 1);
  assert.equal(validateSnapshot(server.store).valid, true);
});

test("admin campaign task HTTP Interface configures 21-day rules", async (t) => {
  const server = createApp({
    env: {
      ROOT_ALLOW_OPENID_LOGIN: "true",
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const campaignResult = await request(baseUrl, "/api/v1/admin/campaigns/upsert", {
    method: "POST",
    body: JSON.stringify({
      campaignId: "ROOT_21D_HTTP",
      title: "ROOT 21 日习惯计划",
      status: "ACTIVE",
      config: { durationDays: 21, allowNoOrderParticipation: true },
    }),
  });
  const taskResult = await request(baseUrl, "/api/v1/admin/task-definitions/upsert", {
    method: "POST",
    body: JSON.stringify({
      taskDefinitionId: "td_root_21d_http_checkin",
      campaignId: "ROOT_21D_HTTP",
      taskType: "CHECKIN",
      title: "完成 21 天身体记录",
      required: true,
      config: { targetCount: 21, uniqueBy: "taskDate" },
    }),
  });
  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ openid: "http_21d_task_openid", appCode: "MYROOT" }),
  });
  const auth = { Authorization: `Bearer ${login.data.token}` };
  await request(baseUrl, "/api/v1/campaigns/join", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ campaignId: "ROOT_21D_HTTP" }),
  });
  await request(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      campaignId: "ROOT_21D_HTTP",
      taskType: "CHECKIN",
      taskDate: "2026-06-19",
      payload: { taskDate: "2026-06-19" },
      idempotencyKey: "http-21d-checkin-1",
    }),
  });
  const progress = await request(baseUrl, "/api/v1/tasks/progress?campaignId=ROOT_21D_HTTP", { headers: auth });
  const checkinTask = progress.data.progress.tasks.find((task) => task.taskDefinitionId === "td_root_21d_http_checkin");

  assert.equal(campaignResult.data.campaign.campaignId, "ROOT_21D_HTTP");
  assert.equal(taskResult.data.taskDefinition.config_json.targetCount, 21);
  assert.equal(checkinTask.targetCount, 21);
  assert.equal(checkinTask.completedCount, 1);
});

test("settlement HTTP Interface creates rewards for no-order completion", async (t) => {
  const server = createApp({
    env: {
      ROOT_ALLOW_OPENID_LOGIN: "true",
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ openid: "http_settlement_openid", appCode: "MYROOT" }),
  });
  const auth = { Authorization: `Bearer ${login.data.token}` };
  await request(baseUrl, "/api/v1/campaigns/join", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ sourceChannel: "ROADSHOW_QR" }),
  });
  for (let day = 0; day < 7; day += 1) {
    const taskDate = `2026-06-${String(19 + day).padStart(2, "0")}`;
    await request(baseUrl, "/api/v1/tasks/events", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        taskType: "CHECKIN",
        taskDate,
        payload: { taskDate },
        idempotencyKey: `http-settlement-checkin-${day + 1}`,
      }),
    });
  }
  await request(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      taskType: "QUESTIONNAIRE",
      taskDate: "2026-06-26",
      payload: { questionnaireType: "DAY8_SUMMARY" },
      idempotencyKey: "http-settlement-day8",
    }),
  });

  const statusBefore = await request(baseUrl, "/api/v1/settlement/status", { headers: auth });
  const evaluated = await request(baseUrl, "/api/v1/settlement/evaluate", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ sourceChannel: "MINIPROGRAM_REWARD" }),
  });
  const statusAfter = await request(baseUrl, "/api/v1/settlement/status", { headers: auth });

  assert.equal(statusBefore.data.result.qualified, true);
  assert.equal(statusBefore.data.latestSettlement, null);
  assert.equal(evaluated.data.settlementRecord.status, "QUALIFIED");
  assert.equal(statusAfter.data.latestSettlement.status, "QUALIFIED");
  assert.equal(statusAfter.data.rewardGrants.length, 2);
  assert.equal(statusAfter.data.manualReviews.length, 1);
  assert.equal(server.store.rewardDeliveryJobs.length, 1);
  assert.equal(server.store.youzanOrders.some((order) => order.user_id === login.data.user.userId), false);
});

test("admin settlement HTTP Interface publishes configurable reward rules", async (t) => {
  const server = createApp({
    env: {
      ROOT_ALLOW_OPENID_LOGIN: "true",
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  await request(baseUrl, "/api/v1/admin/campaigns/upsert", {
    method: "POST",
    body: JSON.stringify({
      campaignId: "ROOT_21D_SETTLEMENT_HTTP",
      title: "ROOT 21 日结算活动",
      status: "ACTIVE",
      config: { durationDays: 21, allowNoOrderParticipation: true },
    }),
  });
  await request(baseUrl, "/api/v1/admin/task-definitions/upsert", {
    method: "POST",
    body: JSON.stringify({
      taskDefinitionId: "td_root_21d_settlement_http_checkin",
      campaignId: "ROOT_21D_SETTLEMENT_HTTP",
      taskType: "CHECKIN",
      title: "完成 21 天记录",
      required: true,
      config: { targetCount: 21, uniqueBy: "taskDate" },
    }),
  });
  const rule = await request(baseUrl, "/api/v1/admin/campaign-rules/publish", {
    method: "POST",
    body: JSON.stringify({
      campaignId: "ROOT_21D_SETTLEMENT_HTTP",
      version: 1,
      conditions: [
        { conditionType: "TASK_COUNT", taskType: "CHECKIN", minCount: 21, uniqueBy: "taskDate", label: "完成 21 天记录" },
      ],
      rewards: [
        { rewardType: "TAG", rewardKey: "wework_21d", title: "企微标签", description: "完成后进入 21 天人群" },
      ],
    }),
  });
  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ openid: "http_21d_settlement_openid", appCode: "MYROOT" }),
  });
  const auth = { Authorization: `Bearer ${login.data.token}` };
  await request(baseUrl, "/api/v1/campaigns/join", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ campaignId: "ROOT_21D_SETTLEMENT_HTTP" }),
  });
  const event = await request(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      campaignId: "ROOT_21D_SETTLEMENT_HTTP",
      taskType: "CHECKIN",
      taskDate: "2026-06-19",
      payload: { taskDate: "2026-06-19" },
      idempotencyKey: "http-21d-settlement-checkin-1",
    }),
  });
  const preview = await request(baseUrl, "/api/v1/admin/settlement/preview", {
    method: "POST",
    body: JSON.stringify({
      rootUserId: login.data.user.rootUserId,
      campaignId: "ROOT_21D_SETTLEMENT_HTTP",
    }),
  });

  assert.equal(rule.data.ruleVersion.campaignId, "ROOT_21D_SETTLEMENT_HTTP");
  assert.equal(rule.data.ruleVersion.rewards[0].rewardType, "TAG");
  assert.equal(event.code, 0);
  assert.equal(preview.data.result.qualified, false);
  assert.equal(preview.data.result.missingConditions[0].missing, 20);
});

test("admin settlement HTTP Interface accepts OR condition trees", async (t) => {
  const server = createApp({
    env: {
      ROOT_ALLOW_OPENID_LOGIN: "true",
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  await request(baseUrl, "/api/v1/admin/campaigns/upsert", {
    method: "POST",
    body: JSON.stringify({
      campaignId: "ROOT_OR_SETTLEMENT_HTTP",
      title: "ROOT HTTP OR 结算活动",
      status: "ACTIVE",
      config: { allowNoOrderParticipation: true },
    }),
  });
  await request(baseUrl, "/api/v1/admin/task-definitions/upsert", {
    method: "POST",
    body: JSON.stringify({
      taskDefinitionId: "td_root_or_settlement_http_checkin",
      campaignId: "ROOT_OR_SETTLEMENT_HTTP",
      taskType: "CHECKIN",
      title: "完成任意一天打卡",
      required: false,
      config: { targetCount: 1, uniqueBy: "taskDate" },
    }),
  });
  const rule = await request(baseUrl, "/api/v1/admin/campaign-rules/publish", {
    method: "POST",
    body: JSON.stringify({
      campaignId: "ROOT_OR_SETTLEMENT_HTTP",
      version: 1,
      conditions: {
        logic: "OR",
        label: "完成任一互动",
        conditions: [
          { conditionType: "TASK_COUNT", taskType: "CHECKIN", minCount: 1, uniqueBy: "taskDate", label: "完成 1 次打卡" },
          { conditionType: "CONSULTATION_REQUIRED", label: "完成一次咨询" },
        ],
      },
      rewards: [
        { rewardType: "POINTS", rewardKey: "http_or_points", title: "HTTP 任选积分", description: "任一互动后承诺积分" },
      ],
    }),
  });
  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ openid: "http_or_settlement_openid", appCode: "MYROOT" }),
  });
  const auth = { Authorization: `Bearer ${login.data.token}` };
  await request(baseUrl, "/api/v1/campaigns/join", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ campaignId: "ROOT_OR_SETTLEMENT_HTTP" }),
  });
  const before = await request(baseUrl, "/api/v1/admin/settlement/preview", {
    method: "POST",
    body: JSON.stringify({
      rootUserId: login.data.user.rootUserId,
      campaignId: "ROOT_OR_SETTLEMENT_HTTP",
    }),
  });
  const event = await request(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      campaignId: "ROOT_OR_SETTLEMENT_HTTP",
      taskType: "CHECKIN",
      taskDate: "2026-06-20",
      payload: { taskDate: "2026-06-20" },
      idempotencyKey: "http-or-settlement-checkin",
    }),
  });
  const after = await request(baseUrl, "/api/v1/admin/settlement/preview", {
    method: "POST",
    body: JSON.stringify({
      rootUserId: login.data.user.rootUserId,
      campaignId: "ROOT_OR_SETTLEMENT_HTTP",
    }),
  });
  const workbench = await request(baseUrl, "/api/v1/admin/config-workbench");
  const workbenchRule = workbench.data.ruleVersions.find((item) => item.campaignId === "ROOT_OR_SETTLEMENT_HTTP");

  assert.equal(rule.data.ruleVersion.conditions.logic, "OR");
  assert.equal(before.data.result.qualified, false);
  assert.equal(before.data.result.missingConditions.length, 2);
  assert.equal(event.code, 0);
  assert.equal(after.data.result.qualified, true);
  assert.equal(after.data.result.missingConditions.length, 0);
  assert.equal(after.data.result.conditions[0].logic, "OR");
  assert.equal(workbenchRule.conditionCount, 2);
});

test("settlement HTTP Interface preserves reward quota configuration", async (t) => {
  const server = createApp({
    env: {
      ROOT_ALLOW_OPENID_LOGIN: "true",
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  await request(baseUrl, "/api/v1/admin/campaigns/upsert", {
    method: "POST",
    body: JSON.stringify({
      campaignId: "ROOT_QUOTA_SETTLEMENT_HTTP",
      title: "ROOT HTTP 限量奖励活动",
      status: "ACTIVE",
      config: { allowNoOrderParticipation: true },
    }),
  });
  await request(baseUrl, "/api/v1/admin/task-definitions/upsert", {
    method: "POST",
    body: JSON.stringify({
      taskDefinitionId: "td_root_quota_settlement_http_checkin",
      campaignId: "ROOT_QUOTA_SETTLEMENT_HTTP",
      taskType: "CHECKIN",
      title: "完成限量奖励打卡",
      required: true,
      config: { targetCount: 1, uniqueBy: "taskDate" },
    }),
  });
  await request(baseUrl, "/api/v1/admin/campaign-rules/publish", {
    method: "POST",
    body: JSON.stringify({
      campaignId: "ROOT_QUOTA_SETTLEMENT_HTTP",
      version: 1,
      conditions: [
        { conditionType: "TASK_COUNT", taskType: "CHECKIN", minCount: 1, uniqueBy: "taskDate", label: "完成 1 次打卡" },
      ],
      rewards: [
        { rewardType: "POINTS", rewardKey: "http_quota_points", quotaKey: "http_quota_points_pool", stockLimit: 1, title: "HTTP 限量积分" },
      ],
    }),
  });

  async function completeAndEvaluate(openid, taskDate) {
    const login = await request(baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ openid, appCode: "MYROOT" }),
    });
    const auth = { Authorization: `Bearer ${login.data.token}` };
    await request(baseUrl, "/api/v1/campaigns/join", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ campaignId: "ROOT_QUOTA_SETTLEMENT_HTTP" }),
    });
    await request(baseUrl, "/api/v1/tasks/events", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        campaignId: "ROOT_QUOTA_SETTLEMENT_HTTP",
        taskType: "CHECKIN",
        taskDate,
        payload: { taskDate },
        idempotencyKey: `${openid}-http-quota-checkin`,
      }),
    });
    return request(baseUrl, "/api/v1/settlement/evaluate", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ campaignId: "ROOT_QUOTA_SETTLEMENT_HTTP" }),
    });
  }

  const first = await completeAndEvaluate("http_quota_user_one_openid", "2026-06-20");
  const second = await completeAndEvaluate("http_quota_user_two_openid", "2026-06-21");

  assert.equal(first.data.result.qualified, true);
  assert.equal(second.data.result.qualified, true);
  assert.equal(first.data.rewardResults[0].created, true);
  assert.equal(second.data.rewardResults[0].skipped, true);
  assert.match(second.data.rewardResults[0].skippedReason, /奖励库存已达上限/);
  assert.equal(server.store.rewardInventoryPools.length, 1);
  assert.equal(server.store.rewardInventoryReservations.length, 1);
  assert.equal(server.store.rewardInventoryReservations[0].status, "RESERVED");
  assert.equal(server.store.rewardGrants.length, 1);
  assert.equal(server.store.rewardGrants[0].quota_key, "http_quota_points_pool");
  assert.equal(server.store.rewardGrants[0].quota_limit, 1);
  assert.equal(server.store.rewardGrants[0].inventory_reservation_id, server.store.rewardInventoryReservations[0].reward_inventory_reservation_id);
});

test("settlement HTTP Interface supports reward lottery skips", async (t) => {
  const server = createApp({
    env: {
      ROOT_ALLOW_OPENID_LOGIN: "true",
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  await request(baseUrl, "/api/v1/admin/campaigns/upsert", {
    method: "POST",
    body: JSON.stringify({
      campaignId: "ROOT_LOTTERY_SETTLEMENT_HTTP",
      title: "ROOT HTTP 抽取奖励活动",
      status: "ACTIVE",
      config: { allowNoOrderParticipation: true },
    }),
  });
  await request(baseUrl, "/api/v1/admin/task-definitions/upsert", {
    method: "POST",
    body: JSON.stringify({
      taskDefinitionId: "td_root_lottery_settlement_http_checkin",
      campaignId: "ROOT_LOTTERY_SETTLEMENT_HTTP",
      taskType: "CHECKIN",
      title: "完成抽取奖励打卡",
      required: true,
      config: { targetCount: 1, uniqueBy: "taskDate" },
    }),
  });
  await request(baseUrl, "/api/v1/admin/campaign-rules/publish", {
    method: "POST",
    body: JSON.stringify({
      campaignId: "ROOT_LOTTERY_SETTLEMENT_HTTP",
      version: 1,
      conditions: [
        { conditionType: "TASK_COUNT", taskType: "CHECKIN", minCount: 1, uniqueBy: "taskDate", label: "完成 1 次打卡" },
      ],
      rewards: [
        { rewardType: "FREE_ORDER_CHANCE", rewardKey: "http_lottery_free_order", chanceRate: 0, title: "HTTP 0% 免单机会" },
      ],
    }),
  });
  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ openid: "http_lottery_settlement_openid", appCode: "MYROOT" }),
  });
  const auth = { Authorization: `Bearer ${login.data.token}` };
  await request(baseUrl, "/api/v1/campaigns/join", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ campaignId: "ROOT_LOTTERY_SETTLEMENT_HTTP" }),
  });
  await request(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      campaignId: "ROOT_LOTTERY_SETTLEMENT_HTTP",
      taskType: "CHECKIN",
      taskDate: "2026-06-20",
      payload: { taskDate: "2026-06-20" },
      idempotencyKey: "http-lottery-settlement-checkin",
    }),
  });
  const evaluated = await request(baseUrl, "/api/v1/settlement/evaluate", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ campaignId: "ROOT_LOTTERY_SETTLEMENT_HTTP" }),
  });

  assert.equal(evaluated.data.result.qualified, true);
  assert.equal(evaluated.data.rewardResults[0].skipped, true);
  assert.match(evaluated.data.rewardResults[0].skippedReason, /未抽中该奖励/);
  assert.equal(server.store.rewardGrants.length, 0);
  assert.equal(server.store.manualReviewItems.length, 0);
});

test("admin config HTTP Interface lists workbench data and resolves manual review", async (t) => {
  const server = createApp({
    env: {
      ROOT_ALLOW_OPENID_LOGIN: "true",
      ROOT_ADMIN_TOKEN: "secret-admin",
      ROOT_MANUAL_REVIEW_EXPLANATION_TEMPLATES: JSON.stringify({
        FREE_ORDER_REVIEW: {
          title: "HTTP 免单复核解释",
          pendingReason: "HTTP 模板核对 {{reason}}",
          evidenceRequired: ["HTTP 打卡记录", "HTTP 订单证据"],
          operatorGuidance: "HTTP 后台先核订单再处理。",
          nextAction: "等待 HTTP 复核结果。",
        },
      }),
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());
  const adminHeaders = { "X-ROOT-ADMIN-TOKEN": "secret-admin" };

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ openid: "http_admin_config_openid", appCode: "MYROOT" }),
  });
  const auth = { Authorization: `Bearer ${login.data.token}` };
  await request(baseUrl, "/api/v1/campaigns/join", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ sourceChannel: "ROADSHOW_QR" }),
  });
  for (let day = 0; day < 7; day += 1) {
    const taskDate = `2026-06-${String(19 + day).padStart(2, "0")}`;
    await request(baseUrl, "/api/v1/tasks/events", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        taskType: "CHECKIN",
        taskDate,
        payload: { taskDate },
        idempotencyKey: `http-admin-config-checkin-${day + 1}`,
      }),
    });
  }
  await request(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      taskType: "QUESTIONNAIRE",
      taskDate: "2026-06-26",
      payload: { questionnaireType: "DAY8_SUMMARY" },
      idempotencyKey: "http-admin-config-day8",
    }),
  });
  await request(baseUrl, "/api/v1/settlement/evaluate", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({}),
  });

  const workbench = await request(baseUrl, "/api/v1/admin/config-workbench", { headers: adminHeaders });
  const userStatus = await request(baseUrl, "/api/v1/settlement/status", { headers: auth });
  const reviewId = workbench.data.manualReviews[0].reviewItemId;
  const resolved = await request(baseUrl, `/api/v1/admin/manual-reviews/${reviewId}/resolve`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ decision: "APPROVED", reason: "HTTP 复核通过" }),
  });
  const refreshed = await request(baseUrl, "/api/v1/admin/config-workbench", { headers: adminHeaders });

  assert.equal(workbench.data.metrics.openManualReviews, 1);
  assert.equal(workbench.data.ruleVersions.length >= 1, true);
  assert.equal(workbench.data.manualReviewExplanationTemplates.status, "READY");
  assert.equal(workbench.data.manualReviewExplanationTemplates.templates.find((item) => item.templateKey === "FREE_ORDER_REVIEW").title, "HTTP 免单复核解释");
  assert.equal(workbench.data.manualReviews[0].explanationTitle, "HTTP 免单复核解释");
  assert.equal(workbench.data.manualReviews[0].operatorGuidance, "HTTP 后台先核订单再处理。");
  assert.deepEqual(workbench.data.manualReviews[0].evidenceRequired, ["HTTP 打卡记录", "HTTP 订单证据"]);
  assert.equal(userStatus.data.manualReviews[0].operatorGuidance, "");
  assert.equal(userStatus.data.manualReviews[0].explanation.operatorGuidance, "");
  assert.equal(resolved.data.review.status, "RESOLVED");
  assert.equal(refreshed.data.metrics.openManualReviews, 0);
  assert.equal(refreshed.data.rewardGrants.some((grant) => grant.status === "APPROVED"), true);
  assert.equal(server.store.auditLogs[0].operator_id, "admin");
});

test("admin manual review batch HTTP Interface enforces roles and idempotency", async (t) => {
  const server = createApp({
    env: {
      ROOT_ALLOW_OPENID_LOGIN: "true",
      ROOT_ADMIN_TOKENS: JSON.stringify({
        viewer: { token: "viewer-secret", role: "viewer" },
        ops: { token: "ops-secret", role: "operator" },
      }),
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());
  const viewerHeaders = { "X-Admin-Token": "viewer-secret" };
  const opsHeaders = { "X-Admin-Token": "ops-secret" };

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ openid: "http_admin_batch_review_openid", appCode: "MYROOT" }),
  });
  const auth = { Authorization: `Bearer ${login.data.token}` };
  await request(baseUrl, "/api/v1/campaigns/join", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ sourceChannel: "ROADSHOW_QR" }),
  });
  for (let day = 0; day < 7; day += 1) {
    const taskDate = `2026-06-${String(19 + day).padStart(2, "0")}`;
    await request(baseUrl, "/api/v1/tasks/events", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        taskType: "CHECKIN",
        taskDate,
        payload: { taskDate },
        idempotencyKey: `http-admin-batch-review-checkin-${day + 1}`,
      }),
    });
  }
  await request(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      taskType: "QUESTIONNAIRE",
      taskDate: "2026-06-26",
      payload: { questionnaireType: "DAY8_SUMMARY" },
      idempotencyKey: "http-admin-batch-review-day8",
    }),
  });
  await request(baseUrl, "/api/v1/settlement/evaluate", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({}),
  });

  const workbench = await request(baseUrl, "/api/v1/admin/config-workbench", { headers: viewerHeaders });
  const reviewId = workbench.data.manualReviews[0].reviewItemId;
  const denied = await request(baseUrl, "/api/v1/admin/manual-reviews/batch-resolve", {
    method: "POST",
    headers: { ...viewerHeaders, "X-Request-Id": "http-batch-review-viewer" },
    body: JSON.stringify({
      reviewItemIds: [reviewId],
      decision: "APPROVED",
      confirmRisk: true,
      reason: "viewer 不应可复核",
    }),
  });
  const resolved = await request(baseUrl, "/api/v1/admin/manual-reviews/batch-resolve", {
    method: "POST",
    headers: { ...opsHeaders, "X-Request-Id": "http-batch-review-1" },
    body: JSON.stringify({
      reviewItemIds: [reviewId],
      decision: "APPROVED",
      confirmRisk: true,
      reason: "HTTP 批量复核",
    }),
  });
  const repeated = await request(baseUrl, "/api/v1/admin/manual-reviews/batch-resolve", {
    method: "POST",
    headers: { ...opsHeaders, "X-Request-Id": "http-batch-review-1" },
    body: JSON.stringify({
      reviewItemIds: [reviewId],
      decision: "APPROVED",
      confirmRisk: true,
      reason: "HTTP 批量复核",
    }),
  });
  const audit = await request(baseUrl, "/api/v1/admin/audit-logs?action=BATCH_MANUAL_REVIEW_RESOLVE", {
    headers: viewerHeaders,
  });

  assert.equal(denied.code, 40301);
  assert.equal(resolved.code, 0);
  assert.equal(resolved.data.summary.resolved, 1);
  assert.equal(repeated.data.audit.audit_log_id, resolved.data.audit.audit_log_id);
  assert.equal(audit.data.auditLogs[0].target_id, "http-batch-review-1");
  assert.equal(audit.data.auditLogs[0].operator_id, "ops");
  assert.equal(server.store.auditLogs.filter((log) => log.action === "BATCH_MANUAL_REVIEW_RESOLVE").length, 1);
});

test("admin reward delivery HTTP Interface enforces roles and idempotency", async (t) => {
  const server = createApp({
    env: {
      ROOT_ALLOW_OPENID_LOGIN: "true",
      ROOT_ADMIN_TOKENS: JSON.stringify({
        viewer: { token: "viewer-secret", role: "viewer" },
        finance: { token: "finance-secret", role: "finance" },
      }),
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());
  const viewerHeaders = { "X-Admin-Token": "viewer-secret" };
  const financeHeaders = { "X-Admin-Token": "finance-secret" };

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ openid: "http_reward_delivery_openid", appCode: "MYROOT" }),
  });
  const auth = { Authorization: `Bearer ${login.data.token}` };
  await request(baseUrl, "/api/v1/campaigns/join", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ sourceChannel: "ROADSHOW_QR" }),
  });
  for (let day = 0; day < 7; day += 1) {
    const taskDate = `2026-06-${String(19 + day).padStart(2, "0")}`;
    await request(baseUrl, "/api/v1/tasks/events", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        taskType: "CHECKIN",
        taskDate,
        payload: { taskDate },
        idempotencyKey: `http-reward-delivery-checkin-${day + 1}`,
      }),
    });
  }
  await request(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      taskType: "QUESTIONNAIRE",
      taskDate: "2026-06-26",
      payload: { questionnaireType: "DAY8_SUMMARY" },
      idempotencyKey: "http-reward-delivery-day8",
    }),
  });
  await request(baseUrl, "/api/v1/settlement/evaluate", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({}),
  });

  const workbench = await request(baseUrl, "/api/v1/admin/config-workbench", { headers: viewerHeaders });
  const deliveryJobId = workbench.data.deliveryJobs[0].deliveryJobId;
  const rewardGrantId = workbench.data.deliveryJobs[0].rewardGrantId;
  const denied = await request(baseUrl, "/api/v1/admin/reward-delivery/execute", {
    method: "POST",
    headers: { ...viewerHeaders, "X-Request-Id": "http-reward-delivery-viewer" },
    body: JSON.stringify({
      deliveryJobIds: [deliveryJobId],
      confirmRisk: true,
      outcome: "DELIVERED",
    }),
  });
  const delivered = await request(baseUrl, "/api/v1/admin/reward-delivery/execute", {
    method: "POST",
    headers: { ...financeHeaders, "X-Request-Id": "http-reward-delivery-1" },
    body: JSON.stringify({
      deliveryJobIds: [deliveryJobId],
      confirmRisk: true,
      outcome: "DELIVERED",
      externalRef: "YZ_HTTP_COUPON_001",
      reason: "HTTP 奖励发放",
    }),
  });
  const repeated = await request(baseUrl, "/api/v1/admin/reward-delivery/execute", {
    method: "POST",
    headers: { ...financeHeaders, "X-Request-Id": "http-reward-delivery-1" },
    body: JSON.stringify({
      deliveryJobIds: [deliveryJobId],
      confirmRisk: true,
      outcome: "DELIVERED",
      externalRef: "YZ_HTTP_COUPON_001",
      reason: "HTTP 奖励发放",
    }),
  });
  const audit = await request(baseUrl, "/api/v1/admin/audit-logs?action=REWARD_DELIVERY_BATCH_EXECUTE", {
    headers: viewerHeaders,
  });
  const statusDenied = await request(baseUrl, "/api/v1/admin/reward-delivery/status-query", {
    method: "POST",
    headers: { ...viewerHeaders, "X-Request-Id": "http-reward-status-viewer" },
    body: JSON.stringify({
      deliveryJobIds: [deliveryJobId],
      externalStatus: "USED",
    }),
  });
  const statusUpdated = await request(baseUrl, "/api/v1/admin/reward-delivery/status-query", {
    method: "POST",
    headers: { ...financeHeaders, "X-Request-Id": "http-reward-status-1" },
    body: JSON.stringify({
      deliveryJobIds: [deliveryJobId],
      externalStatus: "USED",
      reason: "HTTP 查询券核销状态",
    }),
  });
  const statusRepeated = await request(baseUrl, "/api/v1/admin/reward-delivery/status-query", {
    method: "POST",
    headers: { ...financeHeaders, "X-Request-Id": "http-reward-status-1" },
    body: JSON.stringify({
      deliveryJobIds: [deliveryJobId],
      externalStatus: "USED",
      reason: "HTTP 查询券核销状态",
    }),
  });
  const statusWorkbench = await request(baseUrl, "/api/v1/admin/config-workbench", {
    headers: viewerHeaders,
  });
  const statusWorkbenchGrant = statusWorkbench.data.rewardGrants.find((grant) => grant.rewardGrantId === rewardGrantId);
  const statusWorkbenchJob = statusWorkbench.data.deliveryJobs.find((job) => job.deliveryJobId === deliveryJobId);

  assert.equal(denied.code, 40301);
  assert.equal(delivered.code, 0);
  assert.equal(delivered.data.summary.delivered, 1);
  assert.equal(repeated.data.audit.audit_log_id, delivered.data.audit.audit_log_id);
  assert.equal(server.store.rewardDeliveryJobs[0].status, "DELIVERED");
  assert.equal(server.store.rewardGrants.find((grant) => grant.reward_type === "YOUZAN_COUPON").status, "USED");
  assert.equal(server.store.rewardGrants.find((grant) => grant.reward_type === "YOUZAN_COUPON").external_status, "USED");
  assert.equal(audit.data.auditLogs[0].target_id, "http-reward-delivery-1");
  assert.equal(audit.data.auditLogs[0].operator_id, "finance");
  assert.equal(server.store.auditLogs.filter((log) => log.action === "REWARD_DELIVERY_BATCH_EXECUTE").length, 1);
  assert.equal(statusDenied.code, 40301);
  assert.equal(statusUpdated.code, 0);
  assert.equal(statusUpdated.data.summary.updated, 1);
  assert.equal(statusRepeated.data.audit.audit_log_id, statusUpdated.data.audit.audit_log_id);
  assert.equal(statusWorkbenchGrant.externalStatus, "USED");
  assert.equal(Boolean(statusWorkbenchGrant.externalStatusCheckedAt), true);
  assert.equal(statusWorkbenchJob.externalStatus, "USED");
  assert.equal(Boolean(statusWorkbenchJob.externalStatusCheckedAt), true);
  assert.equal(server.store.auditLogs.filter((log) => log.action === "REWARD_DELIVERY_STATUS_BATCH_QUERY").length, 1);
});

test("admin lifecycle HTTP Interface lists identity and settlement progress", async (t) => {
  const lifecycleObjectDir = fs.mkdtempSync(path.join(os.tmpdir(), "root-lifecycle-object-http-"));
  const lifecycleWebhookCalls = [];
  const lifecycleRetryWebhookAttempts = new Map();
  const server = createApp({
    env: {
      ROOT_ALLOW_OPENID_LOGIN: "true",
      ROOT_LIFECYCLE_EXPORT_OBJECT_DIR: lifecycleObjectDir,
      ROOT_LIFECYCLE_EXPORT_DOWNLOAD_SECRET: "http-export-secret",
      ROOT_ADMIN_TOKENS: JSON.stringify({
        admin: { token: "secret-admin", role: "admin" },
        ops2: { token: "ops2-secret", role: "operator" },
        finance: { token: "finance-secret", role: "finance" },
      }),
    },
    trustedWechatIdentityAdapter: verifiedCloudbaseHeaderIdentityAdapter,
    fetchImpl: async (url, init) => {
      lifecycleWebhookCalls.push({ url, init });
      if (url === "https://hooks.example.com/http-lifecycle-retry") {
        const attempts = (lifecycleRetryWebhookAttempts.get(url) || 0) + 1;
        lifecycleRetryWebhookAttempts.set(url, attempts);
        if (attempts === 1) return { ok: false, status: 500, text: async () => "temporary http lifecycle failure" };
        return { ok: true, status: 202, text: async () => "accepted http lifecycle retry" };
      }
      return { ok: true, status: 202, text: async () => "accepted http lifecycle export" };
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());
  const adminHeaders = { "X-Admin-Token": "secret-admin" };
  const otherOperatorHeaders = { "X-Admin-Token": "ops2-secret" };
  const financeHeaders = { "X-Admin-Token": "finance-secret" };

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    headers: {
      "x-wx-openid": "http_lifecycle_openid",
      "x-wx-unionid": "http_lifecycle_unionid",
    },
    body: JSON.stringify({
      appCode: "MYROOT",
    }),
  });
  const auth = { Authorization: `Bearer ${login.data.token}` };
  await request(baseUrl, "/api/v1/campaigns/join", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ sourceChannel: "ROADSHOW_QR" }),
  });
  for (let day = 0; day < 7; day += 1) {
    const taskDate = `2026-06-${String(19 + day).padStart(2, "0")}`;
    await request(baseUrl, "/api/v1/tasks/events", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        taskType: "CHECKIN",
        taskDate,
        payload: { taskDate },
        idempotencyKey: `http-lifecycle-checkin-${day + 1}`,
      }),
    });
  }
  await request(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      taskType: "QUESTIONNAIRE",
      taskDate: "2026-06-22",
      payload: { questionnaireType: "DAY4_MIDPOINT" },
      idempotencyKey: "http-lifecycle-day4",
    }),
  });
  await request(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      taskType: "QUESTIONNAIRE",
      taskDate: "2026-06-26",
      payload: { questionnaireType: "DAY8_SUMMARY" },
      idempotencyKey: "http-lifecycle-day8",
    }),
  });
  await request(baseUrl, "/api/v1/settlement/evaluate", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({}),
  });

  const workbench = await request(baseUrl, "/api/v1/admin/lifecycle-users?keyword=http_lifecycle_unionid", {
    headers: adminHeaders,
  });
  const filtered = await request(
    baseUrl,
    "/api/v1/admin/lifecycle-users?campaignId=ROOT_7D_RESET&taskProgress=SETTLEMENT_READY&settlementStatus=QUALIFIED&rewardStatus=PENDING&consultationStatus=NONE&openTasks=NO_OPEN_TASKS&limit=20",
    { headers: adminHeaders },
  );
  const excluded = await request(baseUrl, "/api/v1/admin/lifecycle-users?consultationStatus=PENDING", {
    headers: adminHeaders,
  });
  const exportResult = await textRequest(
    baseUrl,
    "/api/v1/admin/lifecycle-users/export?campaignId=ROOT_7D_RESET&taskProgress=SETTLEMENT_READY&settlementStatus=QUALIFIED&rewardStatus=PENDING&consultationStatus=NONE&openTasks=NO_OPEN_TASKS&limit=20",
    { headers: adminHeaders },
  );
  const rawExportResult = await textRequest(
    baseUrl,
    "/api/v1/admin/lifecycle-users/export?campaignId=ROOT_7D_RESET&taskProgress=SETTLEMENT_READY&settlementStatus=QUALIFIED&rewardStatus=PENDING&consultationStatus=NONE&openTasks=NO_OPEN_TASKS&limit=20&sensitivity=RAW",
    { headers: adminHeaders },
  );
  const downgradedRawExportResult = await textRequest(
    baseUrl,
    "/api/v1/admin/lifecycle-users/export?campaignId=ROOT_7D_RESET&taskProgress=SETTLEMENT_READY&settlementStatus=QUALIFIED&rewardStatus=PENDING&consultationStatus=NONE&openTasks=NO_OPEN_TASKS&limit=20&sensitivity=RAW",
    { headers: otherOperatorHeaders },
  );
  const scheduledExport = await request(baseUrl, "/api/v1/admin/lifecycle-user-exports/create", {
    method: "POST",
    headers: { ...adminHeaders, "X-Request-Id": "http-lifecycle-users-export-1" },
    body: JSON.stringify({
      filters: {
        campaignId: "ROOT_7D_RESET",
        taskProgress: "SETTLEMENT_READY",
        settlementStatus: "QUALIFIED",
        rewardStatus: "PENDING",
        consultationStatus: "NONE",
        openTasks: "NO_OPEN_TASKS",
        limit: 20,
      },
      retentionDays: 7,
    }),
  });
  const downgradedScheduledExport = await request(baseUrl, "/api/v1/admin/lifecycle-user-exports/create", {
    method: "POST",
    headers: { ...otherOperatorHeaders, "X-Request-Id": "http-lifecycle-users-export-downgraded" },
    body: JSON.stringify({
      filters: {
        campaignId: "ROOT_7D_RESET",
        taskProgress: "SETTLEMENT_READY",
        settlementStatus: "QUALIFIED",
        rewardStatus: "PENDING",
        consultationStatus: "NONE",
        openTasks: "NO_OPEN_TASKS",
        limit: 20,
      },
      sensitivity: "RAW",
      retentionDays: 7,
    }),
  });
  const scheduledExportsBeforeDownload = await request(baseUrl, "/api/v1/admin/lifecycle-user-exports?limit=10", {
    headers: adminHeaders,
  });
  const scheduledExportDownload = await textRequest(
    baseUrl,
    `/api/v1/admin/lifecycle-user-exports/${scheduledExport.data.exportRecord.exportId}/download`,
    { headers: adminHeaders },
  );
  const scheduledExportsAfterDownload = await request(baseUrl, "/api/v1/admin/lifecycle-user-exports?limit=10", {
    headers: adminHeaders,
  });
  const operatorDelivery = await request(baseUrl, "/api/v1/admin/lifecycle-user-exports/deliver", {
    method: "POST",
    headers: { ...otherOperatorHeaders, "X-Request-Id": "http-lifecycle-users-export-operator-delivery" },
    body: JSON.stringify({
      exportId: scheduledExport.data.exportRecord.exportId,
      deliveryChannel: "INTERNAL_LINK",
    }),
  });
  const deliveredScheduledExport = await request(baseUrl, "/api/v1/admin/lifecycle-user-exports/deliver", {
    method: "POST",
    headers: { ...financeHeaders, "X-Request-Id": "http-lifecycle-users-export-finance-delivery" },
    body: JSON.stringify({
      exportId: scheduledExport.data.exportRecord.exportId,
      deliveryChannel: "INTERNAL_LINK",
    }),
  });
  const signedScheduledExport = await request(baseUrl, "/api/v1/admin/lifecycle-user-exports/deliver", {
    method: "POST",
    headers: { ...financeHeaders, "X-Request-Id": "http-lifecycle-users-export-signed-delivery" },
    body: JSON.stringify({
      exportId: scheduledExport.data.exportRecord.exportId,
      deliveryChannel: "INTERNAL_LINK",
      signedDownload: true,
      signedDownloadTtlSeconds: 600,
    }),
  });
  const signedScheduledDownload = await textRequest(
    baseUrl,
    signedScheduledExport.data.delivery.externalRef,
  );
  const signedScheduledDownloadInvalid = await request(
    baseUrl,
    signedScheduledExport.data.delivery.externalRef.replace(/signature=[^&]+/, "signature=bad-signature"),
  );
  const deliveredWebhookExport = await request(baseUrl, "/api/v1/admin/lifecycle-user-exports/deliver", {
    method: "POST",
    headers: { ...financeHeaders, "X-Request-Id": "http-lifecycle-users-export-webhook-delivery" },
    body: JSON.stringify({
      exportId: scheduledExport.data.exportRecord.exportId,
      deliveryChannel: "WEBHOOK",
      webhookUrl: "https://hooks.example.com/http-lifecycle-export",
      webhookSecret: "http-lifecycle-webhook-secret",
      webhookChannel: "WEWORK",
      webhookTemplate: "lifecycle_export_ready",
      signedDownload: true,
      signedDownloadTtlSeconds: 600,
    }),
  });
  const lifecycleWebhookPayload = JSON.parse(lifecycleWebhookCalls[0].init.body);
  const retryWebhookExport = await request(baseUrl, "/api/v1/admin/lifecycle-user-exports/create", {
    method: "POST",
    headers: { ...adminHeaders, "X-Request-Id": "http-lifecycle-users-export-webhook-retry" },
    body: JSON.stringify({
      filters: {
        campaignId: "ROOT_7D_RESET",
        taskProgress: "SETTLEMENT_READY",
        settlementStatus: "QUALIFIED",
        rewardStatus: "PENDING",
        consultationStatus: "NONE",
        openTasks: "NO_OPEN_TASKS",
        limit: 20,
      },
      retentionDays: 7,
      now: "2026-06-20T08:20:00+08:00",
    }),
  });
  const retryScheduledExport = await request(baseUrl, "/api/v1/admin/lifecycle-user-exports/deliver", {
    method: "POST",
    headers: { ...financeHeaders, "X-Request-Id": "http-lifecycle-users-export-webhook-retry-first" },
    body: JSON.stringify({
      exportId: retryWebhookExport.data.exportRecord.exportId,
      deliveryChannel: "WEBHOOK",
      webhookUrl: "https://hooks.example.com/http-lifecycle-retry",
      webhookSecret: "http-lifecycle-webhook-secret",
      webhookChannel: "WEWORK",
      webhookTemplate: "lifecycle_export_ready",
      signedDownload: true,
      deliveryRetryEnabled: true,
      deliveryMaxAttempts: 2,
      deliveryRetryDelaySeconds: 60,
      now: "2026-06-20T08:21:00+08:00",
    }),
  });
  const deliveryHealthBeforeRetry = await request(baseUrl, "/api/v1/admin/lifecycle-user-exports/delivery-health?now=2026-06-20T08:22:01%2B08:00", {
    headers: adminHeaders,
  });
  const exportDeliveryRetryPreview = await collectLifecycleUserExportsDeliveryRetry(parseLifecycleUserExportsDeliveryRetryArgs([
    "--base-url", baseUrl,
    "--admin-token", "finance-secret",
    "--dry-run",
    "--now", "2026-06-20T08:22:01+08:00",
    "--batch-size", "5",
  ]));
  const exportDeliveryRetryExecuted = await collectLifecycleUserExportsDeliveryRetry(parseLifecycleUserExportsDeliveryRetryArgs([
    "--base-url", baseUrl,
    "--admin-token", "finance-secret",
    "--execute",
    "--now", "2026-06-20T08:22:01+08:00",
    "--batch-size", "5",
    "--max-attempts", "2",
    "--retry-delay-seconds", "60",
    "--delivery-channel", "WEBHOOK",
    "--webhook-url", "https://hooks.example.com/http-lifecycle-retry",
    "--webhook-secret", "http-lifecycle-webhook-secret",
    "--webhook-channel", "WEWORK",
    "--webhook-template", "lifecycle_export_ready",
    "--signed-download",
    "--request-id", "http-lifecycle-users-export-delivery-retry-1",
  ]));
  const deliveryHealthAfterRetry = await request(baseUrl, "/api/v1/admin/lifecycle-user-exports/delivery-health?now=2026-06-20T08:22:02%2B08:00", {
    headers: adminHeaders,
  });
  const exportDeliveryRetryReport = buildLifecycleUserExportsDeliveryRetryReport(exportDeliveryRetryExecuted);
  const deliveredObjectExport = await request(baseUrl, "/api/v1/admin/lifecycle-user-exports/deliver", {
    method: "POST",
    headers: { ...financeHeaders, "X-Request-Id": "http-lifecycle-users-export-object-delivery" },
    body: JSON.stringify({
      exportId: scheduledExport.data.exportRecord.exportId,
      deliveryChannel: "OBJECT_STORAGE",
      objectPrefix: "http-lifecycle-exports",
    }),
  });
  const deliveredObjectPath = () => path.join(lifecycleObjectDir, deliveredObjectExport.data.delivery.target.objectKey);
  const expiredObjectExport = await request(baseUrl, "/api/v1/admin/lifecycle-user-exports/create", {
    method: "POST",
    headers: { ...adminHeaders, "X-Request-Id": "http-lifecycle-users-export-object-expired" },
    body: JSON.stringify({
      filters: {
        campaignId: "ROOT_7D_RESET",
        taskProgress: "SETTLEMENT_READY",
        settlementStatus: "QUALIFIED",
        rewardStatus: "PENDING",
        consultationStatus: "NONE",
        openTasks: "NO_OPEN_TASKS",
        limit: 20,
      },
      retentionDays: 1,
      now: "2026-06-01T09:00:00+08:00",
    }),
  });
  const deliveredExpiredObjectExport = await request(baseUrl, "/api/v1/admin/lifecycle-user-exports/deliver", {
    method: "POST",
    headers: { ...financeHeaders, "X-Request-Id": "http-lifecycle-users-export-object-expired-delivery" },
    body: JSON.stringify({
      exportId: expiredObjectExport.data.exportRecord.exportId,
      deliveryChannel: "OBJECT_STORAGE",
      objectPrefix: "http-lifecycle-exports",
      now: "2026-06-01T09:01:00+08:00",
    }),
  });
  const expiredObjectPath = () => path.join(lifecycleObjectDir, deliveredExpiredObjectExport.data.delivery.target.objectKey);
  const exportCleanupDenied = await request(baseUrl, "/api/v1/jobs/lifecycle-user-exports-cleanup", {
    method: "POST",
    headers: otherOperatorHeaders,
    body: JSON.stringify({ dryRun: true, now: "2026-06-20T09:00:00+08:00" }),
  });
  const exportCleanupPreview = await collectLifecycleUserExportsCleanup(parseLifecycleUserExportsCleanupArgs([
    "--base-url", baseUrl,
    "--admin-token", "finance-secret",
    "--dry-run",
    "--now", "2026-06-20T09:02:00+08:00",
    "--object-dir", lifecycleObjectDir,
  ]));
  const exportCleanupMissingRequestId = await request(baseUrl, "/api/v1/jobs/lifecycle-user-exports-cleanup", {
    method: "POST",
    headers: financeHeaders,
    body: JSON.stringify({
      dryRun: false,
      now: "2026-06-20T09:03:00+08:00",
      objectDir: lifecycleObjectDir,
    }),
  });
  const exportCleanupExecuted = await collectLifecycleUserExportsCleanup(parseLifecycleUserExportsCleanupArgs([
    "--base-url", baseUrl,
    "--admin-token", "finance-secret",
    "--execute",
    "--now", "2026-06-20T09:04:00+08:00",
    "--object-dir", lifecycleObjectDir,
    "--request-id", "http-lifecycle-user-exports-cleanup-1",
  ]));
  const exportCleanupReport = buildLifecycleUserExportsCleanupReport(exportCleanupExecuted);
  const rawApprovalExport = await request(baseUrl, "/api/v1/admin/lifecycle-user-exports/create", {
    method: "POST",
    headers: { ...adminHeaders, "X-Request-Id": "http-lifecycle-users-export-raw-approval" },
    body: JSON.stringify({
      filters: {
        campaignId: "ROOT_7D_RESET",
        taskProgress: "SETTLEMENT_READY",
        settlementStatus: "QUALIFIED",
        rewardStatus: "PENDING",
        consultationStatus: "NONE",
        openTasks: "NO_OPEN_TASKS",
        limit: 20,
      },
      sensitivity: "RAW",
      retentionDays: 7,
    }),
  });
  const rawApprovalDownloadBefore = await request(
    baseUrl,
    `/api/v1/admin/lifecycle-user-exports/${rawApprovalExport.data.exportRecord.exportId}/download`,
    { headers: adminHeaders },
  );
  const rawApprovalDeliveryBefore = await request(baseUrl, "/api/v1/admin/lifecycle-user-exports/deliver", {
    method: "POST",
    headers: { ...financeHeaders, "X-Request-Id": "http-lifecycle-users-export-delivery-before-approval" },
    body: JSON.stringify({
      exportId: rawApprovalExport.data.exportRecord.exportId,
      deliveryChannel: "INTERNAL_LINK",
    }),
  });
  const operatorApproval = await request(baseUrl, "/api/v1/admin/lifecycle-user-exports/review", {
    method: "POST",
    headers: { ...otherOperatorHeaders, "X-Request-Id": "http-lifecycle-users-export-operator-approval" },
    body: JSON.stringify({
      exportId: rawApprovalExport.data.exportRecord.exportId,
      decision: "APPROVED",
      note: "operator 误审批",
    }),
  });
  const approvedRawExport = await request(baseUrl, "/api/v1/admin/lifecycle-user-exports/review", {
    method: "POST",
    headers: { ...financeHeaders, "X-Request-Id": "http-lifecycle-users-export-finance-approval" },
    body: JSON.stringify({
      exportId: rawApprovalExport.data.exportRecord.exportId,
      decision: "APPROVED",
      note: "finance 审批原文字段下载",
    }),
  });
  const rawApprovalDownloadAfter = await textRequest(
    baseUrl,
    `/api/v1/admin/lifecycle-user-exports/${rawApprovalExport.data.exportRecord.exportId}/download`,
    { headers: adminHeaders },
  );
  const rawApprovalDeliveryAfter = await request(baseUrl, "/api/v1/admin/lifecycle-user-exports/deliver", {
    method: "POST",
    headers: { ...financeHeaders, "X-Request-Id": "http-lifecycle-users-export-delivery-after-approval" },
    body: JSON.stringify({
      exportId: rawApprovalExport.data.exportRecord.exportId,
      deliveryChannel: "INTERNAL_LINK",
    }),
  });
  const exportJobMissingRequestId = await request(baseUrl, "/api/v1/jobs/lifecycle-users-export", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ dryRun: false, filters: { campaignId: "ROOT_7D_RESET" } }),
  });
  const exportJobDryRun = await collectLifecycleUsersExport(parseLifecycleUsersExportArgs([
    "--base-url", baseUrl,
    "--admin-token", "secret-admin",
    "--dry-run",
    "--campaign", "ROOT_7D_RESET",
    "--task-progress", "SETTLEMENT_READY",
    "--limit", "20",
  ]));
  const exportJobExecuted = await collectLifecycleUsersExport(parseLifecycleUsersExportArgs([
    "--base-url", baseUrl,
    "--admin-token", "secret-admin",
    "--execute",
    "--campaign", "ROOT_7D_RESET",
    "--task-progress", "SETTLEMENT_READY",
    "--limit", "20",
    "--request-id", "http-lifecycle-users-export-job-1",
  ]));
  const exportJobReport = buildLifecycleUsersExportReport(exportJobExecuted);
  const savedPreset = await request(baseUrl, "/api/v1/admin/lifecycle-filter-presets/upsert", {
    method: "POST",
    headers: { ...adminHeaders, "X-Request-Id": "http-lifecycle-filter-1" },
    body: JSON.stringify({
      title: "HTTP 可结算待发奖",
      scope: "TEAM",
      pinned: true,
      sortOrder: 10,
      filters: {
        campaignId: "ROOT_7D_RESET",
        taskProgress: "SETTLEMENT_READY",
        settlementStatus: "QUALIFIED",
        rewardStatus: "PENDING",
        consultationStatus: "NONE",
        openTasks: "NO_OPEN_TASKS",
        limit: 20,
      },
    }),
  });
  const personalPreset = await request(baseUrl, "/api/v1/admin/lifecycle-filter-presets/upsert", {
    method: "POST",
    headers: { ...adminHeaders, "X-Request-Id": "http-lifecycle-filter-personal-1" },
    body: JSON.stringify({
      title: "HTTP 个人待办筛选",
      scope: "PERSONAL",
      pinned: false,
      sortOrder: 80,
      filters: {
        openTasks: "HAS_OPEN_TASKS",
        limit: 20,
      },
    }),
  });
  const presets = await request(baseUrl, "/api/v1/admin/lifecycle-filter-presets", {
    headers: adminHeaders,
  });
  const otherOperatorPresets = await request(baseUrl, "/api/v1/admin/lifecycle-filter-presets", {
    headers: otherOperatorHeaders,
  });
  const copiedPreset = await request(baseUrl, "/api/v1/admin/lifecycle-filter-presets/copy", {
    method: "POST",
    headers: { ...otherOperatorHeaders, "X-Request-Id": "http-lifecycle-filter-copy-1" },
    body: JSON.stringify({
      sourcePresetId: savedPreset.data.preset.presetId,
      reason: "HTTP 复制团队筛选",
    }),
  });
  const otherOperatorPresetsAfterCopy = await request(baseUrl, "/api/v1/admin/lifecycle-filter-presets", {
    headers: otherOperatorHeaders,
  });
  const otherOperatorEdit = await request(baseUrl, "/api/v1/admin/lifecycle-filter-presets/upsert", {
    method: "POST",
    headers: { ...otherOperatorHeaders, "X-Request-Id": "http-lifecycle-filter-other-edit-1" },
    body: JSON.stringify({
      presetId: savedPreset.data.preset.presetId,
      title: "HTTP 误改团队筛选",
      scope: "TEAM",
      filters: { rewardStatus: "PENDING", limit: 20 },
    }),
  });
  const otherOperatorDelete = await request(baseUrl, "/api/v1/admin/lifecycle-filter-presets/delete", {
    method: "POST",
    headers: { ...otherOperatorHeaders, "X-Request-Id": "http-lifecycle-filter-other-delete-1" },
    body: JSON.stringify({ presetId: savedPreset.data.preset.presetId }),
  });
  const otherOperatorCopyPrivate = await request(baseUrl, "/api/v1/admin/lifecycle-filter-presets/copy", {
    method: "POST",
    headers: { ...otherOperatorHeaders, "X-Request-Id": "http-lifecycle-filter-copy-private-1" },
    body: JSON.stringify({ sourcePresetId: personalPreset.data.preset.presetId }),
  });
  const deletedPreset = await request(baseUrl, "/api/v1/admin/lifecycle-filter-presets/delete", {
    method: "POST",
    headers: { ...adminHeaders, "X-Request-Id": "http-lifecycle-filter-delete-1" },
    body: JSON.stringify({ presetId: savedPreset.data.preset.presetId }),
  });
  const filterBatchPreview = await request(baseUrl, "/api/v1/admin/lifecycle-users/settlement-batch-preview", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      filters: {
        campaignId: "ROOT_7D_RESET",
        taskProgress: "SETTLEMENT_READY",
        settlementStatus: "QUALIFIED",
        rewardStatus: "PENDING",
        consultationStatus: "NONE",
        openTasks: "NO_OPEN_TASKS",
        limit: 1,
      },
      selectionLimit: 20,
    }),
  });
  const createdJob = await request(baseUrl, "/api/v1/admin/lifecycle-settlement-jobs/create", {
    method: "POST",
    headers: { ...adminHeaders, "X-Request-Id": "http-lifecycle-job-create-1" },
    body: JSON.stringify({
      filters: {
        campaignId: "ROOT_7D_RESET",
        taskProgress: "SETTLEMENT_READY",
        settlementStatus: "QUALIFIED",
        rewardStatus: "PENDING",
        consultationStatus: "NONE",
        openTasks: "NO_OPEN_TASKS",
        limit: 1,
      },
      selectionLimit: 20,
      batchSize: 1,
      confirmRisk: true,
      reason: "HTTP 生命周期结算队列",
    }),
  });
  const schedulerCandidate = await request(baseUrl, "/api/v1/admin/lifecycle-settlement-jobs/create", {
    method: "POST",
    headers: { ...adminHeaders, "X-Request-Id": "http-lifecycle-job-create-scheduler" },
    body: JSON.stringify({
      filters: {
        campaignId: "ROOT_7D_RESET",
        taskProgress: "SETTLEMENT_READY",
        settlementStatus: "QUALIFIED",
        rewardStatus: "PENDING",
        consultationStatus: "NONE",
        openTasks: "NO_OPEN_TASKS",
      },
      selectionLimit: 20,
      batchSize: 1,
      confirmRisk: true,
      reason: "HTTP 生命周期结算队列自动调度候选",
    }),
  });
  const listedJobs = await request(baseUrl, "/api/v1/admin/lifecycle-settlement-jobs?campaignId=ROOT_7D_RESET", {
    headers: adminHeaders,
  });
  const schedulerPreview = await collectLifecycleSettlementJob(parseLifecycleSettlementArgs([
    "--base-url", baseUrl,
    "--admin-token", "secret-admin",
    "--dry-run",
    "--campaign", "ROOT_7D_RESET",
    "--job-limit", "2",
  ]));
  const schedulerMissingRequestId = await request(baseUrl, "/api/v1/jobs/lifecycle-settlement-due", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ dryRun: false, campaignId: "ROOT_7D_RESET" }),
  });
  const ranJob = await request(baseUrl, "/api/v1/admin/lifecycle-settlement-jobs/run", {
    method: "POST",
    headers: { ...adminHeaders, "X-Request-Id": "http-lifecycle-job-run-1" },
    body: JSON.stringify({
      jobId: createdJob.data.job.jobId,
      batchSize: 1,
    }),
  });
  const schedulerExecuted = await collectLifecycleSettlementJob(parseLifecycleSettlementArgs([
    "--base-url", baseUrl,
    "--admin-token", "secret-admin",
    "--execute",
    "--campaign", "ROOT_7D_RESET",
    "--job-limit", "2",
    "--request-id", "http-lifecycle-scheduler-run-1",
  ]));
  const schedulerReport = buildLifecycleSettlementJobReport(schedulerExecuted);
  server.store.adminLifecycleSettlementJobs.unshift({
    job_id: "lsj_http_cleanup_running",
    source: "LIFECYCLE_FILTER",
    status: "RUNNING",
    campaign_id: "ROOT_7D_RESET",
    request_id: "http-cleanup-running",
    operator_id: "ops-http",
    reason: "HTTP 清理测试队列",
    batch_size: 20,
    filters_json: { campaignId: "ROOT_7D_RESET" },
    selection_json: { total: 2, selectedCount: 2, selectionLimit: 2, truncated: false, users: [] },
    root_user_ids: ["root_http_cleanup_done", "root_http_cleanup_pending"],
    processed_root_user_ids: ["root_http_cleanup_done"],
    failed_root_user_ids: [],
    items_json: [{ rootUserId: "root_http_cleanup_done", status: "SKIPPED", executed: false }],
    last_run_json: { requestId: "http-cleanup-last" },
    total_count: 2,
    run_count: 1,
    error_message: "",
    created_at: "2026-06-19T08:00:00+08:00",
    updated_at: "2026-06-19T08:10:00+08:00",
    started_at: "2026-06-19T08:00:00+08:00",
    finished_at: "",
    cancelled_at: "",
  });
  const cleanupPreview = await collectLifecycleSettlementCleanup(parseLifecycleSettlementCleanupArgs([
    "--base-url", baseUrl,
    "--admin-token", "secret-admin",
    "--dry-run",
    "--campaign", "ROOT_7D_RESET",
    "--stale-minutes", "120",
    "--job-limit", "5",
  ]));
  const cleanupMissingRequestId = await request(baseUrl, "/api/v1/jobs/lifecycle-settlement-cleanup", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ dryRun: false, campaignId: "ROOT_7D_RESET" }),
  });
  const cleanupExecuted = await collectLifecycleSettlementCleanup(parseLifecycleSettlementCleanupArgs([
    "--base-url", baseUrl,
    "--admin-token", "secret-admin",
    "--execute",
    "--campaign", "ROOT_7D_RESET",
    "--stale-minutes", "120",
    "--job-limit", "5",
    "--request-id", "http-lifecycle-cleanup-run-1",
  ]));
  const cleanupReport = buildLifecycleSettlementCleanupReport(cleanupExecuted);
  const cancelCandidate = await request(baseUrl, "/api/v1/admin/lifecycle-settlement-jobs/create", {
    method: "POST",
    headers: { ...adminHeaders, "X-Request-Id": "http-lifecycle-job-create-cancel" },
    body: JSON.stringify({
      filters: {
        campaignId: "ROOT_7D_RESET",
        taskProgress: "SETTLEMENT_READY",
        settlementStatus: "QUALIFIED",
        rewardStatus: "PENDING",
        consultationStatus: "NONE",
        openTasks: "NO_OPEN_TASKS",
      },
      selectionLimit: 20,
      batchSize: 1,
      confirmRisk: true,
    }),
  });
  const cancelledJob = await request(baseUrl, "/api/v1/admin/lifecycle-settlement-jobs/cancel", {
    method: "POST",
    headers: { ...adminHeaders, "X-Request-Id": "http-lifecycle-job-cancel-1" },
    body: JSON.stringify({ jobId: cancelCandidate.data.job.jobId }),
  });
  const row = workbench.data.users[0];

  assert.equal(workbench.code, 0);
  assert.equal(workbench.data.metrics.unionidLinked, 1);
  assert.equal(row.unionidStatus, "LINKED");
  assert.equal(row.taskSummary.settlementReady, true);
  assert.equal(row.latestSettlement.status, "QUALIFIED");
  assert.equal(row.rewardSummary.rewardCount, 2);
  assert.equal(filtered.code, 0);
  assert.equal(filtered.data.total, 1);
  assert.equal(filtered.data.users[0].taskProgressStatus, "SETTLEMENT_READY");
  assert.equal(filtered.data.users[0].settlementStatus, "QUALIFIED");
  assert.equal(filtered.data.users[0].rewardStatus, "PENDING");
  assert.equal(filtered.data.users[0].consultationStatus, "NONE");
  assert.equal(filtered.data.filters.limit, 20);
  assert.equal(excluded.data.total, 0);
  assert.equal(exportResult.status, 200);
  assert.match(exportResult.contentType, /text\/csv/);
  assert.match(exportResult.body, /root_user_id,user_id,nickname,phone/);
  assert.doesNotMatch(exportResult.body, /http_lifecycle_unionid/);
  assert.match(exportResult.body, /http\.\.\.onid/);
  assert.match(rawExportResult.body, /http_lifecycle_unionid/);
  assert.doesNotMatch(downgradedRawExportResult.body, /http_lifecycle_unionid/);
  assert.match(exportResult.body, /SETTLEMENT_READY/);
  assert.match(exportResult.body, /QUALIFIED/);
  assert.equal(scheduledExport.code, 0);
  assert.equal(scheduledExport.data.executed, true);
  assert.equal(scheduledExport.data.summary.exportedCount, 1);
  assert.equal(scheduledExport.data.exportRecord.summary.truncated, false);
  assert.equal(scheduledExport.data.exportRecord.summary.sensitivity, "MASKED");
  assert.equal(scheduledExport.data.exportRecord.approvalRequired, false);
  assert.equal(scheduledExport.data.exportRecord.approvalStatus, "NOT_REQUIRED");
  assert.equal(scheduledExport.data.exportRecord.delivery.status, "NOT_REQUESTED");
  assert.equal(downgradedScheduledExport.data.summary.sensitivity, "MASKED");
  assert.equal(downgradedScheduledExport.data.summary.requestedSensitivity, "RAW");
  assert.equal(downgradedScheduledExport.data.summary.sensitivityDowngraded, true);
  assert.equal(scheduledExportsBeforeDownload.data.some((item) => item.exportId === scheduledExport.data.exportRecord.exportId && item.downloadCount === 0), true);
  assert.equal(scheduledExportDownload.status, 200);
  assert.match(scheduledExportDownload.contentType, /text\/csv/);
  assert.doesNotMatch(scheduledExportDownload.body, /http_lifecycle_unionid/);
  assert.equal(scheduledExportsAfterDownload.data.some((item) => item.exportId === scheduledExport.data.exportRecord.exportId && item.downloadCount === 1), true);
  assert.equal(operatorDelivery.code, 40301);
  assert.equal(deliveredScheduledExport.code, 0);
  assert.equal(deliveredScheduledExport.data.delivered, true);
  assert.equal(deliveredScheduledExport.data.delivery.status, "DELIVERED");
  assert.match(deliveredScheduledExport.data.delivery.externalRef, /\/api\/v1\/admin\/lifecycle-user-exports\//);
  assert.equal(signedScheduledExport.code, 0);
  assert.equal(signedScheduledExport.data.delivered, true);
  assert.equal(signedScheduledExport.data.delivery.status, "DELIVERED");
  assert.match(signedScheduledExport.data.delivery.externalRef, /\/api\/v1\/lifecycle-user-exports\/.+\/signed-download\?expires=/);
  assert.doesNotMatch(signedScheduledExport.data.delivery.externalRef, /\/api\/v1\/admin\//);
  assert.equal(signedScheduledExport.data.delivery.target.signedDownload, true);
  assert.equal(signedScheduledDownload.status, 200);
  assert.match(signedScheduledDownload.contentType, /text\/csv/);
  assert.match(signedScheduledDownload.body, /root_user_id,user_id,nickname,phone/);
  assert.doesNotMatch(signedScheduledDownload.body, /http_lifecycle_unionid/);
  assert.equal(signedScheduledDownloadInvalid.code, 8042);
  assert.equal(deliveredWebhookExport.code, 0);
  assert.equal(deliveredWebhookExport.data.delivered, true);
  assert.equal(deliveredWebhookExport.data.delivery.status, "DELIVERED");
  assert.equal(deliveredWebhookExport.data.delivery.externalRef, "HTTP 202");
  assert.equal(deliveredWebhookExport.data.delivery.target.webhookChannel, "WEWORK");
  assert.equal(deliveredWebhookExport.data.delivery.target.webhookTemplate, "lifecycle_export_ready");
  assert.equal(deliveredWebhookExport.data.delivery.target.webhookStatusCode, 202);
  assert.equal(deliveredWebhookExport.data.delivery.target.webhookSigned, true);
  assert.equal(deliveredWebhookExport.data.delivery.target.signedDownload, true);
  assert.match(deliveredWebhookExport.data.delivery.target.signedDownloadUrlPreview, /\/api\/v1\/lifecycle-user-exports\/.+\/signed-download/);
  assert.equal(deliveredWebhookExport.data.delivery.target.webhookResponsePreview, "accepted http lifecycle export");
  assert.equal(lifecycleWebhookCalls.filter((call) => call.url === "https://hooks.example.com/http-lifecycle-export").length, 1);
  assert.equal(lifecycleWebhookCalls[0].url, "https://hooks.example.com/http-lifecycle-export");
  assert.equal(lifecycleWebhookCalls[0].init.headers["X-Root-Export-Webhook-Channel"], "WEWORK");
  assert.equal(lifecycleWebhookCalls[0].init.headers["X-Root-Export-Webhook-Template"], "lifecycle_export_ready");
  assert.equal(lifecycleWebhookCalls[0].init.headers["X-Root-Export-Signed-Download"], "true");
  assert.ok(lifecycleWebhookCalls[0].init.headers["X-Root-Export-Signature"]);
  assert.match(lifecycleWebhookPayload.export.signedDownloadUrl, /\/api\/v1\/lifecycle-user-exports\/.+\/signed-download\?expires=/);
  assert.doesNotMatch(lifecycleWebhookPayload.export.signedDownloadUrl, /\/api\/v1\/admin\//);
  assert.equal(lifecycleWebhookPayload.delivery.webhookChannel, "WEWORK");
  assert.equal(lifecycleWebhookPayload.delivery.webhookTemplate, "lifecycle_export_ready");
  assert.equal(lifecycleWebhookPayload.delivery.signedDownload, true);
  assert.equal(Boolean(lifecycleWebhookPayload.csvText), false);
  assert.equal(retryScheduledExport.code, 0);
  assert.equal(retryScheduledExport.data.delivered, false);
  assert.equal(retryScheduledExport.data.delivery.status, "RETRY_SCHEDULED");
  assert.equal(retryScheduledExport.data.delivery.externalRef, "HTTP 500");
  assert.equal(retryScheduledExport.data.delivery.attemptCount, 1);
  assert.equal(retryScheduledExport.data.delivery.nextRetryAt, "2026-06-20T08:22:00+08:00");
  assert.equal(deliveryHealthBeforeRetry.code, 0);
  assert.equal(deliveryHealthBeforeRetry.data.status, "WARNING");
  assert.equal(deliveryHealthBeforeRetry.data.summary.retryScheduledCount, 1);
  assert.equal(deliveryHealthBeforeRetry.data.summary.dueRetryCount, 1);
  assert.equal(deliveryHealthBeforeRetry.data.channels.some((item) => item.channel === "WEBHOOK" && item.dueRetry === 1), true);
  assert.equal(exportDeliveryRetryPreview.ok, true);
  assert.equal(exportDeliveryRetryPreview.data.selectedCount, 1);
  assert.equal(exportDeliveryRetryPreview.data.candidates[0].exportId, retryWebhookExport.data.exportRecord.exportId);
  assert.equal(exportDeliveryRetryExecuted.ok, true);
  assert.equal(exportDeliveryRetryExecuted.data.executed, true);
  assert.equal(exportDeliveryRetryExecuted.data.deliveredCount, 1);
  assert.equal(exportDeliveryRetryExecuted.data.results[0].status, "DELIVERED");
  assert.equal(deliveryHealthAfterRetry.code, 0);
  assert.equal(deliveryHealthAfterRetry.data.summary.dueRetryCount, 0);
  assert.equal(deliveryHealthAfterRetry.data.channels.some((item) => item.channel === "WEBHOOK" && item.delivered >= 1 && item.dueRetry === 0), true);
  assert.equal(determineLifecycleUserExportsDeliveryRetryExitCode(exportDeliveryRetryExecuted), 0);
  assert.match(exportDeliveryRetryReport, /ROOT 用户生命周期导出交付重试报告/);
  assert.match(exportDeliveryRetryReport, /http-lifecycle-users-export-delivery-retry-1/);
  assert.equal(deliveredObjectExport.code, 0);
  assert.equal(deliveredObjectExport.data.delivered, true);
  assert.equal(deliveredObjectExport.data.delivery.status, "DELIVERED");
  assert.equal(deliveredObjectExport.data.delivery.target.adapter, "FILESYSTEM");
  assert.match(deliveredObjectExport.data.delivery.target.objectKey, /^http-lifecycle-exports\//);
  assert.equal(fs.existsSync(deliveredObjectPath()), true);
  assert.match(fs.readFileSync(deliveredObjectPath(), "utf8"), /root_user_id,user_id,nickname,phone/);
  assert.equal(exportCleanupDenied.code, 40301);
  assert.equal(exportCleanupPreview.ok, true);
  assert.equal(exportCleanupPreview.data.candidates.some((item) => item.exportId === expiredObjectExport.data.exportRecord.exportId && item.delivery.objectKey), true);
  assert.equal(exportCleanupMissingRequestId.code, 400);
  assert.equal(exportCleanupExecuted.ok, true);
  assert.equal(exportCleanupExecuted.data.executed, true);
  assert.equal(exportCleanupExecuted.data.removedCount, 1);
  assert.equal(exportCleanupExecuted.data.objectDeletedCount, 1);
  assert.equal(determineLifecycleUserExportsCleanupExitCode(exportCleanupExecuted), 0);
  assert.match(exportCleanupReport, /ROOT 用户生命周期导出过期清理报告/);
  assert.match(exportCleanupReport, /http-lifecycle-user-exports-cleanup-1/);
  assert.equal(fs.existsSync(expiredObjectPath()), false);
  assert.equal(fs.existsSync(`${expiredObjectPath()}.metadata.json`), false);
  assert.equal(server.store.adminLifecycleUserExports.some((item) => item.export_id === expiredObjectExport.data.exportRecord.exportId), false);
  assert.equal(rawApprovalExport.data.exportRecord.summary.sensitivity, "RAW");
  assert.equal(rawApprovalExport.data.exportRecord.approvalRequired, true);
  assert.equal(rawApprovalExport.data.exportRecord.approvalStatus, "PENDING");
  assert.equal(rawApprovalDownloadBefore.code, 8033);
  assert.equal(rawApprovalDeliveryBefore.code, 8037);
  assert.equal(operatorApproval.code, 40301);
  assert.equal(approvedRawExport.data.approved, true);
  assert.equal(approvedRawExport.data.exportRecord.approvalStatus, "APPROVED");
  assert.equal(rawApprovalDownloadAfter.status, 200);
  assert.match(rawApprovalDownloadAfter.body, /http_lifecycle_unionid/);
  assert.equal(rawApprovalDeliveryAfter.data.delivered, true);
  assert.equal(rawApprovalDeliveryAfter.data.delivery.status, "DELIVERED");
  assert.equal(exportJobMissingRequestId.code, 400);
  assert.equal(exportJobDryRun.ok, true);
  assert.equal(exportJobDryRun.data.dryRun, true);
  assert.equal(exportJobExecuted.ok, true);
  assert.equal(exportJobExecuted.data.executed, true);
  assert.equal(exportJobExecuted.data.summary.sensitivity, "MASKED");
  assert.equal(determineLifecycleUsersExportExitCode(exportJobExecuted), 0);
  assert.match(exportJobReport, /ROOT 用户生命周期定时导出报告/);
  assert.match(exportJobReport, /http-lifecycle-users-export-job-1/);
  assert.match(exportJobReport, /字段策略：MASKED/);
  assert.equal(savedPreset.code, 0);
  assert.equal(savedPreset.data.created, true);
  assert.equal(savedPreset.data.preset.scope, "TEAM");
  assert.equal(savedPreset.data.preset.pinned, true);
  assert.equal(savedPreset.data.preset.sortOrder, 10);
  assert.equal(savedPreset.data.preset.filters.rewardStatus, "PENDING");
  assert.equal(personalPreset.data.preset.scope, "PERSONAL");
  assert.equal(presets.data.presets.length, 2);
  assert.equal(presets.data.presets[0].title, "HTTP 可结算待发奖");
  assert.equal(presets.data.presets[0].pinned, true);
  assert.equal(presets.data.presets[1].title, "HTTP 个人待办筛选");
  assert.equal(otherOperatorPresets.data.presets.length, 1);
  assert.equal(otherOperatorPresets.data.presets[0].scope, "TEAM");
  assert.equal(otherOperatorPresets.data.presets[0].canModify, false);
  assert.equal(copiedPreset.code, 0);
  assert.equal(copiedPreset.data.sourcePreset.presetId, savedPreset.data.preset.presetId);
  assert.equal(copiedPreset.data.preset.scope, "PERSONAL");
  assert.equal(copiedPreset.data.preset.pinned, false);
  assert.match(copiedPreset.data.preset.title, /副本/);
  assert.equal(copiedPreset.data.preset.filters.rewardStatus, "PENDING");
  assert.equal(otherOperatorPresetsAfterCopy.data.presets.some((item) => item.presetId === copiedPreset.data.preset.presetId && item.canModify === true), true);
  assert.equal(otherOperatorEdit.code, 8032);
  assert.equal(otherOperatorDelete.code, 8032);
  assert.equal(otherOperatorCopyPrivate.code, 8036);
  assert.equal(deletedPreset.data.deleted, true);
  assert.equal(deletedPreset.data.presets.length, 1);
  assert.equal(deletedPreset.data.presets[0].title, "HTTP 个人待办筛选");
  assert.equal(filterBatchPreview.code, 0);
  assert.equal(filterBatchPreview.data.source, "LIFECYCLE_FILTER");
  assert.equal(filterBatchPreview.data.selection.total, 1);
  assert.equal(filterBatchPreview.data.selection.selectedCount, 1);
  assert.equal(filterBatchPreview.data.selection.filters.limit, 1);
  assert.equal(filterBatchPreview.data.summary.total, 1);
  assert.equal(createdJob.code, 0);
  assert.equal(createdJob.data.job.status, "QUEUED");
  assert.equal(createdJob.data.job.summary.selected, 1);
  assert.equal(schedulerCandidate.code, 0);
  assert.equal(listedJobs.data.jobs.some((job) => job.jobId === createdJob.data.job.jobId), true);
  assert.equal(schedulerPreview.ok, true);
  assert.equal(schedulerPreview.data.selectedCount >= 1, true);
  assert.equal(schedulerMissingRequestId.code, 400);
  assert.equal(ranJob.code, 0);
  assert.equal(ranJob.data.job.status, "COMPLETED");
  assert.equal(ranJob.data.job.summary.processed, 1);
  assert.equal(schedulerExecuted.ok, true);
  assert.equal(schedulerExecuted.data.executedCount >= 1, true);
  assert.equal(determineLifecycleSettlementExitCode(schedulerExecuted), 0);
  assert.match(schedulerReport, /ROOT 生命周期结算队列 Job 报告/);
  assert.match(schedulerReport, /http-lifecycle-scheduler-run-1/);
  assert.equal(cleanupPreview.ok, true);
  assert.ok(cleanupPreview.data.candidates.some((item) => item.jobId === "lsj_http_cleanup_running" && item.cleanupAction === "RESET_TO_QUEUED"));
  assert.equal(cleanupMissingRequestId.code, 400);
  assert.equal(cleanupExecuted.ok, true);
  assert.equal(cleanupExecuted.data.resetCount, 1);
  assert.equal(determineLifecycleSettlementCleanupExitCode(cleanupExecuted), 0);
  assert.match(cleanupReport, /ROOT 生命周期结算队列超时清理报告/);
  assert.equal(server.store.adminLifecycleSettlementJobs.find((job) => job.job_id === "lsj_http_cleanup_running").status, "QUEUED");
  assert.equal(cancelledJob.data.job.status, "CANCELLED");
  assert.equal(server.store.auditLogs.some((log) => log.action === "ADMIN_LIFECYCLE_FILTER_PRESET_UPSERT"), true);
  assert.equal(server.store.auditLogs.some((log) => log.action === "ADMIN_LIFECYCLE_FILTER_PRESET_DELETE"), true);
  assert.equal(server.store.auditLogs.some((log) => log.action === "ADMIN_LIFECYCLE_FILTER_PRESET_COPY"), true);
  assert.equal(server.store.auditLogs.some((log) => log.action === "ADMIN_LIFECYCLE_USER_EXPORT_RUN"), true);
  assert.equal(server.store.auditLogs.some((log) => log.action === "ADMIN_LIFECYCLE_USER_EXPORT_DOWNLOAD"), true);
  assert.equal(server.store.auditLogs.some((log) => log.action === "ADMIN_LIFECYCLE_USER_EXPORT_APPROVAL"), true);
  assert.equal(server.store.auditLogs.some((log) => log.action === "ADMIN_LIFECYCLE_USER_EXPORT_DELIVERY"), true);
  assert.equal(server.store.auditLogs.some((log) => log.action === "ADMIN_LIFECYCLE_USER_EXPORT_CLEANUP"), true);
  assert.equal(server.store.auditLogs.some((log) => log.action === "ADMIN_LIFECYCLE_SETTLEMENT_JOB_CREATE"), true);
  assert.equal(server.store.auditLogs.some((log) => log.action === "ADMIN_LIFECYCLE_SETTLEMENT_JOB_RUN"), true);
  assert.equal(server.store.auditLogs.some((log) => log.action === "ADMIN_LIFECYCLE_SETTLEMENT_JOB_TIMEOUT_CLEANUP"), true);
  assert.equal(server.store.auditLogs.some((log) => log.action === "ADMIN_LIFECYCLE_SETTLEMENT_JOB_CANCEL"), true);
});

test("admin settlement batch HTTP Interface requires request id and is idempotent", async (t) => {
  const server = createApp({
    env: {
      ROOT_ALLOW_OPENID_LOGIN: "true",
      ROOT_ADMIN_TOKEN: "secret-admin",
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());
  const adminHeaders = { "X-Admin-Token": "secret-admin" };

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({
      openid: "http_batch_settlement_openid",
      unionid: "http_batch_settlement_unionid",
      appCode: "MYROOT",
    }),
  });
  const rootUserId = login.data.user.rootUserId;
  const auth = { Authorization: `Bearer ${login.data.token}` };
  await request(baseUrl, "/api/v1/campaigns/join", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ sourceChannel: "ROADSHOW_QR" }),
  });
  for (let day = 0; day < 7; day += 1) {
    const taskDate = `2026-06-${String(19 + day).padStart(2, "0")}`;
    await request(baseUrl, "/api/v1/tasks/events", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        taskType: "CHECKIN",
        taskDate,
        payload: { taskDate },
        idempotencyKey: `http-batch-settlement-checkin-${day + 1}`,
      }),
    });
  }
  await request(baseUrl, "/api/v1/tasks/events", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      taskType: "QUESTIONNAIRE",
      taskDate: "2026-06-26",
      payload: { questionnaireType: "DAY8_SUMMARY" },
      idempotencyKey: "http-batch-settlement-day8",
    }),
  });

  const preview = await request(baseUrl, "/api/v1/admin/settlement/batch-preview", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ rootUserIds: [rootUserId] }),
  });
  const missingConfirm = await request(baseUrl, "/api/v1/admin/settlement/batch-execute", {
    method: "POST",
    headers: { ...adminHeaders, "X-Request-Id": "http-batch-settlement-no-confirm" },
    body: JSON.stringify({ rootUserIds: [rootUserId] }),
  });
  const executed = await request(baseUrl, "/api/v1/admin/settlement/batch-execute", {
    method: "POST",
    headers: { ...adminHeaders, "X-Request-Id": "http-batch-settlement-1" },
    body: JSON.stringify({ rootUserIds: [rootUserId], confirmRisk: true, reason: "HTTP 批量结算" }),
  });
  const repeated = await request(baseUrl, "/api/v1/admin/settlement/batch-execute", {
    method: "POST",
    headers: { ...adminHeaders, "X-Request-Id": "http-batch-settlement-1" },
    body: JSON.stringify({ rootUserIds: [rootUserId], confirmRisk: true, reason: "HTTP 批量结算" }),
  });

  assert.equal(preview.data.summary.qualified, 1);
  assert.equal(missingConfirm.code, 8012);
  assert.equal(executed.code, 0);
  assert.equal(executed.data.summary.executed, 1);
  assert.equal(repeated.data.audit.audit_log_id, executed.data.audit.audit_log_id);
  assert.equal(server.store.settlementRecords.length, 1);
  assert.equal(server.store.auditLogs.filter((log) => log.action === "BATCH_SETTLEMENT_EXECUTE").length, 1);
  assert.equal(server.store.auditLogs[0].target_id, "http-batch-settlement-1");
});

test("rebuild feature flag can keep legacy unregistered route over HTTP", async (t) => {
  const server = createApp({
    env: {
      ROOT_ALLOW_OPENID_LOGIN: "true",
      MYROOT_REBUILD_ENABLED: "false",
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ openid: "http_legacy_route_openid", appCode: "MYROOT" }),
  });
  const state = await request(baseUrl, "/api/v1/user/state", {
    headers: { Authorization: `Bearer ${login.data.token}` },
  });

  assert.equal(login.data.nextRoute, "/pages/home/index");
  assert.equal(login.data.features.myRootRebuildEnabled, false);
  assert.equal(state.data.route, "/pages/home/index");
});

test("HTTP login rejects direct phone payload when direct phone login is not enabled", async (t) => {
  const server = createApp();
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone: "13800000001" }),
  });

  assert.equal(login.code, 1007);
  assert.match(login.message, /微信手机号授权/);
});

test("admin order matching HTTP Interface searches, previews, and confirms", async (t) => {
  const server = createApp({ env: directPhoneLoginEnv });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone: "13800000001" }),
  });
  await request(baseUrl, "/api/v1/user/profile", {
    method: "POST",
    headers: { Authorization: `Bearer ${login.data.token}` },
    body: JSON.stringify({
      joinReasons: ["health"],
      gutHealthStatus: "normal",
      improvementMethods: ["diet"],
      stoolType: "type4",
    }),
  });

  const search = await request(baseUrl, "/api/v1/admin/order-matching/search?q=YZROOT202604260001");
  const preview = await request(baseUrl, "/api/v1/admin/order-matching/preview", {
    method: "POST",
    body: JSON.stringify({ orderId: "ord_root_001", userId: login.data.user.userId }),
  });
  const confirmed = await request(baseUrl, "/api/v1/admin/order-matching/confirm", {
    method: "POST",
    body: JSON.stringify({ orderId: "ord_root_001", userId: login.data.user.userId }),
  });

  assert.equal(search.code, 0);
  assert.equal(search.data.orders[0].youzanOrderNo, "YZROOT202604260001");
  assert.equal(preview.code, 0);
  assert.equal(preview.data.canConfirm, true);
  assert.equal(confirmed.code, 0);
  assert.equal(confirmed.data.order.userId, login.data.user.userId);
  assert.equal(confirmed.data.task.task_type, "DELIVERED_NOT_STARTED");
});

test("admin order after-sales HTTP Interface mirrors refund status and recovery", async (t) => {
  const server = createApp({ env: directPhoneLoginEnv });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone: "13800000931" }),
  });
  const auth = { Authorization: `Bearer ${login.data.token}` };
  const syncedOrder = await request(baseUrl, "/api/v1/admin/orders/sync", {
    method: "POST",
    body: JSON.stringify({
      userId: login.data.user.userId,
      youzanOrderNo: "YZ_HTTP_AFTER_SALES_001",
      receiverPhone: "13800000931",
      receiverName: "HTTP售后用户",
      amount: 199,
      deliveryStatus: "DELIVERED",
    }),
  });
  server.store.rewardGrants.push({
    reward_grant_id: "rgr_http_after_sales_001",
    root_user_id: login.data.user.rootUserId,
    campaign_id: "ROOT_7D_RESET",
    settlement_record_id: "stl_http_after_sales_001",
    order_id: syncedOrder.data.order.orderId,
    reward_type: "COUPON",
    reward_key: "http_after_sales_coupon",
    quota_key: "",
    quota_limit: 0,
    inventory_reservation_id: "",
    title: "HTTP售后追回券",
    description: "",
    status: "PENDING_DELIVERY",
    external_status: "",
    external_ref: "",
    recovery_status: "",
    recovery_reason: "",
    recovery_record_id: "",
    recovered_at: "",
    payload_json: {},
    idempotency_key: "rgr-http-after-sales-001",
    created_at: "2026-06-20T10:00:00.000Z",
    updated_at: "2026-06-20T10:00:00.000Z",
  });
  server.store.rewardGrants.push({
    reward_grant_id: "rgr_http_after_sales_unrelated_001",
    root_user_id: login.data.user.rootUserId,
    campaign_id: "ROOT_7D_RESET",
    settlement_record_id: "stl_http_after_sales_unrelated_001",
    order_id: "ord_http_after_sales_unrelated_001",
    reward_type: "COUPON",
    reward_key: "http_after_sales_unrelated_coupon",
    quota_key: "",
    quota_limit: 0,
    inventory_reservation_id: "",
    title: "HTTP不相关售后券",
    description: "",
    status: "PENDING_DELIVERY",
    external_status: "",
    external_ref: "",
    recovery_status: "",
    recovery_reason: "",
    recovery_record_id: "",
    recovered_at: "",
    payload_json: {},
    idempotency_key: "rgr-http-after-sales-unrelated-001",
    created_at: "2026-06-20T10:00:00.000Z",
    updated_at: "2026-06-20T10:00:00.000Z",
  });
  server.store.refundWorkItems.push({
    refund_work_item_id: "rwi_http_after_sales_001",
    session_id: "session_http_after_sales_001",
    user_id: login.data.user.userId,
    order_id: syncedOrder.data.order.orderId,
    youzan_order_no: syncedOrder.data.order.youzanOrderNo,
    amount: 199,
    status: "PENDING",
    created_at: "2026-06-20T10:00:00.000Z",
    paid_at: "",
    note: "",
  });

  const requested = await request(baseUrl, "/api/v1/admin/order-after-sales/upsert", {
    method: "POST",
    headers: { "X-Request-Id": "http-after-sales-requested-1" },
    body: JSON.stringify({
      youzanOrderNo: "YZ_HTTP_AFTER_SALES_001",
      afterSalesNo: "AS_HTTP_001",
      rawStatus: "WAIT_SELLER_AGREE",
      refundAmount: 199,
      reason: "用户申请售后",
      requestId: "http-after-sales-requested-1",
    }),
  });
  const refunded = await request(baseUrl, "/api/v1/admin/order-after-sales/upsert", {
    method: "POST",
    headers: { "X-Request-Id": "http-after-sales-refunded-1" },
    body: JSON.stringify({
      youzanOrderNo: "YZ_HTTP_AFTER_SALES_001",
      afterSalesNo: "AS_HTTP_001",
      rawStatus: "REFUND_SUCCESS",
      refundAmount: 199,
      reason: "有赞售后退款成功",
      requestId: "http-after-sales-refunded-1",
    }),
  });
  const batch = await request(baseUrl, "/api/v1/admin/order-after-sales/sync", {
    method: "POST",
    headers: { "X-Request-Id": "http-after-sales-batch-1" },
    body: JSON.stringify({
      requestId: "http-after-sales-batch-1",
      records: [{
        youzanOrderNo: "YZ_HTTP_AFTER_SALES_001",
        afterSalesNo: "AS_HTTP_002",
        rawStatus: "PARTIAL_REFUNDED",
        refundAmount: 20,
        reason: "部分退款记录",
      }],
    }),
  });
  const records = await request(baseUrl, "/api/v1/admin/order-after-sales?youzanOrderNo=YZ_HTTP_AFTER_SALES_001");
  const userOrders = await request(baseUrl, "/api/v1/user/orders", { headers: auth });

  assert.equal(syncedOrder.code, 0);
  assert.equal(requested.code, 0);
  assert.equal(requested.data.record.status, "REQUESTED");
  assert.equal(requested.data.followTask.task_type, "ORDER_AFTER_SALES_FOLLOW");
  assert.equal(refunded.code, 0);
  assert.equal(refunded.data.record.status, "REFUNDED");
  assert.equal(refunded.data.refundWorkItem.status, "PAID");
  assert.equal(refunded.data.rewardRecovery.createdCount, 1);
  assert.equal(batch.code, 0);
  assert.equal(batch.data.total, 1);
  assert.equal(records.code, 0);
  assert.equal(records.data.records.length, 2);
  assert.equal(userOrders.data.orders.some((order) => order.youzanOrderNo === "YZ_HTTP_AFTER_SALES_001" && order.afterSalesStatus === "PARTIAL_REFUND"), true);
  assert.equal(server.store.rewardGrants.find((grant) => grant.reward_grant_id === "rgr_http_after_sales_001").status, "REVOKED");
  assert.equal(server.store.rewardGrants.find((grant) => grant.reward_grant_id === "rgr_http_after_sales_unrelated_001").status, "PENDING_DELIVERY");
  assert.equal(validateSnapshot(server.store).valid, true);
});

test("admin bulk order paste previews and imports orders into matching queue", async (t) => {
  const server = createApp({ env: directPhoneLoginEnv });
  const baseUrl = await listen(server);
  t.after(() => server.close());
  const text = [
    "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
    "YZROOT202605250001,批量用户,13800025001,ROOT 7日试饮装,199,已支付,已发货,上海市批量地址",
    "YZROOT202605250002,缺手机号用户,,ROOT 7日试饮装,199,已支付,已发货,上海市批量地址2",
  ].join("\n");

  const preview = await request(baseUrl, "/api/v1/admin/external-samples/preview", {
    method: "POST",
    body: JSON.stringify({ sourceType: "YOUZAN_ORDER", text }),
  });
  const imported = await request(baseUrl, "/api/v1/admin/external-samples/import", {
    method: "POST",
    body: JSON.stringify({ sourceType: "YOUZAN_ORDER", text }),
  });
  const dashboard = await request(baseUrl, "/api/v1/admin/dashboard");

  assert.equal(preview.code, 0);
  assert.equal(preview.data.total, 2);
  assert.equal(preview.data.importableCount, 1);
  assert.equal(preview.data.errorCount, 1);
  assert.equal(imported.data.importedCount, 1);
  assert.ok(dashboard.data.opsDashboard.pendingOrders.some((order) => order.youzanOrderNo === "YZROOT202605250001"));

  const rawYouzanExport = [
    "订单号,订单状态,全部商品名称,订单实付金额,买家付款时间,收货人/提货人,收货人手机号/提货人手机号,详细收货地址/提货地址",
    "E20260525220543065306159,已发货,LinkVital益生元饮 7天身体重启计划(1件),99.00,2026-05-25 22:05:57,Alex,13811611060,北京市北京市西城区北京市金泰鑫桥大厦 608",
  ].join("\n");
  const rawPreview = await request(baseUrl, "/api/v1/admin/external-samples/preview", {
    method: "POST",
    body: JSON.stringify({ sourceType: "YOUZAN_ORDER", text: rawYouzanExport }),
  });
  assert.equal(rawPreview.code, 0);
  assert.equal(rawPreview.data.importableCount, 1);
  assert.equal(rawPreview.data.rows[0].mapped.youzanOrderNo, "E20260525220543065306159");
  assert.equal(rawPreview.data.rows[0].mapped.receiverPhone, "13811611060");
  assert.equal(rawPreview.data.rows[0].mapped.deliveryStatus, "SHIPPED");
});

test("admin Youzan customer samples import into customer mirror", async (t) => {
  const server = createApp({
    env: verifiedWechatTestEnv,
    trustedWechatIdentityAdapter: verifiedCloudbaseHeaderIdentityAdapter,
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());
  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    headers: {
      "x-wx-openid": "http_youzan_customer_openid",
      "x-wx-unionid": "http_youzan_customer_unionid",
    },
    body: JSON.stringify({
      appCode: "MYROOT",
    }),
  });
  const text = [
    "有赞客户ID,unionid,手机号,昵称",
    "yz_http_customer_001,http_youzan_customer_unionid,13800055101,HTTP客户",
  ].join("\n");

  const imported = await request(baseUrl, "/api/v1/admin/external-samples/import", {
    method: "POST",
    body: JSON.stringify({ sourceType: "YOUZAN_CUSTOMER", text }),
  });
  const customers = await request(baseUrl, "/api/v1/admin/youzan-customers?keyword=yz_http_customer_001");

  assert.equal(imported.code, 0);
  assert.equal(imported.data.importedCount, 1);
  assert.equal(customers.code, 0);
  assert.equal(customers.data.customers[0].youzanYzUid, "yz_http_customer_001");
  assert.equal(customers.data.customers[0].rootUserId, login.data.user.rootUserId);
  assert.equal(customers.data.customers[0].matchSource, "UNIONID");
  assert.equal(customers.data.customers[0].linkStatus, "LINKED");
  assert.equal(customers.data.customers[0].orderSummary.totalOrders, 0);
});

test("admin CSV import batches preview, confirm once, and expose batch detail", async (t) => {
  const server = createApp({ env: directPhoneLoginEnv });
  const baseUrl = await listen(server);
  t.after(() => server.close());
  const text = [
    "订单号,订单状态,订单实付金额,全部商品名称,收货人/提货人,收货人手机号/提货人手机号,详细收货地址/提货地址",
    "YZROOT202605280001,待发货,199,ROOT 7日试饮装,批次用户,13800028001,批次地址",
    "YZROOT202605280002,待发货,199,ROOT 7日试饮装,缺手机号,,批次地址",
  ].join("\n");

  const preview = await request(baseUrl, "/api/v1/admin/imports/preview", {
    method: "POST",
    body: JSON.stringify({ sourceType: "YOUZAN_ORDER", text, fileName: "youzan.csv" }),
  });
  const beforeConfirm = await request(baseUrl, "/api/v1/admin/dashboard");
  const confirmed = await request(baseUrl, `/api/v1/admin/imports/${preview.data.batchId}/confirm`, {
    method: "POST",
    body: JSON.stringify({ operatorId: "ops" }),
  });
  const confirmedAgain = await request(baseUrl, `/api/v1/admin/imports/${preview.data.batchId}/confirm`, {
    method: "POST",
    body: JSON.stringify({ operatorId: "ops" }),
  });
  const failureCsv = await textRequest(baseUrl, `/api/v1/admin/imports/${preview.data.batchId}/failures.csv`);
  const detail = await request(baseUrl, `/api/v1/admin/imports/${preview.data.batchId}`);
  const afterConfirm = await request(baseUrl, "/api/v1/admin/dashboard");
  const fulfillmentText = [
    "快递公司,获取时间,电子面单号,订单号,运输状态,收件人姓名,收件人联系方式",
    "顺丰速运,2026-05-28 19:00:00,SF202605280001,YZROOT202605280001,已签收,批次用户,13800028001",
  ].join("\n");
  const fulfillmentPreview = await request(baseUrl, "/api/v1/admin/imports/preview", {
    method: "POST",
    body: JSON.stringify({ sourceType: "FULFILLMENT", text: fulfillmentText, fileName: "fulfillment.csv" }),
  });
  const fulfillmentConfirmed = await request(baseUrl, `/api/v1/admin/imports/${fulfillmentPreview.data.batchId}/confirm`, {
    method: "POST",
    body: JSON.stringify({ operatorId: "ops" }),
  });
  const afterFulfillment = await request(baseUrl, "/api/v1/admin/dashboard");

  assert.equal(preview.code, 0);
  assert.match(preview.data.batchId, /^imp_/);
  assert.match(preview.data.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(preview.data.preview.importableCount, 1);
  assert.equal(preview.data.preview.errorCount, 1);
  assert.equal(beforeConfirm.data.orders.some((order) => order.youzanOrderNo === "YZROOT202605280001"), false);
  assert.equal(confirmed.data.status, "CONFIRMED");
  assert.equal(confirmed.data.result.importedCount, 1);
  assert.equal(confirmedAgain.data.result.importedCount, 1);
  assert.match(failureCsv.contentType, /text\/csv/);
  assert.match(failureCsv.body, /receiverPhone/);
  assert.match(failureCsv.body, /缺手机号/);
  assert.equal(detail.data.batchId, preview.data.batchId);
  assert.equal(afterConfirm.data.orders.some((order) => order.youzanOrderNo === "YZROOT202605280001"), true);
  assert.equal(afterConfirm.data.importBatches[0].batchId, preview.data.batchId);
  assert.equal(fulfillmentPreview.data.preview.importableCount, 1);
  assert.equal(fulfillmentConfirmed.data.result.importedCount, 1);
  assert.equal(
    afterFulfillment.data.orders.find((order) => order.youzanOrderNo === "YZROOT202605280001").deliveryStatus,
    "DELIVERED"
  );
  assert.equal(
    afterFulfillment.data.orders.find((order) => order.youzanOrderNo === "YZROOT202605280001").deliveryStatusLabel,
    "已送达"
  );
  assert.equal(afterFulfillment.data.importBatches[0].batchId, fulfillmentPreview.data.batchId);

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone: "13800028001" }),
  });
  const userOrders = await request(baseUrl, "/api/v1/user/orders", {
    headers: { Authorization: `Bearer ${login.data.token}` },
  });
  assert.equal(userOrders.data.orders[0].fulfillment.carrier, "顺丰速运");
  assert.equal(userOrders.data.orders[0].fulfillment.trackingNo, "SF202605280001");
});

test("admin correction HTTP Interface previews, applies, and lists audit logs", async (t) => {
  const server = createApp({ env: directPhoneLoginEnv });
  const baseUrl = await listen(server);
  t.after(() => server.close());
  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone: "13800000002" }),
  });

  const preview = await request(baseUrl, "/api/v1/admin/corrections/preview", {
    method: "POST",
    body: JSON.stringify({ action: "BIND_ORDER_USER", orderId: "ord_root_001", userId: login.data.user.userId }),
  });
  const denied = await request(baseUrl, "/api/v1/admin/corrections/apply", {
    method: "POST",
    body: JSON.stringify({ action: "BIND_ORDER_USER", orderId: "ord_root_001", userId: login.data.user.userId }),
  });
  const applied = await request(baseUrl, "/api/v1/admin/corrections/apply", {
    method: "POST",
    body: JSON.stringify({
      action: "BIND_ORDER_USER",
      orderId: "ord_root_001",
      userId: login.data.user.userId,
      reason: "HTTP修正测试",
      confirmRisk: true,
      operatorId: "ops-http",
    }),
  });
  const audit = await request(baseUrl, "/api/v1/admin/audit-logs?targetType=ORDER&targetId=ord_root_001");

  assert.equal(preview.code, 0);
  assert.equal(preview.data.requiresSecondConfirm, true);
  assert.equal(denied.code, 4206);
  assert.equal(applied.code, 0);
  assert.equal(applied.data.audit.action, "BIND_ORDER_USER");
  assert.equal(audit.data.auditLogs[0].operator_id, "ops-http");
});

test("admin operational analytics HTTP Interface exposes funnel contract", async (t) => {
  const webhookCalls = [];
  const server = createApp({
    env: {
      ...directPhoneLoginEnv,
      ROOT_OPERATIONAL_ALERT_WEBHOOK_SECRET: "http-webhook-secret",
      ROOT_OPERATIONAL_ALERT_WEBHOOK_CHANNEL: "DINGTALK",
      ROOT_OPERATIONAL_ALERT_WEBHOOK_TEMPLATE: "ops_alert",
    },
    fetchImpl: async (url, init) => {
      webhookCalls.push({ url, init });
      return { ok: false, status: 500 };
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());
  server.store.externalAdapterRuns.unshift({
    run_id: "adr_http_retry_exhausted",
    source_type: "YOUZAN_ORDER",
    adapter_kind: "YOUZAN_OPEN",
    mode: "IMPORT",
    status: "FAILED",
    total: 0,
    importable_count: 0,
    imported_count: 0,
    error_count: 0,
    warning_count: 0,
    external_count: 0,
    requested_limit: 50,
    cursor_before: "http-cursor-before",
    cursor_after: "",
    has_more: false,
    review_id: "",
    rollback_status: "NOT_AVAILABLE",
    rollback_targets: [],
    rollback_notes: [],
    rollback_result: null,
    retry_status: "RETRYABLE",
    retry_attempt: 5,
    retry_source_run_id: "",
    retry_reason: "HTTP test upstream 502",
    next_retry_at: "2026-06-19T11:00:00+08:00",
    error_code: "502",
    error_message: "HTTP test upstream 502",
    started_at: "2026-06-19T10:00:00+08:00",
    finished_at: "2026-06-19T10:01:00+08:00",
  });
  server.store.adminLifecycleSettlementJobs.unshift({
    job_id: "lsj_http_failed",
    source: "LIFECYCLE_FILTER",
    status: "COMPLETED_WITH_ERRORS",
    campaign_id: "ROOT_7D_RESET",
    request_id: "http-lifecycle-failed",
    operator_id: "ops-http",
    reason: "HTTP 运营漏斗失败队列",
    batch_size: 20,
    filters_json: { campaignId: "ROOT_7D_RESET" },
    selection_json: { total: 1, selectedCount: 1, selectionLimit: 1, truncated: false, users: [] },
    root_user_ids: ["root_http_failed"],
    processed_root_user_ids: ["root_http_failed"],
    failed_root_user_ids: ["root_http_failed"],
    items_json: [{ rootUserId: "root_http_failed", status: "ERROR", message: "HTTP failed", rewardCount: 0 }],
    last_run_json: { requestId: "http-lifecycle-failed-run", selectedCount: 1 },
    total_count: 1,
    run_count: 1,
    error_message: "HTTP failed",
    created_at: "2026-06-19T10:10:00+08:00",
    updated_at: "2026-06-19T10:12:00+08:00",
    started_at: "2026-06-19T10:10:00+08:00",
    finished_at: "2026-06-19T10:12:00+08:00",
    cancelled_at: "",
  });
  server.store.adminLifecycleSettlementJobs.unshift({
    job_id: "lsj_http_stalled",
    source: "LIFECYCLE_FILTER",
    status: "RUNNING",
    campaign_id: "ROOT_7D_RESET",
    request_id: "http-lifecycle-stalled",
    operator_id: "ops-http",
    reason: "HTTP 运营漏斗卡住队列",
    batch_size: 20,
    filters_json: { campaignId: "ROOT_7D_RESET" },
    selection_json: { total: 1, selectedCount: 1, selectionLimit: 1, truncated: false, users: [] },
    root_user_ids: ["root_http_stalled"],
    processed_root_user_ids: [],
    failed_root_user_ids: [],
    items_json: [],
    last_run_json: null,
    total_count: 1,
    run_count: 0,
    error_message: "",
    created_at: "2026-06-19T08:00:00+08:00",
    updated_at: "2026-06-19T08:10:00+08:00",
    started_at: "2026-06-19T08:00:00+08:00",
    finished_at: "",
    cancelled_at: "",
  });
  server.store.adminLifecycleUserExports.unshift({
    export_id: "lex_http_dead_letter",
    filename: "http_lifecycle_users_dead_letter.csv",
    created_at: "2026-06-19T09:00:00+08:00",
    expires_at: "2099-01-01T00:00:00+08:00",
    operator_id: "ops-http",
    request_id: "http-export-dead-letter",
    filters_json: { campaignId: "ROOT_7D_RESET" },
    summary_json: { exportedCount: 1, bytes: 128, sensitivity: "CONFIDENTIAL" },
    rows_json: [],
    delivery_requested: true,
    delivery_channel: "WEBHOOK",
    delivery_status: "DEAD_LETTER",
    delivery_target_json: { webhookUrlPreview: "https://hooks.example.com/http-lifecycle-export" },
    delivery_external_ref: "",
    delivery_error: "HTTP 500",
    delivery_dead_letter_reason: "max attempts reached: HTTP 500",
    delivery_delivered_at: "",
    delivery_last_attempt_at: "2026-06-19T09:03:00+08:00",
    delivery_request_id: "http-export-dead-letter",
    delivery_attempt_count: 3,
    delivery_max_attempts: 3,
    delivery_next_retry_at: "",
  });
  server.store.adminLifecycleUserExports.unshift({
    export_id: "lex_http_due_retry",
    filename: "http_lifecycle_users_due_retry.csv",
    created_at: "2026-06-19T09:10:00+08:00",
    expires_at: "2099-01-01T00:00:00+08:00",
    operator_id: "ops-http",
    request_id: "http-export-due-retry",
    filters_json: { campaignId: "ROOT_7D_RESET" },
    summary_json: { exportedCount: 1, bytes: 128, sensitivity: "CONFIDENTIAL" },
    rows_json: [],
    delivery_requested: true,
    delivery_channel: "WEBHOOK",
    delivery_status: "RETRY_SCHEDULED",
    delivery_target_json: { webhookUrlPreview: "https://hooks.example.com/http-lifecycle-export" },
    delivery_external_ref: "",
    delivery_error: "HTTP 502",
    delivery_dead_letter_reason: "",
    delivery_delivered_at: "",
    delivery_last_attempt_at: "2026-06-19T09:12:00+08:00",
    delivery_request_id: "http-export-due-retry",
    delivery_attempt_count: 1,
    delivery_max_attempts: 3,
    delivery_next_retry_at: "2020-01-01T00:00:00+08:00",
  });

  const analytics = await request(baseUrl, "/api/v1/admin/operational-analytics?campaignId=ROOT_7D_RESET&dateFrom=2026-06-19&dateTo=2026-06-30");
  const stageKeys = analytics.data.stages.map((item) => item.key);

  assert.equal(analytics.code, 0);
  assert.equal(analytics.data.filters.campaignId, "ROOT_7D_RESET");
  assert.deepEqual(analytics.data.filters.dateFrom, "2026-06-19");
  assert.ok(stageKeys.includes("wework_leads"));
  assert.ok(stageKeys.includes("registered_users"));
  assert.ok(stageKeys.includes("reward_delivered"));
  assert.ok(Array.isArray(analytics.data.bottlenecks));
  assert.ok(Array.isArray(analytics.data.recentActivity));
  assert.ok(Array.isArray(analytics.data.alerts));
  assert.ok(Array.isArray(analytics.data.trend));
  assert.ok(Array.isArray(analytics.data.retentionSegments));
  assert.ok(Array.isArray(analytics.data.charts.funnelBars));
  assert.ok(Array.isArray(analytics.data.charts.trendSeries));
  assert.ok(Array.isArray(analytics.data.charts.segmentBars));
  assert.ok(Array.isArray(analytics.data.alertRules));
  assert.ok(analytics.data.alertRules.some((item) => item.alertRuleId === "op_alert_adapter_retry_exhausted" && item.ownerRole === "研发"));
  assert.ok(analytics.data.alertRules.some((item) => item.alertRuleId === "op_alert_lifecycle_settlement_job_failed"));
  assert.ok(analytics.data.alertRules.some((item) => item.alertRuleId === "op_alert_lifecycle_settlement_job_stalled"));
  assert.ok(analytics.data.alertRules.some((item) => item.alertRuleId === "op_alert_lifecycle_export_delivery_dead_letter"));
  assert.ok(analytics.data.alertRules.some((item) => item.alertRuleId === "op_alert_lifecycle_export_delivery_due_retry"));
  assert.ok(analytics.data.alerts.some((item) => item.key === "adapter_retry_exhausted_adr_http_retry_exhausted"));
  assert.ok(analytics.data.alerts.some((item) => item.key === "lifecycle_settlement_job_failed_lsj_http_failed"));
  assert.ok(analytics.data.alerts.some((item) => item.key === "lifecycle_settlement_job_stalled_lsj_http_stalled"));
  assert.ok(analytics.data.alerts.some((item) => item.key === "lifecycle_export_delivery_health_dead_letter" && item.exportId === "lex_http_dead_letter"));
  assert.ok(analytics.data.alerts.some((item) => item.key === "lifecycle_export_delivery_health_due_retry" && item.exportId === "lex_http_due_retry"));
  assert.equal(typeof analytics.data.alertSummary.triggeredCount, "number");
  assert.ok(analytics.data.distributions.taskType);

  const rule = await request(baseUrl, "/api/v1/admin/operational-alert-rules/upsert", {
    method: "POST",
    headers: { "X-Request-Id": "http-operational-alert-rule-1" },
    body: JSON.stringify({
      alertRuleId: "op_alert_unresolved_leads",
      title: "企微线索未补链",
      targetType: "BOTTLENECK",
      targetKey: "unresolved_leads",
      metricKey: "count",
      operator: ">",
      thresholdValue: 10,
      severity: "warning",
      channel: "IN_APP",
      ownerRole: "运营主管",
      ownerName: "HTTP Ops",
      ownerContact: "wecom:http-ops",
      routeKey: "ops:http-unresolved-leads",
      status: "ACTIVE",
    }),
  });
  const webhookRule = await request(baseUrl, "/api/v1/admin/operational-alert-rules/upsert", {
    method: "POST",
    headers: { "X-Request-Id": "http-operational-alert-webhook-rule-1" },
    body: JSON.stringify({
      alertRuleId: "http_webhook_lifecycle_failed",
      title: "HTTP 生命周期结算失败外部推送",
      targetType: "LIFECYCLE_SETTLEMENT_JOB_FAILED",
      targetKey: "*",
      metricKey: "failedCount",
      operator: ">",
      thresholdValue: 0,
      severity: "danger",
      channel: "WEBHOOK",
      webhookUrl: "https://hooks.example.com/http-alert",
      ownerRole: "运营主管",
      ownerName: "HTTP Ops Lead",
      ownerContact: "wecom:http-ops-lead",
      routeKey: "ops:http-lifecycle",
      status: "ACTIVE",
    }),
  });
  const alertJobPreview = await request(baseUrl, "/api/v1/jobs/operational-alerts", {
    method: "POST",
    body: JSON.stringify({ campaignId: "ROOT_7D_RESET", dryRun: true }),
  });
  const alertJobExecute = await request(baseUrl, "/api/v1/jobs/operational-alerts", {
    method: "POST",
    headers: { "X-Request-Id": "http-operational-alert-job-1" },
    body: JSON.stringify({ campaignId: "ROOT_7D_RESET", dryRun: false }),
  });
  const alertJobRepeat = await request(baseUrl, "/api/v1/jobs/operational-alerts", {
    method: "POST",
    headers: { "X-Request-Id": "http-operational-alert-job-1" },
    body: JSON.stringify({ campaignId: "ROOT_7D_RESET", dryRun: false }),
  });
  const alertRunnerDryRunArgs = parseOperationalAlertArgs(["--base-url", baseUrl, "--campaign", "ROOT_7D_RESET"]);
  const alertRunnerExecuteArgs = parseOperationalAlertArgs(["--base-url", baseUrl, "--campaign", "ROOT_7D_RESET", "--execute", "--request-id", "http-operational-alert-runner-1"]);
  const alertRunnerDryRun = await collectOperationalAlertJob(alertRunnerDryRunArgs);
  const alertRunnerExecute = await collectOperationalAlertJob(alertRunnerExecuteArgs);
  const alertRunnerReport = buildOperationalAlertJobReport(alertRunnerExecute);

  assert.equal(rule.code, 0);
  assert.equal(rule.data.rule.thresholdValue, 10);
  assert.equal(rule.data.rule.ownerName, "HTTP Ops");
  assert.equal(rule.data.rule.routeKey, "ops:http-unresolved-leads");
  assert.equal(alertJobPreview.code, 0);
  assert.equal(alertJobExecute.code, 0);
  assert.ok(alertJobExecute.data.alerts.some((item) => item.key === "adapter_retry_exhausted_adr_http_retry_exhausted" && item.ownerRole === "研发"));
  assert.ok(alertJobExecute.data.alerts.some((item) => item.key === "lifecycle_export_delivery_health_dead_letter" && item.ownerRole === "运营主管"));
  assert.ok(alertJobExecute.data.alerts.some((item) => item.key === "lifecycle_export_delivery_health_due_retry" && item.ownerRole === "运营"));
  assert.ok(alertJobExecute.data.results.some((item) => item.notification && item.notification.owner_role === "研发"));
  assert.equal(webhookRule.code, 0);
  assert.equal(webhookRule.data.rule.channel, "WEBHOOK");
  assert.equal(webhookCalls.length >= 1, true);
  const webhookRequest = webhookCalls[0];
  const webhookBody = JSON.parse(webhookRequest.init.body);
  const webhookNotification = server.store.operationalAlertNotifications.find((item) => item.alert_rule_id === "http_webhook_lifecycle_failed");
  assert.equal(webhookRequest.url, "https://hooks.example.com/http-alert");
  assert.equal(webhookRequest.init.headers["X-Root-Alert-Channel"], "DINGTALK");
  assert.equal(webhookBody.alert.lifecycleJobId, "lsj_http_failed");
  assert.ok(webhookRequest.init.headers["X-Root-Alert-Signature"]);
  assert.ok(webhookNotification);
  assert.equal(webhookNotification.status, "FAILED");
  assert.equal(webhookNotification.error, "HTTP 500");
  assert.equal(webhookNotification.payload_json.webhook.channel, "DINGTALK");
  assert.equal(alertJobRepeat.data.run.operational_alert_run_id, alertJobExecute.data.run.operational_alert_run_id);
  assert.equal(alertRunnerDryRun.request.dryRun, true);
  assert.equal(alertRunnerExecute.request.requestId, "http-operational-alert-runner-1");
  assert.equal(alertRunnerExecute.ok, true);
  assert.equal(determineOperationalAlertExitCode(alertRunnerExecute), 3);
  assert.match(alertRunnerReport, /ROOT 运营预警 Job 报告/);
  assert.match(alertRunnerReport, /http-operational-alert-runner-1/);
  assert.match(alertRunnerReport, /HTTP 500/);

  const csv = await textRequest(baseUrl, "/api/v1/admin/operational-analytics/export?campaignId=ROOT_7D_RESET&dateFrom=2026-06-19&dateTo=2026-06-30");
  assert.equal(csv.status, 200);
  assert.match(csv.contentType, /text\/csv/);
  assert.match(csv.body, /section,key,label,date,count/);
  assert.match(csv.body, /stage,wework_leads/);
});

test("external platform adapter Interface exposes catalog and manual sample runs", async (t) => {
  const server = createApp({ env: {} });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const catalog = await request(baseUrl, "/api/v1/admin/external-adapters");
  assert.equal(catalog.code, 0);
  assert.ok(catalog.data.catalog.manualAdapters.some((item) => item.sourceType === "YOUZAN_ORDER" && item.status === "READY"));
  assert.ok(catalog.data.catalog.realAdapters.some((item) => item.adapterKind === "YOUZAN_OPEN" && item.status === "NEEDS_CONFIG"));

  const calibration = await request(baseUrl, "/api/v1/admin/adapter-calibration");
  assert.equal(calibration.code, 0);
  assert.equal(calibration.data.sources.length, 4);
  assert.ok(calibration.data.sources.some((item) => item.adapterKind === "YOUZAN_OPEN"));
  const actionCalibration = await request(baseUrl, "/api/v1/admin/action-adapter-calibration");
  assert.equal(actionCalibration.code, 0);
  assert.equal(actionCalibration.data.actions.length, 4);
  assert.equal(actionCalibration.data.status, "BLOCKED");
  assert.ok(catalog.data.catalog.manualAdapters.some((item) => item.sourceType === "YOUZAN_CUSTOMER" && item.status === "READY"));
  assert.equal(normalizeSource("wework"), "WECHAT_LEAD");
  assert.equal(normalizeSource("customer"), "YOUZAN_CUSTOMER");
  assert.equal(parseAdapterArgs(["--source", "wework"]).adapterKind, "WEWORK_CONTACT");
  assert.equal(parseAdapterArgs(["--source", "fulfillment"]).adapterKind, "FULFILLMENT_PUSH");
  assert.equal(parseAdapterArgs(["--source", "customer"]).adapterKind, "YOUZAN_CUSTOMER");

  const failedRun = await collectAdapterRun({
    baseUrl,
    sourceType: "YOUZAN_ORDER",
    adapterKind: "YOUZAN_OPEN",
    mode: "PREVIEW",
    limit: 1,
  });
  const failedRunReport = buildAdapterRunReport(failedRun);
  assert.equal(failedRun.ok, false);
  assert.match(failedRun.message, /未配置/);
  assert.equal(failedRun.latestRun.status, "FAILED");
  assert.equal(failedRun.latestRun.retry_status, "MANUAL_REVIEW");
  assert.equal(failedRun.latestRun.retry_attempt, 1);
  assert.equal(failedRun.latestRun.next_retry_at, "");
  assert.equal(determineAdapterExitCode(failedRun), 2);
  assert.match(failedRunReport, /ROOT 真实 Adapter 运行报告/);

  const run = await request(baseUrl, "/api/v1/admin/external-adapters/run", {
    method: "POST",
    body: JSON.stringify({
      sourceType: "YOUZAN_ORDER",
      adapterKind: "MANUAL_SAMPLE",
      mode: "PREVIEW",
      text: [
        "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
        "YZROOT202605170001,赵样本,13800017001,ROOT 7日试饮装,199,已支付,已发货,上海市样本地址",
      ].join("\n"),
    }),
  });
  const dashboard = await request(baseUrl, "/api/v1/admin/dashboard");
  const catalogAfterRun = await request(baseUrl, "/api/v1/admin/external-adapters");
  const reviewLookup = await request(baseUrl, `/api/v1/admin/external-sample-reviews?reviewId=${run.data.review.review_id}`);

  assert.equal(run.code, 0);
  assert.equal(run.data.run.adapter_kind, "MANUAL_SAMPLE");
  assert.equal(run.data.run.mode, "PREVIEW");
  assert.equal(run.data.result.importableCount, 1);
  assert.equal(run.data.review.mode, "ADAPTER_PREVIEW");
  assert.equal(dashboard.data.externalAdapterRuns[0].review_id, run.data.review.review_id);
  assert.equal(catalogAfterRun.data.reviews[0].review_id, run.data.review.review_id);
  assert.equal(reviewLookup.code, 0);
  assert.equal(reviewLookup.data.review.review_id, run.data.review.review_id);
  assert.equal(reviewLookup.data.review.field_coverage.youzanOrderNo.rate, 100);
  assert.equal(reviewLookup.data.review.rows.length, 1);
  assert.match(reviewLookup.data.review.rows[0].raw.有赞订单号, /已脱敏/);
  assert.equal(reviewLookup.data.review.rows[0].mapped.deliveryStatus, "SHIPPED");
});

test("admin external Adapter retry scheduler previews and executes due runs", async (t) => {
  let calls = 0;
  const server = createApp({
    env: { YOUZAN_ACCESS_TOKEN: "token", YOUZAN_ORDER_LIST_URL: "https://youzan.example/orders" },
    adapterImplementations: {
      YOUZAN_OPEN: () => {
        calls += 1;
        if (calls === 1) {
          const error = new Error("有赞上游临时不可用");
          error.code = 502;
          throw error;
        }
        return {
          samples: [
            {
              有赞订单号: "YZROOT202605170777",
              收货人: "调度重试",
              收货手机号: "13800017777",
              商品名称: "ROOT 7日试饮装",
              实付金额: "199",
              订单状态: "已支付",
              物流状态: "已发货",
              收货地址: "上海市调度重试地址",
            },
          ],
          externalCount: 1,
          nextCursor: "api-retry-cursor",
          hasMore: false,
        };
      },
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const failed = await request(baseUrl, "/api/v1/admin/external-adapters/run", {
    method: "POST",
    body: JSON.stringify({
      sourceType: "YOUZAN_ORDER",
      adapterKind: "YOUZAN_OPEN",
      mode: "PREVIEW",
      limit: 1,
    }),
  });
  const failedRun = server.store.externalAdapterRuns[0];
  failedRun.next_retry_at = "2026-05-17T10:00:00+08:00";

  const preview = await request(baseUrl, "/api/v1/admin/external-adapters/retry-due", {
    method: "POST",
    body: JSON.stringify({ dryRun: true, now: "2026-05-17T10:10:00+08:00" }),
  });
  const executed = await request(baseUrl, "/api/v1/admin/external-adapters/retry-due", {
    method: "POST",
    headers: { "X-Request-Id": "adapter-retry-api-test" },
    body: JSON.stringify({ dryRun: false, now: "2026-05-17T10:10:00+08:00" }),
  });
  const catalog = await request(baseUrl, "/api/v1/admin/external-adapters");

  assert.equal(failed.code, 502);
  assert.equal(failedRun.retry_status, "RETRYABLE");
  assert.equal(preview.code, 0);
  assert.equal(preview.data.selectedCount, 1);
  assert.equal(preview.data.executedCount, 0);
  assert.equal(executed.code, 0);
  assert.equal(executed.data.executedCount, 1);
  assert.equal(executed.data.successCount, 1);
  assert.equal(executed.data.results[0].run.retry_status, "RETRY_SUCCEEDED");
  assert.equal(executed.data.results[0].run.retry_source_run_id, failedRun.run_id);
  assert.equal(server.store.externalAdapterRuns[0].retry_source_run_id, failedRun.run_id);
  assert.equal(catalog.data.retryScheduler.selectedCount, 0);
});

test("Adapter retry job Interface supports scheduled trigger and idempotency", async (t) => {
  let calls = 0;
  const server = createApp({
    env: {
      ROOT_ADMIN_TOKENS: JSON.stringify({
        viewer: { token: "viewer-secret", role: "viewer" },
        ops: { token: "ops-secret", role: "operator" },
      }),
      YOUZAN_CLIENT_ID: "client",
      YOUZAN_ACCESS_TOKEN: "token",
      YOUZAN_ORDER_LIST_URL: "https://youzan.example/orders",
    },
    adapterImplementations: {
      YOUZAN_OPEN: () => {
        calls += 1;
        if (calls === 1) {
          const error = new Error("有赞定时重试临时失败");
          error.code = 502;
          throw error;
        }
        return {
          samples: [
            {
              有赞订单号: "YZROOT202605170888",
              收货人: "定时重试",
              收货手机号: "13800018888",
              商品名称: "ROOT 7日试饮装",
              实付金额: "199",
              订单状态: "已支付",
              物流状态: "已发货",
              收货地址: "上海市定时重试地址",
            },
          ],
          externalCount: 1,
          nextCursor: "job-retry-cursor",
          hasMore: false,
        };
      },
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  await request(baseUrl, "/api/v1/admin/external-adapters/run", {
    method: "POST",
    headers: { "X-ROOT-ADMIN-TOKEN": "ops-secret" },
    body: JSON.stringify({
      sourceType: "YOUZAN_ORDER",
      adapterKind: "YOUZAN_OPEN",
      mode: "PREVIEW",
      limit: 1,
    }),
  });
  const failedRun = server.store.externalAdapterRuns[0];
  failedRun.next_retry_at = "2026-05-17T11:00:00+08:00";

  const missingRequestId = await request(baseUrl, "/api/v1/jobs/adapter-retry-due", {
    method: "POST",
    headers: { "X-ROOT-ADMIN-TOKEN": "ops-secret" },
    body: JSON.stringify({ dryRun: false, now: "2026-05-17T11:10:00+08:00" }),
  });
  const deniedByRole = await request(baseUrl, "/api/v1/jobs/adapter-retry-due", {
    method: "POST",
    headers: { "X-ROOT-ADMIN-TOKEN": "viewer-secret" },
    body: JSON.stringify({ dryRun: true, now: "2026-05-17T11:10:00+08:00" }),
  });
  const preview = await collectAdapterRetryJob(parseAdapterRetryArgs([
    "--base-url", baseUrl,
    "--admin-token", "ops-secret",
    "--dry-run",
    "--now", "2026-05-17T11:10:00+08:00",
  ]));
  const executed = await collectAdapterRetryJob(parseAdapterRetryArgs([
    "--base-url", baseUrl,
    "--admin-token", "ops-secret",
    "--request-id", "adapter-retry-job-test",
    "--now", "2026-05-17T11:10:00+08:00",
  ]));
  const repeated = await collectAdapterRetryJob(parseAdapterRetryArgs([
    "--base-url", baseUrl,
    "--admin-token", "ops-secret",
    "--request-id", "adapter-retry-job-test",
    "--now", "2026-05-17T11:10:00+08:00",
  ]));
  const report = buildAdapterRetryJobReport(executed);

  assert.equal(missingRequestId.code, 400);
  assert.equal(deniedByRole.code, 40301);
  assert.equal(preview.ok, true);
  assert.equal(preview.data.selectedCount, 1);
  assert.equal(preview.data.executedCount, 0);
  assert.equal(determineAdapterRetryExitCode(preview), 0);
  assert.equal(executed.ok, true);
  assert.equal(executed.data.executedCount, 1);
  assert.equal(executed.data.successCount, 1);
  assert.equal(repeated.data.results[0].run.run_id, executed.data.results[0].run.run_id);
  assert.equal(parseAdapterRetryArgs(["--dry-run", "--source", "wework", "--batch-size", "3"]).sourceType, "WECHAT_LEAD");
  assert.match(report, /ROOT Adapter 到期重试 Job 报告/);
  assert.match(report, /adapter-retry-job-test/);
});

test("admin external Adapter rollback HTTP Interface enforces roles and idempotency", async (t) => {
  const server = createApp({
    env: {
      ROOT_ADMIN_TOKENS: JSON.stringify({
        viewer: { token: "viewer-secret", role: "viewer" },
        operator: { token: "operator-secret", role: "operator" },
      }),
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());
  const viewerHeaders = { "X-Admin-Token": "viewer-secret" };
  const operatorHeaders = { "X-Admin-Token": "operator-secret" };
  const text = [
    "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
    "YZ_HTTP_ROLLBACK_001,回滚用户,13800077188,ROOT 7日试饮装,199,已支付,已发货,上海市回滚地址",
  ].join("\n");

  const runDenied = await request(baseUrl, "/api/v1/admin/external-adapters/run", {
    method: "POST",
    headers: viewerHeaders,
    body: JSON.stringify({
      sourceType: "YOUZAN_ORDER",
      adapterKind: "MANUAL_SAMPLE",
      mode: "IMPORT",
      text,
    }),
  });
  const run = await request(baseUrl, "/api/v1/admin/external-adapters/run", {
    method: "POST",
    headers: operatorHeaders,
    body: JSON.stringify({
      sourceType: "YOUZAN_ORDER",
      adapterKind: "MANUAL_SAMPLE",
      mode: "IMPORT",
      text,
    }),
  });
  const denied = await request(baseUrl, "/api/v1/admin/external-adapters/rollback", {
    method: "POST",
    headers: { ...viewerHeaders, "X-Request-Id": "http-adapter-rollback-viewer" },
    body: JSON.stringify({
      runId: run.data.run.run_id,
      requestId: "http-adapter-rollback-viewer",
      confirmRisk: true,
    }),
  });
  const rolledBack = await request(baseUrl, "/api/v1/admin/external-adapters/rollback", {
    method: "POST",
    headers: { ...operatorHeaders, "X-Request-Id": "http-adapter-rollback-1" },
    body: JSON.stringify({
      runId: run.data.run.run_id,
      requestId: "http-adapter-rollback-1",
      confirmRisk: true,
      reason: "HTTP Adapter 回滚测试",
    }),
  });
  const repeated = await request(baseUrl, "/api/v1/admin/external-adapters/rollback", {
    method: "POST",
    headers: { ...operatorHeaders, "X-Request-Id": "http-adapter-rollback-1" },
    body: JSON.stringify({
      runId: run.data.run.run_id,
      requestId: "http-adapter-rollback-1",
      confirmRisk: true,
      reason: "HTTP Adapter 回滚测试",
    }),
  });
  const audit = await request(baseUrl, "/api/v1/admin/audit-logs?action=EXTERNAL_ADAPTER_RUN_ROLLBACK", {
    headers: viewerHeaders,
  });

  assert.equal(runDenied.code, 40301);
  assert.equal(run.code, 0);
  assert.equal(run.data.run.rollback_targets.length, 2);
  assert.equal(denied.code, 40301);
  assert.equal(rolledBack.code, 0);
  assert.equal(rolledBack.data.summary.status, "ROLLED_BACK");
  assert.equal(rolledBack.data.summary.rolledBack, 2);
  assert.equal(repeated.data.audit.audit_log_id, rolledBack.data.audit.audit_log_id);
  assert.equal(server.store.youzanOrders.some((order) => order.youzan_order_no === "YZ_HTTP_ROLLBACK_001"), false);
  assert.equal(audit.data.auditLogs[0].target_id, run.data.run.run_id);
  assert.equal(audit.data.auditLogs[0].operator_id, "operator");
});

test("admin order increment HTTP Interface enforces roles and idempotency", async (t) => {
  const server = createApp({
    env: {
      ROOT_ADMIN_TOKENS: JSON.stringify({
        viewer: { token: "viewer-secret", role: "viewer" },
        operator: { token: "operator-secret", role: "operator" },
      }),
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());
  const viewerHeaders = { "X-Admin-Token": "viewer-secret" };
  const operatorHeaders = { "X-Admin-Token": "operator-secret" };
  const text = [
    "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
    "YZ_HTTP_INCREMENT_001,订单增量用户,13800077101,ROOT 7日试饮装,199,已支付,已发货,上海市增量地址",
  ].join("\n");

  const preview = await request(baseUrl, "/api/v1/admin/orders/increment-preview", {
    method: "POST",
    headers: operatorHeaders,
    body: JSON.stringify({ text }),
  });
  const denied = await request(baseUrl, "/api/v1/admin/orders/increment-execute", {
    method: "POST",
    headers: { ...viewerHeaders, "X-Request-Id": "http-order-increment-viewer" },
    body: JSON.stringify({
      text,
      requestId: "http-order-increment-viewer",
      confirmRisk: true,
    }),
  });
  const executed = await request(baseUrl, "/api/v1/admin/orders/increment-execute", {
    method: "POST",
    headers: { ...operatorHeaders, "X-Request-Id": "http-order-increment-1" },
    body: JSON.stringify({
      text,
      requestId: "http-order-increment-1",
      confirmRisk: true,
      reason: "HTTP 有赞订单增量同步",
    }),
  });
  const repeated = await request(baseUrl, "/api/v1/admin/orders/increment-execute", {
    method: "POST",
    headers: { ...operatorHeaders, "X-Request-Id": "http-order-increment-1" },
    body: JSON.stringify({
      text,
      requestId: "http-order-increment-1",
      confirmRisk: true,
      reason: "HTTP 有赞订单增量同步",
    }),
  });
  const audit = await request(baseUrl, "/api/v1/admin/audit-logs?action=YOUZAN_ORDER_INCREMENT_SYNC", {
    headers: viewerHeaders,
  });

  assert.equal(preview.code, 0);
  assert.equal(preview.data.summary.importableCount, 1);
  assert.equal(preview.data.summary.importedCount, 0);
  assert.equal(denied.code, 40301);
  assert.equal(executed.code, 0);
  assert.equal(executed.data.summary.importedCount, 1);
  assert.equal(repeated.data.audit.audit_log_id, executed.data.audit.audit_log_id);
  assert.equal(server.store.youzanOrders.filter((order) => order.youzan_order_no === "YZ_HTTP_INCREMENT_001").length, 1);
  assert.equal(audit.data.auditLogs[0].target_id, "http-order-increment-1");
  assert.equal(audit.data.auditLogs[0].operator_id, "operator");
  assert.equal(server.store.auditLogs.filter((log) => log.action === "YOUZAN_ORDER_INCREMENT_SYNC").length, 1);
});

test("sample calibration report summarizes file previews and readiness", async (t) => {
  const server = createApp({ env: {} });
  const baseUrl = await listen(server);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "root-samples-"));
  const youzanFile = path.join(tempDir, "youzan.csv");
  t.after(() => server.close());

  fs.writeFileSync(youzanFile, [
    "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
    "YZROOT202605180001,样本一,13800018001,ROOT 7日试饮装,199,已支付,已发货,上海市样本地址1",
    "YZROOT202605180002,样本二,13800018002,ROOT 7日试饮装,199,已支付,已签收,上海市样本地址2",
    "YZROOT202605180003,样本三,13800018003,ROOT 7日试饮装,199,已支付,运输中,上海市样本地址3",
  ].join("\n"));

  const preview = await request(baseUrl, "/api/v1/admin/external-samples/preview", {
    method: "POST",
    body: JSON.stringify({ sourceType: "YOUZAN_ORDER", text: fs.readFileSync(youzanFile, "utf8") }),
  });
  const dashboard = await request(baseUrl, "/api/v1/admin/dashboard");
  const bundle = {
    mode: "preview",
    generatedAt: "2026-05-16T00:00:00.000Z",
    results: [{
      sourceType: "YOUZAN_ORDER",
      label: "有赞订单",
      filePath: youzanFile,
      mode: "preview",
      result: preview.data,
    }],
    adapterReadiness: dashboard.data.externalAdapterReadiness,
    adapterCalibration: dashboard.data.adapterCalibration,
  };
  const report = buildSampleCalibrationReport(bundle);

  assert.equal(preview.data.errorCount, 0);
  assert.equal(preview.data.review.decision_status, "READY");
  assert.match(report, /ROOT 真实样本准入报告/);
  assert.match(report, /有赞订单: PREVIEW/);
  assert.equal(determineSampleExitCode(bundle), 0);
  assert.equal(determineSampleExitCode(bundle, { requireAllReady: true }), 2);
});

test("JSON file store persists HTTP mutations across app restarts", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "root-store-"));
  const storePath = path.join(tempDir, "store.json");
  const firstStore = createJsonFileStore(storePath);
  const server = createApp({ storeAdapter: firstStore, env: directPhoneLoginEnv });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone: "13800000001" }),
  });
  const token = login.data.token;
  await request(baseUrl, "/api/v1/user/profile", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      joinReasons: ["health"],
      gutHealthStatus: "normal",
      improvementMethods: ["diet"],
      stoolType: "type4",
    }),
  });

  const reloadedStore = createJsonFileStore(storePath);
  const user = reloadedStore.data.users.find((item) => item.phone === "13800000001");

  assert.ok(fs.existsSync(storePath));
  assert.equal(user.state, "REGISTERED_IDLE");
  assert.equal(reloadedStore.kind, "json-file");
});

test("HTTP success is withheld and memory state rolls back when Store commit fails", async (t) => {
  const baseStore = createMemoryStore();
  const failingStore = {
    ...baseStore,
    kind: "failing-test-store",
    save() {
      throw new Error("simulated commit failure");
    },
  };
  const server = createApp({ storeAdapter: failingStore, env: directPhoneLoginEnv });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const result = await textRequest(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "13800007777" }),
  });

  assert.equal(result.status, 503);
  assert.equal(JSON.parse(result.body).code, 50301);
  assert.equal(failingStore.data.users.some((user) => user.phone === "13800007777"), false);
});

test("SQLite store persists HTTP mutations across app restarts", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "root-sqlite-store-"));
  const storePath = path.join(tempDir, "store.sqlite");
  const firstStore = createSqliteStore(storePath);
  const server = createApp({ storeAdapter: firstStore, env: directPhoneLoginEnv });
  const baseUrl = await listen(server);

  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone: "13800000002" }),
  });
  const token = login.data.token;
  await request(baseUrl, "/api/v1/user/profile", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      joinReasons: ["health"],
      gutHealthStatus: "normal",
      improvementMethods: ["diet"],
      stoolType: "type4",
    }),
  });
  await new Promise((resolve) => server.close(resolve));
  firstStore.close();

  const reloadedStore = createSqliteStore(storePath);
  const user = reloadedStore.data.users.find((item) => item.phone === "13800000002");

  assert.ok(fs.existsSync(storePath));
  assert.equal(user.state, "REGISTERED_IDLE");
  assert.equal(reloadedStore.kind, "sqlite");
  reloadedStore.close();
});
