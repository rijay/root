const { nowISO, todayISO } = require("./dates");
const externalAdapterSamples = require("./externalAdapterSamples");
const { createId } = require("./seed");
const { createDefaultAdapterImplementations } = require("./externalAdapterImplementations");

const ADAPTER_KINDS = {
  MANUAL_SAMPLE: "MANUAL_SAMPLE",
  YOUZAN_OPEN: "YOUZAN_OPEN",
  YOUZAN_CUSTOMER: "YOUZAN_CUSTOMER",
  FULFILLMENT_PUSH: "FULFILLMENT_PUSH",
  WEWORK_CONTACT: "WEWORK_CONTACT",
};

const REAL_ADAPTER_CONFIGS = [
  {
    sourceType: "YOUZAN_ORDER",
    label: "有赞订单 Adapter",
    adapterKind: ADAPTER_KINDS.YOUZAN_OPEN,
    requiredEnv: ["YOUZAN_ACCESS_TOKEN", "YOUZAN_ORDER_LIST_URL"],
    cursorLabel: "订单增量游标",
    nextAction: "配置有赞凭证后启用订单拉取 Implementation。",
  },
  {
    sourceType: "YOUZAN_CUSTOMER",
    label: "有赞客户 Adapter",
    adapterKind: ADAPTER_KINDS.YOUZAN_CUSTOMER,
    requiredEnv: ["YOUZAN_CUSTOMER_LIST_URL"],
    cursorLabel: "客户增量游标",
    nextAction: "配置有赞客户列表 URL 和 token 后启用客户镜像拉取 Implementation。",
  },
  {
    sourceType: "FULFILLMENT",
    label: "物流状态 Adapter",
    adapterKind: ADAPTER_KINDS.FULFILLMENT_PUSH,
    requiredEnv: ["ROOT_FULFILLMENT_SECRET"],
    cursorLabel: "物流增量游标",
    nextAction: "确认物流来源后启用签收和异常件拉取或推送 Implementation。",
  },
  {
    sourceType: "WECHAT_LEAD",
    label: "企业微信线索 Adapter",
    adapterKind: ADAPTER_KINDS.WEWORK_CONTACT,
    requiredEnv: ["WEWORK_CORP_ID", "WEWORK_CONTACT_SECRET"],
    cursorLabel: "企微增量游标",
    nextAction: "配置企业微信通讯录或客户联系凭证后启用线索拉取 Implementation。",
  },
];

function adapterError(code, message, detail) {
  const error = new Error(message);
  error.code = code;
  error.detail = detail || null;
  return error;
}

function normalizeMode(mode) {
  return String(mode || "PREVIEW").toUpperCase() === "IMPORT" ? "IMPORT" : "PREVIEW";
}

function normalizeAdapterKind(adapterKind) {
  return String(adapterKind || ADAPTER_KINDS.MANUAL_SAMPLE).toUpperCase();
}

function missingEnv(env, names) {
  return names.filter((name) => !env || !env[name]);
}

function adapterKey(sourceType, adapterKind) {
  return `${sourceType}:${adapterKind}`;
}

function isRealAdapter(adapterKind) {
  return adapterKind !== ADAPTER_KINDS.MANUAL_SAMPLE;
}

function ensureAdapterRuns(data) {
  if (!Array.isArray(data.externalAdapterRuns)) data.externalAdapterRuns = [];
  return data.externalAdapterRuns;
}

function ensureAdapterCursors(data) {
  if (!Array.isArray(data.externalAdapterCursors)) data.externalAdapterCursors = [];
  return data.externalAdapterCursors;
}

function listAdapterRuns(data, limit = 20) {
  return ensureAdapterRuns(data).slice(0, limit);
}

function listAdapterCursors(data) {
  return ensureAdapterCursors(data).slice();
}

function findAdapterRun(data, runId) {
  if (!runId) return null;
  return ensureAdapterRuns(data).find((item) => item.run_id === runId) || null;
}

function cursorFor(data, sourceType, adapterKind) {
  return ensureAdapterCursors(data).find((item) => item.adapter_key === adapterKey(sourceType, adapterKind)) || null;
}

function latestRunFor(data, sourceType, adapterKind) {
  return ensureAdapterRuns(data).find((item) => item.source_type === sourceType && item.adapter_kind === adapterKind) || null;
}

