#!/usr/bin/env node

function defaultRequestId(date = new Date()) {
  return `lifecycle-user-exports-delivery-retry-${date.toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function parsePositiveNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function parseBoolean(value, fallback = false) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return fallback;
  return ["true", "1", "yes", "y"].includes(normalized);
}

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.ROOT_JOB_BASE_URL ||
      process.env.ROOT_CALIBRATION_BASE_URL ||
      process.env.ROOT_PUBLIC_BASE_URL ||
      `http://127.0.0.1:${process.env.PORT || 8787}`,
    adminToken: process.env.ROOT_ADMIN_JOB_TOKEN || process.env.ROOT_ADMIN_TOKEN || "",
    dryRun: true,
    limit: parsePositiveNumber(process.env.ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_BATCH_SIZE, 20),
    maxAttempts: parsePositiveNumber(process.env.ROOT_LIFECYCLE_EXPORT_DELIVERY_MAX_ATTEMPTS, 3),
    retryDelaySeconds: parsePositiveNumber(process.env.ROOT_LIFECYCLE_EXPORT_DELIVERY_RETRY_DELAY_SECONDS, 300),
    deliveryChannel: normalizeText(process.env.ROOT_LIFECYCLE_EXPORT_DELIVERY_CHANNEL).toUpperCase(),
    webhookUrl: normalizeText(process.env.ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_URL),
    webhookSecret: normalizeText(process.env.ROOT_LIFECYCLE_EXPORT_DELIVERY_SECRET),
    webhookChannel: normalizeText(process.env.ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_CHANNEL),
    webhookTemplate: normalizeText(process.env.ROOT_LIFECYCLE_EXPORT_DELIVERY_WEBHOOK_TEMPLATE),
    webhookTimeoutMs: parsePositiveNumber(process.env.ROOT_LIFECYCLE_EXPORT_DELIVERY_TIMEOUT_MS, 5000),
    signedDownload: parseBoolean(process.env.ROOT_LIFECYCLE_EXPORT_SIGNED_DOWNLOAD_ENABLED, false),
    signedDownloadTtlSeconds: parsePositiveNumber(process.env.ROOT_LIFECYCLE_EXPORT_SIGNED_DOWNLOAD_TTL_SECONDS, 86400),
    objectBaseUrl: normalizeText(process.env.ROOT_LIFECYCLE_EXPORT_OBJECT_BASE_URL),
    objectBucket: normalizeText(process.env.ROOT_LIFECYCLE_EXPORT_OBJECT_BUCKET),
    objectDir: normalizeText(process.env.ROOT_LIFECYCLE_EXPORT_OBJECT_DIR),
    objectPrefix: normalizeText(process.env.ROOT_LIFECYCLE_EXPORT_OBJECT_PREFIX),
    now: "",
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
    else if (item === "--limit" || item === "--batch-size") args.limit = parsePositiveNumber(argv[index += 1], args.limit);
    else if (item === "--max-attempts") args.maxAttempts = parsePositiveNumber(argv[index += 1], args.maxAttempts);
    else if (item === "--retry-delay-seconds") args.retryDelaySeconds = parsePositiveNumber(argv[index += 1], args.retryDelaySeconds);
    else if (item === "--delivery-channel") args.deliveryChannel = normalizeText(argv[index += 1]).toUpperCase();
    else if (item === "--webhook-url") args.webhookUrl = normalizeText(argv[index += 1]);
    else if (item === "--webhook-secret") args.webhookSecret = normalizeText(argv[index += 1]);
    else if (item === "--webhook-channel") args.webhookChannel = normalizeText(argv[index += 1]).toUpperCase();
    else if (item === "--webhook-template") args.webhookTemplate = normalizeText(argv[index += 1]);
    else if (item === "--webhook-timeout-ms") args.webhookTimeoutMs = parsePositiveNumber(argv[index += 1], args.webhookTimeoutMs);
    else if (item === "--signed-download") args.signedDownload = true;
    else if (item === "--no-signed-download") args.signedDownload = false;
    else if (item === "--signed-download-ttl-seconds") args.signedDownloadTtlSeconds = parsePositiveNumber(argv[index += 1], args.signedDownloadTtlSeconds);
    else if (item === "--object-base-url") args.objectBaseUrl = normalizeText(argv[index += 1]);
    else if (item === "--object-bucket") args.objectBucket = normalizeText(argv[index += 1]);
    else if (item === "--object-dir") args.objectDir = normalizeText(argv[index += 1]);
    else if (item === "--object-prefix") args.objectPrefix = normalizeText(argv[index += 1]);
    else if (item === "--now") args.now = normalizeText(argv[index += 1]);
    else if (item === "--request-id") args.requestId = normalizeText(argv[index += 1]);
    else if (item === "--reason") args.reason = normalizeText(argv[index += 1]);
    else if (item === "--json") args.json = true;
  }
  args.baseUrl = args.baseUrl.replace(/\/+$/, "");
  if (!args.dryRun && !args.requestId) args.requestId = defaultRequestId();
  return args;
}

