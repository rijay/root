const { nowISO } = require("./dates");
const { createId } = require("./seed");
const adminLifecyclePresenter = require("./adminLifecyclePresenter");
const adminSettlementBatch = require("./adminSettlementBatch");
const auditLog = require("./auditLog");

const DEFAULT_BATCH_SIZE = 20;
const MAX_BATCH_SIZE = 100;
const TERMINAL_STATUSES = new Set(["COMPLETED", "COMPLETED_WITH_ERRORS", "CANCELLED", "FAILED"]);

function businessError(code, message, status = 200) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function unique(values = []) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function lifecycleBatchQuery(body = {}) {
  const filters = body.filters && typeof body.filters === "object" && !Array.isArray(body.filters)
    ? body.filters
    : body;
  return {
    ...filters,
    selectionLimit: body.selectionLimit || body.selection_limit || body.batchLimit || body.batch_limit ||
      filters.selectionLimit || filters.selection_limit || filters.batchLimit || filters.batch_limit,
  };
}

function lifecycleBatchCampaignId(selection, body = {}, query = {}) {
  return body.campaignId || body.campaign_id || query.campaignId || query.campaign_id ||
    selection.users[0]?.campaignId || "";
}

function summarizeItems(job) {
  const items = Array.isArray(job.items_json) ? job.items_json : [];
  return {
    total: job.total_count || unique(job.root_user_ids || []).length,
    selected: unique(job.root_user_ids || []).length,
    processed: unique(job.processed_root_user_ids || []).length,
    pending: Math.max(0, unique(job.root_user_ids || []).length - unique(job.processed_root_user_ids || []).length),
    executed: items.filter((item) => item.executed).length,
    skipped: items.filter((item) => !item.executed && item.status !== "ERROR").length,
    failed: unique(job.failed_root_user_ids || []).length,
    rewardCount: items.reduce((sum, item) => sum + Number(item.rewardCount || 0), 0),
    runCount: Number(job.run_count || 0),
  };
}

function toJobPayload(job) {
  if (!job) return null;
  return {
    jobId: job.job_id,
    status: job.status,
    source: job.source,
    campaignId: job.campaign_id,
    requestId: job.request_id || "",
    operatorId: job.operator_id || "",
    reason: job.reason || "",
    batchSize: job.batch_size,
    filters: job.filters_json || {},
    selection: job.selection_json || {},
    summary: summarizeItems(job),
    rootUserIds: unique(job.root_user_ids || []),
    processedRootUserIds: unique(job.processed_root_user_ids || []),
    failedRootUserIds: unique(job.failed_root_user_ids || []),
    items: Array.isArray(job.items_json) ? job.items_json : [],
    lastRun: job.last_run_json || null,
    cleanup: job.cleanup_json || null,
    errorMessage: job.error_message || "",
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    startedAt: job.started_at || "",
    finishedAt: job.finished_at || "",
    cancelledAt: job.cancelled_at || "",
  };
}

function listLifecycleSettlementJobs(data, query = {}) {
  const status = text(query.status).toUpperCase();
  const campaignId = text(query.campaignId || query.campaign_id);
  const limit = clampNumber(query.limit, 20, 1, 100);
  return ensureList(data, "adminLifecycleSettlementJobs")
    .filter((job) => !status || job.status === status)
    .filter((job) => !campaignId || job.campaign_id === campaignId)
    .slice()
    .sort((left, right) => String(right.updated_at || right.created_at || "").localeCompare(String(left.updated_at || left.created_at || "")))
    .slice(0, limit)
    .map(toJobPayload);
}

function findJob(data, jobId) {
  return ensureList(data, "adminLifecycleSettlementJobs").find((job) => job.job_id === jobId) || null;
}

function requireJob(data, jobId) {
  const job = findJob(data, jobId);
  if (!job) throw businessError(404, "生命周期结算队列不存在", 404);
  return job;
}

function requireRequestId(body = {}) {
  const requestId = text(body.requestId || body.request_id);
  if (!requestId) throw businessError(8011, "队列动作必须提供 request_id");
  return requestId;
}

function requireConfirmed(body = {}) {
  if (!body.confirmRisk && !body.confirmExecute && !body.confirm_batch_settlement) {
    throw businessError(8012, "创建结算队列需要二次确认");
  }
}

