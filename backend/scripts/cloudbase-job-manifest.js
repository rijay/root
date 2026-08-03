#!/usr/bin/env node

const DEFAULT_BASE_URL = "${ROOT_JOB_BASE_URL}";
const REQUIRED_ENV = ["ROOT_JOB_BASE_URL"];
const JOB_TOKEN_ENV = ["ROOT_ADMIN_JOB_ROUTE_TOKENS", "ROOT_ADMIN_JOB_TOKEN", "ROOT_ADMIN_JOB_TOKENS"];

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function resolveBaseUrl(env = process.env, explicitBaseUrl = "") {
  return normalizeBaseUrl(
    explicitBaseUrl || env.ROOT_JOB_BASE_URL || env.ROOT_PUBLIC_BASE_URL || ""
  );
}

function parseArgs(argv, env = process.env) {
  const args = {
    baseUrl: resolveBaseUrl(env),
    json: false,
    strict: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--base-url") args.baseUrl = normalizeBaseUrl(argv[index += 1] || args.baseUrl);
    else if (item === "--json") args.json = true;
    else if (item === "--strict") args.strict = true;
  }
  return args;
}

function buildCloudbaseJobManifest(options = {}) {
  const baseUrl = resolveBaseUrl(options.env, options.baseUrl) || DEFAULT_BASE_URL;
  return {
    version: 2,
    title: "ROOT Formal Launch Scheduled Jobs",
    environment: {
      baseUrl,
      requiredEnv: REQUIRED_ENV,
      anyOfEnv: [JOB_TOKEN_ENV],
      optionalEnv: [
        "ROOT_ADMIN_JOB_ROUTE_TOKENS",
        "ROOT_ADMIN_JOB_TOKENS",
        "ROOT_REQUIRE_SCOPED_JOB_TOKENS",
        "ROOT_JOB_ROUTE_QUERY",
        "ROOT_HEALTH_DATA_RETENTION_CLEANUP_ENABLED",
        "ROOT_HEALTH_DATA_RETENTION_CLEANUP_LIMIT",
        "ROOT_PRIVACY_CONTROLLER_NAME",
        "ROOT_PRIVACY_CONTACT",
        "ROOT_V1_RUNTIME_SCHEDULER_DRY_RUN",
        "ROOT_V1_RUNTIME_BRIDGE_LIMIT",
        "ROOT_V1_RUNTIME_RECOVERY_LIMIT",
        "ROOT_V1_RUNTIME_WORKER_LIMIT",
        "ROOT_V1_RUNTIME_SCHEDULER_TIMEOUT_SECONDS",
      ],
      tokenHeader: "X-Admin-Token",
      tokenPolicy: "每个保留 Job 路径使用独立轮换 token；生产环境启用 scoped token。",
      requestIdPolicy: "execute 模式必须使用稳定 request_id。",
    },
    jobs: [
      {
        id: "health_data_retention_cleanup",
        title: "健康敏感数据到期清理",
        schedule: {
          cron: "15 4 * * *",
          timezone: "Asia/Shanghai",
          description: "每日 04:15 清理超过批准保存期限的健康敏感数据。",
        },
        http: {
          method: "POST",
          path: "/api/v1/jobs/health-data-retention-cleanup",
          body: { dryRun: false, limit: 50, objectCleanup: true },
        },
        dryRunCommand: `ROOT_JOB_BASE_URL=${baseUrl} ROOT_ADMIN_JOB_TOKEN=*** npm run health-data-retention-cleanup --prefix backend -- --dry-run --limit 50`,
        executeCommand: `ROOT_JOB_BASE_URL=${baseUrl} ROOT_ADMIN_JOB_TOKEN=*** npm run health-data-retention-cleanup --prefix backend -- --execute --limit 50`,
        requiredEnv: REQUIRED_ENV,
        safeguards: [
          "保留期限由已批准隐私配置决定。",
          "执行前支持 dry-run；外部对象清理失败会阻断成功状态。",
        ],
      },
      {
        id: "v1_runtime_cycle",
        title: "V1 可靠性运行周期",
        schedule: {
          cron: "* * * * *",
          timezone: "Asia/Shanghai",
          description: "每分钟推进保留的 Outbox/Inbox 与恢复控制。",
        },
        http: {
          method: "POST",
          path: "/api/v1/jobs/v1-runtime-cycle",
          body: { dryRun: true },
        },
        invocation: {
          mode: "CLOUDBASE_TIMER_ONLY",
          functionName: "myroot-v1-runtime-scheduler",
          triggerName: "v1_runtime_cycle",
          dryRunEnv: "ROOT_V1_RUNTIME_SCHEDULER_DRY_RUN",
        },
        requiredEnv: REQUIRED_ENV,
        safeguards: [
          "默认 preview；生产执行由独立运行控制证据授权。",
          "固定 timer identity 与 request_id，拒绝任意调用者提供运行身份。",
        ],
      },
    ],
  };
}

