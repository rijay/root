#!/usr/bin/env node

const SOURCE_ALIASES = {
  ORDER: "YOUZAN_ORDER",
  YOUZAN: "YOUZAN_ORDER",
  YOUZAN_ORDER: "YOUZAN_ORDER",
  CUSTOMER: "YOUZAN_CUSTOMER",
  YOUZAN_CUSTOMER: "YOUZAN_CUSTOMER",
  FULFILLMENT: "FULFILLMENT",
  LOGISTICS: "FULFILLMENT",
  WECHAT: "WECHAT_LEAD",
  WECHAT_LEAD: "WECHAT_LEAD",
  WEWORK: "WECHAT_LEAD",
  WEWORK_CONTACT: "WECHAT_LEAD",
};

function normalizeSource(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return SOURCE_ALIASES[text.toUpperCase()] || text.toUpperCase();
}

function defaultRequestId(date = new Date()) {
  return `adapter-retry-due-${date.toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
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
    dryRun: false,
    batchSize: 5,
    maxAttempts: 5,
    sourceType: "",
    adapterKind: "",
    now: "",
    requestId: "",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--base-url") args.baseUrl = argv[index += 1] || args.baseUrl;
    else if (item === "--admin-token") args.adminToken = argv[index += 1] || "";
    else if (item === "--dry-run") args.dryRun = true;
    else if (item === "--execute") args.dryRun = false;
    else if (item === "--batch-size" || item === "--limit") args.batchSize = parsePositiveNumber(argv[index += 1], args.batchSize);
    else if (item === "--max-attempts") args.maxAttempts = parsePositiveNumber(argv[index += 1], args.maxAttempts);
    else if (item === "--source") args.sourceType = normalizeSource(argv[index += 1]);
    else if (item === "--adapter") args.adapterKind = String(argv[index += 1] || "").trim().toUpperCase();
    else if (item === "--now") args.now = argv[index += 1] || "";
    else if (item === "--request-id") args.requestId = argv[index += 1] || "";
    else if (item === "--json") args.json = true;
  }
  args.baseUrl = args.baseUrl.replace(/\/+$/, "");
  if (!args.dryRun && !args.requestId) args.requestId = defaultRequestId();
  return args;
}

async function postRetryJob(args) {
  const body = {
    dryRun: args.dryRun,
    batchSize: args.batchSize,
    maxAttempts: args.maxAttempts,
    sourceType: args.sourceType || undefined,
    adapterKind: args.adapterKind || undefined,
    now: args.now || undefined,
    requestId: args.requestId || undefined,
  };
  const headers = { "Content-Type": "application/json" };
  if (args.requestId) headers["X-Request-Id"] = args.requestId;
  if (args.adminToken) {
    headers["X-Admin-Token"] = args.adminToken;
    headers["X-ROOT-ADMIN-TOKEN"] = args.adminToken;
  }
  const response = await fetch(`${args.baseUrl}/api/v1/jobs/adapter-retry-due`, {
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

async function collectAdapterRetryJob(args) {
  return postRetryJob(args);
}

function formatRun(run) {
  if (!run) return "-";
  return `${run.run_id || "-"} / ${run.source_type || "-"} / ${run.adapter_kind || "-"} / ${run.retry_status || "-"}`;
}

function buildAdapterRetryJobReport(bundle) {
  const data = bundle.data || {};
  const lines = [
    "# ROOT Adapter 到期重试 Job 报告",
    "",
    `请求结果：${bundle.ok ? "OK" : "FAILED"}`,
    `消息：${bundle.message || "ok"}`,
    `模式：${data.dryRun ? "DRY_RUN" : "EXECUTE"}`,
    `request_id：${bundle.request && bundle.request.requestId ? bundle.request.requestId : "-"}`,
    "",
    "## 调度摘要",
    `- 候选：${data.selectedCount || 0} / 到期总数：${data.eligibleCount || 0}`,
    `- 待到期：${data.pendingCount || 0}`,
    `- 跳过：${data.skippedCount || 0}`,
    `- 执行：${data.executedCount || 0}`,
    `- 成功：${data.successCount || 0}`,
    `- 失败：${data.failedCount || 0}`,
    "",
    "## 候选运行",
    ...((data.candidates || []).length ? data.candidates.map((run) => `- ${formatRun(run)}`) : ["- 暂无候选"]),
    "",
    "## 执行结果",
    ...((data.results || []).length
      ? data.results.map((item) => `- ${item.ok ? "OK" : "FAILED"} ${formatRun(item.run || item.sourceRun)}${item.error_message ? `：${item.error_message}` : ""}`)
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
    const bundle = await collectAdapterRetryJob(args);
    if (args.json) {
      process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
    } else {
      process.stdout.write(buildAdapterRetryJobReport(bundle));
    }
    process.exitCode = determineExitCode(bundle);
  } catch (error) {
    process.stderr.write(`Adapter 到期重试 Job 失败：${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildAdapterRetryJobReport,
  collectAdapterRetryJob,
  defaultRequestId,
  determineExitCode,
  normalizeSource,
  parseArgs,
};
