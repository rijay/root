const { nowISO } = require("./dates");
const externalPlatformAdapters = require("./externalPlatformAdapters");

const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_MAX_ATTEMPTS = 5;
const MAX_BATCH_SIZE = 20;

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeOptions(options = {}) {
  const dryRun = !(options.execute === true || options.dryRun === false || options.dry_run === false);
  const batchSize = clampNumber(options.batchSize || options.batch_size || options.limit, DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const maxAttempts = clampNumber(options.maxAttempts || options.max_attempts, DEFAULT_MAX_ATTEMPTS, 1, 20);
  const sourceType = normalizeString(options.sourceType || options.source_type);
  const adapterKind = normalizeString(options.adapterKind || options.adapter_kind);
  const now = normalizeString(options.now) || nowISO();
  return { dryRun, batchSize, maxAttempts, sourceType, adapterKind, now };
}

function sameAdapter(left, right) {
  return left
    && right
    && left.source_type === right.source_type
    && left.adapter_kind === right.adapter_kind;
}

function newerSuccessfulRunExists(runs, run) {
  const runStartedAt = timestamp(run.started_at);
  return runs.some((item) => {
    if (!sameAdapter(item, run)) return false;
    if (item.run_id === run.run_id) return false;
    if (!["COMPLETED", "COMPLETED_WITH_ERRORS"].includes(item.status)) return false;
    return timestamp(item.started_at) > runStartedAt;
  });
}

function summarizeRun(run) {
  return {
    run_id: run.run_id,
    source_type: run.source_type,
    adapter_kind: run.adapter_kind,
    mode: run.mode,
    status: run.status,
    retry_status: run.retry_status || "NOT_REQUIRED",
    retry_attempt: Number(run.retry_attempt || 0),
    retry_source_run_id: run.retry_source_run_id || "",
    retry_reason: run.retry_reason || "",
    next_retry_at: run.next_retry_at || "",
    requested_limit: run.requested_limit || 0,
    cursor_before: run.cursor_before || "",
    cursor_after: run.cursor_after || "",
    started_at: run.started_at || "",
    finished_at: run.finished_at || "",
    error_message: run.error_message || "",
  };
}

function skip(reason, run) {
  return { reason, run: summarizeRun(run) };
}

function planDueAdapterRetries(data, options = {}) {
  const normalized = normalizeOptions(options);
  const runs = externalPlatformAdapters.listAdapterRuns(data, 100);
  const retryChildSourceIds = new Set(runs.map((run) => run.retry_source_run_id).filter(Boolean));
  const nowAt = timestamp(normalized.now);
  const due = [];
  const pending = [];
  const skipped = [];

  runs
    .filter((run) => run.status === "FAILED" && run.retry_status === "RETRYABLE")
    .forEach((run) => {
      if (normalized.sourceType && run.source_type !== normalized.sourceType) return;
      if (normalized.adapterKind && run.adapter_kind !== normalized.adapterKind) return;
      if (retryChildSourceIds.has(run.run_id)) {
        skipped.push(skip("CHILD_RETRY_EXISTS", run));
        return;
      }
      if (Number(run.retry_attempt || 0) >= normalized.maxAttempts) {
        skipped.push(skip("MAX_ATTEMPTS_REACHED", run));
        return;
      }
      if (newerSuccessfulRunExists(runs, run)) {
        skipped.push(skip("NEWER_SUCCESS_EXISTS", run));
        return;
      }
      if (!run.next_retry_at || timestamp(run.next_retry_at) > nowAt) {
        pending.push(summarizeRun(run));
        return;
      }
      due.push(run);
    });

  due.sort((left, right) => {
    const retryDiff = timestamp(left.next_retry_at) - timestamp(right.next_retry_at);
    if (retryDiff) return retryDiff;
    return timestamp(left.started_at) - timestamp(right.started_at);
  });

  const selected = due.slice(0, normalized.batchSize);
  return {
    now: normalized.now,
    dryRun: normalized.dryRun,
    batchSize: normalized.batchSize,
    maxAttempts: normalized.maxAttempts,
    filters: {
      sourceType: normalized.sourceType,
      adapterKind: normalized.adapterKind,
    },
    eligibleCount: due.length,
    selectedCount: selected.length,
    pendingCount: pending.length,
    skippedCount: skipped.length,
    candidates: selected.map(summarizeRun),
    pending,
    skipped,
  };
}

function retryPayloadFromRun(run) {
  return {
    sourceType: run.source_type,
    adapterKind: run.adapter_kind,
    mode: run.mode || "PREVIEW",
    limit: run.requested_limit || 50,
    cursor: run.cursor_before || "",
    retrySourceRunId: run.run_id,
  };
}

async function runDueAdapterRetries(data, body = {}, context = {}) {
  const plan = planDueAdapterRetries(data, body);
  if (plan.dryRun) {
    return {
      ...plan,
      executedCount: 0,
      successCount: 0,
      failedCount: 0,
      results: [],
    };
  }

  const results = [];
  for (const candidate of plan.candidates) {
    try {
      const result = await externalPlatformAdapters.runAdapter(data, retryPayloadFromRun(candidate), {
        env: context.env || process.env,
        dateText: context.dateText,
        adapterImplementations: context.adapterImplementations || {},
        fetchImpl: context.fetchImpl,
      });
      results.push({
        ok: true,
        sourceRun: candidate,
        run: summarizeRun(result.run),
        reviewId: result.review ? result.review.review_id : "",
        cursor: result.cursor || null,
      });
    } catch (error) {
      results.push({
        ok: false,
        sourceRun: candidate,
        run: error.run ? summarizeRun(error.run) : null,
        error_code: String(error.code || 500),
        error_message: error.message || "Adapter 自动重试失败",
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
  planDueAdapterRetries,
  runDueAdapterRetries,
};
