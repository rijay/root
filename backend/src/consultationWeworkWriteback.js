const auditLog = require("./auditLog");
const { nowISO } = require("./dates");
const operationTask = require("./operationTask");
const { createId } = require("./seed");
const { FOLLOW_TASK_TYPE } = require("./consultationFollowup");
const { createWeworkContactWritebackImplementation } = require("./weworkContactWritebackAdapter");

const WRITEBACK_ADAPTER = "WEWORK_CONTACT_WRITEBACK";

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

function clone(value) {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function redactText(value) {
  return String(value || "")
    .replace(/([?&\s](?:access_token|token|secret|password|key)=)[^&\s]+/gi, "$1***")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1***");
}

function redactPayload(value) {
  if (Array.isArray(value)) return value.map((item) => redactPayload(item));
  if (!value || typeof value !== "object") return typeof value === "string" ? redactText(value) : value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    if (/token|secret|password|openid|unionid|phone/i.test(key)) return [key, "***"];
    return [key, redactPayload(entry)];
  }));
}

function writebackSummary(record) {
  return {
    writebackId: record.writeback_id,
    taskId: record.task_id,
    consultationId: record.consultation_id,
    rootUserId: record.root_user_id,
    userId: record.user_id,
    campaignId: record.campaign_id,
    consultationType: record.consultation_type,
    adapterType: record.adapter_type,
    status: record.status,
    externalContactId: record.external_contact_id,
    externalRef: record.external_ref,
    operatorId: record.operator_id,
    requestId: record.request_id,
    message: record.message,
    note: record.note,
    createdAt: record.created_at,
    deliveredAt: record.delivered_at,
  };
}

function listConsultationWeworkWritebacks(data, query = {}) {
  const taskId = text(query.taskId || query.task_id);
  const rootUserId = text(query.rootUserId || query.root_user_id);
  const userId = text(query.userId || query.user_id);
  const status = text(query.status).toUpperCase();
  const limit = Math.max(1, Math.min(200, Number(query.limit || 50)));
  return ensureList(data, "consultationWeworkWritebacks")
    .filter((item) => !taskId || item.task_id === taskId)
    .filter((item) => !rootUserId || item.root_user_id === rootUserId)
    .filter((item) => !userId || item.user_id === userId)
    .filter((item) => !status || item.status === status)
    .slice()
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")))
    .slice(0, limit)
    .map(writebackSummary);
}

function findTask(data, body = {}) {
  const taskId = text(body.taskId || body.task_id || body.followTaskId || body.follow_task_id);
  if (!taskId) throw businessError(400, "企微联系回写 task_id 必填", 400);
  const task = ensureList(data, "operationTasks").find((item) => item.task_id === taskId);
  if (!task) throw businessError(404, "咨询跟进待办不存在", 404);
  if (task.task_type !== FOLLOW_TASK_TYPE) throw businessError(400, "企微联系回写只支持 CONSULTATION_FOLLOW 待办", 400);
  return task;
}

function findLead(data, task) {
  const rootUserId = text(task.metadata && task.metadata.rootUserId);
  return ensureList(data, "leadProfiles").find((lead) => {
    return lead.user_id === task.user_id || lead.user_id === rootUserId || lead.root_user_id === rootUserId;
  }) || null;
}

function externalContactIdFor(data, task, body = {}) {
  const lead = findLead(data, task);
  return text(
    body.externalContactId
    || body.external_contact_id
    || (task.metadata && task.metadata.externalContactId)
    || (lead && lead.external_contact_id)
  );
}

function writebackMode(body = {}) {
  const mode = text(body.writebackMode || body.writeback_mode || body.adapterMode || body.adapter_mode || body.deliveryMode || body.delivery_mode).toUpperCase();
  if (mode === "AUTO" || mode === WRITEBACK_ADAPTER) return WRITEBACK_ADAPTER;
  return "MANUAL";
}

function shouldFail(body = {}) {
  const status = text(body.status || body.outcome || body.result).toUpperCase();
  return status === "FAILED" || status === "FAIL";
}

function manualResult(task, body = {}) {
  if (shouldFail(body)) {
    const message = text(body.errorMessage || body.error_message || body.message, "企微联系回写人工标记失败");
    return {
      ok: false,
      status: "FAILED",
      message,
      externalRef: "",
      payload: {
        adapterType: "MANUAL",
        taskId: task.task_id,
        message,
      },
    };
  }
  const externalRef = text(body.externalRef || body.external_ref, `manual-${task.task_id}`);
  return {
    ok: true,
    status: "DELIVERED",
    message: text(body.message || body.successMessage || body.success_message, "企微联系已人工确认"),
    externalRef,
    payload: {
      adapterType: "MANUAL",
      taskId: task.task_id,
      externalRef,
    },
  };
}

