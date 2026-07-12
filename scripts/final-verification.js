#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { prepareBackendAdminDist } = require("./prepare-backend-admin-dist");
const { buildMiniprogramReleaseManifest } = require("./miniprogram-release-manifest");
const { collectLifecycleSettlementCleanup, parseArgs: parseLifecycleSettlementCleanupArgs } = require("../backend/scripts/lifecycle-settlement-cleanup");
const { collectLifecycleSettlementJob, parseArgs: parseLifecycleSettlementArgs } = require("../backend/scripts/lifecycle-settlement-scheduler");
const { collectLifecycleUserExportsCleanup, parseArgs: parseLifecycleUserExportsCleanupArgs } = require("../backend/scripts/lifecycle-user-exports-cleanup");
const { collectLifecycleUserExportsDeliveryRetry, parseArgs: parseLifecycleUserExportsDeliveryRetryArgs } = require("../backend/scripts/lifecycle-user-exports-delivery-retry");
const { collectLifecycleUsersExport, parseArgs: parseLifecycleUsersExportArgs } = require("../backend/scripts/lifecycle-users-export");
const { collectOperationalAlertJob, parseArgs: parseOperationalAlertArgs } = require("../backend/scripts/operational-alert-runner");
const { collectWeWorkTouchJob, parseArgs: parseWeWorkTouchArgs } = require("../backend/scripts/wework-touch-runner");
const {
  buildCloudbaseJobManifest,
  validateCloudbaseJobManifest,
} = require("../backend/scripts/cloudbase-job-manifest");
const { buildProductionEnvMatrix } = require("../backend/src/productionEnvMatrix");
const { version: candidateVersion } = require("../backend/package.json");

const projectRoot = path.resolve(__dirname, "..");
const adminDir = path.join(projectRoot, "admin");
const backendDir = path.join(projectRoot, "backend");
const miniprogramDir = path.join(projectRoot, "miniprogram");

function collectFiles(dir, predicate, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if ([".git", "node_modules", "dist", "build", "coverage", "miniprogram_npm"].includes(entry.name)) continue;
      collectFiles(fullPath, predicate, results);
      continue;
    }
    if (predicate(fullPath)) results.push(fullPath);
  }
  return results.sort();
}

function runCommand(label, command, args, options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd || projectRoot,
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 12,
  });
  return {
    label,
    command: [command, ...args].join(" "),
    status: result.status === 0 ? "PASS" : "FAIL",
    code: result.status,
    durationMs: Date.now() - startedAt,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function syntaxCheck() {
  const files = [
    ...collectFiles(path.join(projectRoot, "scripts"), (file) => file.endsWith(".js")),
    ...collectFiles(path.join(backendDir, "src"), (file) => file.endsWith(".js")),
    ...collectFiles(path.join(backendDir, "scripts"), (file) => file.endsWith(".js")),
    ...collectFiles(path.join(backendDir, "tests"), (file) => file.endsWith(".js")),
    ...collectFiles(path.join(projectRoot, "cloudfunctions"), (file) => file.endsWith(".js")),
    ...collectFiles(adminDir, (file) => file.endsWith(".js")),
    ...collectFiles(miniprogramDir, (file) => file.endsWith(".js")),
    path.join(backendDir, "public", "admin.js"),
  ];
  const failures = [];
  const startedAt = Date.now();
  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.status !== 0) {
      failures.push({ file, stdout: result.stdout || "", stderr: result.stderr || "" });
    }
  }
  return {
    label: "JavaScript syntax check",
    command: `node --check (${files.length} files)`,
    status: failures.length ? "FAIL" : "PASS",
    code: failures.length ? 1 : 0,
    durationMs: Date.now() - startedAt,
    filesChecked: files.length,
    failures,
  };
}

function releaseVersionAlignmentCheck() {
  const startedAt = Date.now();
  const expectedVersion = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")).version;
  const packageFiles = [
    "package.json",
    "backend/package.json",
    "miniprogram/package.json",
    "admin/package.json",
    "cloudfunctions/myroot-job-dispatcher/package.json",
  ];
  const lockFiles = [
    "backend/package-lock.json",
    "admin/package-lock.json",
  ];
  const checks = [];
  for (const file of packageFiles) {
    const payload = JSON.parse(fs.readFileSync(path.join(projectRoot, file), "utf8"));
    checks.push({ id: file, status: payload.version === expectedVersion ? "PASS" : "FAIL", version: payload.version || "" });
  }
  for (const file of lockFiles) {
    const payload = JSON.parse(fs.readFileSync(path.join(projectRoot, file), "utf8"));
    const rootPackageVersion = payload.packages && payload.packages[""] && payload.packages[""].version;
    checks.push({
      id: file,
      status: payload.version === expectedVersion && rootPackageVersion === expectedVersion ? "PASS" : "FAIL",
      version: payload.version || "",
    });
  }
  const failed = checks.filter((check) => check.status !== "PASS");
  return {
    label: "Release version alignment",
    command: `compare deployable package versions with ${expectedVersion}`,
    status: failed.length ? "FAIL" : "PASS",
    code: failed.length ? 1 : 0,
    durationMs: Date.now() - startedAt,
    checks,
    failures: failed,
  };
}

function migrationChecksumManifestCheck() {
  const startedAt = Date.now();
  const migrationsDir = path.join(backendDir, "db", "migrations");
  const manifestPath = path.join(migrationsDir, "checksums.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const expected = manifest.files && typeof manifest.files === "object" ? manifest.files : {};
  const sqlFiles = fs.readdirSync(migrationsDir)
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/i.test(name))
    .sort();
  const manifestFiles = Object.keys(expected).sort();
  const checks = sqlFiles.map((file) => {
    const actual = crypto.createHash("sha256")
      .update(fs.readFileSync(path.join(migrationsDir, file)))
      .digest("hex");
    return {
      id: file,
      status: expected[file] === actual ? "PASS" : "FAIL",
      expected: expected[file] || "MISSING",
      actual,
    };
  });
  const fileSetCheck = {
    id: "manifest_file_set",
    status: JSON.stringify(sqlFiles) === JSON.stringify(manifestFiles) ? "PASS" : "FAIL",
    expected: manifestFiles,
    actual: sqlFiles,
  };
  checks.push(fileSetCheck);
  const failures = checks.filter((check) => check.status !== "PASS");
  return {
    label: "Immutable migration checksums",
    command: "compare backend/db/migrations/*.sql with checksums.json",
    status: failures.length ? "FAIL" : "PASS",
    code: failures.length ? 1 : 0,
    durationMs: Date.now() - startedAt,
    filesChecked: sqlFiles.length,
    checks,
    failures,
  };
}

function miniprogramReleaseManifestCheck() {
  const startedAt = Date.now();
  const outputPath = path.join(os.tmpdir(), `myroot-miniprogram-${candidateVersion}-verify.sha256`);
  try {
    const manifest = buildMiniprogramReleaseManifest({ outputPath });
    const requiredFiles = [
      "app.js",
      "app.json",
      "config/env.js",
      "config/version.js",
      "pages/home/index.js",
      "static/brand/logo.png",
    ];
    const forbiddenFiles = [
      ".git/HEAD",
      ".gitignore",
      "README.md",
      "package.json",
      "project.private.config.json",
      "pages/dev-identity-probe/index.js",
      "scripts/validate.js",
    ];
    const checks = [
      {
        id: "runtime_sources_present",
        status: requiredFiles.every((file) => manifest.files.includes(file)) ? "PASS" : "FAIL",
      },
      {
        id: "development_sources_excluded",
        status: forbiddenFiles.every((file) => !manifest.files.includes(file)) ? "PASS" : "FAIL",
      },
      {
        id: "unused_upload_filter_enabled",
        status: manifest.safeguards.ignoreUploadUnusedFiles === true ? "PASS" : "FAIL",
      },
      {
        id: "source_maps_disabled",
        status: manifest.safeguards.uploadWithSourceMap === false ? "PASS" : "FAIL",
      },
      {
        id: "explicit_pack_ignores",
        status: manifest.safeguards.explicitIgnoreRuleCount >= 6 ? "PASS" : "FAIL",
      },
      {
        id: "manifest_nonempty",
        status: manifest.fileCount > 0 && manifest.totalBytes > 0 && /^[a-f0-9]{64}$/.test(manifest.manifestSha256)
          ? "PASS"
          : "FAIL",
      },
    ];
    const failures = checks.filter((check) => check.status !== "PASS");
    return {
      label: "Mini-program release source manifest",
      command: `node scripts/miniprogram-release-manifest.js --output ${outputPath}`,
      status: failures.length ? "FAIL" : "PASS",
      code: failures.length ? 1 : 0,
      durationMs: Date.now() - startedAt,
      filesChecked: manifest.fileCount,
      manifestSha256: manifest.manifestSha256,
      checks,
      failures,
    };
  } catch (error) {
    return {
      label: "Mini-program release source manifest",
      command: `node scripts/miniprogram-release-manifest.js --output ${outputPath}`,
      status: "FAIL",
      code: 1,
      durationMs: Date.now() - startedAt,
      stderr: error.message,
      failures: [error.message],
    };
  } finally {
    fs.rmSync(outputPath, { force: true });
  }
}

function cloudbaseConfigSecretCheck() {
  const startedAt = Date.now();
  const files = collectFiles(projectRoot, (file) => /^cloudbaserc(?:\.[^.]+)?\.json$/.test(path.basename(file)));
  const secretKeyPattern = /(token|secret|password|private[_-]?key|access[_-]?key)/i;
  const violations = [];

  function inspect(value, file, keyPath = []) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const nextPath = keyPath.concat(key);
      if (secretKeyPattern.test(key)) {
        violations.push({
          file: path.relative(projectRoot, file),
          keyPath: nextPath.join("."),
        });
      }
      inspect(child, file, nextPath);
    }
  }

  for (const file of files) {
    try {
      inspect(JSON.parse(fs.readFileSync(file, "utf8")), file);
    } catch (error) {
      violations.push({
        file: path.relative(projectRoot, file),
        keyPath: "<invalid-json>",
      });
    }
  }

  return {
    label: "CloudBase config secret check",
    command: "inspect cloudbaserc*.json for secret-bearing keys",
    status: violations.length ? "FAIL" : "PASS",
    code: violations.length ? 1 : 0,
    durationMs: Date.now() - startedAt,
    filesChecked: files.length,
    failures: violations,
  };
}

