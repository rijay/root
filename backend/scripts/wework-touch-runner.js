#!/usr/bin/env node

function defaultRequestId(date = new Date()) {
  return `wework-touch-due-${date.toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function parsePositiveNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.ROOT_JOB_BASE_URL ||
      process.env.ROOT_CALIBRATION_BASE_URL ||
      process.env.ROOT_PUBLIC_BASE_URL ||
      `http://127.0.0.1:${process.env.PORT || 8787}`,
    adminToken: process.env.ROOT_ADMIN_JOB_TOKEN || process.env.ROOT_ADMIN_TOKEN || "",
    dryRun: true,
    limit: parsePositiveNumber(process.env.ROOT_WEWORK_TOUCH_TASK_LIMIT, 50),
    batchSize: parsePositiveNumber(process.env.ROOT_WEWORK_TOUCH_BATCH_SIZE, 20),
    cooldownHours: parsePositiveNumber(process.env.ROOT_WEWORK_TOUCH_COOLDOWN_HOURS, 24),
    adapterMode: normalizeText(process.env.ROOT_WEWORK_TOUCH_ADAPTER_MODE || "AUTO"),
    requestId: "",
    reason: "",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--base-url") args.baseUrl = argv[index += 1] || args.baseUrl;
    else if (item === "--admin-token") args.adminToken = argv[index += 1] || "";
    else if (item === "--dry-run") args.dryRun = true;
    else if (item === "--execute") args.dryRun = false;
    else if (item === "--limit" || item === "--task-limit") args.limit = parsePositiveNumber(argv[index += 1], args.limit);
    else if (item === "--batch-size") args.batchSize = parsePositiveNumber(argv[index += 1], args.batchSize);
    else if (item === "--cooldown-hours") args.cooldownHours = parsePositiveNumber(argv[index += 1], args.cooldownHours);
    else if (item === "--adapter-mode") args.adapterMode = normalizeText(argv[index += 1] || args.adapterMode);
    else if (item === "--request-id") args.requestId = normalizeText(argv[index += 1]);
    else if (item === "--reason") args.reason = normalizeText(argv[index += 1]);
    else if (item === "--json") args.json = true;
  }
  args.baseUrl = args.baseUrl.replace(/\/+$/, "");
  if (!args.dryRun && !args.requestId) args.requestId = defaultRequestId();
  return args;
}

async function postWeWorkTouchJob(args) {
  const body = {
    dryRun: args.dryRun,
    limit: args.limit,
    batchSize: args.batchSize,
    cooldownHours: args.cooldownHours,
    adapterMode: args.adapterMode || undefined,
    requestId: args.requestId || undefined,
    reason: args.reason || undefined,
  };
  const headers = { "Content-Type": "application/json" };
  if (args.requestId) headers["X-Request-Id"] = args.requestId;
  if (args.adminToken) {
    headers["X-Admin-Token"] = args.adminToken;
    headers["X-ROOT-ADMIN-TOKEN"] = args.adminToken;
  }
  const response = await fetch(`${args.baseUrl}/api/v1/jobs/wework-touch-due`, {
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
    request: body,
  };
}

async function collectWeWorkTouchJob(args) {
  return postWeWorkTouchJob(args);
}

function formatJob(job) {
  if (!job) return "-";
  return `${job.touchJobId || "-"} / ${job.status || "-"} / ${job.taskType || "-"} / ${job.externalContactId || "-"}`;
}

function buildWeWorkTouchJobReport(bundle) {
  const data = bundle.data || {};
  const plan = data.plan || {};
  const lines = [
    "# ROOT 企微自动触达 Job 报告",
    "",
    `请求结果：${bundle.ok ? "OK" : "FAILED"}`,
    `消息：${bundle.message || "ok"}`,
    `模式：${data.dryRun ? "DRY_RUN" : "EXECUTE"}`,
    `request_id：${bundle.request && bundle.request.requestId ? bundle.request.requestId : "-"}`,
    "",
    "## 规划摘要",
    `- 候选：${plan.selectedCount || 0}`,
    `- 新建：${plan.createdCount || 0}`,
    `- 阻塞：${plan.blockedCount || 0}`,
    "",
    "## 执行摘要",
    `- 选中：${data.selectedCount || 0}`,
    `- 执行：${data.executedCount || 0}`,
    `- 成功：${data.successCount || 0}`,
    `- 失败：${data.failedCount || 0}`,
    "",
    "## 触达 Job",
    ...((data.jobs || []).length ? data.jobs.map((job) => `- ${formatJob(job)}`) : ["- 暂无触达 Job"]),
    "",
    "## 执行结果",
    ...((data.results || []).length
      ? data.results.map((item) => `- ${item.ok ? "OK" : "FAILED"} ${formatJob(item.job)}${item.message ? `：${item.message}` : ""}`)
      : ["- 暂无执行结果"]),
  ];
  return `${lines.join("\n")}\n`;
}

function determineExitCode(bundle) {
  if (!bundle.ok) return 2;
  const data = bundle.data || {};
  if (data.failedCount) return 3;
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const bundle = await collectWeWorkTouchJob(args);
    if (args.json) {
      process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
    } else {
      process.stdout.write(buildWeWorkTouchJobReport(bundle));
    }
    process.exitCode = determineExitCode(bundle);
  } catch (error) {
    process.stderr.write(`企微自动触达 Job 失败：${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildWeWorkTouchJobReport,
  collectWeWorkTouchJob,
  defaultRequestId,
  determineExitCode,
  parseArgs,
};