async function adapterResult(data, task, body = {}, context = {}) {
  const mode = writebackMode(body);
  if (mode === "MANUAL" || shouldFail(body)) return manualResult(task, body);
  const env = context.env || process.env;
  const adapters = { ...(context.consultationWritebackAdapters || {}) };
  if (!adapters[WRITEBACK_ADAPTER] && env.WEWORK_CONTACT_WRITEBACK_URL) {
    adapters[WRITEBACK_ADAPTER] = createWeworkContactWritebackImplementation({ fetchImpl: context.fetchImpl });
  }
  const adapter = adapters[WRITEBACK_ADAPTER];
  if (typeof adapter !== "function") {
    return {
      ok: false,
      status: "FAILED",
      message: "企微联系回写 Adapter 尚未配置",
      externalRef: "",
      payload: {
        adapterType: WRITEBACK_ADAPTER,
        errorCode: "ADAPTER_NOT_CONFIGURED",
        errorMessage: "企微联系回写 Adapter 尚未配置",
      },
    };
  }
  try {
    const result = await adapter({
      env,
      fetchImpl: context.fetchImpl,
      data,
      task,
      body,
      externalContactId: externalContactIdFor(data, task, body),
    });
    return {
      ok: Boolean(result && result.ok),
      status: result && result.ok ? "DELIVERED" : "FAILED",
      message: text(result && result.message, result && result.ok ? "企微联系回写完成" : "企微联系回写失败"),
      externalRef: text(result && result.externalRef),
      payload: result && result.payload ? result.payload : result || {},
    };
  } catch (error) {
    return {
      ok: false,
      status: "FAILED",
      message: error.message || "企微联系回写 Adapter 运行失败",
      externalRef: "",
      payload: {
        adapterType: WRITEBACK_ADAPTER,
        errorCode: String(error.code || 500),
        errorMessage: error.message || "企微联系回写 Adapter 运行失败",
        detail: error.detail || null,
      },
    };
  }
}

async function recordConsultationWeworkWriteback(data, body = {}, context = {}) {
  const requestId = text(body.requestId || body.request_id || context.requestId);
  if (!requestId) throw businessError(400, "企微联系回写 request_id 必填", 400);
  const existing = ensureList(data, "consultationWeworkWritebacks").find((item) => item.request_id === requestId);
  if (existing) return { writeback: writebackSummary(existing), idempotent: true };

  const task = findTask(data, body);
  const rootUserId = text((task.metadata && task.metadata.rootUserId) || task.user_id);
  const externalContactId = externalContactIdFor(data, task, body);
  const mode = writebackMode(body);
  if (mode === WRITEBACK_ADAPTER && !externalContactId) {
    throw businessError(400, "企微联系回写缺少 externalContactId", 400);
  }
  const beforeTask = clone(task);
  const result = await adapterResult(data, task, {
    ...body,
    externalContactId,
  }, context);
  const now = nowISO();
  const record = {
    writeback_id: createId("wwb"),
    task_id: task.task_id,
    consultation_id: text(task.metadata && task.metadata.consultationId),
    root_user_id: rootUserId,
    user_id: task.user_id || "",
    campaign_id: text(task.metadata && task.metadata.campaignId),
    consultation_type: text(task.metadata && task.metadata.consultationType),
    adapter_type: mode,
    status: result.ok ? "DELIVERED" : "FAILED",
    external_contact_id: externalContactId,
    external_ref: text(result.externalRef),
    operator_id: text(body.operatorId || body.operator_id || context.operatorId),
    request_id: requestId,
    message: redactText(text(result.message)),
    note: redactText(text(body.note || body.followNote || body.follow_note)),
    payload_json: redactPayload(result.payload || {}),
    created_at: now,
    delivered_at: result.ok ? now : "",
  };
  ensureList(data, "consultationWeworkWritebacks").unshift(record);
  data.consultationWeworkWritebacks = ensureList(data, "consultationWeworkWritebacks").slice(0, 1000);

  let completedTask = task;
  if (result.ok) {
    completedTask = operationTask.completeOperationTask(data, task.task_id, {
      result: text(body.result || body.followResult || body.follow_result, "WEWORK_CONTACTED"),
      note: record.note || record.message,
    });
  }

  const audit = auditLog.appendAuditLog(data, {
    action: "CONSULTATION_WEWORK_WRITEBACK",
    targetType: "OPERATION_TASK",
    targetId: task.task_id,
    operatorId: record.operator_id,
    reason: record.message,
    before: beforeTask,
    after: clone(completedTask),
    metadata: {
      requestId,
      writebackId: record.writeback_id,
      adapterType: record.adapter_type,
      status: record.status,
      externalRef: record.external_ref,
    },
  });

  return {
    success: result.ok,
    writeback: writebackSummary(record),
    task: completedTask,
    audit,
  };
}

module.exports = {
  WRITEBACK_ADAPTER,
  listConsultationWeworkWritebacks,
  recordConsultationWeworkWriteback,
  writebackSummary,
};
