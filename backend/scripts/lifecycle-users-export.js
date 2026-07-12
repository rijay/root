#!/usr/bin/env node

function defaultRequestId(date = new Date()) {
  return `lifecycle-users-export-${date.toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
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
    campaignId: process.env.ROOT_LIFECYCLE_EXPORT_CAMPAIGN_ID || "",
    dryRun: true,
    limit: parsePositiveNumber(process.env.ROOT_LIFECYCLE_EXPORT_LIMIT, 200),
    retentionDays: parsePositiveNumber(process.env.ROOT_LIFECYCLE_EXPORT_RETENTION_DAYS, 7),
    sensitivity: normalizeText(process.env.ROOT_LIFECYCLE_EXPORT_SENSITIVITY || "MASKED").toUpperCase(),
    approvalRequired: parseBoolean(process.env.ROOT_LIFECYCLE_EXPORT_APPROVAL_REQUIRED),
    deliveryEnabled: parseBoolean(
      process.env.ROOT_LIFECYCLE_EXPORT_DELIVERY_ENABLED,
      Boolean(normalizeText(process.env.ROOT_LIFECYCLE_EXPORT_DELIVERY_CHANNEL)),
    ),
    deliveryChannel: normalizeText(process.env.ROOT_LIFECYCLE_EXPORT_DELIVERY_CHANNEL).toUpperCase(),
    deliveryTarget: normalizeText(process.env.ROOT_LIFECYCLE_EXPORT_DELIVERY_TARGET),
    deliveryIncludeCsv: parseBoolean(process.env.ROOT_LIFECYCLE_EXPORT_DELIVERY_INCLUDE_CSV),
    objectBaseUrl: normalizeText(process.env.ROOT_LIFECYCLE_EXPORT_OBJECT_BASE_URL),
    objectBucket: normalizeText(process.env.ROOT_LIFECYCLE_EXPORT_OBJECT_BUCKET),
    objectDir: normalizeText(process.env.ROOT_LIFECYCLE_EXPORT_OBJECT_DIR),
    objectPrefix: normalizeText(process.env.ROOT_LIFECYCLE_EXPORT_OBJECT_PREFIX),
    keyword: "",
    unionidStatus: "",
    taskProgress: "",
    consultationStatus: "",
    settlementStatus: "",
    rewardStatus: "",
    openTasks: "",
    severity: "",
    blockage: "",
    state: "",
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
    else if (item === "--limit" || item === "--export-limit") args.limit = parsePositiveNumber(argv[index += 1], args.limit);
    else if (item === "--retention-days") args.retentionDays = parsePositiveNumber(argv[index += 1], args.retentionDays);
    else if (item === "--sensitivity" || item === "--field-sensitivity") args.sensitivity = normalizeText(argv[index += 1]).toUpperCase() || args.sensitivity;
    else if (item === "--approval-required") args.approvalRequired = true;
    else if (item === "--no-approval-required") args.approvalRequired = false;
    else if (item === "--delivery-enabled") args.deliveryEnabled = true;
    else if (item === "--no-delivery") {
      args.deliveryEnabled = false;
      args.deliveryChannel = "NONE";
    }
    else if (item === "--delivery-channel") {
      args.deliveryChannel = normalizeText(argv[index += 1]).toUpperCase();
      args.deliveryEnabled = Boolean(args.deliveryChannel && args.deliveryChannel !== "NONE");
    }
    else if (item === "--delivery-target") args.deliveryTarget = normalizeText(argv[index += 1]);
    else if (item === "--delivery-include-csv") args.deliveryIncludeCsv = true;
    else if (item === "--object-base-url") args.objectBaseUrl = normalizeText(argv[index += 1]);
    else if (item === "--object-bucket") args.objectBucket = normalizeText(argv[index += 1]);
    else if (item === "--object-dir") args.objectDir = normalizeText(argv[index += 1]);
    else if (item === "--object-prefix") args.objectPrefix = normalizeText(argv[index += 1]);
    else if (item === "--keyword") args.keyword = normalizeText(argv[index += 1]);
    else if (item === "--unionid-status") args.unionidStatus = normalizeText(argv[index += 1]).toUpperCase();
    else if (item === "--task-progress") args.taskProgress = normalizeText(argv[index += 1]).toUpperCase();
    else if (item === "--consultation-status") args.consultationStatus = normalizeText(argv[index += 1]).toUpperCase();
    else if (item === "--settlement-status") args.settlementStatus = normalizeText(argv[index += 1]).toUpperCase();
    else if (item === "--reward-status") args.rewardStatus = normalizeText(argv[index += 1]).toUpperCase();
    else if (item === "--open-tasks") args.openTasks = normalizeText(argv[index += 1]).toUpperCase();
    else if (item === "--severity") args.severity = normalizeText(argv[index += 1]).toUpperCase();
    else if (item === "--blockage") args.blockage = normalizeText(argv[index += 1]);
    else if (item === "--state") args.state = normalizeText(argv[index += 1]);
    else if (item === "--request-id") args.requestId = normalizeText(argv[index += 1]);
    else if (item === "--reason") args.reason = normalizeText(argv[index += 1]);
    else if (item === "--json") args.json = true;
  }
  args.baseUrl = args.baseUrl.replace(/\/+$/, "");
  if (!args.dryRun && !args.requestId) args.requestId = defaultRequestId();
  return args;
}

function buildFilters(args) {
  return {
    campaignId: args.campaignId || undefined,
    keyword: args.keyword || undefined,
    unionidStatus: args.unionidStatus || undefined,
    taskProgress: args.taskProgress || undefined,
    consultationStatus: args.consultationStatus || undefined,
    settlementStatus: args.settlementStatus || undefined,
    rewardStatus: args.rewardStatus || undefined,
    openTasks: args.openTasks || undefined,
    severity: args.severity || undefined,
    blockage: args.blockage || undefined,
    state: args.state || undefined,
    limit: args.limit,
  };
}

async function postLifecycleUsersExport(args) {
  const body = {
    dryRun: args.dryRun,
    filters: buildFilters(args),
    retentionDays: args.retentionDays,
    sensitivity: args.sensitivity,
    approvalRequired: args.approvalRequired,
    deliveryEnabled: args.deliveryEnabled,
    deliveryChannel: args.deliveryChannel || undefined,
    deliveryTarget: args.deliveryTarget || undefined,
    deliveryIncludeCsv: args.deliveryIncludeCsv,
    objectBaseUrl: args.objectBaseUrl || undefined,
    objectBucket: args.objectBucket || undefined,
    objectDir: args.objectDir || undefined,
    objectPrefix: args.objectPrefix || undefined,
    requestId: args.requestId || undefined,
    reason: args.reason || undefined,
  };
  const headers = { "Content-Type": "application/json" };
  if (args.requestId) headers["X-Request-Id"] = args.requestId;
  if (args.adminToken) {
    headers["X-Admin-Token"] = args.adminToken;
    headers["X-ROOT-ADMIN-TOKEN"] = args.adminToken;
  }
  const response = await fetch(`${args.baseUrl}/api/v1/jobs/lifecycle-users-export`, {
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

async function collectLifecycleUsersExport(args) {
  return postLifecycleUsersExport(args);
}

function formatFilters(filters = {}) {
  const visible = Object.entries(filters)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${value}`);
  return visible.length ? visible.join(" / ") : "-";
}