function appendJobAudit(data, action, job, body = {}, before = null, after = null) {
  return auditLog.appendAuditLog(data, {
    action,
    targetType: "ADMIN_LIFECYCLE_SETTLEMENT_JOB",
    targetId: job.job_id,
    operatorId: body.operatorId || body.operator_id || job.operator_id || "",
    reason: body.reason || job.reason || action,
    before,
    after,
    metadata: {
      requestId: body.requestId || body.request_id || "",
      campaignId: job.campaign_id,
      status: job.status,
    },
  });
}

function createLifecycleSettlementJob(data, body = {}, context = {}) {
  const requestId = requireRequestId(body);
  requireConfirmed(body);
  const query = lifecycleBatchQuery(body);
  const selection = adminLifecyclePresenter.buildLifecycleBatchSelection(data, query, context);
  if (!selection.rootUserIds.length) throw businessError(8010, "筛选结果没有可处理用户");
  const campaignId = lifecycleBatchCampaignId(selection, body, query);
  const now = nowISO();
  const job = {
    job_id: createId("lsj"),
    source: "LIFECYCLE_FILTER",
    status: "QUEUED",
    campaign_id: campaignId,
    request_id: requestId,
    operator_id: body.operatorId || body.operator_id || "",
    reason: body.reason || "用户生命周期筛选批量结算队列",
    batch_size: clampNumber(body.batchSize || body.batch_size, DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE),
    filters_json: selection.filters,
    selection_json: {
      total: selection.total,
      selectedCount: selection.selectedCount,
      selectionLimit: selection.selectionLimit,
      truncated: selection.truncated,
      users: selection.users,
    },
    root_user_ids: selection.rootUserIds,
    processed_root_user_ids: [],
    failed_root_user_ids: [],
    items_json: [],
    last_run_json: null,
    total_count: selection.rootUserIds.length,
    run_count: 0,
    error_message: "",
    created_at: now,
    updated_at: now,
    started_at: "",
    finished_at: "",
    cancelled_at: "",
  };
  ensureList(data, "adminLifecycleSettlementJobs").unshift(job);
  const audit = appendJobAudit(data, "ADMIN_LIFECYCLE_SETTLEMENT_JOB_CREATE", job, body, null, toJobPayload(job));
  return { job: toJobPayload(job), audit };
}

function pendingRootUserIds(job) {
  const processed = new Set(unique(job.processed_root_user_ids || []));
  return unique(job.root_user_ids || []).filter((rootUserId) => !processed.has(rootUserId));
}

function jobStatusAfterRun(job) {
  const summary = summarizeItems(job);
  if (summary.pending > 0) return "RUNNING";
  return summary.failed > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED";
}

