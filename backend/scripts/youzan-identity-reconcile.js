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
  return "youzan-identity-reconcile-" + now.toISOString().replace(/\D/g, "").slice(0, 12);
}

function parseArgs(argv, env = process.env) {
  const args = {
    baseUrl: text(env.ROOT_JOB_BASE_URL || env.ROOT_PUBLIC_BASE_URL || ("http://127.0.0.1:" + (env.PORT || 8787))).replace(/\/+$/, ""),
    adminToken: text(env.ROOT_ADMIN_JOB_TOKEN || env.ROOT_ADMIN_TOKEN),
    dryRun: true,
    batchSize: integer(env.ROOT_YOUZAN_IDENTITY_RECONCILE_BATCH_SIZE, 5, 1, 20),
    refreshHours: integer(env.ROOT_YOUZAN_IDENTITY_RECONCILE_REFRESH_HOURS, 168, 1, 720),
    now: "",
    requestId: "",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--base-url") args.baseUrl = text(argv[index += 1]).replace(/\/+$/, "");
    else if (item === "--admin-token") args.adminToken = text(argv[index += 1]);
    else if (item === "--execute") args.dryRun = false;
    else if (item === "--dry-run") args.dryRun = true;
    else if (item === "--batch-size" || item === "--limit") args.batchSize = integer(argv[index += 1], args.batchSize, 1, 20);
    else if (item === "--refresh-hours") args.refreshHours = integer(argv[index += 1], args.refreshHours, 1, 720);
    else if (item === "--now") args.now = text(argv[index += 1]);
    else if (item === "--request-id") args.requestId = text(argv[index += 1]);
    else if (item === "--json") args.json = true;
  }
  if (!args.dryRun && !args.requestId) args.requestId = defaultRequestId();
  return args;
}

async function collectYouzanIdentityReconciliation(args) {
  const body = {
    dryRun: args.dryRun,
    execute: !args.dryRun,
    batchSize: args.batchSize,
    refreshHours: args.refreshHours,
    now: args.now || undefined,
    requestId: args.requestId || undefined,
  };
  const headers = { "Content-Type": "application/json" };
  if (args.requestId) headers["X-Request-Id"] = args.requestId;
  if (args.adminToken) {
    headers["X-Admin-Token"] = args.adminToken;
    headers["X-ROOT-ADMIN-TOKEN"] = args.adminToken;
  }
  const response = await fetch(args.baseUrl + "/api/v1/jobs/youzan-identity-reconcile", {
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
      batchSize: body.batchSize,
      refreshHours: body.refreshHours,
      now: body.now,
      requestId: body.requestId,
    },
  };
}

function buildYouzanIdentityReconciliationReport(bundle) {
  const data = bundle.data || {};
  const lines = [
    "# ROOT 有赞身份小批量对账报告",
    "",
    "请求结果：" + (bundle.ok ? "OK" : "FAILED"),
    "消息：" + (bundle.message || "ok"),
    "模式：" + (data.dryRun ? "DRY_RUN" : "EXECUTE"),
    "request_id：" + ((bundle.request && bundle.request.requestId) || "-"),
    "配置状态：" + (data.config && data.config.ready ? "READY" : "NOT_READY"),
    "成功身份复核周期：" + (data.refreshHours || 168) + " 小时",
    "候选：" + (data.candidateCount || 0),
    "执行：" + (data.executedCount || 0),
    "成功：" + (data.successCount || 0),
    "失败：" + (data.failedCount || 0),
    "待复核：" + (data.reviewCount || 0),
  ];
  return lines.join("\n") + "\n";
}

function determineExitCode(bundle) {
  if (!bundle.ok) return 2;
  if (bundle.data && bundle.data.failedCount) return 3;
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const bundle = await collectYouzanIdentityReconciliation(args);
    if (args.json) process.stdout.write(JSON.stringify(bundle, null, 2) + "\n");
    else process.stdout.write(buildYouzanIdentityReconciliationReport(bundle));
    process.exitCode = determineExitCode(bundle);
  } catch (error) {
    process.stderr.write("有赞身份对账失败：" + error.message + "\n");
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  buildYouzanIdentityReconciliationReport,
  collectYouzanIdentityReconciliation,
  defaultRequestId,
  determineExitCode,
  parseArgs,
};
