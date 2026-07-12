#!/usr/bin/env node

function text(value) {
  return String(value || "").trim();
}

function integer(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function defaultRequestId(now = new Date()) {
  return "health-data-retention-" + now.toISOString().replace(/\D/g, "").slice(0, 12);
}

function parseArgs(argv, env = process.env) {
  const args = {
    baseUrl: text(env.ROOT_JOB_BASE_URL || env.ROOT_PUBLIC_BASE_URL || ("http://127.0.0.1:" + (env.PORT || 8787))).replace(/\/+$/, ""),
    adminToken: text(env.ROOT_ADMIN_JOB_TOKEN || env.ROOT_ADMIN_TOKEN),
    dryRun: true,
    limit: integer(env.ROOT_HEALTH_DATA_RETENTION_CLEANUP_LIMIT, 50, 1, 200),
    objectCleanup: true,
    now: "",
    requestId: "",
    reason: "健康敏感数据保存期限到期清理",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--base-url") args.baseUrl = text(argv[index += 1]).replace(/\/+$/, "");
    else if (item === "--admin-token") args.adminToken = text(argv[index += 1]);
    else if (item === "--execute") args.dryRun = false;
    else if (item === "--dry-run") args.dryRun = true;
    else if (item === "--limit") args.limit = integer(argv[index += 1], args.limit, 1, 200);
    else if (item === "--no-object-cleanup") args.objectCleanup = false;
    else if (item === "--now") args.now = text(argv[index += 1]);
    else if (item === "--request-id") args.requestId = text(argv[index += 1]);
    else if (item === "--reason") args.reason = text(argv[index += 1]);
    else if (item === "--json") args.json = true;
  }
  if (!args.dryRun && !args.requestId) args.requestId = defaultRequestId();
  return args;
}

async function collectHealthDataRetentionCleanup(args) {
  const body = {
    dryRun: args.dryRun,
    execute: !args.dryRun,
    limit: args.limit,
    objectCleanup: args.objectCleanup,
    now: args.now || undefined,
    requestId: args.requestId || undefined,
    reason: args.reason || undefined,
  };
  const headers = { "Content-Type": "application/json" };
  if (args.requestId) headers["X-Request-Id"] = args.requestId;
  if (args.adminToken) {
    headers["X-Admin-Token"] = args.adminToken;
    headers["X-ROOT-ADMIN-TOKEN"] = args.adminToken;
  }
  const response = await fetch(args.baseUrl + "/api/v1/jobs/health-data-retention-cleanup", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return {
    ok: response.ok && payload.code === 0,
    code: payload.code,
    message: payload.message,
    data: payload.data,
    request: {
      dryRun: body.dryRun,
      limit: body.limit,
      objectCleanup: body.objectCleanup,
      now: body.now,
      requestId: body.requestId,
    },
  };
}

function buildHealthDataRetentionCleanupReport(bundle) {
  const data = bundle.data || {};
  const lines = [
    "# ROOT 健康敏感数据到期清理报告",
    "",
    "请求结果：" + (bundle.ok ? "OK" : "FAILED"),
    "消息：" + (bundle.message || "ok"),
    "模式：" + (data.dryRun ? "DRY_RUN" : "EXECUTE"),
    "request_id：" + ((bundle.request && bundle.request.requestId) || "-"),
    "保存天数：" + (data.retentionDays || "-"),
    "截止日期：" + (data.cutoffDate || "-"),
    "",
    "## 清理摘要",
    "- 候选：" + (data.selectedCount || 0) + " / 到期总数：" + (data.eligibleCount || 0),
    "- 未选入：" + (data.pendingCount || 0),
    "- 完整脱敏：" + (data.redactedCount || 0),
    "- 部分脱敏：" + (data.partialRedactedCount || 0),
    "- 删除引用记录：" + (data.removedCount || 0),
    "- 对象删除：" + (data.objectDeletedCount || 0),
    "- 对象已不存在：" + (data.objectAlreadyMissingCount || 0),
    "- 共享对象保留：" + (data.objectSharedCount || 0),
    "- 对象失败：" + (data.objectFailedCount || 0),
    "- 外部 HTTPS 引用移除：" + (data.unmanagedHttpsCount || 0),
    "- 失败记录：" + (data.failedCount || 0),
  ];
  return lines.join("\n") + "\n";
}

function determineExitCode(bundle) {
  if (!bundle.ok) return 2;
  if (bundle.data && (bundle.data.failedCount || bundle.data.objectFailedCount || bundle.data.unmanagedHttpsCount)) return 3;
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const bundle = await collectHealthDataRetentionCleanup(args);
    if (args.json) process.stdout.write(JSON.stringify(bundle, null, 2) + "\n");
    else process.stdout.write(buildHealthDataRetentionCleanupReport(bundle));
    process.exitCode = determineExitCode(bundle);
  } catch (error) {
    process.stderr.write("健康敏感数据到期清理失败：" + error.message + "\n");
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  buildHealthDataRetentionCleanupReport,
  collectHealthDataRetentionCleanup,
  defaultRequestId,
  determineExitCode,
  parseArgs,
};