function manualAdapterStatus(sourceType, data) {
  const template = externalAdapterSamples.sampleTemplateFor(sourceType);
  const adapterKind = ADAPTER_KINDS.MANUAL_SAMPLE;
  return {
    sourceType,
    label: `${template.label}手工取样 Adapter`,
    adapterKind,
    status: "READY",
    requiredEnv: [],
    missingEnv: [],
    cursor: cursorFor(data || {}, sourceType, adapterKind),
    latestRun: latestRunFor(data || {}, sourceType, adapterKind),
    nextAction: "粘贴真实导出样本后即可预览或导入。",
  };
}

function realAdapterStatus(env, config, data, implementations = {}) {
  const missing = missingEnv(env, config.requiredEnv);
  const hasImplementation = typeof implementations[config.adapterKind] === "function";
  const status = missing.length ? "NEEDS_CONFIG" : hasImplementation ? "READY" : "CONFIG_READY";
  return {
    ...config,
    status,
    missingEnv: missing,
    cursor: cursorFor(data || {}, config.sourceType, config.adapterKind),
    latestRun: latestRunFor(data || {}, config.sourceType, config.adapterKind),
    nextAction: missing.length
      ? `补齐环境变量：${missing.join(", ")}`
      : hasImplementation
        ? "可运行真实平台拉取。"
        : config.nextAction,
  };
}

function buildAdapterCatalog(env = process.env, options = {}) {
  const data = options.data || {};
  const implementations = createDefaultAdapterImplementations(env, options);
  const manualAdapters = REAL_ADAPTER_CONFIGS.map((config) => manualAdapterStatus(config.sourceType, data));
  const realAdapters = REAL_ADAPTER_CONFIGS.map((config) => realAdapterStatus(env, config, data, implementations));
  return {
    manualAdapters,
    realAdapters,
    adapters: manualAdapters.concat(realAdapters),
  };
}

function sampleInputFromBody(body = {}) {
  if (body.samples !== undefined) return body.samples;
  if (body.text !== undefined) return body.text;
  return "";
}

function fetchSamplesWithManualAdapter(body = {}) {
  const input = sampleInputFromBody(body);
  const hasInput = Array.isArray(input) ? input.length > 0 : String(input || "").trim() !== "";
  if (!hasInput) throw adapterError(400, "MANUAL_SAMPLE Adapter 需要 text 或 samples");
  return {
    input,
    externalCount: Array.isArray(input) ? input.length : 0,
    cursorBefore: "",
    cursorAfter: "",
    hasMore: false,
  };
}

function configuredRealAdapter(env, adapterKind) {
  const catalog = buildAdapterCatalog(env);
  const adapter = catalog.realAdapters.find((item) => item.adapterKind === adapterKind);
  if (!adapter) throw adapterError(400, "未知外部平台 Adapter");
  if (adapter.status === "NEEDS_CONFIG") {
    throw adapterError(400, `${adapter.label} 未配置：${adapter.missingEnv.join(", ")}`, adapter);
  }
  return adapter;
}

function normalizeExternalFetchResult(value) {
  if (Array.isArray(value) || typeof value === "string") {
    return { input: value, externalCount: Array.isArray(value) ? value.length : 0, cursorAfter: "", hasMore: false };
  }
  const result = value || {};
  const input = result.samples !== undefined ? result.samples : result.text;
  return {
    input: input === undefined ? [] : input,
    externalCount: result.externalCount === undefined
      ? Array.isArray(input) ? input.length : 0
      : Number(result.externalCount) || 0,
    cursorAfter: result.nextCursor || result.next_cursor || result.cursorAfter || result.cursor_after || "",
    hasMore: Boolean(result.hasMore || result.has_more),
  };
}

async function fetchSamplesWithRealAdapter(data, env, body, options, sourceType, adapterKind) {
  const adapter = configuredRealAdapter(env, adapterKind);
  const implementations = createDefaultAdapterImplementations(env, options);
  const implementation = implementations[adapterKind];
  if (typeof implementation !== "function") {
    throw adapterError(501, `${adapter.label} 的真实拉取 Implementation 尚未启用`, adapter);
  }

  const existingCursor = cursorFor(data, sourceType, adapterKind);
  const cursorBefore = body.cursor || body.cursor_before || (existingCursor ? existingCursor.cursor_value : "");
  const limit = Number(body.limit || body.pageSize || body.page_size || 50);
  const fetched = normalizeExternalFetchResult(await implementation({
    adapter,
    sourceType,
    adapterKind,
    cursor: cursorBefore,
    limit,
    body,
    env,
    fetchImpl: options.fetchImpl,
  }));
  return {
    ...fetched,
    cursorBefore,
    requestedLimit: limit,
  };
}

