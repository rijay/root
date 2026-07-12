#!/usr/bin/env node

function defaultRequestId(date = new Date()) {
  return `lifecycle-settlement-cleanup-${date.toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
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
    campaignId: process.env.ROOT_LIFECYCLE_SETTLEMENT_CAMPAIGN_ID || "",
    dryRun: true,
    staleMinutes: parsePositiveNumber(process.env.ROOT_LIFECYCLE_SETTLEMENT_STALE_MINUTES, 120),
    cancelAfterMinutes: parsePositiveNumber(process.env.ROOT_LIFECYCLE_SETTLEMENT_CANCEL_AFTER_MINUTES, 1440),
    allowCancel: String(process.env.ROOT_LIFECYCLE_SETTLEMENT_ALLOW_CANCEL || "").toLowerCase() === "true",
    jobLimit: 20,
    status: "",
    requestId: "",
    reason: "",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--base-url") args.baseUrl = argv[index += 1] || args.baseUrl;
    else if (item === "--admin-token") args.adminToken = argv[index += 1] || "";
    else if (item === "--campaign" || item === "--campaign-id") args.campaignId = normalizeText(argv[index += 1]);
    else if (item === "--dry-run") args.dryRun = true;
    else if (item === "--execute") args.dryRun = false;
    else if (item === "--stale-minutes") args.staleMinutes = parsePositiveNumber(argv[index += 1], args.staleMinutes);
    else if (item === "--cancel-after-minutes") args.cancelAfterMinutes = parsePositiveNumber(argv[index += 1], args.cancelAfterMinutes);
    else if (item === "--allow-cancel") args.allowCancel = true;
    else if (item === "--job-limit" || item === "--max-jobs") args.jobLimit = parsePositiveNumber(argv[index += 1], args.jobLimit);
    else if (item === "--status") args.status = normalizeText(argv[index += 1]);
    else if (item === "--request-id") args.requestId = normalizeText(argv[index += 1]);
    else if (item === "--reason") args.reason = normalizeText(argv[index += 1]);
    else if (item === "--json") args.json = true;
  }
  args.baseUrl = args.baseUrl.replace(/\/+$/, "");
  if (!args.dryRun && !args.requestId) args.requestId = defaultRequestId();
  return args;
}

async function postLifecycleSettlementCleanup(args) {
  const body = {
    dryRun: args.dryRun,
    staleMinutes: args.staleMinutes,
    cancelAfterMinutes: args.cancelAfterMinutes,
    allowCancel: args.allowCancel,
    jobLimit: args.jobLimit,
    campaignId: args.campaignId || undefined,
    status: args.status || undefined,
    requestId: args.requestId || undefined,
    reason: args.reason || undefined,
  };
  const headers = { "Content-Type": "application/json" };
  if (args.requestId) headers["X-Request-Id"] = args.requestId;
  if (args.adminToken) {
    headers["X-Admin-Token"] = args.adminToken;
    headers["X-ROOT-ADMIN-TOKEN"] = args.adminToken;
  }
  const response = await fetch(`${args.baseUrl}/api/v1/jobs/lifecycle-settlement-cleanup`, {
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

async function collectLifecycleSettlementCleanup(args) {
  return postLifecycleSettlementCleanup(args);
}

function formatCandidate(job) {
  if (!job) return "-";
  const summary = job.summary || {};
  return `${job.jobId || "-"} / ${job.status || "-"} -> ${job.nextStatus || job.status || "-"} / ${job.cleanupAction || "-"} / 等待 ${job.ageMinutes || 0} 分钟 / ${summary.processed || 0}/${summary.selected || 0}`;
}

function buildLifecycleSettlementCleanupReport(bundle) {
  const data = bundle.data || {};
  const lines = [
    "# ROOT 生命周期结算队列超时清理报告",
    "",
    `请求结果：${bundle.ok ? "OK" : "FAILED"}`,
    `消息：${bundle.message || "ok"}`,
    `模式：${data.dryRun ? "DRY_RUN" : "EXECUTE"}`,
    `request_id：${bundle.request && bundle.request.requestId ? bundle.request.requestId : "-"}`,
    "",
    "## 清理摘要",
    `- 候选：${data.selectedCount || 0} / 超时总数：${data.eligibleCount || 0}`,
    `- 未选入：${data.pendingCount || 0}`,
    `- 执行：${data.executedCount || 0}`,
    `- 重置：${data.resetCount || 0}`,
    `- 取消：${data.cancelCount || 0}`,
    `- 记录：${data.annotatedCount || 0}`,
    `- 失败：${data.failedCount || 0}`,
    "",
    "## 候选队列",
    ...((data.candidates || []).length ? data.candidates.map((job) => `- ${formatCandidate(job)}：${job.cleanupReason || ""}`) : ["- 暂无候选"]),
    "",
    "## 执行结果",
    ...((data.results || []).length
      ? data.results.map((item) => `- ${item.ok ? "OK" : "FAILED"} ${item.action || "-"} ${formatCandidate(item.job)}${item.error_message ? `：${item.error_message}` : ""}`)
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
    const bundle = await collectLifecycleSettlementCleanup(args);
    if (args.json) {
      process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
    } else {
      process.stdout.write(buildLifecycleSettlementCleanupReport(bundle));
    }
    process.exitCode = determineExitCode(bundle);
  } catch (error) {
    process.stderr.write(`生命周期结算队列超时清理失败：${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildLifecycleSettlementCleanupReport,
  collectLifecycleSettlementCleanup,
  defaultRequestId,
  determineExitCode,
  parseArgs,
};