function isCronExpression(value) {
  return typeof value === "string" && value.trim().split(/\s+/).length === 5;
}

function validateCloudbaseJobManifest(manifest, options = {}) {
  const errors = [];
  const warnings = [];
  if (!manifest || manifest.version !== 2) errors.push("manifest.version must be 2");
  if (!manifest || !manifest.environment) errors.push("manifest.environment is required");
  const jobs = manifest && Array.isArray(manifest.jobs) ? manifest.jobs : [];
  const expectedIds = ["health_data_retention_cleanup", "v1_runtime_cycle"];
  if (jobs.length !== expectedIds.length) errors.push("manifest.jobs must contain exactly the two formal-launch jobs");
  if (!manifest || !manifest.environment || !Array.isArray(manifest.environment.anyOfEnv)
    || !manifest.environment.anyOfEnv.some((group) => (
      Array.isArray(group) && JOB_TOKEN_ENV.every((name) => group.includes(name))
    ))) {
    errors.push("manifest.environment.anyOfEnv must declare the Job token rotation alternatives");
  }
  const ids = new Set();
  for (const job of jobs) {
    if (!job.id || ids.has(job.id)) errors.push(`invalid or duplicate job id: ${job.id || "missing"}`);
    ids.add(job.id);
    if (!job.schedule || !isCronExpression(job.schedule.cron)) errors.push(`${job.id || "job"} schedule.cron must use five-field cron`);
    if (!job.http || job.http.method !== "POST" || !String(job.http.path || "").startsWith("/api/v1/jobs/")) {
      errors.push(`${job.id || "job"} http Interface must call POST /api/v1/jobs/*`);
    }
    if (!Array.isArray(job.requiredEnv) || !REQUIRED_ENV.every((name) => job.requiredEnv.includes(name))) {
      errors.push(`${job.id || "job"} is missing required environment`);
    }
    if (job.id === "v1_runtime_cycle") {
      if (!job.invocation || job.invocation.mode !== "CLOUDBASE_TIMER_ONLY"
        || job.invocation.functionName !== "myroot-v1-runtime-scheduler"
        || job.invocation.triggerName !== "v1_runtime_cycle") {
        errors.push("v1_runtime_cycle timer-only invocation contract is invalid");
      }
    } else if (!job.executeCommand?.includes("--execute") || !job.dryRunCommand?.includes("--dry-run")) {
      errors.push(`${job.id || "job"} must expose explicit dry-run and execute commands`);
    }
  }
  for (const id of expectedIds) if (!ids.has(id)) errors.push(`missing job ${id}`);
  const baseUrl = manifest && manifest.environment && manifest.environment.baseUrl;
  if (!baseUrl || baseUrl === DEFAULT_BASE_URL) warnings.push("ROOT_JOB_BASE_URL is not resolved; configure it before execute mode");
  if (options.strict && String(baseUrl || "").startsWith("http://")) errors.push("strict mode requires HTTPS ROOT_JOB_BASE_URL");
  return { status: errors.length ? "FAIL" : "PASS", errors, warnings };
}

function buildCloudbaseJobManifestReport(manifest, validation) {
  const lines = [
    "# ROOT 正式上线定时任务 Manifest",
    "",
    `状态：${validation.status}`,
    `base_url：${manifest.environment.baseUrl}`,
    "",
    "## 保留任务",
  ];
  for (const job of manifest.jobs) {
    lines.push(
      `- ${job.id}：${job.schedule.description}`,
      `  - cron：${job.schedule.cron} (${job.schedule.timezone})`,
      `  - Interface：${job.http.method} ${job.http.path}`
    );
  }
  if (validation.warnings.length) lines.push("", "## 提醒", ...validation.warnings.map((item) => `- ${item}`));
  if (validation.errors.length) lines.push("", "## 错误", ...validation.errors.map((item) => `- ${item}`));
  return `${lines.join("\n")}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = buildCloudbaseJobManifest(args);
  const validation = validateCloudbaseJobManifest(manifest, { strict: args.strict });
  process.stdout.write(args.json
    ? `${JSON.stringify({ manifest, validation }, null, 2)}\n`
    : buildCloudbaseJobManifestReport(manifest, validation));
  process.exitCode = validation.status === "PASS" ? 0 : 1;
}

if (require.main === module) main();

module.exports = {
  buildCloudbaseJobManifest,
  buildCloudbaseJobManifestReport,
  parseArgs,
  resolveBaseUrl,
  validateCloudbaseJobManifest,
};