function runLifecycleSettlementJob(data, body = {}, context = {}) {
  const requestId = requireRequestId(body);
  const job = requireJob(data, text(body.jobId || body.job_id));
  if (job.status === "CANCELLED") throw businessError(8013, "队列已取消，不能继续执行");
  if (job.status === "FAILED") throw businessError(8014, "队列失败，请先重试失败项或重新创建队列");
  if (TERMINAL_STATUSES.has(job.status)) {
    return { job: toJobPayload(job), run: job.last_run_json || null, audit: null };
  }
  const before = toJobPayload(job);
  const batchSize = clampNumber(body.batchSize || body.batch_size || job.batch_size, job.batch_size || DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const selectedRootUserIds = pendingRootUserIds(job).slice(0, batchSize);
  if (!selectedRootUserIds.length) {
    job.status = jobStatusAfterRun(job);
    job.finished_at = job.finished_at || nowISO();
    job.updated_at = nowISO();
    const audit = appendJobAudit(data, "ADMIN_LIFECYCLE_SETTLEMENT_JOB_RUN", job, body, before, toJobPayload(job));
    return { job: toJobPayload(job), run: job.last_run_json || null, audit };
  }

  const now = nowISO();
  const runIndex = Number(job.run_count || 0) + 1;
  const chunkRequestId = `${job.job_id}:${runIndex}:${requestId}`;
  job.status = "RUNNING";
  job.started_at = job.started_at || now;
  job.updated_at = now;
  job.run_count = runIndex;

  try {
    const result = adminSettlementBatch.executeBatchSettlement(data, {
      rootUserIds: selectedRootUserIds,
      campaignId: job.campaign_id,
      confirmRisk: true,
      requestId: chunkRequestId,
      operatorId: body.operatorId || body.operator_id || job.operator_id,
      reason: body.reason || job.reason || "生命周期结算队列执行",
    }, { ...context, requestId: chunkRequestId });
    const attemptedAt = nowISO();
    const itemSummaries = result.items.map((item) => ({
      rootUserId: item.rootUserId,
      status: item.status,
      executed: Boolean(item.executed),
      missingCount: item.missingCount || 0,
      rewardCount: item.rewardCount || 0,
      message: item.message || "",
      requestId: chunkRequestId,
      runIndex,
      attemptedAt,
    }));
    job.items_json = [...(Array.isArray(job.items_json) ? job.items_json : []), ...itemSummaries];
    job.processed_root_user_ids = unique([...(job.processed_root_user_ids || []), ...selectedRootUserIds]);
    job.failed_root_user_ids = unique([
      ...(job.failed_root_user_ids || []),
      ...itemSummaries.filter((item) => item.status === "ERROR").map((item) => item.rootUserId),
    ]);
    job.status = jobStatusAfterRun(job);
    job.finished_at = TERMINAL_STATUSES.has(job.status) ? attemptedAt : "";
    job.error_message = "";
    job.last_run_json = {
      requestId,
      chunkRequestId,
      runIndex,
      selectedCount: selectedRootUserIds.length,
      summary: result.summary,
      auditId: result.audit ? result.audit.audit_log_id : "",
      ranAt: attemptedAt,
    };
  } catch (error) {
    job.status = "FAILED";
    job.error_message = error.message || "生命周期结算队列执行失败";
    job.processed_root_user_ids = unique([...(job.processed_root_user_ids || []), ...selectedRootUserIds]);
    job.failed_root_user_ids = unique([...(job.failed_root_user_ids || []), ...selectedRootUserIds]);
    job.last_run_json = {
      requestId,
      chunkRequestId,
      runIndex,
      selectedCount: selectedRootUserIds.length,
      errorMessage: job.error_message,
      ranAt: nowISO(),
    };
    job.finished_at = nowISO();
  }
  job.updated_at = nowISO();
  const audit = appendJobAudit(data, "ADMIN_LIFECYCLE_SETTLEMENT_JOB_RUN", job, body, before, toJobPayload(job));
  return { job: toJobPayload(job), run: job.last_run_json, audit };
}

function cancelLifecycleSettlementJob(data, body = {}) {
  requireRequestId(body);
  const job = requireJob(data, text(body.jobId || body.job_id));
  const before = toJobPayload(job);
  if (!TERMINAL_STATUSES.has(job.status)) {
    job.status = "CANCELLED";
    job.cancelled_at = nowISO();
    job.finished_at = job.cancelled_at;
    job.updated_at = job.cancelled_at;
  }
  const audit = appendJobAudit(data, "ADMIN_LIFECYCLE_SETTLEMENT_JOB_CANCEL", job, body, before, toJobPayload(job));
  return { job: toJobPayload(job), audit };
}

function retryFailedLifecycleSettlementJob(data, body = {}) {
  requireRequestId(body);
  const job = requireJob(data, text(body.jobId || body.job_id));
  const failedIds = unique(job.failed_root_user_ids || []);
  const before = toJobPayload(job);
  if (failedIds.length) {
    const failed = new Set(failedIds);
    job.processed_root_user_ids = unique(job.processed_root_user_ids || []).filter((rootUserId) => !failed.has(rootUserId));
    job.failed_root_user_ids = [];
    job.status = "QUEUED";
    job.finished_at = "";
    job.cancelled_at = "";
    job.error_message = "";
    job.updated_at = nowISO();
  }
  const audit = appendJobAudit(data, "ADMIN_LIFECYCLE_SETTLEMENT_JOB_RETRY_FAILED", job, body, before, toJobPayload(job));
  return { job: toJobPayload(job), audit };
}

module.exports = {
  cancelLifecycleSettlementJob,
  createLifecycleSettlementJob,
  listLifecycleSettlementJobs,
  retryFailedLifecycleSettlementJob,
  runLifecycleSettlementJob,
  toJobPayload,
};
