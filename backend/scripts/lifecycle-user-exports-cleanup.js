#!/usr/bin/env node

function defaultRequestId(date = new Date()) {
  return `lifecycle-user-exports-cleanup-${date.toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
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
    limit: parsePositiveNumber(process.env.ROOT_LIFECYCLE_EXPORT_CLEANUP_LIMIT, 50),
    objectCleanup: parseBoolean(process.env.ROOT_LIFECYCLE_EXPORT_OBJECT_CLEANUP_ENABLED, true),
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
    else if (item === "--limit" || item === "--cleanup-limit") args.limit = parsePositiveNumber(argv[index += 1], args.limit);
    else if (item === "--object-cleanup") args.objectCleanup = true;
    else if (item === "--no-object-cleanup") args.objectCleanup = false;
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

async function postLifecycleUserExportsCleanup(args) {
  const body = {
    dryRun: args.dryRun,
    limit: args.limit,
    objectCleanup: args.objectCleanup,
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
  const response = await fetch(`${args.baseUrl}/api/v1/jobs/lifecycle-user-exports-cleanup`, {
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

async function collectLifecycleUserExportsCleanup(args) {
  return postLifecycleUserExportsCleanup(args);
}

function formatExport(item) {
  if (!item) return "-";
  const delivery = item.delivery || {};
  return `${item.exportId || "-"} / ${item.filename || "-"} / 过期 ${item.expiresAt || "-"} / ${item.cleanupAction || "-"} / ${delivery.objectKey || "no-object"}`;
}

function buildLifecycleUserExportsCleanupReport(bundle) {
  const data = bundle.data || {};
  const lines = [
    "# ROOT 用户生命周期导出过期清理报告",
    "",
    `请求结果：${bundle.ok ? "OK" : "FAILED"}`,
    `消息：${bundle.message || "ok"}`,
    `模式：${data.dryRun ? "DRY_RUN" : "EXECUTE"}`,
    `request_id：${bundle.request && bundle.request.requestId ? bundle.request.requestId : "-"}`,
    "",
    "## 清理摘要",
    `- 候选：${data.selectedCount || 0} / 过期总数：${data.eligibleCount || 0}`,
    `- 未选入：${data.pendingCount || 0}`,
    `- 移除记录：${data.removedCount || 0}`,
    `- 删除对象：${data.objectDeletedCount || 0}`,
    `- 跳过对象：${data.objectSkippedCount || 0}`,
    `- 对象失败：${data.objectFailedCount || 0}`,
    "",
    "## 候选导出",
    ...((data.candidates || []).length ? data.candidates.map((item) => `- ${formatExport(item)}：${item.cleanupReason || ""}`) : ["- 暂无候选"]),
    "",
    "## 执行结果",
    ...((data.results || []).length
      ? data.results.map((item) => `- ${item.ok ? "OK" : "FAILED"} ${item.exportId || "-"} / ${item.cleanupStatus || "-"} / ${item.cleanupAction || "-"}${item.error_message ? `：${item.error_message}` : ""}`)
      : ["- 暂无执行结果"]),
  ];
  return `${lines.join("\n")}\n`;
}

function determineExitCode(bundle) {
  if (!bundle.ok) return 2;
  const data = bundle.data || {};
  if (data.objectFailedCount) return 3;
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const bundle = await collectLifecycleUserExportsCleanup(args);
    if (args.json) {
      process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
    } else {
      process.stdout.write(buildLifecycleUserExportsCleanupReport(bundle));
    }
    process.exitCode = determineExitCode(bundle);
  } catch (error) {
    process.stderr.write(`用户生命周期导出过期清理失败：${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildLifecycleUserExportsCleanupReport,
  collectLifecycleUserExportsCleanup,
  defaultRequestId,
  determineExitCode,
  parseArgs,
};