async function postLifecycleUserExportsDeliveryRetry(args) {
  const body = {
    dryRun: args.dryRun,
    limit: args.limit,
    deliveryRetryEnabled: true,
    deliveryMaxAttempts: args.maxAttempts,
    deliveryRetryDelaySeconds: args.retryDelaySeconds,
    deliveryChannel: args.deliveryChannel || undefined,
    webhookUrl: args.webhookUrl || undefined,
    webhookSecret: args.webhookSecret || undefined,
    webhookChannel: args.webhookChannel || undefined,
    webhookTemplate: args.webhookTemplate || undefined,
    webhookTimeoutMs: args.webhookTimeoutMs || undefined,
    signedDownload: args.signedDownload,
    signedDownloadTtlSeconds: args.signedDownloadTtlSeconds || undefined,
    objectBaseUrl: args.objectBaseUrl || undefined,
    objectBucket: args.objectBucket || undefined,
    objectDir: args.objectDir || undefined,
    objectPrefix: args.objectPrefix || undefined,
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
  const response = await fetch(`${args.baseUrl}/api/v1/jobs/lifecycle-user-exports-delivery-retry`, {
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

async function collectLifecycleUserExportsDeliveryRetry(args) {
  return postLifecycleUserExportsDeliveryRetry(args);
}

function formatCandidate(item) {
  if (!item) return "-";
  return `${item.exportId || "-"} / ${item.channel || "-"} / attempt ${item.attemptCount || 0}/${item.maxAttempts || 0} / ${item.nextRetryAt || "-"}`;
}

function buildLifecycleUserExportsDeliveryRetryReport(bundle) {
  const data = bundle.data || {};
  const lines = [
    "# ROOT 用户生命周期导出交付重试报告",
    "",
    `请求结果：${bundle.ok ? "OK" : "FAILED"}`,
    `消息：${bundle.message || "ok"}`,
    `模式：${data.dryRun ? "DRY_RUN" : "EXECUTE"}`,
    `request_id：${bundle.request && bundle.request.requestId ? bundle.request.requestId : "-"}`,
    "",
    "## 重试摘要",
    `- 候选：${data.selectedCount || 0} / 到期总数：${data.eligibleCount || 0}`,
    `- 未选入：${data.pendingCount || 0}`,
    `- 执行：${data.executedCount || 0}`,
    `- 成功：${data.deliveredCount || 0}`,
    `- 重新排队：${data.rescheduledCount || 0}`,
    `- 死信：${data.deadLetterCount || 0}`,
    `- 失败：${data.failedCount || 0}`,
    "",
    "## 到期候选",
    ...((data.candidates || []).length ? data.candidates.map((item) => `- ${formatCandidate(item)}：${item.error || ""}`) : ["- 暂无候选"]),
    "",
    "## 执行结果",
    ...((data.results || []).length
      ? data.results.map((item) => `- ${item.delivered ? "OK" : item.status || "FAILED"} ${item.exportId || "-"} / attempt ${item.attemptCount || 0}${item.nextRetryAt ? ` / next ${item.nextRetryAt}` : ""}${item.error ? `：${item.error}` : ""}`)
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
    const bundle = await collectLifecycleUserExportsDeliveryRetry(args);
    if (args.json) {
      process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
    } else {
      process.stdout.write(buildLifecycleUserExportsDeliveryRetryReport(bundle));
    }
    process.exitCode = determineExitCode(bundle);
  } catch (error) {
    process.stderr.write(`用户生命周期导出交付重试失败：${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildLifecycleUserExportsDeliveryRetryReport,
  collectLifecycleUserExportsDeliveryRetry,
  defaultRequestId,
  determineExitCode,
  parseArgs,
};
