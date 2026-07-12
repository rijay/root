const { nowISO } = require("./dates");
const adminLifecycleSettlementJobs = require("./adminLifecycleSettlementJobs");
const auditLog = require("./auditLog");

const DEFAULT_STALE_MINUTES = 120;
const DEFAULT_CANCEL_AFTER_MINUTES = 1440;
const DEFAULT_JOB_LIMIT = 20;
const MAX_JOB_LIMIT = 100;
const CLEANUP_STATUSES = ["QUEUED", "RUNNING"];

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

function normalizeStatusList(value) {
  if (!value) return CLEANUP_STATUSES;
  const list = String(value)
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean)
    .filter((item) => CLEANUP_STATUSES.includes(item));
  return list.length ? list : CLEANUP_STATUSES;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function normalizeBooleanOption(options, camelKey, snakeKey, fallback = "") {
  const raw = hasOwn(options, camelKey)
    ? options[camelKey]
    : hasOwn(options, snakeKey)
      ? options[snakeKey]
      : fallback;
  return raw === true || String(raw || "").toLowerCase() === "true";
}

function normalizeOptions(options = {}) {
  const dryRun = !(options.execute === true || options.dryRun === false || options.dry_run === false);
  const staleMinutes = clampNumber(
    options.staleMinutes || options.stale_minutes || process.env.ROOT_LIFECYCLE_SETTLEMENT_STALE_MINUTES,
    DEFAULT_STALE_MINUTES,
    5,
    10080,
  );
  const cancelAfterMinutes = clampNumber(
    options.cancelAfterMinutes || options.cancel_after_minutes || process.env.ROOT_LIFECYCLE_SETTLEMENT_CANCEL_AFTER_MINUTES,
    DEFAULT_CANCEL_AFTER_MINUTES,
    staleMinutes,
    43200,
  );
  return {
    dryRun,
    staleMinutes,
    cancelAfterMinutes,
    allowCancel: normalizeBooleanOption(options, "allowCancel", "allow_cancel", process.env.ROOT_LIFECYCLE_SETTLEMENT_ALLOW_CANCEL),
    jobLimit: clampNumber(options.jobLimit || options.job_limit || options.maxJobs || options.max_jobs, DEFAULT_JOB_LIMIT, 1, MAX_JOB_LIMIT),
    campaignId: text(options.campaignId || options.campaign_id),
    statuses: normalizeStatusList(options.status || options.statuses),
    requestId: text(options.requestId || options.request_id),
    operatorId: text(options.operatorId || options.operator_id),
    reason: text(options.reason, "生命周期结算队列超时清理"),
    now: text(options.now) || nowISO(),
  };
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function minutesSince(value, nowText) {
  const base = timestamp(value);
  const now = timestamp(nowText);
  if (!base || !now) return 0;
  return Math.max(0, Math.floor((now - base) / 60000));
}

function lastActivityAt(job) {
  return job.updated_at || job.started_at || job.created_at || "";
}

function cleanupAction(job, ageMinutes, options) {
  if (options.allowCancel && ageMinutes >= options.cancelAfterMinutes) return "CANCEL";
  if (job.status === "RUNNING") return "RESET_TO_QUEUED";
  return "ANNOTATE";
}

function cleanupReason(action, ageMinutes, options) {
  if (action === "CANCEL") return `超过 ${options.cancelAfterMinutes} 分钟未推进，自动取消以释放队列`;
  if (action === "RESET_TO_QUEUED") return `超过 ${options.staleMinutes} 分钟未推进，重置为 QUEUED 交给调度器继续推进`;
  return `超过 ${options.staleMinutes} 分钟未推进，仅记录清理检查，避免误取消运营暂停队列`;
}

function toCleanupCandidate(job, options) {
  const payload = adminLifecycleSettlementJobs.toJobPayload(job);
  const activityAt = lastActivityAt(job);
  const ageMinutes = minutesSince(activityAt, options.now);
  const action = cleanupAction(job, ageMinutes, options);
  return {
    jobId: payload.jobId,
    status: payload.status,
    campaignId: payload.campaignId,
    summary: payload.summary,
    updatedAt: payload.updatedAt,
    startedAt: payload.startedAt,
    lastActivityAt: activityAt,
    ageMinutes,
    cleanupAction: action,
    cleanupReason: cleanupReason(action, ageMinutes, options),
    nextStatus: action === "CANCEL" ? "CANCELLED" : action === "RESET_TO_QUEUED" ? "QUEUED" : payload.status,
  };
}

function cleanupCandidates(data, options) {
  const statusSet = new Set(options.statuses);
  return ensureList(data, "adminLifecycleSettlementJobs")
    .filter((job) => statusSet.has(job.status))
    .filter((job) => !options.campaignId || job.campaign_id === options.campaignId)
    .filter((job) => adminLifecycleSettlementJobs.toJobPayload(job).summary.pending > 0)
    .map((job) => ({ job, candidate: toCleanupCandidate(job, options) }))
    .filter((entry) => entry.candidate.ageMinutes >= options.staleMinutes)
    .sort((left, right) => right.candidate.ageMinutes - left.candidate.ageMinutes || String(left.job.job_id || "").localeCompare(String(right.job.job_id || "")));
}

function planLifecycleSettlementJobCleanup(data, options = {}) {
  const normalized = normalizeOptions(options);
  const eligible = cleanupCandidates(data, normalized);
  const selected = eligible.slice(0, normalized.jobLimit);
  return {
    now: normalized.now,
    dryRun: normalized.dryRun,
    staleMinutes: normalized.staleMinutes,
    cancelAfterMinutes: normalized.cancelAfterMinutes,
    allowCancel: normalized.allowCancel,
    jobLimit: normalized.jobLimit,
    filters: {
      campaignId: normalized.campaignId,
      statuses: normalized.statuses,
    },
    eligibleCount: eligible.length,
    selectedCount: selected.length,
    pendingCount: Math.max(0, eligible.length - selected.length),
    candidates: selected.map((entry) => entry.candidate),
  };
}

function requireExecuteRequestId(options) {
  if (!options.requestId) throw businessError(8021, "生命周期结算队列超时清理 request_id 必填");
}

function appendCleanupAudit(data, job, before, after, body = {}) {
  return auditLog.appendAuditLog(data, {
    action: "ADMIN_LIFECYCLE_SETTLEMENT_JOB_TIMEOUT_CLEANUP",
    targetType: "ADMIN_LIFECYCLE_SETTLEMENT_JOB",
    targetId: job.job_id,
    operatorId: body.operatorId || body.operator_id || job.operator_id || "",
    reason: body.reason || "生命周期结算队列超时清理",
    before,
    after,
    metadata: {
      requestId: body.requestId || body.request_id || "",
      campaignId: job.campaign_id,
      status: job.status,
      cleanupAction: after && after.cleanup ? after.cleanup.action : "",
    },
  });
}

function applyCleanup(data, job, candidate, options) {
  const before = adminLifecycleSettlementJobs.toJobPayload(job);
  const now = options.now || nowISO();
  const cleanup = {
    requestId: options.requestId,
    action: candidate.cleanupAction,
    reason: candidate.cleanupReason,
    ageMinutes: candidate.ageMinutes,
    staleMinutes: options.staleMinutes,
    cancelAfterMinutes: options.cancelAfterMinutes,
    allowCancel: options.allowCancel,
    cleanedAt: now,
  };
  if (candidate.cleanupAction === "CANCEL") {
    job.status = "CANCELLED";
    job.cancelled_at = now;
    job.finished_at = now;
    job.error_message = cleanup.reason;
  } else if (candidate.cleanupAction === "RESET_TO_QUEUED") {
    job.status = "QUEUED";
    job.finished_at = "";
    job.error_message = cleanup.reason;
  } else {
    job.error_message = cleanup.reason;
  }
  job.cleanup_json = cleanup;
  job.updated_at = now;
  const after = {
    ...adminLifecycleSettlementJobs.toJobPayload(job),
    cleanup,
  };
  const audit = appendCleanupAudit(data, job, before, after, {
    requestId: options.requestId,
    operatorId: options.operatorId,
    reason: options.reason,
  });
  return {
    ok: true,
    action: candidate.cleanupAction,
    job: after,
    auditId: audit.audit_log_id || "",
  };
}

async function runLifecycleSettlementJobCleanup(data, body = {}) {
  const normalized = normalizeOptions(body);
  const plan = planLifecycleSettlementJobCleanup(data, normalized);
  if (plan.dryRun) {
    return {
      ...plan,
      executedCount: 0,
      resetCount: 0,
      cancelCount: 0,
      annotatedCount: 0,
      failedCount: 0,
      results: [],
    };
  }
  requireExecuteRequestId(normalized);
  const jobsById = new Map(ensureList(data, "adminLifecycleSettlementJobs").map((job) => [job.job_id, job]));
  const results = [];
  for (const candidate of plan.candidates) {
    const job = jobsById.get(candidate.jobId);
    if (!job) {
      results.push({ ok: false, action: candidate.cleanupAction, job: candidate, error_message: "队列不存在" });
      continue;
    }
    try {
      results.push(applyCleanup(data, job, candidate, normalized));
    } catch (error) {
      results.push({
        ok: false,
        action: candidate.cleanupAction,
        job: candidate,
        error_code: String(error.code || 500),
        error_message: error.message || "生命周期结算队列超时清理失败",
      });
    }
  }
  return {
    ...plan,
    executedCount: results.length,
    resetCount: results.filter((item) => item.ok && item.action === "RESET_TO_QUEUED").length,
    cancelCount: results.filter((item) => item.ok && item.action === "CANCEL").length,
    annotatedCount: results.filter((item) => item.ok && item.action === "ANNOTATE").length,
    failedCount: results.filter((item) => !item.ok).length,
    results,
  };
}

module.exports = {
  planLifecycleSettlementJobCleanup,
  runLifecycleSettlementJobCleanup,
};