async function fetchSamples(data, env, body = {}, options = {}, sourceType, adapterKind) {
  if (adapterKind === ADAPTER_KINDS.MANUAL_SAMPLE) return fetchSamplesWithManualAdapter(body);
  return fetchSamplesWithRealAdapter(data, env, body, options, sourceType, adapterKind);
}

function recordAdapterRun(data, run) {
  ensureAdapterRuns(data).unshift(run);
  data.externalAdapterRuns = ensureAdapterRuns(data).slice(0, 50);
  return run;
}

function upsertAdapterCursor(data, run) {
  if (!isRealAdapter(run.adapter_kind)) return null;
  if (!run.cursor_after) return null;
  const cursors = ensureAdapterCursors(data);
  const key = adapterKey(run.source_type, run.adapter_kind);
  let cursor = cursors.find((item) => item.adapter_key === key);
  if (!cursor) {
    cursor = {
      adapter_cursor_id: createId("adc"),
      adapter_key: key,
      source_type: run.source_type,
      adapter_kind: run.adapter_kind,
      cursor_value: "",
      last_successful_run_id: "",
      last_successful_at: "",
      updated_at: nowISO(),
    };
    cursors.push(cursor);
  }
  cursor.cursor_value = run.cursor_after;
  cursor.last_successful_run_id = run.run_id;
  cursor.last_successful_at = run.finished_at || nowISO();
  cursor.updated_at = nowISO();
  return cursor;
}

function rollbackTargetsFromResult(result = {}) {
  return (result.rows || [])
    .filter((row) => row.imported)
    .flatMap((row) => row.rollbackRefs || [])
    .filter((target) => target && target.targetType && target.targetId);
}

function rollbackNotesFromResult(result = {}) {
  return (result.rows || [])
    .flatMap((row) => row.rollbackNotes || [])
    .filter(Boolean);
}

function retrySourceRunIdFromBody(body = {}) {
  return body.retrySourceRunId || body.retry_source_run_id || body.sourceRunId || body.source_run_id || "";
}

function retryAttemptFromBody(data, body = {}) {
  const explicit = Number(body.retryAttempt || body.retry_attempt);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const sourceRun = findAdapterRun(data, retrySourceRunIdFromBody(body));
  const previousAttempt = Number(sourceRun && sourceRun.retry_attempt) || 0;
  return previousAttempt ? previousAttempt + 1 : 1;
}

function retryDelayMinutes(attempt) {
  const schedule = [5, 15, 60, 240, 720];
  const index = Math.min(schedule.length - 1, Math.max(0, Number(attempt || 1) - 1));
  return schedule[index];
}

function nextRetryAt(attempt, startedAt) {
  const base = startedAt ? new Date(String(startedAt).replace("+08:00", "+08:00")) : new Date();
  const date = Number.isNaN(base.getTime()) ? new Date() : base;
  return nowISO(new Date(date.getTime() + retryDelayMinutes(attempt) * 60 * 1000));
}

function numericErrorCode(error) {
  const value = Number(error && (error.status || error.code));
  return Number.isFinite(value) ? value : 500;
}