function cloudbaseTriggerTopologyCheck() {
  const startedAt = Date.now();
  const configPath = path.join(projectRoot, "cloudbaserc.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const functions = Array.isArray(config.functions) ? config.functions : [];
  const primary = functions.find((item) => item.name === "myroot-job-dispatcher");
  const retention = functions.find((item) => item.name === "myroot-health-retention");
  const triggerGroups = functions.map((item) => ({
    functionName: item.name,
    triggers: Array.isArray(item.triggers) ? item.triggers : [],
  }));
  const triggerNames = triggerGroups.flatMap((item) => item.triggers.map((trigger) => trigger.name));
  const uniqueTriggerNames = new Set(triggerNames);
  const expectedTriggerNames = [
    "adapter_retry_due",
    "operational_alerts",
    "checkin_reminders",
    "wework_touch_due",
    "lifecycle_settlement_due",
    "lifecycle_settlement_cleanup",
    "lifecycle_users_export",
    "lifecycle_user_exports_delivery_retry",
    "lifecycle_user_exports_cleanup",
    "health_data_retention_cleanup",
    "youzan_identity_reconcile",
  ];
  const checks = [
    {
      id: "two_function_topology",
      status: primary && retention ? "PASS" : "FAIL",
    },
    {
      id: "per_function_trigger_limit",
      status: triggerGroups.every((item) => item.triggers.length <= 10) ? "PASS" : "FAIL",
    },
    {
      id: "eleven_unique_triggers",
      status: triggerNames.length === 11 && uniqueTriggerNames.size === 11 &&
        expectedTriggerNames.every((name) => uniqueTriggerNames.has(name)) ? "PASS" : "FAIL",
    },
    {
      id: "health_retention_isolated",
      status: retention && retention.triggers.length === 1 &&
        retention.triggers[0].name === "health_data_retention_cleanup" ? "PASS" : "FAIL",
    },
    {
      id: "shared_dispatcher_source",
      status: primary && retention && primary.dir === "cloudfunctions/myroot-job-dispatcher" &&
        retention.dir === primary.dir && fs.existsSync(path.join(projectRoot, primary.dir, "index.js")) ? "PASS" : "FAIL",
    },
  ];
  const failures = checks.filter((check) => check.status !== "PASS");
  return {
    label: "CloudBase trigger topology",
    command: "validate 11 Jobs across CloudBase's 10-trigger-per-function limit",
    status: failures.length ? "FAIL" : "PASS",
    code: failures.length ? 1 : 0,
    durationMs: Date.now() - startedAt,
    checks,
    failures,
  };
}

function cloudbaseJobManifestCheck() {
  const startedAt = Date.now();
  const manifest = buildCloudbaseJobManifest({
    baseUrl: "https://express-x7te-258599-9-1404419431.sh.run.tcloudbase.com",
    campaignId: "ROOT_7D_RESET",
  });
  const validation = validateCloudbaseJobManifest(manifest, { strict: true });
  const checks = [
    {
      id: "manifest_validation",
      status: validation.status === "PASS" ? "PASS" : "FAIL",
    },
    {
      id: "adapter_retry_job",
      status: manifest.jobs.some((job) =>
        job.id === "adapter_retry_due" &&
        job.schedule.cron === "*/10 * * * *" &&
        job.executeCommand.includes("npm run adapter-retry") &&
        job.http.path === "/api/v1/jobs/adapter-retry-due") ? "PASS" : "FAIL",
    },
    {
      id: "operational_alert_job",
      status: manifest.jobs.some((job) =>
        job.id === "operational_alerts" &&
        job.schedule.cron === "*/30 * * * *" &&
        job.executeCommand.includes("npm run operational-alerts") &&
        job.http.path === "/api/v1/jobs/operational-alerts") ? "PASS" : "FAIL",
    },
    {
      id: "wework_touch_job",
      status: manifest.jobs.some((job) =>
        job.id === "wework_touch_due" &&
        job.schedule.cron === "*/10 * * * *" &&
        job.executeCommand.includes("npm run wework-touch") &&
        job.http.path === "/api/v1/jobs/wework-touch-due" &&
        job.http.body.cooldownHours === 24 &&
        job.http.body.adapterMode === "AUTO") ? "PASS" : "FAIL",
    },
    {
      id: "lifecycle_settlement_job",
      status: manifest.jobs.some((job) =>
        job.id === "lifecycle_settlement_due" &&
        job.schedule.cron === "*/15 * * * *" &&
        job.executeCommand.includes("npm run lifecycle-settlement") &&
        job.http.path === "/api/v1/jobs/lifecycle-settlement-due" &&
        job.http.body.batchSize === 20) ? "PASS" : "FAIL",
    },
    {
      id: "lifecycle_settlement_cleanup_job",
      status: manifest.jobs.some((job) =>
        job.id === "lifecycle_settlement_cleanup" &&
        job.schedule.cron === "5 * * * *" &&
        job.executeCommand.includes("npm run lifecycle-settlement-cleanup") &&
        job.http.path === "/api/v1/jobs/lifecycle-settlement-cleanup" &&
        job.http.body.allowCancel === false) ? "PASS" : "FAIL",
    },
    {
      id: "lifecycle_users_export_job",
      status: manifest.jobs.some((job) =>
        job.id === "lifecycle_users_export" &&
        job.schedule.cron === "30 9 * * *" &&
        job.executeCommand.includes("npm run lifecycle-users-export") &&
        job.http.path === "/api/v1/jobs/lifecycle-users-export" &&
        job.http.body.retentionDays === 7 &&
        job.http.body.sensitivity === "MASKED" &&
        job.http.body.approvalRequired === false &&
        job.http.body.deliveryEnabled === false &&
        job.http.body.deliveryChannel === "NONE") ? "PASS" : "FAIL",
    },
    {
      id: "lifecycle_user_exports_cleanup_job",
      status: manifest.jobs.some((job) =>
        job.id === "lifecycle_user_exports_cleanup" &&
        job.schedule.cron === "45 3 * * *" &&
        job.executeCommand.includes("npm run lifecycle-user-exports-cleanup") &&
        job.http.path === "/api/v1/jobs/lifecycle-user-exports-cleanup" &&
        job.http.body.objectCleanup === true) ? "PASS" : "FAIL",
    },
    {
      id: "lifecycle_user_exports_delivery_retry_job",
      status: manifest.jobs.some((job) =>
        job.id === "lifecycle_user_exports_delivery_retry" &&
        job.schedule.cron === "*/20 * * * *" &&
        job.executeCommand.includes("npm run lifecycle-user-exports-delivery-retry") &&
        job.http.path === "/api/v1/jobs/lifecycle-user-exports-delivery-retry" &&
        job.http.body.deliveryMaxAttempts === 3) ? "PASS" : "FAIL",
    },
    {
      id: "health_data_retention_cleanup_job",
      status: manifest.jobs.some((job) =>
        job.id === "health_data_retention_cleanup" &&
        job.schedule.cron === "15 4 * * *" &&
        job.executeCommand.includes("npm run health-data-retention-cleanup") &&
        job.http.path === "/api/v1/jobs/health-data-retention-cleanup" &&
        job.http.body.objectCleanup === true) ? "PASS" : "FAIL",
    },
    {
      id: "youzan_identity_reconcile_job",
      status: manifest.jobs.some((job) =>
        job.id === "youzan_identity_reconcile" &&
        job.schedule.cron === "25 * * * *" &&
        job.executeCommand.includes("npm run youzan-identity-reconcile") &&
        job.http.path === "/api/v1/jobs/youzan-identity-reconcile" &&
        job.http.body.batchSize === 5) ? "PASS" : "FAIL",
    },
    {
      id: "job_environment",
      status: manifest.environment.requiredEnv.includes("ROOT_JOB_BASE_URL") &&
        manifest.environment.requiredEnv.includes("ROOT_ADMIN_JOB_TOKEN") &&
        manifest.environment.optionalEnv.includes("ROOT_JOB_ROUTE_QUERY") &&
        manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_CLEANUP_LIMIT") &&
        manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_CHANNEL") &&
        manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_TEMPLATE") &&
        manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_DELIVERY_TIMEOUT_MS") &&
        manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_BATCH_SIZE") &&
        manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_DELIVERY_MAX_ATTEMPTS") &&
        manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_DELAY_SECONDS") &&
        manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_DOWNLOAD_SECRET") &&
        manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_SIGNED_DOWNLOAD_ENABLED") &&
        manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_SIGNED_DOWNLOAD_TTL_SECONDS") &&
        manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_OBJECT_CLEANUP_ENABLED") &&
        manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_OBJECT_PROVIDER") &&
        manifest.environment.optionalEnv.includes("ROOT_LIFECYCLE_EXPORT_OBJECT_PREFIX") &&
        manifest.environment.optionalEnv.includes("ROOT_HEALTH_DATA_RETENTION_CLEANUP_ENABLED") &&
        manifest.environment.optionalEnv.includes("ROOT_HEALTH_DATA_RETENTION_CLEANUP_LIMIT") &&
        manifest.environment.optionalEnv.includes("ROOT_PRIVACY_CONTROLLER_NAME") &&
        manifest.environment.optionalEnv.includes("ROOT_PRIVACY_CONTACT") &&
        manifest.environment.optionalEnv.includes("ROOT_YOUZAN_IDENTITY_RECONCILE_ENABLED") &&
        manifest.environment.optionalEnv.includes("YOUZAN_USER_QUERY_URL") &&
        manifest.environment.optionalEnv.includes("ROOT_WEWORK_TOUCH_COOLDOWN_HOURS") &&
        manifest.environment.optionalEnv.includes("ROOT_WEWORK_TOUCH_TEMPLATES") &&
        manifest.environment.optionalEnv.includes("WEWORK_TOUCH_SEND_URL") &&
        manifest.environment.optionalEnv.includes("WEWORK_TOUCH_ACCESS_TOKEN") ? "PASS" : "FAIL",
    },
  ];
  const failed = checks.filter((check) => check.status !== "PASS");
  return {
    label: "CloudBase job manifest",
    status: failed.length ? "FAIL" : "PASS",
    code: failed.length ? 1 : 0,
    durationMs: Date.now() - startedAt,
    checks,
    validation,
  };
}

function productionEnvMatrixCheck() {
  const startedAt = Date.now();
  const env = {
    WECHAT_APPID: "wx-root",
    WECHAT_APPSECRET: "wechat-secret",
    ROOT_PUBLIC_BASE_URL: "https://express-x7te-258599-9-1404419431.sh.run.tcloudbase.com",
    ROOT_ADMIN_TOKEN: "admin-secret",
    ROOT_REQUIRE_HEALTH_CONSENT: "true",
    ROOT_PRIVACY_CONTROLLER_NAME: "ROOT 测试主体",
    ROOT_PRIVACY_CONTACT: "privacy@example.com",
    ROOT_HEALTH_DATA_RETENTION_DAYS: "180",
    ROOT_HEALTH_DATA_RETENTION_CLEANUP_ENABLED: "true",
    ROOT_STORE_ADAPTER: "mysql",
    MYSQL_ADDRESS: "10.11.103.164:3306",
    MYSQL_USERNAME: "root",
    MYSQL_PASSWORD: "mysql-secret",
    MYSQL_DATABASE: "root_checkin",
    ROOT_CLOUDBASE_STORE_DECISION: "MYSQL_ON_CLOUDBASE",
    ROOT_CLOUDBASE_ENV_ID: "root-prod-env",
    ROOT_CLOUDBASE_REGION: "ap-shanghai",
    ROOT_CLOUDBASE_STORE_BACKUP_PLAN: "每日快照 + 发布前手工快照",
    ROOT_CLOUDBASE_STORE_ROLLBACK_PLAN: "按发布前快照回滚",
    ROOT_CLOUDBASE_STORE_PROOF: "release-proof-cloudbase-store",
    ROOT_MEMBER_CENTER_APPID: "wx_root_member_center",
    ROOT_MEMBER_CENTER_PRODUCT_PATH: "pages/product/detail?id=ROOT_PREBIOTIC",
    ROOT_MEMBER_CENTER_ENV_VERSION: "release",
    ROOT_CHECKIN_REMINDER_ENABLED: "true",
    ROOT_CHECKIN_REMINDER_TEMPLATE_ID: "template-checkin-next-day",
    ROOT_CHECKIN_REMINDER_TEMPLATE_VERSION: "v2026-06-28-tpl10850",
    ROOT_JOB_BASE_URL: "https://express-x7te-258599-9-1404419431.sh.run.tcloudbase.com",
    ROOT_ADMIN_JOB_TOKENS: JSON.stringify(["job-old-secret", "job-new-secret"]),
    ROOT_LIFECYCLE_EXPORT_OBJECT_PROVIDER: "CLOUDBASE",
    ROOT_LIFECYCLE_EXPORT_OBJECT_PREFIX: "lifecycle-user-exports",
    YOUZAN_CLIENT_ID: "youzan-client",
    YOUZAN_CLIENT_SECRET: "youzan-secret",
    YOUZAN_GRANT_ID: "12345678",
    YOUZAN_ACCESS_TOKEN: "youzan-token",
    YOUZAN_ACCESS_TOKEN_EXPIRES_AT: "2099-01-01T00:00:00+08:00",
    YOUZAN_TOKEN_MANAGEMENT_MODE: "STATIC_ROTATION",
    YOUZAN_TOKEN_ROTATION_OWNER: "root-ops",
    YOUZAN_ORDER_LIST_URL: "https://youzan.example.com/orders",
    ROOT_AFTER_SALES_STATUS_MAP: JSON.stringify({ REFUND_SUCCESS: "REFUNDED", PARTIAL_REFUNDED: "PARTIAL_REFUND" }),
    ROOT_AFTER_SALES_RECOVERY_STATUSES: "REFUNDED,PARTIAL_REFUND",
    ROOT_AFTER_SALES_FOLLOW_STATUSES: "REQUESTED,APPROVED,REFUNDING,REJECTED",
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
    WEWORK_CONTACT_USERIDS: "advisor-final",
    WEWORK_TOKEN_URL: "https://qyapi.weixin.qq.com/cgi-bin/gettoken",
    WEWORK_ACCESS_TOKEN: "wework-token",
    WEWORK_TAG_APPLY_URL: "https://wework.example.com/tags",
    WEWORK_TAG_USERID: "advisor-final",
    ROOT_WEWORK_TOUCH_COOLDOWN_HOURS: "24",
    ROOT_WEWORK_TOUCH_ADAPTER_MODE: "AUTO",
    WEWORK_TOUCH_SEND_URL: "https://wework.example.com/touch",
    WEWORK_TOUCH_ACCESS_TOKEN: "wework-touch-token",
    ROOT_CONSULTATION_ADVISORS: "advisor-final:最终验收顾问,advisor-backup:备用顾问",
    ROOT_CONSULTATION_SLA_MINUTES: "120",
    ROOT_CONSULTATION_SLA_DUE_SOON_MINUTES: "30",
    ROOT_CONSULTATION_SLA_ESCALATION_RULES: JSON.stringify([
      { stage: "ADVISOR_REMINDER", level: 1, thresholdMinutes: 0, label: "顾问提醒", ownerRole: "咨询顾问", severity: "warning" },
      { stage: "OPS_ESCALATION", level: 2, thresholdMinutes: 60, label: "运营升级", ownerRole: "运营", severity: "danger" },
      { stage: "LEAD_ESCALATION", level: 3, thresholdMinutes: 120, label: "负责人升级", ownerRole: "运营主管", severity: "danger" },
    ]),
    ROOT_MANUAL_REVIEW_EXPLANATION_TEMPLATES: JSON.stringify({
      FREE_ORDER_REVIEW: {
        title: "最终验收免单解释",
        pendingReason: "最终验收核对 {{reason}}",
        evidenceRequired: ["最终验收打卡记录", "最终验收订单证据"],
        operatorGuidance: "最终验收运营指引",
        nextAction: "等待最终验收复核结果。",
      },
    }),
    WEWORK_CONTACT_WRITEBACK_URL: "https://wework.example.com/writeback",
    WEWORK_CONTACT_WRITEBACK_USERID: "advisor-final",
  };
  const ready = buildProductionEnvMatrix(env, { target: "production" });
  const blocked = buildProductionEnvMatrix({}, { target: "production" });
  const checks = [
    {
      id: "matrix_ready",
      status: ready.status === "READY" ? "PASS" : "FAIL",
    },
    {
      id: "runtime_store_job_groups",
      status: ["runtime", "privacy_compliance", "store", "cloudbase_store", "cloudbase_jobs", "checkin_reminder_subscription", "root_member_center_jump"].every((id) =>
        ready.groups.some((group) => group.id === id && group.status === "PASS")) ? "PASS" : "FAIL",
    },
    {
      id: "job_token_rotation_env",
      status: ready.groups.some((group) =>
        group.id === "cloudbase_jobs" &&
        group.status === "PASS" &&
        group.anyOf.some((item) => item.presentNames.includes("ROOT_ADMIN_JOB_TOKENS"))) ? "PASS" : "FAIL",
    },
    {
      id: "lifecycle_export_optional_env",
      status: ready.groups.some((group) =>
        group.id === "cloudbase_jobs" &&
        group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_CAMPAIGN_ID") &&
        group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_LIMIT") &&
        group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_CLEANUP_LIMIT") &&
        group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_RETENTION_DAYS") &&
        group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_SENSITIVITY") &&
        group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_APPROVAL_REQUIRED") &&
        group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_DELIVERY_CHANNEL") &&
        group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_URL") &&
        group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_CHANNEL") &&
        group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_TEMPLATE") &&
        group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_DELIVERY_TIMEOUT_MS") &&
        group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_BATCH_SIZE") &&
        group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_DELIVERY_MAX_ATTEMPTS") &&
        group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_DELAY_SECONDS") &&
        group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_DOWNLOAD_SECRET") &&
        group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_SIGNED_DOWNLOAD_ENABLED") &&
        group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_SIGNED_DOWNLOAD_TTL_SECONDS") &&
        group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_OBJECT_BASE_URL") &&
        group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_OBJECT_CLEANUP_ENABLED") &&
        group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_OBJECT_DIR") &&
        group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_OBJECT_PROVIDER" && item.present) &&
        group.optional.some((item) => item.name === "ROOT_LIFECYCLE_EXPORT_OBJECT_PREFIX" && item.present)) ? "PASS" : "FAIL",
    },
    {
      id: "checkin_reminder_required_env",
      status: ready.groups.some((group) =>
        group.id === "checkin_reminder_subscription" &&
        group.status === "PASS" &&
        group.required.some((item) => item.name === "ROOT_CHECKIN_REMINDER_TEMPLATE_ID" && item.present) &&
        group.required.some((item) => item.name === "ROOT_CHECKIN_REMINDER_TEMPLATE_VERSION" && item.present)) ? "PASS" : "FAIL",
    },
    {
      id: "root_member_center_required_env",
      status: ready.groups.some((group) =>
        group.id === "root_member_center_jump" &&
        group.status === "PASS" &&
        group.anyOf.every((item) => item.present)) ? "PASS" : "FAIL",
    },
    {
      id: "wework_touch_optional_env",
      status: ready.groups.some((group) =>
        group.id === "wework_touch" &&
        group.status === "OPTIONAL" &&
        group.optional.some((item) => item.name === "WEWORK_TOUCH_SEND_URL" && item.present) &&
        group.optional.some((item) => item.name === "WEWORK_TOUCH_ACCESS_TOKEN" && item.present)) ? "PASS" : "FAIL",
    },
    {
      id: "official_wework_optional_env",
      status: ready.groups.some((group) =>
        group.id === "wework_contact" &&
        group.optional.some((item) => item.name === "WEWORK_CONTACT_USERIDS" && item.present) &&
        group.optional.some((item) => item.name === "WEWORK_TOKEN_URL" && item.present)) &&
        ready.groups.some((group) =>
          group.id === "wework_tag" &&
          group.optional.some((item) => item.name === "WEWORK_TAG_USERID" && item.present)) &&
        ready.groups.some((group) =>
          group.id === "wework_contact_writeback" &&
          group.optional.some((item) => item.name === "WEWORK_CONTACT_WRITEBACK_USERID" && item.present)) ? "PASS" : "FAIL",
    },
    {
      id: "order_after_sales_optional_env",
      status: ready.groups.some((group) =>
        group.id === "order_after_sales" &&
        group.status === "OPTIONAL" &&
        group.optional.some((item) => item.name === "ROOT_AFTER_SALES_STATUS_MAP" && item.present) &&
        group.optional.some((item) => item.name === "ROOT_AFTER_SALES_RECOVERY_STATUSES" && item.present) &&
        group.optional.some((item) => item.name === "ROOT_AFTER_SALES_FOLLOW_STATUSES" && item.present)) ? "PASS" : "FAIL",
    },
    {
      id: "external_adapter_groups",
      status: ["youzan_order", "youzan_customer", "youzan_coupon", "fulfillment", "wework_contact", "wework_tag"].every((id) =>
        ready.groups.some((group) => group.id === id && group.status === "PASS")) ? "PASS" : "FAIL",
    },
    {
      id: "missing_env_blocks_production",
      status: blocked.status === "BLOCKED" && blocked.missingEnv.some((item) => item.name === "ROOT_JOB_BASE_URL") ? "PASS" : "FAIL",
    },
  ];
  const failed = checks.filter((check) => check.status !== "PASS");
  return {
    label: "Production env matrix",
    status: failed.length ? "FAIL" : "PASS",
    code: failed.length ? 1 : 0,
    durationMs: Date.now() - startedAt,
    checks,
  };
}

function adminDeployBundleCheck() {
  const startedAt = Date.now();
  try {
    const summary = prepareBackendAdminDist({ clean: true });
    const buildManifest = JSON.parse(fs.readFileSync(path.join(summary.target.dir, "admin-build-manifest.json"), "utf8"));
    const checks = [
      { id: "source_admin_dist", status: summary.source.ready ? "PASS" : "FAIL" },
      { id: "backend_public_admin_dist", status: summary.target.ready ? "PASS" : "FAIL" },
      { id: "admin_base_assets", status: summary.target.usesAdminBase ? "PASS" : "FAIL" },
      { id: "admin_js_assets", status: summary.target.jsAssetCount > 0 ? "PASS" : "FAIL" },
      { id: "admin_release_version", status: buildManifest.releaseVersion === candidateVersion ? "PASS" : "FAIL" },
    ];
    const failed = checks.filter((check) => check.status !== "PASS");
    return {
      label: "Backend admin dist bundle",
      command: "node scripts/prepare-backend-admin-dist.js --clean",
      status: failed.length ? "FAIL" : "PASS",
      code: failed.length ? 1 : 0,
      durationMs: Date.now() - startedAt,
      checks,
    };
  } catch (error) {
    return {
      label: "Backend admin dist bundle",
      command: "node scripts/prepare-backend-admin-dist.js --clean",
      status: "FAIL",
      code: 1,
      durationMs: Date.now() - startedAt,
      stderr: error.message,
      failures: error.summary ? [error.summary] : [],
    };
  }
}

function okPayload(payload) {
  if (!payload || payload.code !== 0) {
    throw new Error(payload && payload.message ? payload.message : "HTTP Interface 返回异常");
  }
  return payload.data;
}

async function postJson(baseUrl, route, body, headers = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body || {}),
  });
  return response.json();
}

async function getJson(baseUrl, route, headers = {}) {
  const response = await fetch(`${baseUrl}${route}`, { headers });
  return response.json();
}

async function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

