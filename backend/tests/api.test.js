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

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

async function request(baseUrl, requestPath, options = {}) {
  const response = await fetch(`${baseUrl}${requestPath}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  return response.json();
}

async function textRequest(baseUrl, requestPath, options = {}) {
  const response = await fetch(`${baseUrl}${requestPath}`, options);
  return {
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    body: await response.text(),
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


test("formal Job HTTP Interfaces expose only retention and V1 runtime cycle", async (t) => {
  const server = createApp({
    env: { ROOT_ADMIN_JOB_TOKEN: "job-secret" },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const retiredRoutes = [
    "/api/v1/jobs/daily-audit",
    "/api/v1/jobs/checkin-reminders",
    "/api/v1/jobs/adapter-retry-due",
    "/api/v1/jobs/operational-alerts",
    "/api/v1/jobs/wework-touch-due",
    "/api/v1/jobs/lifecycle-settlement-due",
    "/api/v1/jobs/lifecycle-settlement-cleanup",
    "/api/v1/jobs/lifecycle-users-export",
    "/api/v1/jobs/lifecycle-user-exports-cleanup",
    "/api/v1/jobs/lifecycle-user-exports-delivery-retry",
    "/api/v1/jobs/youzan-identity-reconcile",
  ];
  for (const route of retiredRoutes) {
    const response = await request(baseUrl, route, {
      method: "POST",
      headers: { "X-ROOT-ADMIN-TOKEN": "job-secret" },
      body: JSON.stringify({ dryRun: true }),
    });
    assert.equal(response.code, 404, route);
  }

  const retention = await request(baseUrl, "/api/v1/jobs/health-data-retention-cleanup", {
    method: "POST",
    headers: { "X-ROOT-ADMIN-TOKEN": "job-secret" },
    body: JSON.stringify({ dryRun: true }),
  });
  assert.notEqual(retention.code, 404);

  const runtimeCycle = await request(baseUrl, "/api/v1/jobs/v1-runtime-cycle", {
    method: "POST",
    headers: { "X-ROOT-ADMIN-TOKEN": "job-secret" },
    body: JSON.stringify({ dryRun: true }),
  });
  assert.equal(runtimeCycle.code, 50351);
});

test("retired task, settlement, reward, order, check-in and legacy operations HTTP Interfaces return 404", async (t) => {
  const server = createApp({ env: { ROOT_ADMIN_TOKEN: "admin-secret" } });
  const baseUrl = await listen(server);
  t.after(() => server.close());
  const headers = { "X-Admin-Token": "admin-secret" };

  const routes = [
    ["GET", "/api/v1/tasks/progress"],
    ["POST", "/api/v1/tasks/events"],
    ["GET", "/api/v1/settlement/status"],
    ["POST", "/api/v1/settlement/evaluate"],
    ["GET", "/api/v1/notifications/checkin-reminder-template"],
    ["POST", "/api/v1/notifications/subscriptions"],
    ["GET", "/api/v1/admin/lifecycle-settlement-jobs"],
    ["POST", "/api/v1/admin/lifecycle-settlement-jobs/create"],
    ["POST", "/api/v1/admin/lifecycle-settlement-jobs/run"],
    ["POST", "/api/v1/admin/lifecycle-settlement-jobs/cancel"],
    ["POST", "/api/v1/admin/lifecycle-settlement-jobs/retry-failed"],
    ["POST", "/api/v1/admin/lifecycle-users/settlement-batch-preview"],
    ["POST", "/api/v1/admin/lifecycle-users/settlement-batch-execute"],
    ["POST", "/api/v1/admin/settlement/preview"],
    ["POST", "/api/v1/admin/settlement/batch-preview"],
    ["POST", "/api/v1/admin/settlement/batch-execute"],
    ["POST", "/api/v1/admin/reward-delivery/execute"],
    ["POST", "/api/v1/admin/reward-delivery/status-query"],
    ["GET", "/api/v1/admin/config-workbench"],
    ["POST", "/api/v1/admin/campaigns/upsert"],
    ["POST", "/api/v1/admin/task-definitions/upsert"],
    ["POST", "/api/v1/admin/campaign-rules/publish"],
    ["POST", "/api/v1/admin/manual-reviews/batch-resolve"],
    ["POST", "/api/v1/admin/manual-reviews/review-retired/resolve"],
    ["POST", "/api/v1/admin/settlement-source-invalidations/candidate-retired/resolve"],
    ["GET", "/api/v1/admin/legacy-data-migration-decisions"],
    ["POST", "/api/v1/admin/legacy-data-migration-decisions"],
    ["GET", "/api/v1/admin/legacy-data-migration-executions"],
    ["POST", "/api/v1/admin/legacy-data-migration-executions"],
    ["GET", "/api/v1/user/orders"],
    ["GET", "/api/v1/user/profile"],
    ["POST", "/api/v1/user/profile"],
    ["POST", "/api/v1/user/display-profile"],
    ["GET", "/api/v1/user/consultations"],
    ["GET", "/api/v1/campaigns/active"],
    ["POST", "/api/v1/campaigns/join"],
    ["GET", "/api/v1/products"],
    ["GET", "/api/v1/products/retired-product"],
    ["POST", "/api/v1/products/jump"],
    ["POST", "/api/v1/order/match"],
    ["POST", "/api/v1/checkin/start"],
    ["GET", "/api/v1/checkin/session"],
    ["POST", "/api/v1/checkin/submit"],
    ["GET", "/api/v1/checkin/records"],
    ["GET", "/api/v1/checkin/records/retired-record"],
    ["GET", "/api/v1/questionnaire"],
    ["GET", "/api/v1/questionnaire/answers/status"],
    ["POST", "/api/v1/questionnaire/answers"],
    ["GET", "/api/v1/questionnaire/status"],
    ["POST", "/api/v1/questionnaire/submit"],
    ["POST", "/api/v1/refund/apply"],
    ["GET", "/api/v1/refund/status"],
    ["GET", "/api/v1/coupon/status"],
    ["POST", "/api/v1/coupon/claim"],
    ["POST", "/api/v1/coupon/repurchase-click"],
    ["POST", "/api/v1/user/continue-daily"],
    ["GET", "/api/v1/daily/stats"],
    ["POST", "/api/v1/daily/submit"],
    ["GET", "/api/v1/daily/history"],
    ["GET", "/api/v1/daily/trend"],
    ["POST", "/api/v1/event/track"],
    ["POST", "/api/v1/upload/image"],
    ["GET", "/api/v1/admin/tasks"],
    ["POST", "/api/v1/admin/tasks/retired-task/complete"],
    ["POST", "/api/v1/admin/tasks/retired-task/resolve"],
    ["GET", "/api/v1/admin/order-matching/search"],
    ["POST", "/api/v1/admin/order-matching/preview"],
    ["POST", "/api/v1/admin/order-matching/confirm"],
    ["GET", "/api/v1/admin/order-after-sales"],
    ["POST", "/api/v1/admin/order-after-sales/upsert"],
    ["POST", "/api/v1/admin/order-after-sales/sync"],
    ["POST", "/api/v1/admin/orders/sync"],
    ["POST", "/api/v1/admin/orders/fulfillment"],
    ["POST", "/api/v1/admin/orders/increment-preview"],
    ["POST", "/api/v1/admin/orders/increment-execute"],
    ["POST", "/api/v1/admin/products/upsert"],
    ["POST", "/api/v1/admin/products/sync-preview"],
    ["POST", "/api/v1/admin/products/sync-execute"],
    ["POST", "/api/v1/admin/refunds/retired-refund/approve"],
    ["POST", "/api/v1/admin/coupons/retired-coupon/use"],
    ["GET", "/api/v1/admin/dashboard"],
    ["GET", "/api/v1/admin/lifecycle-filter-presets"],
    ["GET", "/api/v1/admin/lifecycle-user-exports"],
    ["GET", "/api/v1/admin/lifecycle-user-exports/delivery-health"],
    ["GET", "/api/v1/admin/lifecycle-users"],
    ["POST", "/api/v1/admin/lifecycle-user-exports/create"],
    ["POST", "/api/v1/admin/lifecycle-user-exports/review"],
    ["POST", "/api/v1/admin/lifecycle-user-exports/deliver"],
    ["POST", "/api/v1/admin/lifecycle-filter-presets/upsert"],
    ["POST", "/api/v1/admin/lifecycle-filter-presets/copy"],
    ["POST", "/api/v1/admin/lifecycle-filter-presets/delete"],
    ["GET", "/api/v1/admin/operational-analytics"],
    ["POST", "/api/v1/admin/operational-alert-rules/upsert"],
    ["GET", "/api/v1/admin/users/retired-user/detail"],
    ["POST", "/api/v1/admin/users/retired-user/follow"],
    ["GET", "/api/v1/admin/consultation-wework-writebacks"],
    ["GET", "/api/v1/admin/wework-touch-jobs"],
    ["POST", "/api/v1/admin/wework-touch-jobs/plan"],
    ["POST", "/api/v1/admin/wework-touch-jobs/run"],
    ["GET", "/api/v1/admin/consultation-advisor-assignments"],
    ["GET", "/api/v1/admin/consultation-sla"],
    ["GET", "/api/v1/admin/consultation-sla-escalations"],
    ["GET", "/api/v1/admin/consultation-advisor-workbench"],
    ["POST", "/api/v1/admin/consultation-advisor-assignments"],
    ["POST", "/api/v1/admin/consultation-wework-writebacks"],
    ["GET", "/api/v1/admin/adapter-calibration"],
    ["GET", "/api/v1/admin/action-adapter-calibration"],
    ["GET", "/api/v1/admin/external-adapters"],
    ["GET", "/api/v1/admin/youzan-customers"],
    ["POST", "/api/v1/admin/external-adapters/run"],
    ["POST", "/api/v1/admin/external-adapters/retry-due"],
    ["POST", "/api/v1/admin/external-adapters/rollback"],
    ["GET", "/api/v1/admin/external-samples/template"],
    ["GET", "/api/v1/admin/external-sample-reviews"],
    ["POST", "/api/v1/admin/external-samples/preview"],
    ["POST", "/api/v1/admin/external-samples/import"],
    ["GET", "/api/v1/admin/imports"],
    ["POST", "/api/v1/admin/imports/preview"],
    ["GET", "/api/v1/admin/imports/retired-batch"],
    ["POST", "/api/v1/admin/imports/retired-batch/confirm"],
    ["POST", "/api/v1/admin/corrections/preview"],
    ["POST", "/api/v1/admin/corrections/apply"],
    ["POST", "/api/v1/admin/external-status-mappings"],
  ];
  for (const [method, route] of routes) {
    const response = await request(baseUrl, route, {
      method,
      headers,
      body: method === "POST" ? JSON.stringify({ requestId: "retired-settlement-queue" }) : undefined,
    });
    assert.equal(response.code, 404, `${method} ${route}`);
  }

  const retiredDownloads = [
    "/api/v1/admin/lifecycle-users/export",
    "/api/v1/lifecycle-user-exports/retired-export/signed-download",
    "/api/v1/admin/lifecycle-user-exports/retired-export/download",
    "/api/v1/admin/operational-analytics/export",
    "/api/v1/admin/imports/retired-batch/failures.csv",
  ];
  for (const route of retiredDownloads) {
    const response = await textRequest(baseUrl, route, { headers });
    assert.equal(response.status, 404, `GET ${route}`);
  }
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
    template_key: "ACTIVITY_NOTIFICATION",
    template_id: "tmpl_mysql_projection",
    template_version: "v2026-06-28-test",
    grant_request_id: "activity-notification-mysql-projection",
    status: "AVAILABLE",
    idempotency_key: "SUBSCRIPTION_GRANT:usr_mysql_projection:activity-notification-mysql-projection",
    source_channel: "MYROOT",
    granted_at: "2026-07-11T10:00:00+08:00",
    created_at: "2026-07-11T10:00:00+08:00",
    updated_at: "2026-07-11T10:00:00+08:00",
    ...freezeWechatRecipientBinding(data, {
      rootUserId: "usr_mysql_projection",
      grantRequestId: "activity-notification-mysql-projection",
      templateKey: "ACTIVITY_NOTIFICATION",
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
  assert.deepEqual(manifest.jobs.map((job) => job.id), ["health_data_retention_cleanup", "v1_runtime_cycle"]);
  assert.ok(manifest.jobs.every((job) => job.http.method === "POST"));
  assert.ok(manifest.jobs.every((job) => job.http.path.startsWith("/api/v1/jobs/")));
  assert.match(manifest.jobs[0].executeCommand, /npm run health-data-retention-cleanup/);
  assert.equal(manifest.jobs[0].schedule.cron, "15 4 * * *");
  assert.equal(manifest.jobs[0].http.path, "/api/v1/jobs/health-data-retention-cleanup");
  assert.equal(manifest.jobs[0].http.body.objectCleanup, true);
  assert.equal(manifest.jobs[1].schedule.cron, "* * * * *");
  assert.equal(manifest.jobs[1].http.path, "/api/v1/jobs/v1-runtime-cycle");
  assert.equal(manifest.jobs[1].http.body.dryRun, true);
  assert.equal(manifest.jobs[1].invocation.mode, "CLOUDBASE_TIMER_ONLY");
  assert.equal(manifest.jobs[1].invocation.functionName, "myroot-v1-runtime-scheduler");
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_HEALTH_DATA_RETENTION_CLEANUP_ENABLED"), true);
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_HEALTH_DATA_RETENTION_CLEANUP_LIMIT"), true);
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_PRIVACY_CONTROLLER_NAME"), true);
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_PRIVACY_CONTACT"), true);
  assert.equal(manifest.environment.optionalEnv.includes("ROOT_V1_RUNTIME_SCHEDULER_DRY_RUN"), true);
  assert.equal(manifest.environment.optionalEnv.some((name) => /CHECKIN|LIFECYCLE|WEWORK|YOUZAN|ADAPTER_RETRY/.test(name)), false);
  assert.match(report, /ROOT 正式上线定时任务 Manifest/);
  assert.match(report, /health_data_retention_cleanup/);
  assert.match(report, /v1_runtime_cycle/);
  assert.equal(parseCloudbaseJobManifestArgs(["--base-url", "https://job.example.com/"]).baseUrl, "https://job.example.com");
  assert.equal(resolveCloudbaseJobBaseUrl({ ROOT_JOB_BASE_URL: "https://job.example.com/", ROOT_PUBLIC_BASE_URL: "https://public.example.com" }), "https://job.example.com");
  const legacyMutation = JSON.parse(JSON.stringify(manifest));
  legacyMutation.jobs.push({
    id: "checkin_reminders",
    schedule: { cron: "*/10 * * * *" },
    http: { method: "POST", path: "/api/v1/jobs/checkin-reminders" },
    requiredEnv: ["ROOT_JOB_BASE_URL"],
  });
  assert.equal(validateCloudbaseJobManifest(legacyMutation, { strict: true }).status, "FAIL");
  const versionMutation = JSON.parse(JSON.stringify(manifest));
  versionMutation.version = 1;
  assert.equal(validateCloudbaseJobManifest(versionMutation, { strict: true }).status, "FAIL");
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
    ROOT_CUTOVER_CLOUDRUN_CANDIDATE_VERIFIED: "done",
    ROOT_CUTOVER_MINIPROGRAM_TRIAL_VERIFIED: "done",
    ROOT_CUTOVER_CLOUDRUN_CANARY_VERIFIED: "done",
    ROOT_CUTOVER_RELEASE_ARTIFACT_TRACEABILITY_VERIFIED: "done",
    WECHAT_APPID: "wx-root",
    WECHAT_APPSECRET: "wechat-secret",
    ROOT_PUBLIC_BASE_URL: "https://root.example.com",
    ROOT_CLOUDBASE_ENV_ID: "root-prod",
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
  assert.equal(blocked.summary.requiredProofCount, 13);
  assert.equal(blocked.summary.blockerCount, 13);
  assert.ok(blocked.blockers.some((item) => item.includes("微信开放平台")));
  assert.equal(gray.status, "NEEDS_REVIEW");
  assert.equal(gray.summary.warningCount, 13);
  assert.equal(grayReady.status, "READY");
  assert.equal(grayReady.items[0].proofSource, "ENV");
  assert.equal(envOnlyProduction.status, "BLOCKED");
  assert.equal(envOnlyProduction.summary.readyProofCount, 0);
  assert.ok(envOnlyProduction.blockers.every((item) => item.includes("后台 VERIFIED 记录")));
  assert.equal(ready.status, "READY");
  assert.equal(ready.summary.readyProofCount, 13);
  assert.equal(ready.summary.releaseScopedProofCount, 4);
  assert.equal(ready.summary.releaseBoundReadyCount, 4);
  assert.ok(ready.items.every((item) => item.proofSource === "RECORD"));
  assert.ok(ready.items.filter((item) => item.proofScope === "ENVIRONMENT").every((item) => item.proofPolicy === "VERIFIED_RECORD_WITH_EVIDENCE"));
  assert.ok(ready.items.filter((item) => item.proofScope === "RELEASE").every((item) => item.proofPolicy === "VERIFIED_RECORD_WITH_EVIDENCE_AND_RELEASE_BINDING"));
  assert.equal(ready.items.find((item) => item.id === "cloudrun_candidate_runtime").status, "READY");
  assert.equal(ready.items.find((item) => item.id === "miniprogram_trial_core_flow").status, "READY");
  assert.equal(ready.items.find((item) => item.id === "cloudrun_canary_observation").status, "READY");
  assert.equal(ready.items.find((item) => item.id === "release_artifact_traceability").status, "READY");
  assert.equal(rotatingJobToken.items.find((item) => item.id === "cloudbase_jobs_created").status, "READY");
  assert.equal(ready.groups.find((group) => group.group === "identity").status, "READY");
  assert.equal(partial.status, "BLOCKED");
  assert.ok(partial.blockers.some((item) => item.includes("Root 会员中心 appId")));
  assert.equal(legacyProofWithoutEvidence.status, "BLOCKED");
  assert.equal(legacyProofWithoutEvidence.summary.readyProofCount, 12);
  assert.ok(legacyProofWithoutEvidence.blockers.some((item) => item.includes("缺少 evidenceRef")));
  assert.equal(staleRelease.status, "BLOCKED");
  assert.equal(staleRelease.summary.readyProofCount, 9);
  assert.equal(staleRelease.summary.releaseBoundReadyCount, 0);
  assert.equal(staleRelease.items.find((item) => item.id === "cloudbase_unionid").status, "READY");
  assert.equal(staleRelease.items.find((item) => item.id === "cloudrun_candidate_runtime").status, "BLOCKED");
  assert.ok(staleRelease.blockers.some((item) => item.includes("与当前候选 0.5.13/myroot-api-test-053 不一致")));
  assert.equal(fallbackReleaseId.status, "BLOCKED");
  assert.equal(fallbackReleaseId.summary.readyProofCount, 9);
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
      "/api/v1/jobs/v1-runtime-cycle": ["runtime-route-secret-with-strong-entropy-2026"],
    }),
    ROOT_ADMIN_JOB_TOKEN: "job-secret-with-strong-entropy-2026",
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
      "/api/v1/jobs/v1-runtime-cycle": [
        "runtime-route-old-secret-with-strong-entropy-2026",
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
  const untrustedWechatOpenApiEndpoint = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_WECHAT_OPENAPI_BASE_URL: "https://attacker.example",
  }, { target: "production" });
  const exactWechatEndpoint = buildProductionEnvMatrix({
    ...readyEnv,
    ROOT_WECHAT_OPENAPI_BASE_URL: "https://api.weixin.qq.com",
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
      "/api/v1/jobs/v1-runtime-cycle": ["   "],
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
  assert.ok(untrustedWechatOpenApiEndpoint.groups.some((group) =>
    group.id === "runtime" && group.status === "BLOCKER"));
  assert.ok(exactWechatEndpoint.groups.some((group) =>
    group.id === "runtime" && group.status === "PASS"));
  for (const invalidNotificationDelivery of [
    disabledNotificationDeliveryFoundation,
    weakNotificationReceiptKey,
    invalidNotificationReceiptKeyId,
  ]) {
    assert.ok(invalidNotificationDelivery.groups.some((group) =>
      group.id === "v1_runtime_control" && group.status === "BLOCKER"));
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
  assert.ok(ready.groups.some((group) => group.id === "root_member_center_jump" && group.status === "PASS"));
  assert.ok(ready.groups.some((group) => group.id === "order_after_sales" && group.status === "OPTIONAL"));
  assert.ok(ready.groups.some((group) => group.id === "order_after_sales" && group.optional.some((item) => item.name === "ROOT_AFTER_SALES_STATUS_MAP" && item.present)));
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

test("formal home content HTTP Interface is public and detail uses the same published item", async (t) => {
  const server = createApp();
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const home = await request(baseUrl, "/api/v1/public/content/home");
  assert.equal(home.code, 0);
  assert.equal(home.data.publicationState, "PUBLISHED");
  assert.equal(home.data.items.length, 2);
  assert.equal(home.data.items[0].assetState, "DEVELOPMENT_PLACEHOLDER");

  const detail = await request(
    baseUrl,
    `/api/v1/public/content/detail?contentId=${encodeURIComponent(home.data.items[0].contentId)}`,
  );
  assert.equal(detail.code, 0);
  assert.equal(detail.data.item.contentId, home.data.items[0].contentId);
  assert.deepEqual(detail.data.item.lines, home.data.items[0].lines);
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
        operator: { token: "operator-secret", role: "operator" },
      }),
    },
  });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const viewer = await request(baseUrl, "/api/v1/admin/me", {
    headers: { "X-Admin-Token": "viewer-secret" },
  });
  const operator = await request(baseUrl, "/api/v1/admin/me", {
    headers: { "X-Admin-Token": "operator-secret" },
  });
  const denied = await request(baseUrl, "/api/v1/admin/me", {
    headers: { "X-Admin-Token": "bad-secret" },
  });

  assert.equal(viewer.code, 0);
  assert.equal(viewer.data.operatorId, "viewer");
  assert.equal(viewer.data.role, "viewer");
  assert.deepEqual(viewer.data.capabilities.sort(), ["ADMIN_READ", "AUDIT_READ"]);
  assert.equal(operator.data.capabilities.includes("CONTENT_WRITE"), true);
  assert.equal(operator.data.capabilities.includes("HEALTH_CONTENT_WRITE"), true);
  assert.equal(operator.data.capabilities.includes("ACTIVITY_CONTENT_WRITE"), true);
  assert.equal(denied.code, 40101);
});

test("production and CloudBase admin Interface rejects unconfigured admin tokens", async (t) => {
  const productionServer = createApp({ env: { NODE_ENV: "production" } });
  const productionBaseUrl = await listen(productionServer);
  t.after(() => productionServer.close());

  const productionDenied = await request(productionBaseUrl, "/api/v1/admin/content/welcome/draft", {
    method: "POST",
    body: JSON.stringify({ requestId: "unconfigured-admin-denied" }),
  });
  assert.equal(productionDenied.code, 40101);
  assert.equal(productionServer.store.contentVersions.length, 0);

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

test("serves formal REST Interfaces and admin release evidence", async (t) => {
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

  const profile = await request(baseUrl, "/api/v1/user/formal-profile", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      nickname: "Root体验同学",
      avatarUrl: "cloud://prod-d3grtjkva76c93e00.avatars/avatar.jpg",
      birthDate: "1990-01-01",
      gender: "FEMALE",
    }),
  });
  assert.equal(profile.data.profile.nickname, "Root体验同学");
  assert.equal(profile.data.profile.avatarUrl, "cloud://prod-d3grtjkva76c93e00.avatars/avatar.jpg");
  assert.equal(profile.data.profile.complete, true);

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
  assert.equal(releaseRecord.data.evidence.productionCutoverReadiness.summary.requiredProofCount, 13);
  assert.ok(releaseRecord.data.evidence.productionCutoverReadiness.items.some((item) => item.proofEnv === "ROOT_CUTOVER_CLOUDBASE_UNIONID_VERIFIED"));
  assert.equal(releaseRecord.data.evidence.actionAdapterCalibration.status, "NEEDS_REVIEW");
  assert.equal(releaseRecord.data.evidence.actionAdapterCalibration.actions.length, 1);
  assert.equal(releaseRecord.data.evidence.productionEvidenceIntake.items.length, 12);
  assert.equal(releaseRecord.data.evidence.cloudbaseStoreReadiness.status, "NEEDS_REVIEW");
  assert.equal(releaseRecord.data.evidence.cloudbaseStoreReadiness.selectedDecision, "UNDECIDED");
  assert.equal(releaseRecord.data.evidence.rootMemberCenterReadiness.status, "NEEDS_REVIEW");
  assert.equal(releaseRecord.data.evidence.rootMemberCenterReadiness.summary.missingAppIdCount, 1);
  assert.equal(releaseRecord.data.signoffGate.status, "NEEDS_REVIEW");
  assert.equal(releaseRecord.data.signoffGate.summary.pendingCount, 3);
  assert.equal(releaseRecord.data.mustFixBeforeRelease.length, releaseRecord.data.checklist.mustFixBeforeRelease.length);
  assert.ok(releaseRecord.data.rollback.some((item) => item.includes("Store 快照")));

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
  assert.equal(evidencePack.data.pack.evidence.productionCutoverReadiness.summary.requiredProofCount, 13);
  assert.equal(evidencePack.data.pack.summary.actionAdapterCalibrationStatus, "NEEDS_REVIEW");
  assert.equal(evidencePack.data.pack.evidence.actionAdapterCalibration.actions.length, 1);
  assert.equal(evidencePack.data.pack.summary.productionEvidenceIntakeStatus, "BLOCKED");
  assert.equal(evidencePack.data.pack.evidence.productionEvidenceIntake.items.length, 12);
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
  assert.equal(signedReleaseRecord.data.signoffs.find((item) => item.role === "PRODUCT").status, "APPROVED");
  assert.equal(signedReleaseRecord.data.signoffGate.summary.approvedCount, 1);
  assert.equal(signedReleaseRecord.data.signoffGate.summary.pendingCount, 2);
  assert.equal(signedReleaseRecord.data.evidence.signoffGate.summary.approvedCount, 1);
  assert.equal(signedReleaseRecord.data.evidence.adminTransitionReadiness.legacyDeprecationDecision.status, "APPROVED");
  assert.equal(signedReleaseRecord.data.evidence.adminTransitionReadiness.summary.deprecationSource, "RECORD");
  assert.equal(signedReleaseRecord.data.evidence.productionEvidenceIntake.items.find((item) => item.backlogId === "T-008").status, "READY");
  assert.equal(signedReleaseRecord.data.evidence.productionCutoverReadiness.items.find((item) => item.id === "cloudbase_unionid").proofSource, "RECORD");
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

  const denied = await request(baseUrl, "/api/v1/admin/me");
  assert.equal(denied.code, 40101);
  const probeDenied = await request(baseUrl, "/api/v1/admin/cloudbase-identity-probe", {
    headers: { "X-WX-OPENID": "openid_should_not_be_visible_without_admin" },
  });
  assert.equal(probeDenied.code, 40101);

  const allowed = await request(baseUrl, "/api/v1/admin/me", {
    headers: { "X-Admin-Token": "admin-secret" },
  });
  assert.equal(allowed.code, 0);
  assert.equal(allowed.data.role, "admin");
  const allowedByRootHeader = await request(baseUrl, "/api/v1/admin/me", {
    headers: { "X-ROOT-ADMIN-TOKEN": "admin-secret" },
  });
  assert.equal(allowedByRootHeader.code, 0);
  const allowedByOperator = await request(baseUrl, "/api/v1/admin/me", {
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

  const jobDenied = await request(baseUrl, "/api/v1/jobs/health-data-retention-cleanup", {
    method: "POST",
    body: JSON.stringify({ dryRun: true }),
  });
  assert.equal(jobDenied.code, 40101);

  const jobAllowed = await request(baseUrl, "/api/v1/jobs/health-data-retention-cleanup", {
    method: "POST",
    headers: { "X-ROOT-ADMIN-TOKEN": "job-old-secret" },
    body: JSON.stringify({ dryRun: true }),
  });
  assert.notEqual(jobAllowed.code, 40101);
  assert.notEqual(jobAllowed.code, 404);

  const rotatedJobAllowed = await request(baseUrl, "/api/v1/jobs/health-data-retention-cleanup", {
    method: "POST",
    headers: { "X-ROOT-ADMIN-TOKEN": "job-new-secret" },
    body: JSON.stringify({ dryRun: true }),
  });
  assert.notEqual(rotatedJobAllowed.code, 40101);
  assert.notEqual(rotatedJobAllowed.code, 404);

  const unknownJobDenied = await request(baseUrl, "/api/v1/jobs/health-data-retention-cleanup", {
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

test("GET routes use the read-only Store Interface while login remains writable", async (t) => {
  const storeAdapter = createMemoryStore(createEmptyData());
  const requestOptions = [];
  storeAdapter.runRequest = async (options, work) => {
    requestOptions.push(options);
    return work(storeAdapter.data, {});
  };
  const server = createApp({ storeAdapter, env: directPhoneLoginEnv });
  await server.readyPromise;
  requestOptions.length = 0;
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const activities = await request(baseUrl, "/api/v1/activities");
  const login = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone: "13800008888" }),
  });

  assert.equal(activities.code, 0);
  assert.equal(login.code, 0);
  assert.equal(requestOptions.length, 2);
  assert.equal(requestOptions[0].write, false);
  assert.equal(requestOptions[0].shouldCommit(), false);
  assert.equal(requestOptions[1].write, true);
  assert.equal(requestOptions[1].shouldCommit(), true);
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

test("formal launch login and profile HTTP Interface stays outside legacy order matching", async (t) => {
  const server = createApp({ env: directPhoneLoginEnv });
  const baseUrl = await listen(server);
  t.after(() => server.close());

  const firstLogin = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({
      phone: "13800000991",
      flowVersion: "FORMAL_LAUNCH_V1",
      sourceChannel: "MYROOT_FORMAL_LOGIN",
    }),
  });

  assert.equal(firstLogin.code, 0);
  assert.equal(firstLogin.data.sessionOutcome, "NEW_USER");
  assert.equal(firstLogin.data.nextRoute, "/pages/register/index");
  assert.equal(firstLogin.data.autoMatch, null);
  assert.equal(firstLogin.data.profile.phone, "138****0991");

  const saved = await request(baseUrl, "/api/v1/user/formal-profile", {
    method: "POST",
    headers: { Authorization: `Bearer ${firstLogin.data.token}` },
    body: JSON.stringify({
      nickname: "Root新会员",
      birthDate: "1992-08-03",
      gender: "FEMALE",
    }),
  });

  assert.equal(saved.code, 0);
  assert.equal(saved.data.success, true);
  assert.equal(saved.data.profile.complete, true);
  assert.equal(saved.data.profile.phone, "138****0991");

  const profile = await request(baseUrl, "/api/v1/user/formal-profile", {
    headers: { Authorization: `Bearer ${firstLogin.data.token}` },
  });
  assert.equal(profile.code, 0);
  assert.equal(profile.data.profile.nickname, "Root新会员");
  assert.equal(profile.data.profile.phoneVerified, true);

  const returningLogin = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone: "13800000991", flowVersion: "FORMAL_LAUNCH_V1" }),
  });
  assert.equal(returningLogin.code, 0);
  assert.equal(returningLogin.data.sessionOutcome, "REGISTERED");
  assert.equal(returningLogin.data.nextRoute, "/pages/home/index");
  assert.equal(returningLogin.data.autoMatch, null);
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
  const rootUserId = login.data.user.rootUserId;
  await request(baseUrl, "/api/v1/user/formal-profile", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      nickname: "持久化用户",
      birthDate: "1990-01-01",
      gender: "FEMALE",
    }),
  });

  const reloadedStore = createJsonFileStore(storePath);
  const profile = reloadedStore.data.formalProfiles.find((item) => item.rootUserId === rootUserId);

  assert.ok(fs.existsSync(storePath));
  assert.equal(profile.nickname, "持久化用户");
  assert.equal(profile.birthDate, "1990-01-01");
  assert.equal(profile.complete, true);
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
  const rootUserId = login.data.user.rootUserId;
  await request(baseUrl, "/api/v1/user/formal-profile", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      nickname: "SQLite 持久化用户",
      birthDate: "1991-02-03",
      gender: "MALE",
    }),
  });
  await new Promise((resolve) => server.close(resolve));
  firstStore.close();

  const reloadedStore = createSqliteStore(storePath);
  const profile = reloadedStore.data.formalProfiles.find((item) => item.rootUserId === rootUserId);

  assert.ok(fs.existsSync(storePath));
  assert.equal(profile.nickname, "SQLite 持久化用户");
  assert.equal(profile.birthDate, "1991-02-03");
  assert.equal(profile.complete, true);
  assert.equal(reloadedStore.kind, "sqlite");
  reloadedStore.close();
});