function isRetryableFailure(error, adapterKind) {
  if (!isRealAdapter(adapterKind)) return false;
  const code = numericErrorCode(error);
  if ([408, 409, 425, 429].includes(code)) return true;
  if (code >= 500) return true;
  return ["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "ENOTFOUND"].includes(String(error && error.code || "").toUpperCase());
}

function retryFieldsForFailure(data, body, adapterKind, error, startedAt) {
  const retryAttempt = retryAttemptFromBody(data, body);
  const retryable = isRetryableFailure(error, adapterKind);
  return {
    retry_status: retryable ? "RETRYABLE" : "MANUAL_REVIEW",
    retry_attempt: retryAttempt,
    retry_source_run_id: retrySourceRunIdFromBody(body),
    retry_reason: error && error.message ? error.message : "Adapter 运行失败",
    next_retry_at: retryable ? nextRetryAt(retryAttempt, startedAt) : "",
  };
}

function retryFieldsForSuccess(data, body = {}) {
  const retrySourceRunId = retrySourceRunIdFromBody(body);
  if (!retrySourceRunId) {
    return {
      retry_status: "NOT_REQUIRED",
      retry_attempt: 0,
      retry_source_run_id: "",
      retry_reason: "",
      next_retry_at: "",
    };
  }
  return {
    retry_status: "RETRY_SUCCEEDED",
    retry_attempt: retryAttemptFromBody(data, body),
    retry_source_run_id: retrySourceRunId,
    retry_reason: "",
    next_retry_at: "",
  };
}

function buildRunBase(sourceType, adapterKind, mode, startedAt, fetched, retryFields = {}) {
  return {
    run_id: createId("adr"),
    source_type: sourceType,
    adapter_kind: adapterKind,
    mode,
    status: "STARTED",
    total: 0,
    importable_count: 0,
    imported_count: 0,
    error_count: 0,
    warning_count: 0,
    external_count: fetched ? fetched.externalCount || 0 : 0,
    requested_limit: fetched ? fetched.requestedLimit || 0 : 0,
    cursor_before: fetched ? fetched.cursorBefore || "" : "",
    cursor_after: fetched ? fetched.cursorAfter || "" : "",
    has_more: fetched ? Boolean(fetched.hasMore) : false,
    review_id: "",
    rollback_status: "NOT_AVAILABLE",
    rollback_targets: [],
    rollback_notes: [],
    rollback_result: null,
    rollback_request_id: "",
    rollback_reason: "",
    rollback_operator_id: "",
    rolled_back_at: "",
    retry_status: retryFields.retry_status || "NOT_REQUIRED",
    retry_attempt: Number(retryFields.retry_attempt || 0),
    retry_source_run_id: retryFields.retry_source_run_id || "",
    retry_reason: retryFields.retry_reason || "",
    next_retry_at: retryFields.next_retry_at || "",
    error_code: "",
    error_message: "",
    started_at: startedAt,
    finished_at: "",
  };
}

function shouldCommitCursor(adapterKind, mode, body) {
  if (!isRealAdapter(adapterKind)) return false;
  if (body.commitCursor || body.commit_cursor) return true;
  return mode === "IMPORT";
}

async function runAdapter(data, body = {}, options = {}) {
  const rawSourceType = body.sourceType || body.source_type || "";
  const sourceType = externalAdapterSamples.sampleTemplateFor(rawSourceType).sourceType;
  const adapterKind = normalizeAdapterKind(body.adapterKind || body.adapter_kind);
  const mode = normalizeMode(body.mode);
  const startedAt = nowISO();
  let fetched = null;

  try {
    fetched = await fetchSamples(data, options.env || process.env, { ...body, adapterKind }, options, sourceType, adapterKind);
    const result = mode === "IMPORT"
      ? externalAdapterSamples.importExternalSamples(data, sourceType, fetched.input, options.dateText || todayISO())
      : externalAdapterSamples.previewExternalSamples(data, sourceType, fetched.input);
    const review = externalAdapterSamples.recordExternalSampleReview(data, mode === "IMPORT" ? "ADAPTER_IMPORT" : "ADAPTER_PREVIEW", result);
    const run = recordAdapterRun(data, {
      ...buildRunBase(sourceType, adapterKind, mode, startedAt, fetched, retryFieldsForSuccess(data, body)),
      status: result.errorCount ? "COMPLETED_WITH_ERRORS" : "COMPLETED",
      total: result.total || 0,
      importable_count: result.importableCount || 0,
      imported_count: result.importedCount || 0,
      error_count: result.errorCount || 0,
      warning_count: result.warningCount || 0,
      review_id: review.review_id,
      rollback_status: mode === "IMPORT" ? "NOT_APPLIED" : "NOT_AVAILABLE",
      rollback_targets: mode === "IMPORT" ? rollbackTargetsFromResult(result) : [],
      rollback_notes: mode === "IMPORT" ? rollbackNotesFromResult(result) : [],
      rollback_result: null,
      rolled_back_at: "",
      finished_at: nowISO(),
    });
    const cursor = shouldCommitCursor(adapterKind, mode, body) ? upsertAdapterCursor(data, run) : null;
    return {
      adapterKind,
      mode,
      sourceType,
      result,
      review,
      run,
      cursor,
    };
  } catch (error) {
    const run = recordAdapterRun(data, {
      ...buildRunBase(sourceType, adapterKind, mode, startedAt, fetched, retryFieldsForFailure(data, body, adapterKind, error, startedAt)),
      status: "FAILED",
      error_code: String(error.code || 500),
      error_message: error.message || "Adapter 运行失败",
      finished_at: nowISO(),
    });
    error.run = run;
    throw error;
  }
}

function removeByKey(data, listKey, key, value) {
  const list = Array.isArray(data[listKey]) ? data[listKey] : [];
  const index = list.findIndex((item) => item && item[key] === value);
  if (index < 0) return null;
  const [removed] = list.splice(index, 1);
  return removed || null;
}

function cloneRecord(record) {
  return record ? JSON.parse(JSON.stringify(record)) : null;
}

function rollbackSnapshotFor(target) {
  const snapshot = target && target.metadata ? target.metadata.beforeSnapshot : null;
  return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? cloneRecord(snapshot) : null;
}

function restoreByKey(data, listKey, key, value, snapshot) {
  if (!Array.isArray(data[listKey])) data[listKey] = [];
  const list = data[listKey];
  const restored = cloneRecord(snapshot);
  const index = list.findIndex((item) => item && item[key] === value);
  if (index >= 0) {
    list[index] = restored;
  } else {
    list.push(restored);
  }
  return restored;
}

function restoreSnapshotTarget(data, target, listKey, key) {
  const snapshot = rollbackSnapshotFor(target);
  if (!snapshot) return null;
  restoreByKey(data, listKey, key, target.targetId, snapshot);
  return { ...target, status: "ROLLED_BACK", reason: "已恢复导入前字段快照" };
}

function hasCriticalOrderReferences(data, orderId) {
  return [
    ["checkinSessions", "order_id"],
    ["refundWorkItems", "order_id"],
  ].some(([listKey, key]) => {
    return Array.isArray(data[listKey]) && data[listKey].some((item) => item && item[key] === orderId);
  });
}

function rollbackFulfillmentTarget(data, target) {
  const restored = restoreSnapshotTarget(data, target, "orderFulfillments", "fulfillment_id");
  if (restored) return restored;
  const fulfillment = (data.orderFulfillments || []).find((item) => item.fulfillment_id === target.targetId);
  if (!fulfillment) return { ...target, status: "SKIPPED", reason: "目标已不存在" };
  if (target.metadata && (target.metadata.createdByImport || target.metadata.rollbackWithOrder)) {
    removeByKey(data, "orderFulfillments", "fulfillment_id", target.targetId);
    return { ...target, status: "ROLLED_BACK", reason: "" };
  }
  return { ...target, status: "SKIPPED", reason: "该物流记录缺少导入前快照，需人工恢复订单物流旧值" };
}

function rollbackOrderTarget(data, target) {
  const restored = restoreSnapshotTarget(data, target, "youzanOrders", "order_id");
  if (restored) return restored;
  const order = (data.youzanOrders || []).find((item) => item.order_id === target.targetId);
  if (!order) return { ...target, status: "SKIPPED", reason: "目标已不存在" };
  if (hasCriticalOrderReferences(data, order.order_id)) {
    return { ...target, status: "SKIPPED", reason: "订单已被打卡或退款流程引用，需人工处理" };
  }
  (data.orderFulfillments || [])
    .filter((item) => item.order_id === order.order_id)
    .forEach((item) => removeByKey(data, "orderFulfillments", "fulfillment_id", item.fulfillment_id));
  removeByKey(data, "youzanOrders", "order_id", target.targetId);
  return { ...target, status: "ROLLED_BACK", reason: "" };
}

function rollbackCustomerTarget(data, target) {
  const restored = restoreSnapshotTarget(data, target, "youzanCustomers", "youzan_yz_uid");
  if (restored) return restored;
  const customer = (data.youzanCustomers || []).find((item) => item.youzan_yz_uid === target.targetId);
  if (!customer) return { ...target, status: "SKIPPED", reason: "目标已不存在" };
  const hasOrders = (data.youzanOrders || []).some((order) => order.youzan_yz_uid === customer.youzan_yz_uid);
  if (hasOrders) return { ...target, status: "SKIPPED", reason: "客户已被订单引用，需人工处理" };
  removeByKey(data, "youzanCustomers", "youzan_yz_uid", target.targetId);
  return { ...target, status: "ROLLED_BACK", reason: "" };
}

function rollbackLeadTarget(data, target) {
  const restored = restoreSnapshotTarget(data, target, "leadProfiles", "lead_id");
  if (restored) return restored;
  const lead = (data.leadProfiles || []).find((item) => item.lead_id === target.targetId);
  if (!lead) return { ...target, status: "SKIPPED", reason: "目标已不存在" };
  removeByKey(data, "leadProfiles", "lead_id", target.targetId);
  return { ...target, status: "ROLLED_BACK", reason: "" };
}

function rollbackTarget(data, target) {
  if (target.targetType === "FULFILLMENT") return rollbackFulfillmentTarget(data, target);
  if (target.targetType === "YOUZAN_ORDER") return rollbackOrderTarget(data, target);
  if (target.targetType === "YOUZAN_CUSTOMER") return rollbackCustomerTarget(data, target);
  if (target.targetType === "WECHAT_LEAD") return rollbackLeadTarget(data, target);
  return { ...target, status: "SKIPPED", reason: "未知回滚目标类型" };
}

function previousSuccessfulRun(data, run) {
  return ensureAdapterRuns(data).find((item) => {
    return item.run_id !== run.run_id
      && item.source_type === run.source_type
      && item.adapter_kind === run.adapter_kind
      && item.mode === "IMPORT"
      && item.status === "COMPLETED"
      && item.cursor_after === run.cursor_before
      && item.rollback_status !== "ROLLED_BACK";
  }) || null;
}

function rollbackCursor(data, run) {
  if (!isRealAdapter(run.adapter_kind) || !run.cursor_after) return null;
  const cursor = cursorFor(data, run.source_type, run.adapter_kind);
  if (!cursor) return { status: "SKIPPED", reason: "游标记录不存在" };
  if (cursor.last_successful_run_id !== run.run_id) {
    return { status: "SKIPPED", reason: "游标已被后续运行推进" };
  }
  const previous = previousSuccessfulRun(data, run);
  cursor.cursor_value = run.cursor_before || "";
  cursor.last_successful_run_id = previous ? previous.run_id : "";
  cursor.last_successful_at = previous ? previous.finished_at || "" : "";
  cursor.updated_at = nowISO();
  return {
    status: "ROLLED_BACK",
    cursorBefore: run.cursor_after || "",
    cursorAfter: cursor.cursor_value,
    previousRunId: cursor.last_successful_run_id,
  };
}

function rollbackSummary(results) {
  const rolledBack = results.filter((item) => item.status === "ROLLED_BACK").length;
  const skipped = results.filter((item) => item.status === "SKIPPED").length;
  return {
    total: results.length,
    rolledBack,
    skipped,
    status: skipped ? rolledBack ? "PARTIAL" : "SKIPPED" : "ROLLED_BACK",
  };
}

function rollbackAdapterRun(data, body = {}) {
  const runId = body.runId || body.run_id || "";
  const requestId = body.requestId || body.request_id || "";
  if (!runId) throw adapterError(400, "run_id 必填");
  if (!requestId) throw adapterError(400, "request_id 必填");
  if (!body.confirmRisk && !body.confirm_risk) throw adapterError(400, "请先确认回滚风险");
  const run = ensureAdapterRuns(data).find((item) => item.run_id === runId);
  if (!run) throw adapterError(404, "Adapter 运行不存在");
  if (run.mode !== "IMPORT") throw adapterError(400, "只有 IMPORT 运行可回滚");
  if (["ROLLED_BACK", "PARTIAL", "SKIPPED"].includes(run.rollback_status)) throw adapterError(409, "该运行已经执行过回滚");
  const targets = Array.isArray(run.rollback_targets) ? run.rollback_targets : [];
  if (!targets.length) throw adapterError(400, "该运行没有可自动回滚目标");
  const sortedTargets = targets.slice().sort((left, right) => {
    const order = { FULFILLMENT: 0, YOUZAN_ORDER: 1, YOUZAN_CUSTOMER: 2, WECHAT_LEAD: 3 };
    const leftRank = Object.prototype.hasOwnProperty.call(order, left.targetType) ? order[left.targetType] : 99;
    const rightRank = Object.prototype.hasOwnProperty.call(order, right.targetType) ? order[right.targetType] : 99;
    return leftRank - rightRank;
  });
  const results = sortedTargets.map((target) => rollbackTarget(data, target));
  const cursorResult = rollbackCursor(data, run);
  const summary = rollbackSummary(results);
  run.rollback_status = summary.status;
  run.rollback_result = { summary, results, cursor: cursorResult };
  run.rollback_request_id = requestId;
  run.rollback_reason = body.reason || "";
  run.rollback_operator_id = body.operatorId || body.operator_id || "";
  run.rolled_back_at = nowISO();
  return {
    run,
    summary,
    results,
    cursor: cursorResult,
  };
}

module.exports = {
  ADAPTER_KINDS,
  buildAdapterCatalog,
  listAdapterCursors,
  listAdapterRuns,
  rollbackAdapterRun,
  runAdapter,
};