function buildLifecycleUsersExportReport(bundle) {
  const data = bundle.data || {};
  const summary = data.summary || {};
  const record = data.exportRecord || null;
  const lines = [
    "# ROOT 用户生命周期定时导出报告",
    "",
    `请求结果：${bundle.ok ? "OK" : "FAILED"}`,
    `消息：${bundle.message || "ok"}`,
    `模式：${data.dryRun ? "DRY_RUN" : "EXECUTE"}`,
    `request_id：${bundle.request && bundle.request.requestId ? bundle.request.requestId : "-"}`,
    "",
    "## 导出摘要",
    `- 命中用户：${summary.total || 0}`,
    `- 导出用户：${summary.exportedCount || 0}`,
    `- limit：${summary.limit || 0}`,
    `- 是否截断：${summary.truncated ? "YES" : "NO"}`,
    `- 文件大小：${summary.bytes || 0} bytes`,
    `- 保留天数：${summary.retentionDays || 0}`,
    `- 字段策略：${summary.sensitivity || data.sensitivity || "-"}`,
    `- 请求策略：${summary.requestedSensitivity || data.requestedSensitivity || "-"}`,
    `- 策略降级：${summary.sensitivityDowngraded || data.sensitivityDowngraded ? "YES" : "NO"}`,
    `- 下载审批：${summary.approvalRequired || data.approvalRequired ? summary.approvalStatus || data.approvalStatus || "PENDING" : "NOT_REQUIRED"}`,
    `- 外部交付：${record && record.delivery ? `${record.delivery.channel}/${record.delivery.status}` : `${summary.deliveryChannel || "NONE"}/${summary.deliveryRequested ? "READY" : "NOT_REQUESTED"}`}`,
    "",
    "## 筛选条件",
    `- ${formatFilters(data.filters || {})}`,
    "",
    "## 导出记录",
    record
      ? `- ${record.exportId} / ${record.filename} / 过期 ${record.expiresAt || "-"}`
      : "- dry-run 未创建导出记录",
  ];
  return `${lines.join("\n")}\n`;
}

function determineExitCode(bundle) {
  return bundle.ok ? 0 : 2;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const bundle = await collectLifecycleUsersExport(args);
    if (args.json) {
      process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
    } else {
      process.stdout.write(buildLifecycleUsersExportReport(bundle));
    }
    process.exitCode = determineExitCode(bundle);
  } catch (error) {
    process.stderr.write(`用户生命周期定时导出失败：${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildLifecycleUsersExportReport,
  collectLifecycleUsersExport,
  defaultRequestId,
  determineExitCode,
  parseArgs,
};
