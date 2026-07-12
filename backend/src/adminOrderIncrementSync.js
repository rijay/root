const auditLog = require("./auditLog");
const externalPlatformAdapters = require("./externalPlatformAdapters");

function businessError(code, message, status = 200) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function bool(value) {
  if (value === true) return true;
  const textValue = String(value || "").trim().toLowerCase();
  return ["true", "1", "yes", "y", "confirmed"].includes(textValue);
}

function hasManualInput(body = {}) {
  if (Array.isArray(body.samples) && body.samples.length) return true;
  if (body.samples && typeof body.samples === "object") return true;
  return String(body.text || "").trim() !== "";
}

function adapterKindForBody(body = {}) {
  if (body.adapterKind || body.adapter_kind) return String(body.adapterKind || body.adapter_kind).trim().toUpperCase();
  return hasManualInput(body) ? "MANUAL_SAMPLE" : "YOUZAN_OPEN";
}

function toRunSummary(result = {}) {
  const run = result.run || {};
  const syncResult = result.result || {};
  return {
    sourceType: result.sourceType || "YOUZAN_ORDER",
    adapterKind: result.adapterKind || run.adapter_kind || "",
    mode: result.mode || run.mode || "",
    status: run.status || "",
    total: syncResult.total || run.total || 0,
    importableCount: syncResult.importableCount || run.importable_count || 0,
    importedCount: syncResult.importedCount || run.imported_count || 0,
    errorCount: syncResult.errorCount || run.error_count || 0,
    warningCount: syncResult.warningCount || run.warning_count || 0,
    externalCount: run.external_count || 0,
    cursorBefore: run.cursor_before || "",
    cursorAfter: run.cursor_after || "",
    hasMore: Boolean(run.has_more),
    reviewId: run.review_id || (result.review && result.review.review_id) || "",
  };
}

async function runOrderAdapter(data, body = {}, context = {}, mode = "PREVIEW") {
  return externalPlatformAdapters.runAdapter(data, {
    ...body,
    sourceType: "YOUZAN_ORDER",
    adapterKind: adapterKindForBody(body),
    mode,
    commitCursor: mode === "IMPORT" ? true : Boolean(body.commitCursor || body.commit_cursor),
  }, {
    env: context.env || process.env,
    dateText: context.dateText,
    adapterImplementations: context.adapterImplementations || {},
    fetchImpl: context.fetchImpl,
  });
}

async function previewOrderIncrement(data, body = {}, context = {}) {
  const result = await runOrderAdapter(data, body, context, "PREVIEW");
  return {
    summary: toRunSummary(result),
    rows: result.result && Array.isArray(result.result.rows) ? result.result.rows : [],
    result: result.result,
    review: result.review,
    run: result.run,
  };
}

async function executeOrderIncrement(data, body = {}, context = {}) {
  const requestId = text(body.requestId || body.request_id);
  if (!requestId) throw businessError(8301, "有赞订单增量同步必须提供 request_id");
  if (!bool(body.confirmRisk || body.confirm_risk || body.confirmed)) {
    throw businessError(8302, "有赞订单增量同步需要二次确认");
  }

  const result = await runOrderAdapter(data, {
    ...body,
    requestId,
  }, context, "IMPORT");
  const summary = toRunSummary(result);
  const audit = auditLog.appendAuditLog(data, {
    action: "YOUZAN_ORDER_INCREMENT_SYNC",
    targetType: "YOUZAN_ORDER_INCREMENT_SYNC",
    targetId: requestId,
    operatorId: body.operatorId || body.operator_id || "",
    reason: body.reason || body.note || "有赞订单增量同步",
    before: null,
    after: {
      summary,
      runId: result.run && result.run.run_id,
      cursor: result.cursor || null,
    },
    metadata: {
      requestId,
      adapterKind: summary.adapterKind,
      cursorBefore: summary.cursorBefore,
      cursorAfter: summary.cursorAfter,
      importedCount: summary.importedCount,
      errorCount: summary.errorCount,
    },
  });

  return {
    requestId,
    summary,
    result: result.result,
    review: result.review,
    run: result.run,
    cursor: result.cursor,
    audit,
  };
}

module.exports = {
  adapterKindForBody,
  executeOrderIncrement,
  previewOrderIncrement,
};
