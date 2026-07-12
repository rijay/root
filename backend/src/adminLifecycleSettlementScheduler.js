const { nowISO } = require("./dates");
const adminLifecycleSettlementJobs = require("./adminLifecycleSettlementJobs");

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_JOB_LIMIT = 3;
const MAX_BATCH_SIZE = 100;
const MAX_JOB_LIMIT = 10;
const RUNNABLE_STATUSES = ["QUEUED", "RUNNING"];

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

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeStatusList(value) {
  if (!value) return RUNNABLE_STATUSES;
  const list = String(value)
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  return list.length ? list : RUNNABLE_STATUSES;
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeOptions(options = {}) {
  const dryRun = !(options.execute === true || options.dryRun === false || options.dry_run === false);
  return {
    dryRun,
    batchSize: clampNumber(options.batchSize || options.batch_size || options.limit, DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE),
    jobLimit: clampNumber(options.jobLimit || options.job_limit || options.maxJobs || options.max_jobs, DEFAULT_JOB_LIMIT, 1, MAX_JOB_LIMIT),
    campaignId: normalizeText(options.campaignId || options.campaign_id),
    statuses: normalizeStatusList(options.status || options.statuses),
    requestId: normalizeText(options.requestId || options.request_id),
    operatorId: normalizeText(options.operatorId || options.operator_id),
    reason: normalizeText(options.reason) || "生命周期结算队列自动调度",
    now: normalizeText(options.now) || nowISO(),
  };
}

function pendingCount(job) {
  return adminLifecycleSettlementJobs.toJobPayload(job).summary.pending;
}

function runnableJobs(data, options) {
  const statusSet = new Set(options.statuses);
  return ensureList(data, "adminLifecycleSettlementJobs")
    .filter((job) => statusSet.has(job.status))
    .filter((job) => !options.campaignId || job.campaign_id === options.campaignId)
    .filter((job) => pendingCount(job) > 0)
    .slice()
    .sort((left, right) => {
      const updatedDiff = timestamp(left.updated_at || left.created_at) - timestamp(right.updated_at || right.created_at);
      if (updatedDiff) return updatedDiff;
      return String(left.job_id || "").localeCompare(String(right.job_id || ""));
    });
}

function toCandidate(job, options) {
  const payload = adminLifecycleSettlementJobs.toJobPayload(job);
  return {
    ...payload,
    schedulerBatchSize: clampNumber(options.batchSize || payload.batchSize, payload.batchSize || DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE),
  };
}

function planLifecycleSettlementJobRuns(data, options = {}) {
  const normalized = normalizeOptions(options);
  const eligible = runnableJobs(data, normalized);
  const selected = eligible.slice(0, normalized.jobLimit);
  return {
    now: normalized.now,
    dryRun: normalized.dryRun,
    batchSize: normalized.batchSize,
    jobLimit: normalized.jobLimit,
    filters: {
      campaignId: normalized.campaignId,
      statuses: normalized.statuses,
    },
    eligibleCount: eligible.length,
    selectedCount: selected.length,
    pendingCount: Math.max(0, eligible.length - selected.length),
    candidates: selected.map((job) => toCandidate(job, normalized)),
  };
}

function requireExecuteRequestId(options) {
  if (!options.requestId) throw businessError(8020, "生命周期结算队列自动调度 request_id 必填");
}

async function runDueLifecycleSettlementJobs(data, body = {}, context = {}) {
  const normalized = normalizeOptions(body);
  const plan = planLifecycleSettlementJobRuns(data, normalized);
  if (plan.dryRun) {
    return {
      ...plan,
      executedCount: 0,
      successCount: 0,
      failedCount: 0,
      results: [],
    };
  }
  requireExecuteRequestId(normalized);

  const results = [];
  for (const candidate of plan.candidates) {
    const jobRequestId = `${normalized.requestId}:${candidate.jobId}`;
    try {
      const result = adminLifecycleSettlementJobs.runLifecycleSettlementJob(data, {
        jobId: candidate.jobId,
        batchSize: candidate.schedulerBatchSize,
        requestId: jobRequestId,
        operatorId: normalized.operatorId,
        reason: normalized.reason,
      }, { ...context, requestId: jobRequestId });
      results.push({
        ok: result.job.status !== "FAILED",
        job: result.job,
        run: result.run,
        auditId: result.audit ? result.audit.audit_log_id : "",
      });
    } catch (error) {
      results.push({
        ok: false,
        job: candidate,
        run: null,
        error_code: String(error.code || 500),
        error_message: error.message || "生命周期结算队列自动调度失败",
      });
    }
  }

  return {
    ...plan,
    executedCount: results.length,
    successCount: results.filter((item) => item.ok).length,
    failedCount: results.filter((item) => !item.ok).length,
    results,
  };
}

module.exports = {
  planLifecycleSettlementJobRuns,
  runDueLifecycleSettlementJobs,
};
