#!/usr/bin/env node

function defaultRequestId(date = new Date()) {
  return `operational-alert-${date.toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.ROOT_JOB_BASE_URL ||
      process.env.ROOT_CALIBRATION_BASE_URL ||
      process.env.ROOT_PUBLIC_BASE_URL ||
      `http://127.0.0.1:${process.env.PORT || 8787}`,
    adminToken: process.env.ROOT_ADMIN_JOB_TOKEN || process.env.ROOT_ADMIN_TOKEN || "",
    campaignId: process.env.ROOT_ALERT_CAMPAIGN_ID || "",
    dateFrom: "",
    dateTo: "",
    dryRun: true,
    requestId: "",
    reason: "",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--base-url") args.baseUrl = argv[index += 1] || args.baseUrl;
    else if (item === "--admin-token") args.adminToken = argv[index += 1] || "";
    else if (item === "--campaign" || item === "--campaign-id") args.campaignId = normalizeText(argv[index += 1]);
    else if (item === "--date-from") args.dateFrom = normalizeText(argv[index += 1]);
    else if (item === "--date-to") args.dateTo = normalizeText(argv[index += 1]);
    else if (item === "--dry-run") args.dryRun = true;
    else if (item === "--execute") args.dryRun = false;
    else if (item === "--request-id") args.requestId = normalizeText(argv[index += 1]);
    else if (item === "--reason") args.reason = normalizeText(argv[index += 1]);
    else if (item === "--json") args.json = true;
  }
  args.baseUrl = args.baseUrl.replace(/\/+$/, "");
  if (!args.dryRun && !args.requestId) args.requestId = defaultRequestId();
  return args;
}

async function postOperationalAlertJob(args) {
  const body = {
    campaignId: args.campaignId || undefined,
    dateFrom: args.dateFrom || undefined,
    dateTo: args.dateTo || undefined,
    dryRun: args.dryRun,
    requestId: args.requestId || undefined,
    reason: args.reason || undefined,
  };
  const headers = { "Content-Type": "application/json" };
  if (args.requestId) headers["X-Request-Id"] = args.requestId;
  if (args.adminToken) {
    headers["X-Admin-Token"] = args.adminToken;
    headers["X-ROOT-ADMIN-TOKEN"] = args.adminToken;
  }
  const response = await fetch(`${args.baseUrl}/api/v1/jobs/operational-alerts`, {
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

async function collectOperationalAlertJob(args) {
  return postOperationalAlertJob(args);
}

function formatAlert(alert) {
  if (!alert) return "-";
  const owner = alert.ownerName || alert.ownerRole || "-";
  const metric = `${alert.metricKey || "-"} ${alert.operator || ""} ${alert.thresholdValue ?? ""}`.trim();
  return `${alert.key || "-"} / ${alert.severity || "-"} / ${owner} / ${metric}`;
}

function formatResult(item) {
  const notification = item.notification || {};
  const owner = notification.owner_role ? ` / ${notification.owner_role}` : "";
  const externalRef = notification.external_ref ? ` / ${notification.external_ref}` : "";
  const error = notification.error ? ` / ${notification.error}` : "";
  return `- ${item.status || "-"} ${formatAlert(item.alert)}${owner}${externalRef}${error}`;
}

function buildOperationalAlertJobReport(bundle) {
  const data = bundle.data || {};
  const summary = data.summary || {};
  const lines = [
    "# ROOT 运营预警 Job 报告",
    "",
    `请求结果：${bundle.ok ? "OK" : "FAILED"}`,
    `消息：${bundle.message || "ok"}`,
    `模式：${data.dryRun ? "DRY_RUN" : "EXECUTE"}`,
    `request_id：${bundle.request && bundle.request.requestId ? bundle.request.requestId : "-"}`,
    "",
    "## 预警摘要",
    `- 命中：${summary.triggeredCount || 0}`,
    `- 发出：${summary.deliveredCount || 0}`,
    `- 跳过：${summary.skippedCount || 0}`,
    `- 失败：${summary.failedCount || 0}`,
    "",
    "## 命中预警",
    ...((data.alerts || []).length ? data.alerts.map((alert) => `- ${formatAlert(alert)}：${alert.message || ""}`) : ["- 暂无命中"]),
    "",
    "## 执行结果",
    ...((data.results || []).length
      ? data.results.map(formatResult)
      : ["- 暂无执行结果"]),
  ];
  return `${lines.join("\n")}\n`;
}

function determineExitCode(bundle) {
  if (!bundle.ok) return 2;
  const data = bundle.data || {};
  const summary = data.summary || {};
  if (summary.failedCount) return 3;
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const bundle = await collectOperationalAlertJob(args);
    if (args.json) {
      process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
    } else {
      process.stdout.write(buildOperationalAlertJobReport(bundle));
    }
    process.exitCode = determineExitCode(bundle);
  } catch (error) {
    process.stderr.write(`运营预警 Job 失败：${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildOperationalAlertJobReport,
  collectOperationalAlertJob,
  defaultRequestId,
  determineExitCode,
  parseArgs,
};