async function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function httpSmoke() {
  const startedAt = Date.now();
  const { createApp } = require(path.join(backendDir, "src", "app"));
  const manualReview = require(path.join(backendDir, "src", "manualReview"));
  const { createSqliteStore } = require(path.join(backendDir, "src", "store"));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "root-final-verify-"));
  const sqliteFile = path.join(tempDir, "verify.sqlite");
  const lifecycleObjectDir = path.join(tempDir, "lifecycle-export-objects");
  const storeAdapter = createSqliteStore(sqliteFile);
  let retrySchedulerCalls = 0;
  const operationalAlertWebhookCalls = [];
  const lifecycleDeliveryRetryAttempts = new Map();
  const server = createApp({
    storeAdapter,
    env: {
      ROOT_ALLOW_OPENID_LOGIN: "true",
      ROOT_REQUIRE_HEALTH_CONSENT: "false",
      ROOT_PRIVACY_CONTROLLER_NAME: "ROOT 最终验收主体",
      ROOT_PRIVACY_CONTACT: "privacy@example.com",
      ROOT_HEALTH_DATA_RETENTION_DAYS: "180",
      ROOT_HEALTH_DATA_RETENTION_CLEANUP_ENABLED: "true",
      YOUZAN_ACCESS_TOKEN: "verify-token",
      YOUZAN_ORDER_LIST_URL: "https://youzan.example/verify/orders",
      ROOT_OPERATIONAL_ALERT_WEBHOOK_URL: "https://hooks.example.com/final-verification-alert",
      ROOT_OPERATIONAL_ALERT_WEBHOOK_SECRET: "verify-alert-secret",
      ROOT_OPERATIONAL_ALERT_WEBHOOK_CHANNEL: "WEWORK",
      ROOT_OPERATIONAL_ALERT_WEBHOOK_TEMPLATE: "final_verification_alert",
      ROOT_MANUAL_REVIEW_EXPLANATION_TEMPLATES: JSON.stringify({
        FREE_ORDER_REVIEW: {
          title: "最终验收免单解释",
          pendingReason: "最终验收核对 {{reason}}",
          evidenceRequired: ["最终验收打卡记录", "最终验收订单证据"],
          operatorGuidance: "最终验收运营指引",
          nextAction: "等待最终验收复核结果。",
        },
      }),
      ROOT_LIFECYCLE_EXPORT_OBJECT_DIR: lifecycleObjectDir,
      ROOT_LIFECYCLE_EXPORT_DOWNLOAD_SECRET: "verify-export-secret",
    },
    fetchImpl: async (url, init) => {
      operationalAlertWebhookCalls.push({ url, init });
      if (url === "https://hooks.example.com/final-verification-export-retry") {
        const attempts = (lifecycleDeliveryRetryAttempts.get(url) || 0) + 1;
        lifecycleDeliveryRetryAttempts.set(url, attempts);
        if (attempts === 1) return { ok: false, status: 500, text: async () => "temporary final verification export failure" };
        return { ok: true, status: 202, text: async () => "accepted final verification export retry" };
      }
      return { ok: true, status: 202, text: async () => "accepted final verification webhook" };
    },
    adapterImplementations: {
      YOUZAN_OPEN: () => {
        retrySchedulerCalls += 1;
        if (retrySchedulerCalls === 1) {
          const error = new Error("最终验收有赞临时失败");
          error.code = 502;
          throw error;
        }
        return {
          samples: [
            {
              有赞订单号: "YZROOTVERIFYRETRY001",
              收货人: "验收自动重试",
              收货手机号: "13800100990",
              商品名称: "ROOT 7日试饮装",
              实付金额: "199",
              订单状态: "已支付",
              物流状态: "已发货",
              收货地址: "上海市自动重试验收地址",
            },
          ],
          externalCount: 1,
          nextCursor: "verify-retry-cursor",
          hasMore: false,
        };
      },
    },
  });
  const checks = [];

  try {
    const baseUrl = await listen(server);
    const health = okPayload(await getJson(baseUrl, "/health"));
    checks.push({ id: "health", status: health.service === "root-checkin" ? "PASS" : "FAIL" });
    checks.push({
      id: "health_release_metadata",
      status: health.version === candidateVersion && health.releaseId === candidateVersion ? "PASS" : "FAIL",
    });

    const ready = okPayload(await getJson(baseUrl, "/ready"));
    checks.push({
      id: "ready",
      status: ready.service === "root-checkin" &&
        ready.version === candidateVersion &&
        ready.releaseId === candidateVersion &&
        ready.store &&
        ready.store.connected === true ? "PASS" : "FAIL",
    });

    const privacyNotice = okPayload(await getJson(baseUrl, "/api/v1/privacy/notice"));
    checks.push({
      id: "public_privacy_notice",
      status: privacyNotice.configured === true &&
        privacyNotice.controllerName === "ROOT 最终验收主体" &&
        privacyNotice.contact === "privacy@example.com" &&
        privacyNotice.retentionDays === 180 ? "PASS" : "FAIL",
    });

    const dashboard = okPayload(await getJson(baseUrl, "/api/v1/admin/dashboard"));
    checks.push({ id: "dashboard", status: dashboard.launchReadiness ? "PASS" : "FAIL" });

    const youzanIdentityPreview = okPayload(await postJson(baseUrl, "/api/v1/jobs/youzan-identity-reconcile", {
      dryRun: true,
      batchSize: 5,
    }));
    checks.push({
      id: "youzan_identity_reconcile",
      status: youzanIdentityPreview.dryRun === true &&
        youzanIdentityPreview.executedCount === 0 &&
        youzanIdentityPreview.batchSize === 5 ? "PASS" : "FAIL",
    });

    const adminHtmlResponse = await fetch(`${baseUrl}/admin`);
    const adminHtml = await adminHtmlResponse.text();
    const adminAssetPath = (adminHtml.match(/\/admin\/assets\/[^"]+\.js/) || [])[0] || "";
    const adminAssetResponse = adminAssetPath ? await fetch(`${baseUrl}${adminAssetPath}`) : null;
    const adminAssetJs = adminAssetResponse ? await adminAssetResponse.text() : "";
    checks.push({
      id: "element_plus_admin_entry",
      status: adminHtmlResponse.status === 200 &&
        adminHtml.includes("myRoot Admin") &&
        adminHtml.includes("/admin/assets/") &&
        adminAssetResponse &&
        adminAssetResponse.status === 200 &&
        adminAssetJs.includes("/api/v1/jobs/lifecycle-user-exports-cleanup") &&
        adminAssetJs.includes("/api/v1/admin/lifecycle-user-exports/delivery-health") &&
        adminAssetJs.includes("过期清理") ? "PASS" : "FAIL",
    });
    const legacyAdminResponse = await fetch(`${baseUrl}/admin-legacy`);
    const legacyAdminHtml = await legacyAdminResponse.text();
    checks.push({
      id: "legacy_admin_fallback",
      status: legacyAdminResponse.status === 200 && legacyAdminHtml.includes("ROOT 7日打卡后台") ? "PASS" : "FAIL",
    });

    const adminProfile = okPayload(await getJson(baseUrl, "/api/v1/admin/me"));
    checks.push({
      id: "admin_profile",
      status: adminProfile.operatorId === "local-admin" &&
        adminProfile.role === "admin" &&
        adminProfile.tokenConfigured === false &&
        adminProfile.capabilities.includes("CONFIG_WRITE") ? "PASS" : "FAIL",
    });

    const rawProbeOpenid = "verify_cloudbase_openid_123456";
    const rawProbeUnionid = "verify_cloudbase_unionid_abcdef";
    const cloudbaseIdentityProbe = okPayload(await getJson(baseUrl, "/api/v1/admin/cloudbase-identity-probe?appCode=MYROOT", {
      "X-WX-OPENID": rawProbeOpenid,
      "X-WX-UNIONID": rawProbeUnionid,
    }));
    checks.push({
      id: "cloudbase_identity_probe",
      status: cloudbaseIdentityProbe.status === "READY" &&
        cloudbaseIdentityProbe.readyForUnionPrimaryKey === true &&
        JSON.stringify(cloudbaseIdentityProbe).includes(rawProbeOpenid) === false &&
        JSON.stringify(cloudbaseIdentityProbe).includes(rawProbeUnionid) === false ? "PASS" : "FAIL",
    });

    const login = okPayload(await postJson(baseUrl, "/api/v1/auth/login", {
      openid: "verify_lifecycle_openid",
      unionid: "verify_lifecycle_unionid",
      appCode: "MYROOT",
    }));
    const lifecycle = okPayload(await getJson(baseUrl, "/api/v1/admin/lifecycle-users?keyword=verify_lifecycle_unionid"));
    const lifecycleFiltered = okPayload(await getJson(
      baseUrl,
      "/api/v1/admin/lifecycle-users?campaignId=ROOT_7D_RESET&unionidStatus=LINKED&taskProgress=NOT_STARTED&consultationStatus=NONE&settlementStatus=NOT_SETTLED&rewardStatus=NONE&openTasks=NO_OPEN_TASKS&limit=20",
    ));
    const lifecycleExport = await fetch(`${baseUrl}/api/v1/admin/lifecycle-users/export?campaignId=ROOT_7D_RESET&unionidStatus=LINKED&taskProgress=NOT_STARTED&consultationStatus=NONE&settlementStatus=NOT_SETTLED&rewardStatus=NONE&openTasks=NO_OPEN_TASKS&limit=20`);
    const lifecycleCsv = await lifecycleExport.text();
    const lifecycleScheduledExport = okPayload(await postJson(baseUrl, "/api/v1/admin/lifecycle-user-exports/create", {
      filters: {
        campaignId: "ROOT_7D_RESET",
        unionidStatus: "LINKED",
        taskProgress: "NOT_STARTED",
        consultationStatus: "NONE",
        settlementStatus: "NOT_SETTLED",
        rewardStatus: "NONE",
        openTasks: "NO_OPEN_TASKS",
        limit: 20,
      },
      retentionDays: 7,
      requestId: "verify-lifecycle-users-export-1",
    }, { "X-Request-Id": "verify-lifecycle-users-export-1" }));
    const lifecycleScheduledExportsBeforeDownload = okPayload(await getJson(baseUrl, "/api/v1/admin/lifecycle-user-exports?limit=10"));
    const lifecycleScheduledExportDownload = await fetch(`${baseUrl}/api/v1/admin/lifecycle-user-exports/${lifecycleScheduledExport.exportRecord.exportId}/download`);
    const lifecycleScheduledExportCsv = await lifecycleScheduledExportDownload.text();
    const lifecycleScheduledExportsAfterDownload = okPayload(await getJson(baseUrl, "/api/v1/admin/lifecycle-user-exports?limit=10"));
    const lifecycleApprovalExport = okPayload(await postJson(baseUrl, "/api/v1/admin/lifecycle-user-exports/create", {
      filters: {
        campaignId: "ROOT_7D_RESET",
        unionidStatus: "LINKED",
        taskProgress: "NOT_STARTED",
        consultationStatus: "NONE",
        settlementStatus: "NOT_SETTLED",
        rewardStatus: "NONE",
        openTasks: "NO_OPEN_TASKS",
        limit: 20,
      },
      approvalRequired: true,
      requestId: "verify-lifecycle-users-export-approval",
    }, { "X-Request-Id": "verify-lifecycle-users-export-approval" }));
    const lifecycleApprovalDownloadBefore = await getJson(baseUrl, `/api/v1/admin/lifecycle-user-exports/${lifecycleApprovalExport.exportRecord.exportId}/download`);
    const lifecycleApprovalReview = okPayload(await postJson(baseUrl, "/api/v1/admin/lifecycle-user-exports/review", {
      exportId: lifecycleApprovalExport.exportRecord.exportId,
      decision: "APPROVED",
      requestId: "verify-lifecycle-users-export-approval-review",
    }, { "X-Request-Id": "verify-lifecycle-users-export-approval-review" }));
    const lifecycleApprovalDownloadAfter = await fetch(`${baseUrl}/api/v1/admin/lifecycle-user-exports/${lifecycleApprovalExport.exportRecord.exportId}/download`);
    const lifecycleApprovalCsv = await lifecycleApprovalDownloadAfter.text();
    const lifecycleDelivery = okPayload(await postJson(baseUrl, "/api/v1/admin/lifecycle-user-exports/deliver", {
      exportId: lifecycleApprovalExport.exportRecord.exportId,
      deliveryChannel: "INTERNAL_LINK",
      requestId: "verify-lifecycle-users-export-delivery",
    }, { "X-Request-Id": "verify-lifecycle-users-export-delivery" }));
    const lifecycleSignedDelivery = okPayload(await postJson(baseUrl, "/api/v1/admin/lifecycle-user-exports/deliver", {
      exportId: lifecycleApprovalExport.exportRecord.exportId,
      deliveryChannel: "INTERNAL_LINK",
      signedDownload: true,
      signedDownloadTtlSeconds: 600,
      requestId: "verify-lifecycle-users-export-signed-delivery",
    }, { "X-Request-Id": "verify-lifecycle-users-export-signed-delivery" }));
    const lifecycleSignedDownload = await fetch(`${baseUrl}${lifecycleSignedDelivery.delivery.externalRef}`);
    const lifecycleSignedCsv = await lifecycleSignedDownload.text();
    const lifecycleSignedInvalid = await getJson(
      baseUrl,
      lifecycleSignedDelivery.delivery.externalRef.replace(/signature=[^&]+/, "signature=bad-signature"),
    );
    const lifecycleWebhookDelivery = okPayload(await postJson(baseUrl, "/api/v1/admin/lifecycle-user-exports/deliver", {
      exportId: lifecycleApprovalExport.exportRecord.exportId,
      deliveryChannel: "WEBHOOK",
      webhookUrl: "https://hooks.example.com/final-verification-export",
      webhookSecret: "verify-export-webhook-secret",
      webhookChannel: "WEWORK",
      webhookTemplate: "lifecycle_export_ready",
      signedDownload: true,
      signedDownloadTtlSeconds: 600,
      requestId: "verify-lifecycle-users-export-webhook-delivery",
    }, { "X-Request-Id": "verify-lifecycle-users-export-webhook-delivery" }));
    const lifecycleWebhookCall = operationalAlertWebhookCalls.find((call) => call.url === "https://hooks.example.com/final-verification-export");
    const lifecycleWebhookPayload = lifecycleWebhookCall ? JSON.parse(lifecycleWebhookCall.init.body) : {};
    const lifecycleRetryExport = okPayload(await postJson(baseUrl, "/api/v1/admin/lifecycle-user-exports/create", {
      filters: {
        campaignId: "ROOT_7D_RESET",
        unionidStatus: "LINKED",
        taskProgress: "NOT_STARTED",
        consultationStatus: "NONE",
        settlementStatus: "NOT_SETTLED",
        rewardStatus: "NONE",
        openTasks: "NO_OPEN_TASKS",
        limit: 20,
      },
      requestId: "verify-lifecycle-users-export-delivery-retry-source",
      now: "2026-06-20T09:10:00+08:00",
    }, { "X-Request-Id": "verify-lifecycle-users-export-delivery-retry-source" }));
    const lifecycleRetryScheduled = okPayload(await postJson(baseUrl, "/api/v1/admin/lifecycle-user-exports/deliver", {
      exportId: lifecycleRetryExport.exportRecord.exportId,
      deliveryChannel: "WEBHOOK",
      webhookUrl: "https://hooks.example.com/final-verification-export-retry",
      webhookSecret: "verify-export-webhook-secret",
      webhookChannel: "WEWORK",
      webhookTemplate: "lifecycle_export_ready",
      signedDownload: true,
      deliveryRetryEnabled: true,
      deliveryMaxAttempts: 2,
      deliveryRetryDelaySeconds: 60,
      requestId: "verify-lifecycle-users-export-delivery-retry-first",
      now: "2026-06-20T09:11:00+08:00",
    }, { "X-Request-Id": "verify-lifecycle-users-export-delivery-retry-first" }));
    const lifecycleDeliveryHealthBeforeRetry = okPayload(await getJson(
      baseUrl,
      "/api/v1/admin/lifecycle-user-exports/delivery-health?now=2026-06-20T09:12:01%2B08:00",
    ));
    const lifecycleDeliveryRetryPreview = await collectLifecycleUserExportsDeliveryRetry(parseLifecycleUserExportsDeliveryRetryArgs([
      "--base-url", baseUrl,
      "--admin-token", "dev-admin-token",
      "--dry-run",
      "--now", "2026-06-20T09:12:01+08:00",
      "--batch-size", "5",
    ]));
    const lifecycleDeliveryRetryExecute = await collectLifecycleUserExportsDeliveryRetry(parseLifecycleUserExportsDeliveryRetryArgs([
      "--base-url", baseUrl,
      "--admin-token", "dev-admin-token",
      "--execute",
      "--now", "2026-06-20T09:12:01+08:00",
      "--batch-size", "5",
      "--max-attempts", "2",
      "--retry-delay-seconds", "60",
      "--delivery-channel", "WEBHOOK",
      "--webhook-url", "https://hooks.example.com/final-verification-export-retry",
      "--webhook-secret", "verify-export-webhook-secret",
      "--webhook-channel", "WEWORK",
      "--webhook-template", "lifecycle_export_ready",
      "--signed-download",
      "--request-id", "verify-lifecycle-user-exports-delivery-retry-1",
    ]));
    const lifecycleDeliveryHealthAfterRetry = okPayload(await getJson(
      baseUrl,
      "/api/v1/admin/lifecycle-user-exports/delivery-health?now=2026-06-20T09:12:02%2B08:00",
    ));
    const lifecycleObjectDelivery = okPayload(await postJson(baseUrl, "/api/v1/admin/lifecycle-user-exports/deliver", {
      exportId: lifecycleApprovalExport.exportRecord.exportId,
      deliveryChannel: "OBJECT_STORAGE",
      objectPrefix: "verify-lifecycle-exports",
      requestId: "verify-lifecycle-users-export-object-delivery",
    }, { "X-Request-Id": "verify-lifecycle-users-export-object-delivery" }));
    const lifecycleObjectPath = lifecycleObjectDelivery.delivery && lifecycleObjectDelivery.delivery.target
      ? path.join(lifecycleObjectDir, lifecycleObjectDelivery.delivery.target.objectKey || "")
      : "";
    const lifecycleExpiredObjectExport = okPayload(await postJson(baseUrl, "/api/v1/admin/lifecycle-user-exports/create", {
      filters: {
        campaignId: "ROOT_7D_RESET",
        unionidStatus: "LINKED",
        taskProgress: "NOT_STARTED",
        consultationStatus: "NONE",
        settlementStatus: "NOT_SETTLED",
        rewardStatus: "NONE",
        openTasks: "NO_OPEN_TASKS",
        limit: 20,
      },
      retentionDays: 1,
      now: "2026-06-01T09:00:00+08:00",
      requestId: "verify-lifecycle-users-export-object-expired",
    }, { "X-Request-Id": "verify-lifecycle-users-export-object-expired" }));
    const lifecycleExpiredObjectDelivery = okPayload(await postJson(baseUrl, "/api/v1/admin/lifecycle-user-exports/deliver", {
      exportId: lifecycleExpiredObjectExport.exportRecord.exportId,
      deliveryChannel: "OBJECT_STORAGE",
      objectPrefix: "verify-lifecycle-exports",
      now: "2026-06-01T09:01:00+08:00",
      requestId: "verify-lifecycle-users-export-object-expired-delivery",
    }, { "X-Request-Id": "verify-lifecycle-users-export-object-expired-delivery" }));
    const lifecycleExpiredObjectPath = lifecycleExpiredObjectDelivery.delivery && lifecycleExpiredObjectDelivery.delivery.target
      ? path.join(lifecycleObjectDir, lifecycleExpiredObjectDelivery.delivery.target.objectKey || "")
      : "";
    const lifecycleExportCleanupPreview = await collectLifecycleUserExportsCleanup(parseLifecycleUserExportsCleanupArgs([
      "--base-url", baseUrl,
      "--admin-token", "dev-admin-token",
      "--dry-run",
      "--now", "2026-06-20T09:02:00+08:00",
      "--object-dir", lifecycleObjectDir,
    ]));
    const lifecycleExportCleanupExecute = await collectLifecycleUserExportsCleanup(parseLifecycleUserExportsCleanupArgs([
      "--base-url", baseUrl,
      "--admin-token", "dev-admin-token",
      "--execute",
      "--now", "2026-06-20T09:03:00+08:00",
      "--object-dir", lifecycleObjectDir,
      "--request-id", "verify-lifecycle-user-exports-cleanup-1",
    ]));
    const lifecycleExportDryRun = await collectLifecycleUsersExport(parseLifecycleUsersExportArgs([
      "--base-url", baseUrl,
      "--admin-token", "dev-admin-token",
      "--dry-run",
      "--campaign", "ROOT_7D_RESET",
      "--unionid-status", "LINKED",
      "--task-progress", "NOT_STARTED",
      "--limit", "20",
    ]));
    const lifecyclePresetSave = okPayload(await postJson(baseUrl, "/api/v1/admin/lifecycle-filter-presets/upsert", {
      title: "验收常用筛选",
      scope: "TEAM",
      pinned: true,
      sortOrder: 10,
      filters: {
        campaignId: "ROOT_7D_RESET",
        unionidStatus: "LINKED",
        taskProgress: "NOT_STARTED",
        consultationStatus: "NONE",
        settlementStatus: "NOT_SETTLED",
        rewardStatus: "NONE",
        openTasks: "NO_OPEN_TASKS",
        limit: 20,
      },
      requestId: "verify-lifecycle-filter-1",
    }, { "X-Request-Id": "verify-lifecycle-filter-1" }));
    const lifecyclePresetCopy = okPayload(await postJson(baseUrl, "/api/v1/admin/lifecycle-filter-presets/copy", {
      sourcePresetId: lifecyclePresetSave.preset.presetId,
      requestId: "verify-lifecycle-filter-copy-1",
    }, { "X-Request-Id": "verify-lifecycle-filter-copy-1" }));
    const lifecyclePresets = okPayload(await getJson(baseUrl, "/api/v1/admin/lifecycle-filter-presets"));
    const lifecycleFilterBatch = okPayload(await postJson(baseUrl, "/api/v1/admin/lifecycle-users/settlement-batch-preview", {
      filters: {
        campaignId: "ROOT_7D_RESET",
        unionidStatus: "LINKED",
        taskProgress: "NOT_STARTED",
        consultationStatus: "NONE",
        settlementStatus: "NOT_SETTLED",
        rewardStatus: "NONE",
        openTasks: "NO_OPEN_TASKS",
        limit: 1,
      },
      selectionLimit: 20,
    }));
    const lifecycleJobCreate = okPayload(await postJson(baseUrl, "/api/v1/admin/lifecycle-settlement-jobs/create", {
      filters: {
        campaignId: "ROOT_7D_RESET",
        unionidStatus: "LINKED",
        taskProgress: "NOT_STARTED",
        consultationStatus: "NONE",
        settlementStatus: "NOT_SETTLED",
        rewardStatus: "NONE",
        openTasks: "NO_OPEN_TASKS",
        limit: 1,
      },
      selectionLimit: 20,
      batchSize: 1,
      confirmRisk: true,
      requestId: "verify-lifecycle-job-create-1",
    }, { "X-Request-Id": "verify-lifecycle-job-create-1" }));
    const lifecycleSchedulerJobCreate = okPayload(await postJson(baseUrl, "/api/v1/admin/lifecycle-settlement-jobs/create", {
      filters: {
        campaignId: "ROOT_7D_RESET",
        unionidStatus: "LINKED",
        taskProgress: "NOT_STARTED",
        consultationStatus: "NONE",
        settlementStatus: "NOT_SETTLED",
        rewardStatus: "NONE",
        openTasks: "NO_OPEN_TASKS",
        limit: 1,
      },
      selectionLimit: 20,
      batchSize: 1,
      confirmRisk: true,
      requestId: "verify-lifecycle-scheduler-create-1",
    }, { "X-Request-Id": "verify-lifecycle-scheduler-create-1" }));
    const lifecycleJobList = okPayload(await getJson(baseUrl, "/api/v1/admin/lifecycle-settlement-jobs?campaignId=ROOT_7D_RESET"));
    const lifecycleSchedulerPreview = await collectLifecycleSettlementJob(parseLifecycleSettlementArgs([
      "--base-url", baseUrl,
      "--admin-token", "dev-admin-token",
      "--dry-run",
      "--campaign", "ROOT_7D_RESET",
      "--job-limit", "3",
    ]));
    const lifecycleJobRun = okPayload(await postJson(baseUrl, "/api/v1/admin/lifecycle-settlement-jobs/run", {
      jobId: lifecycleJobCreate.job.jobId,
      batchSize: 1,
      requestId: "verify-lifecycle-job-run-1",
    }, { "X-Request-Id": "verify-lifecycle-job-run-1" }));
    const lifecycleSchedulerExecute = await collectLifecycleSettlementJob(parseLifecycleSettlementArgs([
      "--base-url", baseUrl,
      "--admin-token", "dev-admin-token",
      "--execute",
      "--campaign", "ROOT_7D_RESET",
      "--job-limit", "3",
      "--request-id", "verify-lifecycle-scheduler-run-1",
    ]));
    storeAdapter.data.adminLifecycleSettlementJobs.unshift({
      job_id: "verify_lifecycle_cleanup_running_1",
      source: "LIFECYCLE_FILTER",
      status: "RUNNING",
      campaign_id: "ROOT_7D_RESET",
      request_id: "verify-lifecycle-cleanup-running",
      operator_id: "verify-ops",
      reason: "最终验收生命周期结算超时清理",
      batch_size: 20,
      filters_json: { campaignId: "ROOT_7D_RESET" },
      selection_json: { total: 2, selectedCount: 2, selectionLimit: 2, truncated: false, users: [] },
      root_user_ids: ["verify_root_cleanup_done", "verify_root_cleanup_pending"],
      processed_root_user_ids: ["verify_root_cleanup_done"],
      failed_root_user_ids: [],
      items_json: [{ rootUserId: "verify_root_cleanup_done", status: "SKIPPED", executed: false }],
      last_run_json: { requestId: "verify-lifecycle-cleanup-last" },
      total_count: 2,
      run_count: 1,
      error_message: "",
      created_at: "2026-06-19T08:00:00+08:00",
      updated_at: "2026-06-19T08:10:00+08:00",
      started_at: "2026-06-19T08:00:00+08:00",
      finished_at: "",
      cancelled_at: "",
    });
    const lifecycleCleanupPreview = await collectLifecycleSettlementCleanup(parseLifecycleSettlementCleanupArgs([
      "--base-url", baseUrl,
      "--admin-token", "dev-admin-token",
      "--dry-run",
      "--campaign", "ROOT_7D_RESET",
      "--stale-minutes", "120",
      "--job-limit", "5",
    ]));
    const lifecycleCleanupExecute = await collectLifecycleSettlementCleanup(parseLifecycleSettlementCleanupArgs([
      "--base-url", baseUrl,
      "--admin-token", "dev-admin-token",
      "--execute",
      "--campaign", "ROOT_7D_RESET",
      "--stale-minutes", "120",
      "--job-limit", "5",
      "--request-id", "verify-lifecycle-cleanup-run-1",
    ]));
    const consultationEvent = okPayload(await postJson(baseUrl, "/api/v1/tasks/events", {
      taskType: "CONSULTATION",
      taskDate: "2026-06-20",
      sourceChannel: "MINIPROGRAM_SUPPORT",
      payload: { taskDate: "2026-06-20", consultationType: "REWARD", scene: "FINAL_VERIFY" },
      idempotencyKey: "verify-consultation-wework-writeback",
    }, { Authorization: `Bearer ${login.token}` }));
    const consultationAssignment = okPayload(await postJson(baseUrl, "/api/v1/admin/consultation-advisor-assignments", {
      taskId: consultationEvent.followUp.task.task_id,
      advisorId: "advisor-final",
      advisorName: "最终验收顾问",
      requestId: "verify-consultation-advisor-assignment-1",
    }, { "X-Request-Id": "verify-consultation-advisor-assignment-1" }));
    const consultationAssignmentList = okPayload(await getJson(baseUrl, `/api/v1/admin/consultation-advisor-assignments?taskId=${consultationEvent.followUp.task.task_id}`));
    const consultationWriteback = okPayload(await postJson(baseUrl, "/api/v1/admin/consultation-wework-writebacks", {
      taskId: consultationEvent.followUp.task.task_id,
      adapterMode: "MANUAL",
      result: "WEWORK_CONTACTED",
      note: "最终验收企微联系 token=secret-token",
      requestId: "verify-consultation-wework-writeback-1",
    }, { "X-Request-Id": "verify-consultation-wework-writeback-1" }));
    const consultationWritebackList = okPayload(await getJson(baseUrl, `/api/v1/admin/consultation-wework-writebacks?taskId=${consultationEvent.followUp.task.task_id}`));
    const consultationDoneView = okPayload(await getJson(baseUrl, "/api/v1/user/consultations", {
      Authorization: `Bearer ${login.token}`,
    }));
    const weworkTouchLogin = okPayload(await postJson(baseUrl, "/api/v1/auth/login", {
      openid: "verify_wework_touch_openid",
      unionid: "verify_wework_touch_unionid",
      appCode: "MYROOT",
    }));
    const weworkTouchEvent = okPayload(await postJson(baseUrl, "/api/v1/tasks/events", {
      taskType: "CONSULTATION",
      taskDate: "2026-06-20",
      sourceChannel: "MINIPROGRAM_SUPPORT",
      payload: { taskDate: "2026-06-20", consultationType: "BODY_FEEDBACK", scene: "FINAL_VERIFY_TOUCH" },
      idempotencyKey: "verify-wework-touch-consultation",
    }, { Authorization: `Bearer ${weworkTouchLogin.token}` }));
    storeAdapter.data.leadProfiles.push({
      lead_id: "lead_verify_wework_touch_001",
      user_id: weworkTouchEvent.followUp.task.user_id,
      root_user_id: weworkTouchLogin.user.rootUserId,
      external_contact_id: "wm_verify_touch_001",
      wechat_remark_name: "最终验收自动触达用户",
      receiver_phone: "",
      source_channel: "WEWORK",
      offline_event_name: "",
      corp_wechat_status: "ADDED",
      operator_note: "",
      created_at: "2026-06-20T10:01:00.000Z",
      updated_at: "2026-06-20T10:01:00.000Z",
    });
    const weworkTouchPlan = okPayload(await postJson(baseUrl, "/api/v1/admin/wework-touch-jobs/plan", {
      dryRun: false,
      taskTypes: ["CONSULTATION_FOLLOW"],
      adapterMode: "MANUAL",
      requestId: "verify-wework-touch-plan-1",
      reason: "最终验收企微自动触达计划",
    }, { "X-Request-Id": "verify-wework-touch-plan-1" }));
    const weworkTouchRunner = await collectWeWorkTouchJob(parseWeWorkTouchArgs([
      "--base-url", baseUrl,
      "--execute",
      "--adapter-mode", "MANUAL",
      "--batch-size", "5",
      "--request-id", "verify-wework-touch-runner-1",
      "--reason", "最终验收企微自动触达命令行 Job",
    ]));
    const weworkTouchJobs = okPayload(await getJson(baseUrl, `/api/v1/admin/wework-touch-jobs?taskId=${weworkTouchEvent.followUp.task.task_id}`));
    const weworkTouchDoneView = okPayload(await getJson(baseUrl, "/api/v1/user/consultations", {
      Authorization: `Bearer ${weworkTouchLogin.token}`,
    }));
    const consultationSlaEvent = okPayload(await postJson(baseUrl, "/api/v1/tasks/events", {
      taskType: "CONSULTATION",
      taskDate: "2026-06-20",
      sourceChannel: "MINIPROGRAM_SUPPORT",
      payload: { taskDate: "2026-06-20", consultationType: "BODY_FEEDBACK", scene: "FINAL_VERIFY_SLA" },
      idempotencyKey: "verify-consultation-sla-overdue",
    }, { Authorization: `Bearer ${login.token}` }));
    const consultationSlaTask = storeAdapter.data.operationTasks.find((item) => item.task_id === consultationSlaEvent.followUp.task.task_id);
    if (consultationSlaTask) consultationSlaTask.created_at = "2026-01-01T08:00:00+08:00";
    const consultationSlaAssignment = okPayload(await postJson(baseUrl, "/api/v1/admin/consultation-advisor-assignments", {
      taskId: consultationSlaEvent.followUp.task.task_id,
      advisorId: "advisor-final",
      advisorName: "最终验收顾问",
      requestId: "verify-consultation-sla-assignment-1",
    }, { "X-Request-Id": "verify-consultation-sla-assignment-1" }));
    const consultationSla = okPayload(await getJson(baseUrl, `/api/v1/admin/consultation-sla?rootUserId=${login.user.rootUserId}&slaMinutes=120&now=2026-01-01T11%3A30%3A00%2B08%3A00`));
    const consultationSlaEscalation = okPayload(await getJson(baseUrl, `/api/v1/admin/consultation-sla-escalations?rootUserId=${login.user.rootUserId}&slaMinutes=120&now=2026-01-01T11%3A30%3A00%2B08%3A00`));
    const consultationAdvisorWorkbench = okPayload(await getJson(baseUrl, "/api/v1/admin/consultation-advisor-workbench?slaMinutes=120&now=2026-01-01T11%3A30%3A00%2B08%3A00"));
    const questionnaireLogin = okPayload(await postJson(baseUrl, "/api/v1/auth/login", {
      openid: "verify_questionnaire_openid",
      unionid: "verify_questionnaire_unionid",
      appCode: "MYROOT",
    }));
    const questionnaireAnswer = okPayload(await postJson(baseUrl, "/api/v1/questionnaire/answers", {
      campaignId: "ROOT_7D_RESET",
      questionnaireType: "DAY4_MIDPOINT",
      taskDate: "2026-06-20",
      answers: { stoolChange: "worse", comfortScore: 3, needsContact: true, contactReason: "最终验收跟进", feedback: "最终验收问卷" },
      idempotencyKey: "verify-questionnaire-answer-day4",
    }, { Authorization: `Bearer ${questionnaireLogin.token}` }));
    const questionnaireAnswerStatus = okPayload(await getJson(baseUrl, "/api/v1/questionnaire/answers/status?campaignId=ROOT_7D_RESET", {
      Authorization: `Bearer ${questionnaireLogin.token}`,
    }));
    const questionnaireProgress = okPayload(await getJson(baseUrl, "/api/v1/tasks/progress", {
      Authorization: `Bearer ${questionnaireLogin.token}`,
    }));
    const questionnaireLifecycle = okPayload(await getJson(baseUrl, "/api/v1/admin/lifecycle-users?keyword=verify_questionnaire_unionid"));
    checks.push({
      id: "lifecycle_users",
      status: lifecycle.metrics.unionidLinked === 1 && lifecycle.users[0] && lifecycle.users[0].rootUserId === login.user.rootUserId ? "PASS" : "FAIL",
    });
    checks.push({
      id: "lifecycle_filters",
      status: lifecycleFiltered.total === 1 &&
        lifecycleFiltered.filters.limit === 20 &&
        lifecycleFiltered.users[0] &&
        lifecycleFiltered.users[0].rootUserId === login.user.rootUserId &&
        lifecycleFiltered.users[0].taskProgressStatus === "NOT_STARTED" &&
        lifecycleFiltered.users[0].consultationStatus === "NONE" &&
        lifecycleFiltered.users[0].settlementStatus === "NOT_SETTLED" &&
        lifecycleFiltered.users[0].rewardStatus === "NONE" ? "PASS" : "FAIL",
    });
    checks.push({
      id: "questionnaire_answer",
      status: questionnaireAnswer.created === true &&
        questionnaireAnswer.answer.questionnaireId === "DAY4_MIDPOINT" &&
        questionnaireAnswerStatus.DAY4_MIDPOINT === true &&
        questionnaireProgress.progress.tasks.some((task) => task.taskType === "QUESTIONNAIRE" && task.config.questionnaireType === "DAY4_MIDPOINT" && task.status === "DONE") &&
        questionnaireLifecycle.users[0] &&
        questionnaireLifecycle.users[0].questionnaireSummary.answerCount === 1 &&
        questionnaireLifecycle.users[0].questionnaireSummary.latestNeedsFollow === true ? "PASS" : "FAIL",
    });
    checks.push({
      id: "consultation_advisor_assignment",
      status: consultationAssignment.success === true &&
        consultationAssignment.assignment.advisorId === "advisor-final" &&
        consultationAssignment.task.metadata.assignedAdvisorName === "最终验收顾问" &&
        consultationAssignmentList.assignments.length === 1 ? "PASS" : "FAIL",
    });
    checks.push({
      id: "consultation_wework_writeback",
      status: consultationEvent.followUp.created === true &&
        consultationWriteback.success === true &&
        consultationWriteback.writeback.status === "DELIVERED" &&
        consultationWriteback.task.status === "DONE" &&
        consultationWritebackList.writebacks.length === 1 &&
        consultationDoneView.summary.handledCount === 1 &&
        consultationDoneView.consultations[0].statusCopy === "最终验收企微联系 token=***" &&
        JSON.stringify(consultationWritebackList).includes("secret-token") === false ? "PASS" : "FAIL",
    });
    checks.push({
      id: "wework_touch_job",
      status: weworkTouchEvent.followUp.created === true &&
        weworkTouchPlan.createdCount === 1 &&
        weworkTouchPlan.jobs[0] &&
        weworkTouchPlan.jobs[0].status === "PENDING" &&
        weworkTouchRunner.ok === true &&
        weworkTouchRunner.data.successCount === 1 &&
        weworkTouchJobs.jobs.length === 1 &&
        weworkTouchJobs.jobs[0].status === "DELIVERED" &&
        weworkTouchJobs.jobs[0].externalContactId === "wm_verify_touch_001" &&
        weworkTouchDoneView.summary.handledCount === 1 ? "PASS" : "FAIL",
    });
    checks.push({
      id: "consultation_sla_overdue",
      status: consultationSlaEvent.followUp.created === true &&
        consultationSlaAssignment.assignment.advisorId === "advisor-final" &&
        consultationSla.summary.overdueCount >= 1 &&
        consultationSla.items.some((item) =>
          item.taskId === consultationSlaEvent.followUp.task.task_id &&
          item.status === "OVERDUE" &&
          item.assignedAdvisorName === "最终验收顾问" &&
          item.overdueMinutes === 90) ? "PASS" : "FAIL",
    });
    checks.push({
      id: "consultation_sla_escalation",
      status: consultationSlaEscalation.summary.escalatedCount >= 1 &&
        consultationSlaEscalation.items.some((item) =>
          item.taskId === consultationSlaEvent.followUp.task.task_id &&
          item.escalationLevel === 2 &&
          item.escalationOwnerRole === "运营" &&
          item.nextEscalationLabel === "负责人升级") ? "PASS" : "FAIL",
    });
    checks.push({
      id: "consultation_advisor_workbench",
      status: consultationAdvisorWorkbench.summary.activeAdvisorCount >= 1 &&
        consultationAdvisorWorkbench.summary.overdueCount >= 1 &&
        consultationAdvisorWorkbench.advisors.some((item) =>
          item.advisorId === "advisor-final" &&
          item.advisorName === "最终验收顾问" &&
          item.status === "ATTENTION") &&
        consultationAdvisorWorkbench.items.some((item) =>
          item.taskId === consultationSlaEvent.followUp.task.task_id &&
          item.status === "OVERDUE") ? "PASS" : "FAIL",
    });
    checks.push({
      id: "lifecycle_export",
      status: (lifecycleExport.headers.get("content-type") || "").includes("text/csv") &&
        lifecycleCsv.includes("root_user_id,user_id,nickname,phone") &&
        lifecycleCsv.includes(login.user.rootUserId) &&
        !lifecycleCsv.includes("verify_lifecycle_unionid") ? "PASS" : "FAIL",
    });
    checks.push({
      id: "lifecycle_scheduled_export",
      status: lifecycleScheduledExport.executed === true &&
        lifecycleScheduledExport.exportRecord &&
        lifecycleScheduledExport.exportRecord.summary.exportedCount === 1 &&
        lifecycleScheduledExport.exportRecord.approvalStatus === "NOT_REQUIRED" &&
        lifecycleScheduledExportsBeforeDownload.some((item) => item.exportId === lifecycleScheduledExport.exportRecord.exportId && item.downloadCount === 0) &&
        (lifecycleScheduledExportDownload.headers.get("content-type") || "").includes("text/csv") &&
        lifecycleScheduledExportCsv.includes(login.user.rootUserId) &&
        !lifecycleScheduledExportCsv.includes("verify_lifecycle_unionid") &&
        lifecycleScheduledExportsAfterDownload.some((item) => item.exportId === lifecycleScheduledExport.exportRecord.exportId && item.downloadCount === 1) &&
        lifecycleExportDryRun.ok &&
        lifecycleExportDryRun.data.dryRun === true &&
        lifecycleExportDryRun.data.summary.total >= 1 &&
        lifecycleExportDryRun.data.summary.sensitivity === "MASKED" ? "PASS" : "FAIL",
    });
    checks.push({
      id: "lifecycle_export_approval",
      status: lifecycleApprovalExport.exportRecord &&
        lifecycleApprovalExport.exportRecord.approvalRequired === true &&
        lifecycleApprovalExport.exportRecord.approvalStatus === "PENDING" &&
        lifecycleApprovalDownloadBefore.code === 8033 &&
        lifecycleApprovalReview.exportRecord.approvalStatus === "APPROVED" &&
        (lifecycleApprovalDownloadAfter.headers.get("content-type") || "").includes("text/csv") &&
        lifecycleApprovalCsv.includes(login.user.rootUserId) ? "PASS" : "FAIL",
    });
    checks.push({
      id: "lifecycle_export_delivery",
      status: lifecycleDelivery.delivered === true &&
        lifecycleDelivery.delivery &&
        lifecycleDelivery.delivery.status === "DELIVERED" &&
        String(lifecycleDelivery.delivery.externalRef || "").includes("/api/v1/admin/lifecycle-user-exports/") ? "PASS" : "FAIL",
    });
    checks.push({
      id: "lifecycle_export_signed_download",
      status: lifecycleSignedDelivery.delivered === true &&
        lifecycleSignedDelivery.delivery &&
        lifecycleSignedDelivery.delivery.status === "DELIVERED" &&
        lifecycleSignedDelivery.delivery.target.signedDownload === true &&
        String(lifecycleSignedDelivery.delivery.externalRef || "").includes("/api/v1/lifecycle-user-exports/") &&
        !String(lifecycleSignedDelivery.delivery.externalRef || "").includes("/api/v1/admin/") &&
        lifecycleSignedDownload.status === 200 &&
        lifecycleSignedCsv.includes(login.user.rootUserId) &&
        !lifecycleSignedCsv.includes("verify_lifecycle_unionid") &&
        lifecycleSignedInvalid.code === 8042 ? "PASS" : "FAIL",
    });
    checks.push({
      id: "lifecycle_export_webhook_delivery",
      status: lifecycleWebhookDelivery.delivered === true &&
        lifecycleWebhookDelivery.delivery &&
        lifecycleWebhookDelivery.delivery.status === "DELIVERED" &&
        lifecycleWebhookDelivery.delivery.externalRef === "HTTP 202" &&
        lifecycleWebhookDelivery.delivery.target.webhookChannel === "WEWORK" &&
        lifecycleWebhookDelivery.delivery.target.webhookTemplate === "lifecycle_export_ready" &&
        lifecycleWebhookDelivery.delivery.target.webhookStatusCode === 202 &&
        lifecycleWebhookDelivery.delivery.target.webhookSigned === true &&
        lifecycleWebhookDelivery.delivery.target.signedDownload === true &&
        lifecycleWebhookDelivery.delivery.target.webhookResponsePreview === "accepted final verification webhook" &&
        lifecycleWebhookCall &&
        lifecycleWebhookCall.init.headers["X-Root-Export-Signed-Download"] === "true" &&
        lifecycleWebhookCall.init.headers["X-Root-Export-Webhook-Channel"] === "WEWORK" &&
        String(lifecycleWebhookPayload.export && lifecycleWebhookPayload.export.signedDownloadUrl || "").includes("/api/v1/lifecycle-user-exports/") &&
        !String(lifecycleWebhookPayload.export && lifecycleWebhookPayload.export.signedDownloadUrl || "").includes("/api/v1/admin/") ? "PASS" : "FAIL",
    });
    checks.push({
      id: "lifecycle_export_delivery_retry",
      status: lifecycleRetryScheduled.delivered === false &&
        lifecycleRetryScheduled.delivery &&
        lifecycleRetryScheduled.delivery.status === "RETRY_SCHEDULED" &&
        lifecycleRetryScheduled.delivery.nextRetryAt === "2026-06-20T09:12:00+08:00" &&
        lifecycleDeliveryRetryPreview.ok &&
        lifecycleDeliveryRetryPreview.data.selectedCount === 1 &&
        lifecycleDeliveryRetryPreview.data.candidates.some((item) => item.exportId === lifecycleRetryExport.exportRecord.exportId) &&
        lifecycleDeliveryRetryExecute.ok &&
        lifecycleDeliveryRetryExecute.data.executed === true &&
        lifecycleDeliveryRetryExecute.data.deliveredCount === 1 &&
        lifecycleDeliveryRetryExecute.data.results.some((item) => item.exportId === lifecycleRetryExport.exportRecord.exportId && item.status === "DELIVERED") ? "PASS" : "FAIL",
    });
    checks.push({
      id: "lifecycle_export_delivery_health",
      status: lifecycleDeliveryHealthBeforeRetry.status === "WARNING" &&
        lifecycleDeliveryHealthBeforeRetry.summary.retryScheduledCount === 1 &&
        lifecycleDeliveryHealthBeforeRetry.summary.dueRetryCount === 1 &&
        lifecycleDeliveryHealthBeforeRetry.channels.some((item) => item.channel === "WEBHOOK" && item.dueRetry === 1) &&
        lifecycleDeliveryHealthAfterRetry.summary.dueRetryCount === 0 &&
        lifecycleDeliveryHealthAfterRetry.channels.some((item) => item.channel === "WEBHOOK" && item.delivered >= 1 && item.dueRetry === 0) ? "PASS" : "FAIL",
    });
    checks.push({
      id: "lifecycle_export_object_storage",
      status: lifecycleObjectDelivery.delivered === true &&
        lifecycleObjectDelivery.delivery &&
        lifecycleObjectDelivery.delivery.status === "DELIVERED" &&
        lifecycleObjectDelivery.delivery.target.adapter === "FILESYSTEM" &&
        fs.existsSync(lifecycleObjectPath) &&
        fs.readFileSync(lifecycleObjectPath, "utf8").includes(login.user.rootUserId) ? "PASS" : "FAIL",
    });
    checks.push({
      id: "lifecycle_export_cleanup",
      status: lifecycleExpiredObjectDelivery.delivered === true &&
        fs.existsSync(lifecycleExpiredObjectPath) === false &&
        fs.existsSync(`${lifecycleExpiredObjectPath}.metadata.json`) === false &&
        lifecycleExportCleanupPreview.ok &&
        lifecycleExportCleanupPreview.data.candidates.some((item) => item.exportId === lifecycleExpiredObjectExport.exportRecord.exportId && item.delivery.objectKey) &&
        lifecycleExportCleanupExecute.ok &&
        lifecycleExportCleanupExecute.data.removedCount >= 1 &&
        lifecycleExportCleanupExecute.data.objectDeletedCount >= 1 ? "PASS" : "FAIL",
    });
    checks.push({
      id: "lifecycle_filter_presets",
      status: lifecyclePresetSave.preset &&
        lifecyclePresetSave.preset.title === "验收常用筛选" &&
        lifecyclePresetSave.preset.scope === "TEAM" &&
        lifecyclePresetSave.preset.pinned === true &&
        lifecyclePresetSave.preset.sortOrder === 10 &&
        lifecyclePresetCopy.preset &&
        lifecyclePresetCopy.sourcePreset.presetId === lifecyclePresetSave.preset.presetId &&
        lifecyclePresetCopy.preset.scope === "PERSONAL" &&
        lifecyclePresets.presets.some((item) => item.presetId === lifecyclePresetSave.preset.presetId && item.filters.taskProgress === "NOT_STARTED" && item.scope === "TEAM" && item.pinned === true) &&
        lifecyclePresets.presets.some((item) => item.presetId === lifecyclePresetCopy.preset.presetId && item.filters.taskProgress === "NOT_STARTED" && item.scope === "PERSONAL") ? "PASS" : "FAIL",
    });
    checks.push({
      id: "lifecycle_filter_batch",
      status: lifecycleFilterBatch.source === "LIFECYCLE_FILTER" &&
        lifecycleFilterBatch.selection.total === 1 &&
        lifecycleFilterBatch.selection.selectedCount === 1 &&
        lifecycleFilterBatch.selection.filters.limit === 1 &&
        lifecycleFilterBatch.summary.total === 1 ? "PASS" : "FAIL",
    });
    checks.push({
      id: "lifecycle_settlement_jobs",
      status: lifecycleJobCreate.job &&
        lifecycleJobCreate.job.status === "QUEUED" &&
        lifecycleSchedulerJobCreate.job.status === "QUEUED" &&
        lifecycleJobCreate.job.summary.selected === 1 &&
        lifecycleJobList.jobs.some((job) => job.jobId === lifecycleJobCreate.job.jobId) &&
        lifecycleJobRun.job.status === "COMPLETED" &&
        lifecycleJobRun.job.summary.processed === 1 &&
        lifecycleJobRun.job.summary.skipped === 1 ? "PASS" : "FAIL",
    });
    checks.push({
      id: "lifecycle_settlement_scheduler",
      status: lifecycleSchedulerPreview.ok &&
        lifecycleSchedulerPreview.data.selectedCount >= 1 &&
        lifecycleSchedulerExecute.ok &&
        lifecycleSchedulerExecute.data.executedCount >= 1 &&
        lifecycleSchedulerExecute.data.results.some((item) => item.job.jobId === lifecycleSchedulerJobCreate.job.jobId) ? "PASS" : "FAIL",
    });
    checks.push({
      id: "lifecycle_settlement_cleanup",
      status: lifecycleCleanupPreview.ok &&
        lifecycleCleanupPreview.data.candidates.some((item) => item.jobId === "verify_lifecycle_cleanup_running_1" && item.cleanupAction === "RESET_TO_QUEUED") &&
        lifecycleCleanupExecute.ok &&
        lifecycleCleanupExecute.data.resetCount >= 1 &&
        storeAdapter.data.adminLifecycleSettlementJobs.some((job) => job.job_id === "verify_lifecycle_cleanup_running_1" && job.status === "QUEUED" && job.cleanup_json && job.cleanup_json.action === "RESET_TO_QUEUED") ? "PASS" : "FAIL",
    });
    storeAdapter.data.externalAdapterRuns.unshift({
      run_id: "verify_adapter_retry_exhausted_1",
      source_type: "YOUZAN_ORDER",
      adapter_kind: "YOUZAN_OPEN",
      mode: "IMPORT",
      status: "FAILED",
      retry_status: "RETRYABLE",
      retry_attempt: 5,
      retry_source_run_id: "",
      retry_reason: "verify upstream 502",
      next_retry_at: "2026-06-19T11:00:00+08:00",
      requested_limit: 50,
      cursor_before: "verify-exhausted-cursor",
      error_code: "502",
      error_message: "verify upstream 502",
      started_at: "2026-06-19T10:00:00+08:00",
      finished_at: "2026-06-19T10:01:00+08:00",
    });
    storeAdapter.data.adminLifecycleSettlementJobs.unshift({
      job_id: "verify_lifecycle_settlement_failed_1",
      source: "LIFECYCLE_FILTER",
      status: "COMPLETED_WITH_ERRORS",
      campaign_id: "ROOT_7D_RESET",
      request_id: "verify-lifecycle-alert-failed",
      operator_id: "verify-ops",
      reason: "最终验收生命周期结算失败预警",
      batch_size: 20,
      filters_json: { campaignId: "ROOT_7D_RESET" },
      selection_json: { total: 1, selectedCount: 1, selectionLimit: 1, truncated: false, users: [] },
      root_user_ids: ["verify_root_failed"],
      processed_root_user_ids: ["verify_root_failed"],
      failed_root_user_ids: ["verify_root_failed"],
      items_json: [{ rootUserId: "verify_root_failed", status: "ERROR", message: "verify failed", rewardCount: 0 }],
      last_run_json: { requestId: "verify-lifecycle-alert-failed-run", selectedCount: 1 },
      total_count: 1,
      run_count: 1,
      error_message: "verify failed",
      created_at: "2026-06-19T10:10:00+08:00",
      updated_at: "2026-06-19T10:12:00+08:00",
      started_at: "2026-06-19T10:10:00+08:00",
      finished_at: "2026-06-19T10:12:00+08:00",
      cancelled_at: "",
    });
    storeAdapter.data.adminLifecycleSettlementJobs.unshift({
      job_id: "verify_lifecycle_settlement_stalled_1",
      source: "LIFECYCLE_FILTER",
      status: "RUNNING",
      campaign_id: "ROOT_7D_RESET",
      request_id: "verify-lifecycle-alert-stalled",
      operator_id: "verify-ops",
      reason: "最终验收生命周期结算卡住预警",
      batch_size: 20,
      filters_json: { campaignId: "ROOT_7D_RESET" },
      selection_json: { total: 1, selectedCount: 1, selectionLimit: 1, truncated: false, users: [] },
      root_user_ids: ["verify_root_stalled"],
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
    storeAdapter.data.adminLifecycleUserExports.unshift({
      export_id: "verify_lifecycle_export_dead_letter_1",
      filename: "verify_lifecycle_users_dead_letter.csv",
      created_at: "2026-06-19T09:00:00+08:00",
      expires_at: "2099-01-01T00:00:00+08:00",
      operator_id: "verify-ops",
      request_id: "verify-lifecycle-export-dead-letter",
      filters_json: { campaignId: "ROOT_7D_RESET" },
      summary_json: { exportedCount: 1, bytes: 128, sensitivity: "CONFIDENTIAL" },
      rows_json: [],
      delivery_requested: true,
      delivery_channel: "WEBHOOK",
      delivery_status: "DEAD_LETTER",
      delivery_target_json: { webhookUrlPreview: "https://hooks.example.com/final-verification-export" },
      delivery_external_ref: "",
      delivery_error: "HTTP 500",
      delivery_dead_letter_reason: "max attempts reached: HTTP 500",
      delivery_delivered_at: "",
      delivery_last_attempt_at: "2026-06-19T09:03:00+08:00",
      delivery_request_id: "verify-lifecycle-export-dead-letter",
      delivery_attempt_count: 3,
      delivery_max_attempts: 3,
      delivery_next_retry_at: "",
    });
    storeAdapter.data.adminLifecycleUserExports.unshift({
      export_id: "verify_lifecycle_export_due_retry_1",
      filename: "verify_lifecycle_users_due_retry.csv",
      created_at: "2026-06-19T09:10:00+08:00",
      expires_at: "2099-01-01T00:00:00+08:00",
      operator_id: "verify-ops",
      request_id: "verify-lifecycle-export-due-retry",
      filters_json: { campaignId: "ROOT_7D_RESET" },
      summary_json: { exportedCount: 1, bytes: 128, sensitivity: "CONFIDENTIAL" },
      rows_json: [],
      delivery_requested: true,
      delivery_channel: "WEBHOOK",
      delivery_status: "RETRY_SCHEDULED",
      delivery_target_json: { webhookUrlPreview: "https://hooks.example.com/final-verification-export" },
      delivery_external_ref: "",
      delivery_error: "HTTP 502",
      delivery_dead_letter_reason: "",
      delivery_delivered_at: "",
      delivery_last_attempt_at: "2026-06-19T09:12:00+08:00",
      delivery_request_id: "verify-lifecycle-export-due-retry",
      delivery_attempt_count: 1,
      delivery_max_attempts: 3,
      delivery_next_retry_at: "2020-01-01T00:00:00+08:00",
    });

    const analytics = okPayload(await getJson(baseUrl, "/api/v1/admin/operational-analytics?campaignId=ROOT_7D_RESET"));
    const analyticsStageKeys = analytics.stages.map((item) => item.key);
    const analyticsExport = await fetch(`${baseUrl}/api/v1/admin/operational-analytics/export?campaignId=ROOT_7D_RESET`);
    const analyticsCsv = await analyticsExport.text();
    checks.push({
      id: "operational_analytics",
      status: analyticsStageKeys.includes("wework_leads") &&
        analyticsStageKeys.includes("registered_users") &&
        analyticsStageKeys.includes("reward_delivered") &&
        analytics.bottlenecks.some((item) => item.key === "unresolved_leads") &&
        Array.isArray(analytics.alerts) &&
        Array.isArray(analytics.trend) &&
        Array.isArray(analytics.retentionSegments) &&
        Array.isArray(analytics.alertRules) &&
        analytics.alertRules.some((item) => item.alertRuleId === "op_alert_adapter_retry_exhausted" && item.ownerRole === "研发") &&
        analytics.alertRules.some((item) => item.alertRuleId === "op_alert_lifecycle_settlement_job_failed") &&
        analytics.alertRules.some((item) => item.alertRuleId === "op_alert_lifecycle_settlement_job_stalled") &&
        analytics.alertRules.some((item) => item.alertRuleId === "op_alert_lifecycle_export_delivery_dead_letter") &&
        analytics.alertRules.some((item) => item.alertRuleId === "op_alert_lifecycle_export_delivery_due_retry") &&
        analytics.alerts.some((item) => item.key === "adapter_retry_exhausted_verify_adapter_retry_exhausted_1") &&
        analytics.alerts.some((item) => item.key === "lifecycle_settlement_job_failed_verify_lifecycle_settlement_failed_1") &&
        analytics.alerts.some((item) => item.key === "lifecycle_settlement_job_stalled_verify_lifecycle_settlement_stalled_1") &&
        analytics.alerts.some((item) => item.key === "lifecycle_export_delivery_health_dead_letter" && item.exportId === "verify_lifecycle_export_dead_letter_1") &&
        analytics.alerts.some((item) => item.key === "lifecycle_export_delivery_health_due_retry" && item.exportId === "verify_lifecycle_export_due_retry_1") &&
        analytics.alertSummary &&
        typeof analytics.alertSummary.triggeredCount === "number" &&
        analytics.charts &&
        Array.isArray(analytics.charts.funnelBars) &&
        Array.isArray(analytics.charts.trendSeries) &&
        Array.isArray(analytics.charts.segmentBars) &&
        (analyticsExport.headers.get("content-type") || "").includes("text/csv") &&
        analyticsCsv.includes("section,key,label,date,count") &&
        analytics.distributions &&
        Array.isArray(analytics.recentActivity) ? "PASS" : "FAIL",
    });

    const alertRule = okPayload(await postJson(baseUrl, "/api/v1/admin/operational-alert-rules/upsert", {
      alertRuleId: "verify_operational_alert_rule",
      title: "验收运营预警",
      targetType: "BOTTLENECK",
      targetKey: "unresolved_leads",
      metricKey: "count",
      operator: ">=",
      thresholdValue: 0,
      severity: "warning",
      channel: "IN_APP",
      ownerRole: "运营主管",
      ownerName: "验收运营",
      ownerContact: "wecom:verify-ops",
      routeKey: "verify:unresolved-leads",
      status: "ACTIVE",
      requestId: "verify-operational-alert-rule-1",
      reason: "最终验收运营预警阈值",
    }, { "X-Request-Id": "verify-operational-alert-rule-1" }));
    const alertWebhookRule = okPayload(await postJson(baseUrl, "/api/v1/admin/operational-alert-rules/upsert", {
      alertRuleId: "verify_operational_alert_webhook_rule",
      title: "验收外部预警推送",
      targetType: "LIFECYCLE_SETTLEMENT_JOB_FAILED",
      targetKey: "*",
      metricKey: "failedCount",
      operator: ">",
      thresholdValue: 0,
      severity: "danger",
      channel: "WEBHOOK",
      ownerRole: "运营主管",
      ownerName: "验收外部运营",
      ownerContact: "wecom:verify-alert",
      routeKey: "verify:lifecycle-webhook",
      status: "ACTIVE",
      requestId: "verify-operational-alert-webhook-rule-1",
      reason: "最终验收外部预警通道",
    }, { "X-Request-Id": "verify-operational-alert-webhook-rule-1" }));
    const alertJob = okPayload(await postJson(baseUrl, "/api/v1/jobs/operational-alerts", {
      campaignId: "ROOT_7D_RESET",
      dryRun: false,
      requestId: "verify-operational-alert-job-1",
      reason: "最终验收运营预警 Job",
    }, { "X-Request-Id": "verify-operational-alert-job-1" }));
    const alertRunner = await collectOperationalAlertJob(parseOperationalAlertArgs([
      "--base-url", baseUrl,
      "--campaign", "ROOT_7D_RESET",
      "--execute",
      "--request-id", "verify-operational-alert-runner-1",
      "--reason", "最终验收运营预警命令行 Job",
    ]));
    const alertWebhookNotification = storeAdapter.data.operationalAlertNotifications.find((item) => item.alert_rule_id === "verify_operational_alert_webhook_rule");
    checks.push({
      id: "operational_alerts",
      status: alertRule.rule.alertRuleId === "verify_operational_alert_rule" &&
        alertRule.rule.ownerName === "验收运营" &&
        alertWebhookRule.rule.channel === "WEBHOOK" &&
        alertJob.requestId === "verify-operational-alert-job-1" &&
        alertRunner.ok === true &&
        alertRunner.data.requestId === "verify-operational-alert-runner-1" &&
        alertJob.alerts.some((item) => item.key === "adapter_retry_exhausted_verify_adapter_retry_exhausted_1" && item.ownerRole === "研发") &&
        alertJob.alerts.some((item) => item.key === "lifecycle_settlement_job_failed_verify_lifecycle_settlement_failed_1" && item.ownerRole === "运营主管") &&
        alertJob.alerts.some((item) => item.key === "lifecycle_settlement_job_stalled_verify_lifecycle_settlement_stalled_1" && item.ownerRole === "运营") &&
        alertJob.alerts.some((item) => item.key === "lifecycle_export_delivery_health_dead_letter" && item.ownerRole === "运营主管") &&
        alertJob.alerts.some((item) => item.key === "lifecycle_export_delivery_health_due_retry" && item.ownerRole === "运营") &&
        alertJob.alerts.some((item) => item.key === `consultation_sla_overdue_${consultationSlaEvent.followUp.task.task_id}` && item.assignedAdvisorName === "最终验收顾问") &&
        alertJob.alerts.some((item) => item.key.startsWith(`consultation_sla_escalation_${consultationSlaEvent.followUp.task.task_id}_`) && item.escalationOwnerRole) &&
        operationalAlertWebhookCalls.length >= 1 &&
        operationalAlertWebhookCalls.some((call) =>
          call.url === "https://hooks.example.com/final-verification-alert" &&
          call.init.headers["X-Root-Alert-Signature"]) &&
        alertWebhookNotification &&
        alertWebhookNotification.status === "DELIVERED" &&
        alertWebhookNotification.external_ref === "HTTP 202" &&
        alertWebhookNotification.payload_json.webhook.channel === "WEWORK" &&
        alertWebhookNotification.payload_json.webhook.signed === true &&
        alertJob.summary.triggeredCount >= alertJob.summary.deliveredCount &&
        Array.isArray(alertJob.alerts) ? "PASS" : "FAIL",
    });

    const productSyncProducts = [
      {
        youzanProductId: "VERIFY_PRODUCT_SYNC_001",
        title: "验收同步商品",
        priceText: "¥299",
        youzanPath: "pages/goods/detail?id=VERIFY_PRODUCT_SYNC_001",
        skus: [{ skuId: "VERIFY_PRODUCT_SYNC_001_DEFAULT", skuName: "默认规格", stockStatus: "UNKNOWN" }],
      },
    ];
    const productSyncPreview = okPayload(await postJson(baseUrl, "/api/v1/admin/products/sync-preview", {
      campaignId: "VERIFY_PRODUCT_SYNC_CAMPAIGN",
      products: productSyncProducts,
    }));
    const productSyncExecute = okPayload(await postJson(baseUrl, "/api/v1/admin/products/sync-execute", {
      campaignId: "VERIFY_PRODUCT_SYNC_CAMPAIGN",
      products: productSyncProducts,
      confirmRisk: true,
      requestId: "verify-product-sync-1",
      reason: "最终验收商品同步",
    }, { "X-Request-Id": "verify-product-sync-1" }));
    const productSyncAudit = okPayload(await getJson(baseUrl, "/api/v1/admin/audit-logs?action=YOUZAN_PRODUCT_SYNC"));
    checks.push({
      id: "product_sync",
      status: productSyncPreview.importableCount === 1 &&
        productSyncExecute.importedCount === 1 &&
        productSyncAudit.auditLogs[0] &&
        productSyncAudit.auditLogs[0].target_id === "verify-product-sync-1" ? "PASS" : "FAIL",
    });

    const customerImport = okPayload(await postJson(baseUrl, "/api/v1/admin/external-samples/import", {
      sourceType: "YOUZAN_CUSTOMER",
      text: [
        "有赞客户ID,unionid,手机号,昵称",
        "verify_yz_customer_001,verify_lifecycle_unionid,13800100991,验收客户",
      ].join("\n"),
    }));
    const customerMirror = okPayload(await getJson(baseUrl, "/api/v1/admin/youzan-customers?keyword=verify_yz_customer_001"));
    checks.push({
      id: "youzan_customer_mirror",
      status: customerImport.importedCount === 1 &&
        customerMirror.customers[0] &&
        customerMirror.customers[0].rootUserId === login.user.rootUserId &&
        customerMirror.customers[0].linkStatus === "LINKED" &&
        customerMirror.customers[0].orderSummary ? "PASS" : "FAIL",
    });

    if (!Array.isArray(storeAdapter.data.rewardGrants)) storeAdapter.data.rewardGrants = [];
    storeAdapter.data.rewardGrants.push({
      reward_grant_id: "verify_reward_review_1",
      root_user_id: login.user.rootUserId,
      campaign_id: "ROOT_7D_RESET",
      settlement_record_id: "",
      reward_type: "FREE_ORDER_CHANCE",
      reward_key: "verify_free_order",
      title: "验收免单机会",
      description: "",
      status: "PENDING_REVIEW",
      payload_json: {},
      idempotency_key: "verify_reward_review_1",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const reviewItem = manualReview.createManualReviewItem(storeAdapter.data, {
      rootUserId: login.user.rootUserId,
      campaignId: "ROOT_7D_RESET",
      reviewType: "FREE_ORDER_REVIEW",
      sourceType: "REWARD_GRANT",
      sourceId: "verify_reward_review_1",
      reason: "最终验收批量复核",
      idempotencyKey: "verify_reward_review_item_1",
    }).item;
    const reviewStatusBefore = okPayload(await getJson(baseUrl, "/api/v1/settlement/status", {
      Authorization: `Bearer ${login.token}`,
    }));
    const reviewWorkbenchBefore = okPayload(await getJson(baseUrl, "/api/v1/admin/config-workbench"));
    const userReviewRow = reviewStatusBefore.manualReviews.find((item) => item.reviewItemId === reviewItem.manual_review_item_id);
    const adminReviewRow = reviewWorkbenchBefore.manualReviews.find((item) => item.reviewItemId === reviewItem.manual_review_item_id);
    checks.push({
      id: "manual_review_explanation",
      status: userReviewRow &&
        userReviewRow.explanationTitle === "最终验收免单解释" &&
        userReviewRow.operatorGuidance === "" &&
        adminReviewRow &&
        adminReviewRow.operatorGuidance === "最终验收运营指引" &&
        adminReviewRow.evidenceRequired.includes("最终验收订单证据") ? "PASS" : "FAIL",
    });
    checks.push({
      id: "manual_review_template_validation",
      status: reviewWorkbenchBefore.manualReviewExplanationTemplates &&
        reviewWorkbenchBefore.manualReviewExplanationTemplates.status === "READY" &&
        reviewWorkbenchBefore.manualReviewExplanationTemplates.templates.some((item) => {
          return item.templateKey === "FREE_ORDER_REVIEW" &&
            item.configured === true &&
            item.title === "最终验收免单解释" &&
            item.evidenceRequired.includes("最终验收订单证据");
        }) ? "PASS" : "FAIL",
    });
    const reviewBatch = okPayload(await postJson(baseUrl, "/api/v1/admin/manual-reviews/batch-resolve", {
      reviewItemIds: [reviewItem.manual_review_item_id],
      decision: "APPROVED",
      confirmRisk: true,
      requestId: "verify-review-batch-1",
      reason: "最终验收批量复核",
    }, { "X-Request-Id": "verify-review-batch-1" }));
    checks.push({ id: "manual_review_batch", status: reviewBatch.summary.resolved === 1 ? "PASS" : "FAIL" });

    const auditLogs = okPayload(await getJson(baseUrl, "/api/v1/admin/audit-logs?action=BATCH_MANUAL_REVIEW_RESOLVE"));
    checks.push({ id: "audit_logs", status: auditLogs.auditLogs[0] && auditLogs.auditLogs[0].target_id === "verify-review-batch-1" ? "PASS" : "FAIL" });

    storeAdapter.data.rewardGrants.push({
      reward_grant_id: "verify_reward_delivery_1",
      root_user_id: login.user.rootUserId,
      campaign_id: "ROOT_7D_RESET",
      settlement_record_id: "",
      reward_type: "YOUZAN_COUPON",
      reward_key: "verify_coupon",
      title: "验收优惠券",
      description: "",
      status: "PENDING_DELIVERY",
      payload_json: {},
      idempotency_key: "verify_reward_delivery_1",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (!Array.isArray(storeAdapter.data.rewardDeliveryJobs)) storeAdapter.data.rewardDeliveryJobs = [];
    storeAdapter.data.rewardDeliveryJobs.push({
      reward_delivery_job_id: "verify_delivery_job_1",
      reward_grant_id: "verify_reward_delivery_1",
      adapter_type: "YOUZAN_COUPON",
      status: "PENDING",
      attempt_count: 0,
      last_error: "",
      next_retry_at: "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const deliveryRun = okPayload(await postJson(baseUrl, "/api/v1/admin/reward-delivery/execute", {
      deliveryJobIds: ["verify_delivery_job_1"],
      outcome: "DELIVERED",
      externalRef: "VERIFY_COUPON_001",
      confirmRisk: true,
      requestId: "verify-delivery-1",
      reason: "最终验收奖励发放",
    }, { "X-Request-Id": "verify-delivery-1" }));
    checks.push({ id: "reward_delivery", status: deliveryRun.summary.delivered === 1 ? "PASS" : "FAIL" });
    const deliveryAudit = okPayload(await getJson(baseUrl, "/api/v1/admin/audit-logs?action=REWARD_DELIVERY_BATCH_EXECUTE"));
    checks.push({ id: "reward_delivery_audit", status: deliveryAudit.auditLogs[0] && deliveryAudit.auditLogs[0].target_id === "verify-delivery-1" ? "PASS" : "FAIL" });
    const rewardStatusRun = okPayload(await postJson(baseUrl, "/api/v1/admin/reward-delivery/status-query", {
      deliveryJobIds: ["verify_delivery_job_1"],
      externalStatus: "USED",
      requestId: "verify-delivery-status-1",
      reason: "最终验收奖励状态查询",
    }, { "X-Request-Id": "verify-delivery-status-1" }));
    const rewardGrant = storeAdapter.data.rewardGrants.find((item) => item.reward_grant_id === "verify_reward_delivery_1");
    const rewardWorkbench = okPayload(await getJson(baseUrl, "/api/v1/admin/config-workbench"));
    const rewardWorkbenchGrant = rewardWorkbench.rewardGrants.find((item) => item.rewardGrantId === "verify_reward_delivery_1");
    checks.push({
      id: "reward_status_query",
      status: rewardStatusRun.summary.updated === 1 &&
        rewardGrant &&
        rewardGrant.external_status === "USED" &&
        rewardWorkbenchGrant &&
        rewardWorkbenchGrant.externalStatus === "USED" ? "PASS" : "FAIL",
    });

    storeAdapter.data.rewardGrants.push({
      reward_grant_id: "verify_reward_wework_tag_1",
      root_user_id: login.user.rootUserId,
      campaign_id: "ROOT_7D_RESET",
      settlement_record_id: "",
      reward_type: "TAG",
      reward_key: "verify_wework_tag",
      title: "验收企微标签",
      description: "",
      status: "PENDING_DELIVERY",
      payload_json: { tagId: "tag_verify" },
      idempotency_key: "verify_reward_wework_tag_1",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (!Array.isArray(storeAdapter.data.leadProfiles)) storeAdapter.data.leadProfiles = [];
    storeAdapter.data.leadProfiles.push({
      lead_id: "verify_wework_tag_lead_1",
      user_id: login.user.rootUserId,
      external_contact_id: "wm_verify_tag_user_001",
      wechat_remark_name: "验收企微用户",
      receiver_phone: "",
      source_channel: "VERIFY_ROADSHOW",
      offline_event_name: "",
      corp_wechat_status: "ADDED",
      operator_note: "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    storeAdapter.data.rewardDeliveryJobs.push({
      reward_delivery_job_id: "verify_delivery_wework_tag_1",
      reward_grant_id: "verify_reward_wework_tag_1",
      adapter_type: "WEWORK_TAG",
      status: "PENDING",
      attempt_count: 0,
      last_error: "",
      next_retry_at: "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const tagWorkbenchBefore = okPayload(await getJson(baseUrl, "/api/v1/admin/config-workbench"));
    const tagWorkbenchJob = tagWorkbenchBefore.deliveryJobs.find((item) => item.deliveryJobId === "verify_delivery_wework_tag_1");
    const tagRun = okPayload(await postJson(baseUrl, "/api/v1/admin/reward-delivery/execute", {
      deliveryJobIds: ["verify_delivery_wework_tag_1"],
      deliveryMode: "MANUAL",
      externalRef: "VERIFY_WEWORK_TAG_001",
      externalContactId: "wm_verify_tag_user_001",
      tagId: "tag_verify",
      tagName: "验收企微标签",
      payload: {
        externalContactId: "wm_verify_tag_user_001",
        tagId: "tag_verify",
        tagName: "验收企微标签",
      },
      confirmRisk: true,
      requestId: "verify-wework-tag-1",
      reason: "最终验收企微标签发放",
    }, { "X-Request-Id": "verify-wework-tag-1" }));
    const tagGrant = storeAdapter.data.rewardGrants.find((item) => item.reward_grant_id === "verify_reward_wework_tag_1");
    checks.push({
      id: "wework_tag_delivery",
      status: tagRun.summary.delivered === 1 &&
        tagGrant &&
        tagGrant.status === "DELIVERED" &&
        tagWorkbenchJob &&
        tagWorkbenchJob.weworkTagHint &&
        tagWorkbenchJob.weworkTagHint.tagId === "tag_verify" &&
        tagWorkbenchJob.weworkTagHint.externalContactId === "wm_verify_tag_user_001" ? "PASS" : "FAIL",
    });

    const batchPreview = okPayload(await postJson(baseUrl, "/api/v1/admin/settlement/batch-preview", {
      rootUserIds: [login.user.rootUserId],
    }));
    checks.push({ id: "settlement_batch_preview", status: batchPreview.summary.total === 1 ? "PASS" : "FAIL" });

    const sampleText = [
      "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
      "YZROOTVERIFY001,验收样本一,13800100001,ROOT 7日试饮装,199,已支付,已发货,上海市验收地址1",
      "YZROOTVERIFY002,验收样本二,13800100002,ROOT 7日试饮装,199,已支付,已签收,上海市验收地址2",
      "YZROOTVERIFY003,验收样本三,13800100003,ROOT 7日试饮装,199,已支付,运输中,上海市验收地址3",
    ].join("\n");
    const samplePreview = okPayload(await postJson(baseUrl, "/api/v1/admin/external-samples/preview", {
      sourceType: "YOUZAN_ORDER",
      text: sampleText,
    }));
    checks.push({ id: "sample_preview", status: samplePreview.review.decision_status === "READY" ? "PASS" : "FAIL" });
    const sampleReviewLookup = okPayload(await getJson(baseUrl, `/api/v1/admin/external-sample-reviews?reviewId=${samplePreview.review.review_id}`));
    checks.push({
      id: "sample_review_detail",
      status: sampleReviewLookup.review &&
        sampleReviewLookup.review.review_id === samplePreview.review.review_id &&
        sampleReviewLookup.review.field_coverage.youzanOrderNo.rate === 100 &&
        sampleReviewLookup.review.rows.length === 3 &&
        sampleReviewLookup.review.rows[0].raw.有赞订单号.includes("已脱敏") &&
        !JSON.stringify(sampleReviewLookup.review).includes("13800100001") &&
        sampleReviewLookup.review.rows[1].mapped.deliveryStatus === "DELIVERED" ? "PASS" : "FAIL",
    });

    const orderIncrementPreview = okPayload(await postJson(baseUrl, "/api/v1/admin/orders/increment-preview", {
      text: sampleText,
    }));
    const orderIncrementExecute = okPayload(await postJson(baseUrl, "/api/v1/admin/orders/increment-execute", {
      text: sampleText,
      requestId: "verify-order-increment-1",
      confirmRisk: true,
      reason: "最终验收有赞订单增量同步",
    }, { "X-Request-Id": "verify-order-increment-1" }));
    const orderIncrementRepeat = okPayload(await postJson(baseUrl, "/api/v1/admin/orders/increment-execute", {
      text: sampleText,
      requestId: "verify-order-increment-1",
      confirmRisk: true,
      reason: "最终验收有赞订单增量同步",
    }, { "X-Request-Id": "verify-order-increment-1" }));
    const orderIncrementAudit = okPayload(await getJson(baseUrl, "/api/v1/admin/audit-logs?action=YOUZAN_ORDER_INCREMENT_SYNC"));
    const syncedOrder = storeAdapter.data.youzanOrders.find((order) => order.youzan_order_no === "YZROOTVERIFY001");
    checks.push({
      id: "order_increment_sync",
      status: orderIncrementPreview.summary.importableCount === 3 &&
        orderIncrementPreview.summary.importedCount === 0 &&
        orderIncrementExecute.summary.importedCount === 3 &&
        orderIncrementRepeat.audit.audit_log_id === orderIncrementExecute.audit.audit_log_id &&
        syncedOrder &&
        orderIncrementAudit.auditLogs[0] &&
        orderIncrementAudit.auditLogs[0].target_id === "verify-order-increment-1" ? "PASS" : "FAIL",
    });

    const afterSalesOrder = okPayload(await postJson(baseUrl, "/api/v1/admin/orders/sync", {
      userId: login.user.userId,
      youzanOrderNo: "YZROOTVERIFYAFTER001",
      receiverPhone: "13800100991",
      receiverName: "验收售后",
      amount: 199,
      deliveryStatus: "DELIVERED",
    }));
    storeAdapter.data.rewardGrants.push({
      reward_grant_id: "verify_reward_after_sales_1",
      root_user_id: login.user.rootUserId,
      campaign_id: "ROOT_7D_RESET",
      settlement_record_id: "verify_settlement_after_sales_1",
      order_id: afterSalesOrder.order.orderId,
      reward_type: "COUPON",
      reward_key: "verify_after_sales_coupon",
      title: "验收售后追回券",
      description: "",
      status: "PENDING_DELIVERY",
      external_status: "",
      external_ref: "",
      recovery_status: "",
      recovery_reason: "",
      recovery_record_id: "",
      recovered_at: "",
      payload_json: {},
      idempotency_key: "verify_reward_after_sales_1",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const afterSalesRun = okPayload(await postJson(baseUrl, "/api/v1/admin/order-after-sales/upsert", {
      youzanOrderNo: "YZROOTVERIFYAFTER001",
      afterSalesNo: "VERIFY_AFTER_SALES_001",
      rawStatus: "REFUND_SUCCESS",
      refundAmount: 199,
      reason: "最终验收售后退款成功",
      requestId: "verify-after-sales-1",
    }, { "X-Request-Id": "verify-after-sales-1" }));
    const afterSalesRecords = okPayload(await getJson(baseUrl, "/api/v1/admin/order-after-sales?youzanOrderNo=YZROOTVERIFYAFTER001"));
    const userOrdersAfterSales = okPayload(await getJson(baseUrl, "/api/v1/user/orders", {
      Authorization: `Bearer ${login.token}`,
    }));
    const afterSalesMirrorOrder = storeAdapter.data.youzanOrders.find((order) => order.youzan_order_no === "YZROOTVERIFYAFTER001");
    checks.push({
      id: "order_after_sales",
      status: afterSalesRun.record.status === "REFUNDED" &&
        afterSalesRun.rewardRecovery.createdCount === 1 &&
        afterSalesRecords.records.length === 1 &&
        afterSalesMirrorOrder &&
        afterSalesMirrorOrder.after_sales_status === "REFUNDED" &&
        userOrdersAfterSales.orders.some((order) =>
          order.youzanOrderNo === "YZROOTVERIFYAFTER001" &&
          order.afterSalesStatus === "REFUNDED") ? "PASS" : "FAIL",
    });

    const rollbackText = [
      "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
      "YZROOTVERIFYROLLBACK001,验收回滚,13800100988,ROOT 7日试饮装,199,已支付,已发货,上海市回滚地址",
    ].join("\n");
    const adapterImport = okPayload(await postJson(baseUrl, "/api/v1/admin/external-adapters/run", {
      sourceType: "YOUZAN_ORDER",
      adapterKind: "MANUAL_SAMPLE",
      mode: "IMPORT",
      text: rollbackText,
    }));
    const adapterRollback = okPayload(await postJson(baseUrl, "/api/v1/admin/external-adapters/rollback", {
      runId: adapterImport.run.run_id,
      requestId: "verify-adapter-rollback-1",
      confirmRisk: true,
      reason: "最终验收 Adapter 导入回滚",
    }, { "X-Request-Id": "verify-adapter-rollback-1" }));
    const adapterRollbackAudit = okPayload(await getJson(baseUrl, "/api/v1/admin/audit-logs?action=EXTERNAL_ADAPTER_RUN_ROLLBACK"));
    checks.push({
      id: "adapter_run_rollback",
      status: adapterImport.run.rollback_targets.length === 2 &&
        adapterRollback.summary.status === "ROLLED_BACK" &&
        !storeAdapter.data.youzanOrders.some((order) => order.youzan_order_no === "YZROOTVERIFYROLLBACK001") &&
        adapterRollbackAudit.auditLogs[0] &&
        adapterRollbackAudit.auditLogs[0].target_id === adapterImport.run.run_id ? "PASS" : "FAIL",
    });

    const snapshotBaseText = [
      "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
      "YZROOTVERIFYSNAPSHOT001,验收旧字段,13800100989,ROOT 7日试饮装,199,已支付,已发货,上海市旧地址",
    ].join("\n");
    const snapshotUpdateText = [
      "有赞订单号,收货人,收货手机号,商品名称,实付金额,订单状态,物流状态,收货地址",
      "YZROOTVERIFYSNAPSHOT001,验收错误字段,13800100989,ROOT 7日试饮装,299,已关闭,已发货,上海市错误地址",
    ].join("\n");
    okPayload(await postJson(baseUrl, "/api/v1/admin/external-adapters/run", {
      sourceType: "YOUZAN_ORDER",
      adapterKind: "MANUAL_SAMPLE",
      mode: "IMPORT",
      text: snapshotBaseText,
    }));
    const snapshotImport = okPayload(await postJson(baseUrl, "/api/v1/admin/external-adapters/run", {
      sourceType: "YOUZAN_ORDER",
      adapterKind: "MANUAL_SAMPLE",
      mode: "IMPORT",
      text: snapshotUpdateText,
    }));
    const snapshotRollback = okPayload(await postJson(baseUrl, "/api/v1/admin/external-adapters/rollback", {
      runId: snapshotImport.run.run_id,
      requestId: "verify-adapter-snapshot-rollback-1",
      confirmRisk: true,
      reason: "最终验收 Adapter 字段快照回滚",
    }, { "X-Request-Id": "verify-adapter-snapshot-rollback-1" }));
    const snapshotOrder = storeAdapter.data.youzanOrders.find((order) => order.youzan_order_no === "YZROOTVERIFYSNAPSHOT001");
    checks.push({
      id: "adapter_snapshot_rollback",
      status: snapshotImport.run.rollback_targets.length === 1 &&
        snapshotImport.run.rollback_targets[0].metadata.beforeSnapshot.receiver_name === "验收旧字段" &&
        snapshotRollback.summary.status === "ROLLED_BACK" &&
        snapshotOrder &&
        snapshotOrder.receiver_name === "验收旧字段" &&
        snapshotOrder.amount === 199 ? "PASS" : "FAIL",
    });

    const adapterFailure = await postJson(baseUrl, "/api/v1/admin/external-adapters/run", {
      sourceType: "WECHAT_LEAD",
      adapterKind: "WEWORK_CONTACT",
      mode: "PREVIEW",
      limit: 1,
    });
    checks.push({ id: "adapter_failure_ledger", status: adapterFailure.code !== 0 ? "PASS" : "FAIL" });

    const adapters = okPayload(await getJson(baseUrl, "/api/v1/admin/external-adapters"));
    const latestFailure = (adapters.runs || []).find((run) => run.adapter_kind === "WEWORK_CONTACT" && run.status === "FAILED");
    checks.push({ id: "adapter_run_recorded", status: latestFailure ? "PASS" : "FAIL" });
    checks.push({
      id: "adapter_retry_strategy",
      status: latestFailure &&
        latestFailure.retry_status === "MANUAL_REVIEW" &&
        latestFailure.retry_attempt === 1 &&
        latestFailure.next_retry_at === "" ? "PASS" : "FAIL",
    });

    const retryableFailure = await postJson(baseUrl, "/api/v1/admin/external-adapters/run", {
      sourceType: "YOUZAN_ORDER",
      adapterKind: "YOUZAN_OPEN",
      mode: "PREVIEW",
      limit: 1,
    });
    const retryableRun = storeAdapter.data.externalAdapterRuns[0];
    if (retryableRun) retryableRun.next_retry_at = "2026-05-17T10:00:00+08:00";
    const retryDuePreview = okPayload(await postJson(baseUrl, "/api/v1/admin/external-adapters/retry-due", {
      dryRun: true,
      now: "2026-05-17T10:10:00+08:00",
    }));
    const retryDueExecute = okPayload(await postJson(baseUrl, "/api/v1/jobs/adapter-retry-due", {
      dryRun: false,
      now: "2026-05-17T10:10:00+08:00",
      requestId: "verify-adapter-retry-due-1",
    }, { "X-Request-Id": "verify-adapter-retry-due-1" }));
    checks.push({
      id: "adapter_retry_scheduler",
      status: retryableFailure.code === 502 &&
        retryableRun &&
        retryableRun.retry_status === "RETRYABLE" &&
        retryDuePreview.selectedCount === 1 &&
        retryDueExecute.executedCount === 1 &&
        retryDueExecute.successCount === 1 &&
        retryDueExecute.results[0] &&
        retryDueExecute.results[0].run.retry_source_run_id === retryableRun.run_id ? "PASS" : "FAIL",
    });
    checks.push({
      id: "adapter_retry_job",
      status: retryDueExecute.requestId === "verify-adapter-retry-due-1" ||
        (retryDueExecute.results[0] && retryDueExecute.results[0].sourceRun.run_id === retryableRun.run_id) ? "PASS" : "FAIL",
    });

    const releaseRecord = okPayload(await getJson(baseUrl, "/api/v1/admin/release-record?target=gray"));
    checks.push({
      id: "release_record",
      status: releaseRecord.status === "BLOCKED" &&
        releaseRecord.evidence &&
        releaseRecord.evidence.externalChannelReadiness &&
        releaseRecord.evidence.externalChannelReadiness.summary.alertRulesReviewed >= 1 &&
        releaseRecord.evidence.externalChannelReadiness.alertOwnerRoutes.some((item) => item.targetType === "LIFECYCLE_EXPORT_DELIVERY_HEALTH") &&
        releaseRecord.evidence.externalChannelReadiness.alertOwnerRoutes.some((item) => item.targetType === "CONSULTATION_SLA_OVERDUE") &&
        releaseRecord.evidence.externalChannelReadiness.alertOwnerRoutes.some((item) => item.targetType === "CONSULTATION_SLA_ESCALATION") &&
        releaseRecord.evidence.adminTransitionReadiness &&
        releaseRecord.evidence.adminTransitionReadiness.summary.readyModuleCount === 6 &&
        releaseRecord.evidence.adminTransitionReadiness.summary.bundledDistReady === true &&
        releaseRecord.evidence.adminTransitionReadiness.summary.legacyFallbackAvailable === true &&
        releaseRecord.evidence.adminTransitionReadiness.legacyDeprecationDecision.status === "PENDING" &&
        releaseRecord.evidence.productionCutoverReadiness &&
        releaseRecord.evidence.productionCutoverReadiness.status === "NEEDS_REVIEW" &&
        releaseRecord.evidence.productionCutoverReadiness.summary.requiredProofCount === 10 &&
        releaseRecord.evidence.actionAdapterCalibration &&
        ["READY", "NEEDS_REVIEW"].includes(releaseRecord.evidence.actionAdapterCalibration.status) &&
        releaseRecord.evidence.actionAdapterCalibration.actions.length === 4 &&
        releaseRecord.evidence.legacyDataMigration &&
        releaseRecord.evidence.legacyDataMigration.status === "READY" &&
        releaseRecord.evidence.legacyDataMigration.summary.legacySessionCount === 0 &&
        releaseRecord.evidence.productionEvidenceIntake &&
        releaseRecord.evidence.productionEvidenceIntake.items.length === 10 &&
        releaseRecord.evidence.cloudbaseStoreReadiness &&
        releaseRecord.evidence.cloudbaseStoreReadiness.status === "NEEDS_REVIEW" &&
        releaseRecord.evidence.cloudbaseStoreReadiness.selectedDecision === "UNDECIDED" &&
        releaseRecord.evidence.rootMemberCenterReadiness &&
        releaseRecord.evidence.rootMemberCenterReadiness.status === "NEEDS_REVIEW" &&
        releaseRecord.evidence.rootMemberCenterReadiness.summary.missingAppIdCount === 1 &&
        releaseRecord.signoffGate &&
        releaseRecord.signoffGate.status === "NEEDS_REVIEW" &&
        releaseRecord.signoffGate.summary.pendingCount === 3 &&
        releaseRecord.mustFixBeforeRelease.length === releaseRecord.checklist.mustFixBeforeRelease.length ? "PASS" : "FAIL",
    });
    checks.push({
      id: "legacy_data_migration_plan",
      status: releaseRecord.evidence.legacyDataMigration &&
        releaseRecord.evidence.legacyDataMigration.writeMode === false &&
        releaseRecord.evidence.legacyDataMigration.recommendedPolicy === "NO_LEGACY_DATA" &&
        releaseRecord.evidence.legacyDataMigration.nextActions.includes("未发现旧 7 日试饮历史数据，无需补迁。") ? "PASS" : "FAIL",
    });

    const calibration = okPayload(await getJson(baseUrl, "/api/v1/admin/adapter-calibration"));
    checks.push({ id: "adapter_calibration", status: calibration.sources.length === 4 ? "PASS" : "FAIL" });
    const actionCalibration = okPayload(await getJson(baseUrl, "/api/v1/admin/action-adapter-calibration?target=gray"));
    checks.push({
      id: "action_adapter_calibration",
      status: ["READY", "NEEDS_REVIEW"].includes(actionCalibration.status) &&
        actionCalibration.actions.length === 4 ? "PASS" : "FAIL",
    });
    const releaseEvidenceBundle = okPayload(await getJson(
      baseUrl,
      `/api/v1/admin/release-evidence-pack?target=gray&baseUrl=${encodeURIComponent(baseUrl)}&strict=true`,
    ));
    const releaseEvidencePack = releaseEvidenceBundle.pack;
    const releaseEvidenceArchive = okPayload(await postJson(baseUrl, "/api/v1/admin/release-evidence-pack/archive", {
      target: "gray",
      baseUrl,
      strict: true,
      note: "final verification evidence archive",
      requestId: "verify-release-evidence-archive-1",
    }, { "X-Request-Id": "verify-release-evidence-archive-1" }));
    const releaseEvidenceBundleAfterArchive = okPayload(await getJson(
      baseUrl,
      `/api/v1/admin/release-evidence-pack?target=gray&baseUrl=${encodeURIComponent(baseUrl)}&strict=true`,
    ));
    const releaseEvidenceArchiveDetail = okPayload(await getJson(
      baseUrl,
      `/api/v1/admin/release-evidence-pack/archive?archiveId=${encodeURIComponent(releaseEvidenceArchive.archive.archiveId)}`,
    ));
    const releaseSignoff = okPayload(await postJson(baseUrl, "/api/v1/admin/release-signoffs", {
      target: "gray",
      role: "PRODUCT",
      status: "APPROVED",
      archiveId: releaseEvidenceArchive.archive.archiveId,
      note: "final verification product signoff",
      requestId: "verify-release-signoff-1",
    }, { "X-Request-Id": "verify-release-signoff-1" }));
    const adminLegacyDecision = okPayload(await postJson(baseUrl, "/api/v1/admin/admin-legacy-deprecation-decisions", {
      target: "gray",
      status: "APPROVED",
      evidenceRef: `${baseUrl}/admin-legacy/deprecation-proof?token=secret`,
      rollbackRef: `${baseUrl}/admin-legacy/rollback-plan?token=secret`,
      note: "final verification admin legacy deprecation openid=raw-openid",
      requestId: "verify-admin-legacy-deprecation-decision-1",
    }, { "X-Request-Id": "verify-admin-legacy-deprecation-decision-1" }));
    const adminLegacyDecisions = okPayload(await getJson(baseUrl, "/api/v1/admin/admin-legacy-deprecation-decisions?target=gray"));
    const cutoverProof = okPayload(await postJson(baseUrl, "/api/v1/admin/production-cutover-proofs", {
      target: "gray",
      itemId: "cloudbase_unionid",
      status: "VERIFIED",
      evidenceRef: `${baseUrl}/api/v1/admin/cloudbase-identity-probe?token=secret`,
      note: "final verification CloudBase unionid proof token=secret",
      requestId: "verify-production-cutover-proof-1",
    }, { "X-Request-Id": "verify-production-cutover-proof-1" }));
    const rootJumpProof = okPayload(await postJson(baseUrl, "/api/v1/admin/root-member-center-jump-proofs", {
      target: "gray",
      productId: "ROOT_PREBIOTIC_TRIAL",
      status: "VERIFIED",
      appId: "wx_root_member_center",
      path: "pages/product/detail?id=ROOT_PREBIOTIC",
      evidenceRef: `${baseUrl}/root-member-center/jump-proof?token=secret`,
      note: "final verification Root member center jump proof openid=raw-openid",
      requestId: "verify-root-member-center-jump-proof-1",
    }, { "X-Request-Id": "verify-root-member-center-jump-proof-1" }));
    const rootJumpProofs = okPayload(await getJson(baseUrl, "/api/v1/admin/root-member-center-jump-proofs?target=gray"));
    const legacyMigrationDecision = okPayload(await postJson(baseUrl, "/api/v1/admin/legacy-data-migration-decisions", {
      target: "gray",
      policy: "NO_LEGACY_DATA",
      status: "APPROVED",
      evidenceRef: `${baseUrl}/legacy-migration/no-data?token=secret`,
      note: "final verification legacy data decision openid=raw-openid",
      requestId: "verify-legacy-data-migration-decision-1",
    }, { "X-Request-Id": "verify-legacy-data-migration-decision-1" }));
    const legacyMigrationDecisions = okPayload(await getJson(baseUrl, "/api/v1/admin/legacy-data-migration-decisions?target=gray"));
    const legacyMigrationExecution = okPayload(await postJson(baseUrl, "/api/v1/admin/legacy-data-migration-executions", {
      target: "gray",
      action: "NO_OP_CONFIRMED",
      status: "VERIFIED",
      evidenceRef: `${baseUrl}/legacy-migration/no-data-execution?token=secret`,
      note: "final verification legacy data execution openid=raw-openid",
      requestId: "verify-legacy-data-migration-execution-1",
    }, { "X-Request-Id": "verify-legacy-data-migration-execution-1" }));
    const legacyMigrationExecutions = okPayload(await getJson(baseUrl, "/api/v1/admin/legacy-data-migration-executions?target=gray"));
    const releaseRecordAfterSignoff = okPayload(await getJson(baseUrl, "/api/v1/admin/release-record?target=gray"));
    checks.push({
      id: "release_evidence_pack",
      status: releaseEvidencePack.status === "BLOCKED" &&
        releaseEvidenceBundle.validation.status === "PASS" &&
        releaseEvidencePack.evidence.commands.some((item) => item.includes("release:evidence")) &&
        releaseEvidencePack.evidence.externalChannelReadiness.alertOwnerRoutes.some((item) => item.targetType === "LIFECYCLE_EXPORT_DELIVERY_HEALTH") &&
        releaseEvidencePack.evidence.externalChannelReadiness.alertOwnerRoutes.some((item) => item.targetType === "CONSULTATION_SLA_OVERDUE") &&
        releaseEvidencePack.evidence.externalChannelReadiness.alertOwnerRoutes.some((item) => item.targetType === "CONSULTATION_SLA_ESCALATION") &&
        releaseEvidencePack.evidence.signoffGate.summary.pendingCount === 3 &&
        releaseEvidencePack.evidence.adminTransitionReadiness.summary.readyModuleCount === 6 &&
        releaseEvidencePack.evidence.adminTransitionReadiness.summary.bundledDistReady === true &&
        releaseEvidencePack.evidence.adminTransitionReadiness.legacyDeprecationDecision.status === "PENDING" &&
        releaseEvidencePack.evidence.productionCutoverReadiness.summary.requiredProofCount === 10 &&
        releaseEvidencePack.summary.productionCutoverStatus === "NEEDS_REVIEW" &&
        releaseEvidencePack.evidence.actionAdapterCalibration.actions.length === 4 &&
        ["READY", "NEEDS_REVIEW"].includes(releaseEvidencePack.summary.actionAdapterCalibrationStatus) &&
        releaseEvidencePack.evidence.legacyDataMigration.summary.legacySessionCount === 0 &&
        releaseEvidencePack.summary.legacyDataMigrationStatus === "READY" &&
        releaseEvidencePack.evidence.productionEvidenceIntake.items.length === 10 &&
        releaseEvidencePack.summary.productionEvidenceIntakeStatus === "BLOCKED" &&
        releaseEvidencePack.evidence.cloudbaseStoreReadiness.selectedDecision === "UNDECIDED" &&
        releaseEvidencePack.summary.cloudbaseStoreStatus === "NEEDS_REVIEW" &&
        releaseEvidencePack.evidence.rootMemberCenterReadiness.summary.missingAppIdCount === 1 &&
        releaseEvidencePack.summary.rootMemberCenterStatus === "NEEDS_REVIEW" &&
        releaseEvidenceArchive.archive.status === "BLOCKED" &&
        releaseEvidenceBundleAfterArchive.archives.some((item) => item.archiveId === releaseEvidenceArchive.archive.archiveId) &&
        releaseEvidenceArchiveDetail.archive.archiveId === releaseEvidenceArchive.archive.archiveId &&
        releaseEvidenceArchiveDetail.pack.status === "BLOCKED" &&
        releaseEvidenceArchiveDetail.validation.status === "PASS" &&
        releaseSignoff.signoff.status === "APPROVED" &&
        adminLegacyDecision.decision.status === "APPROVED" &&
        adminLegacyDecision.decision.evidenceRef.includes("token=secret") === false &&
        adminLegacyDecision.decision.rollbackRef.includes("token=secret") === false &&
        JSON.stringify(adminLegacyDecision).includes("raw-openid") === false &&
        adminLegacyDecisions.latest.some((item) => item.status === "APPROVED") &&
        cutoverProof.proof.status === "VERIFIED" &&
        cutoverProof.proof.evidenceRef.includes("token=secret") === false &&
        rootJumpProof.proof.status === "VERIFIED" &&
        rootJumpProof.proof.evidenceRef.includes("token=secret") === false &&
        JSON.stringify(rootJumpProof).includes("raw-openid") === false &&
        rootJumpProofs.latest.some((item) => item.productId === "ROOT_PREBIOTIC_TRIAL" && item.status === "VERIFIED") &&
        legacyMigrationDecision.decision.status === "APPROVED" &&
        legacyMigrationDecision.decision.evidenceRef.includes("token=secret") === false &&
        JSON.stringify(legacyMigrationDecision).includes("raw-openid") === false &&
        legacyMigrationDecisions.latest.some((item) => item.policy === "NO_LEGACY_DATA" && item.status === "APPROVED") &&
        legacyMigrationExecution.execution.status === "VERIFIED" &&
        legacyMigrationExecution.execution.evidenceRef.includes("token=secret") === false &&
        JSON.stringify(legacyMigrationExecution).includes("raw-openid") === false &&
        legacyMigrationExecutions.latest.some((item) => item.action === "NO_OP_CONFIRMED" && item.status === "VERIFIED") &&
        releaseRecordAfterSignoff.signoffs.some((item) => item.role === "PRODUCT" && item.archiveId === releaseEvidenceArchive.archive.archiveId && item.status === "APPROVED") &&
        releaseRecordAfterSignoff.signoffGate.summary.approvedCount === 1 &&
        releaseRecordAfterSignoff.signoffGate.summary.pendingCount === 2 &&
        releaseRecordAfterSignoff.evidence.adminTransitionReadiness.legacyDeprecationDecision.status === "APPROVED" &&
        releaseRecordAfterSignoff.evidence.adminTransitionReadiness.summary.deprecationSource === "RECORD" &&
        releaseRecordAfterSignoff.evidence.productionEvidenceIntake.items.some((item) => item.backlogId === "T-008" && item.status === "READY") &&
        releaseRecordAfterSignoff.evidence.legacyDataMigration.decision.status === "APPROVED" &&
        releaseRecordAfterSignoff.evidence.legacyDataMigration.execution.status === "VERIFIED" &&
        releaseRecordAfterSignoff.evidence.productionCutoverReadiness.summary.readyProofCount === 1 &&
        JSON.stringify(releaseEvidencePack).includes("ROOT_ADMIN_JOB_TOKEN=") === false ? "PASS" : "FAIL",
    });

    const failed = checks.filter((check) => check.status !== "PASS");
    return {
      label: "HTTP Interface smoke",
      status: failed.length ? "FAIL" : "PASS",
      code: failed.length ? 1 : 0,
      durationMs: Date.now() - startedAt,
      baseUrl,
      storeAdapter: storeAdapter.kind,
      checks,
    };
  } finally {
    await closeServer(server);
    if (typeof storeAdapter.close === "function") storeAdapter.close();
  }
}

function summarize(results) {
  const failed = results.filter((item) => item.status !== "PASS");
  return {
    status: failed.length ? "FAIL" : "PASS",
    passed: results.length - failed.length,
    failed: failed.length,
    total: results.length,
  };
}

function printHumanReport(results) {
  const summary = summarize(results);
  process.stdout.write("# ROOT 最终开发验收\n\n");
  process.stdout.write(`状态：${summary.status}\n`);
  process.stdout.write(`通过：${summary.passed}/${summary.total}\n\n`);
  for (const item of results) {
    process.stdout.write(`## ${item.label}\n`);
    process.stdout.write(`- 状态：${item.status}\n`);
    process.stdout.write(`- 耗时：${item.durationMs}ms\n`);
    if (item.command) process.stdout.write(`- 命令：${item.command}\n`);
    if (item.filesChecked) process.stdout.write(`- 文件数：${item.filesChecked}\n`);
    if (item.checks) {
      for (const check of item.checks) {
        process.stdout.write(`- ${check.id}: ${check.status}\n`);
      }
    }
    if (item.status !== "PASS") {
      if (item.stdout) process.stdout.write(`\nstdout:\n${item.stdout}\n`);
      if (item.stderr) process.stdout.write(`\nstderr:\n${item.stderr}\n`);
      if (item.failures) process.stdout.write(`\nfailures:\n${JSON.stringify(item.failures, null, 2)}\n`);
    }
    process.stdout.write("\n");
  }
}

async function runFinalVerification() {
  const results = [
    syntaxCheck(),
    releaseVersionAlignmentCheck(),
    migrationChecksumManifestCheck(),
    cloudbaseConfigSecretCheck(),
    cloudbaseTriggerTopologyCheck(),
    cloudbaseJobManifestCheck(),
    productionEnvMatrixCheck(),
    runCommand("Backend tests", "npm", ["test", "--prefix", backendDir]),
    runCommand(
      "Production dependency audit",
      "npm",
      ["audit", "--omit=dev", "--audit-level=high"],
      { cwd: backendDir },
    ),
    runCommand("Element Plus admin validation", "npm", ["run", "check", "--prefix", adminDir]),
    runCommand("Element Plus admin build", "npm", ["run", "build", "--prefix", adminDir]),
    adminDeployBundleCheck(),
    runCommand("Mini-program validation", "npm", ["run", "check", "--prefix", miniprogramDir]),
    miniprogramReleaseManifestCheck(),
    await httpSmoke(),
  ];
  return { summary: summarize(results), results };
}

async function main() {
  const json = process.argv.includes("--json");
  try {
    const report = await runFinalVerification();
    if (json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      printHumanReport(report.results);
    }
    process.exitCode = report.summary.status === "PASS" ? 0 : 1;
  } catch (error) {
    process.stderr.write(`最终验收失败：${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  cloudbaseConfigSecretCheck,
  cloudbaseTriggerTopologyCheck,
  httpSmoke,
  runFinalVerification,
  migrationChecksumManifestCheck,
  releaseVersionAlignmentCheck,
  miniprogramReleaseManifestCheck,
  syntaxCheck,
};
