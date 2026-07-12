const auditLog = require("./auditLog");
const { nowISO } = require("./dates");
const operationTask = require("./operationTask");
const { createId } = require("./seed");
const { createWeworkTouchImplementation } = require("./weworkTouchAdapter");

const TOUCH_ADAPTER = "WEWORK_TOUCH";
const DEFAULT_TOUCH_TASK_TYPES = [
  "CONSULTATION_FOLLOW",
  "QUESTIONNAIRE_FOLLOW",
  "DAY8_QUESTIONNAIRE_PENDING",
  "MANUAL_REVIEW_REQUIRED",
];

const DEFAULT_TEMPLATES = {
  CONSULTATION_FOLLOW: "你好，我是 ROOT 顾问。{{suggestedScript}}",
  QUESTIONNAIRE_FOLLOW: "你好，我是 ROOT 顾问。看到你的问卷反馈需要跟进，我先帮你确认一下具体情况。",
  DAY8_QUESTIONNAIRE_PENDING: "你好，ROOT 7 天记录已完成，记得补充收尾问卷，方便我们继续处理活动结算。",
  MANUAL_REVIEW_REQUIRED: "你好，你的活动奖励正在复核中。我们会结合任务记录和活动规则继续确认。",
  COUPON_UNUSED: "你好，你的 ROOT 复购礼还未使用，如需协助可以直接回复我。",
  DEFAULT: "你好，我是 ROOT 顾问。{{reason}}",
};

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

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function arrayValue(value, fallback = []) {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean);
  if (typeof value === "string") {
    const items = value.split(/[\s,，;；]+/).map((item) => text(item)).filter(Boolean);
    return items.length ? items : fallback;
  }
  return fallback;
}

function clone(value) {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function redactText(value) {
  return String(value || "")
    .replace(/([?&\s](?:access_token|token|secret|password|key)=)[^&\s]+/gi, "$1***")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1***")
    .replace(/(openid|unionid|phone)=([^&\s]+)/gi, "$1=***");
}

function parseTemplateConfig(env = process.env, body = {}) {
  const raw = body.templates || body.weworkTouchTemplates || env.ROOT_WEWORK_TOUCH_TEMPLATES;
  if (!raw) return {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    throw businessError(400, `企微触达模板不是合法 JSON：${error.message}`, 400);
  }
}

function rootUserIdForTask(data, task) {
  const metadata = task.metadata || {};
  if (metadata.rootUserId) return metadata.rootUserId;
  const user = ensureList(data, "users").find((item) => item.user_id === task.user_id);
  return user ? user.root_user_id || user.user_id : task.user_id || "";
}

function findLead(data, task, rootUserId) {
  return ensureList(data, "leadProfiles").find((lead) => {
    return lead.user_id === task.user_id || lead.user_id === rootUserId || lead.root_user_id === rootUserId;
  }) || null;
}

function externalContactIdFor(data, task, rootUserId) {
  const metadata = task.metadata || {};
  const lead = findLead(data, task, rootUserId);
  return text(metadata.externalContactId || metadata.external_contact_id || (lead && lead.external_contact_id));
}

function taskTypesFromInput(body = {}, env = process.env) {
  return arrayValue(
    body.taskTypes || body.task_types || env.ROOT_WEWORK_TOUCH_TASK_TYPES,
    DEFAULT_TOUCH_TASK_TYPES,
  ).map((item) => item.toUpperCase());
}

function taskMatches(task, allowedTypes) {
  return task && task.status === "OPEN" && allowedTypes.includes(String(task.task_type || "").toUpperCase());
}

function placeholdersForTask(task, rootUserId, externalContactId) {
  const metadata = task.metadata || {};
  return {
    rootUserId,
    userId: task.user_id || "",
    taskId: task.task_id || "",
    taskType: task.task_type || "",
    campaignId: metadata.campaignId || "",
    consultationType: metadata.consultationType || "",
    externalContactId,
    reason: task.reason || "",
    suggestedAction: task.suggested_action || "",
    suggestedScript: task.suggested_script || "",
  };
}

function renderTemplate(template, values) {
  return redactText(String(template || DEFAULT_TEMPLATES.DEFAULT).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    return values[key] === undefined || values[key] === null ? "" : String(values[key]);
  })).replace(/\s+/g, " ").trim();
}

function templateForTask(task, rootUserId, externalContactId, templates = {}) {
  const taskType = String(task.task_type || "").toUpperCase();
  const templateKey = templates[taskType] ? taskType : DEFAULT_TEMPLATES[taskType] ? taskType : "DEFAULT";
  const template = templates[templateKey] || DEFAULT_TEMPLATES[templateKey] || DEFAULT_TEMPLATES.DEFAULT;
  return {
    templateKey,
    message: renderTemplate(template, placeholdersForTask(task, rootUserId, externalContactId)),
  };
}

function idempotencyKeyFor(task, templateKey) {
  return `wework-touch:${task.task_id}:${templateKey}`;
}

function cooldownHours(body = {}, env = process.env) {
  const hours = numberValue(body.cooldownHours || body.cooldown_hours || env.ROOT_WEWORK_TOUCH_COOLDOWN_HOURS, 24);
  return Math.max(0, hours);
}

function withinCooldown(leftIso, rightIso, hours) {
  if (!hours) return false;
  const left = Date.parse(leftIso || "");
  const right = Date.parse(rightIso || "");
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return Math.abs(right - left) < hours * 60 * 60 * 1000;
}

function recentTouchFor(data, rootUserId, taskType, nowText, hours) {
  if (!hours) return null;
  return ensureList(data, "weworkTouchJobs").find((job) => {
    return job.root_user_id === rootUserId
      && job.task_type === taskType
      && ["PENDING", "DELIVERED"].includes(job.status)
      && withinCooldown(job.created_at || job.delivered_at, nowText, hours);
  }) || null;
}

function toTouchJobPayload(job) {
  if (!job) return null;
  return {
    touchJobId: job.wework_touch_job_id,
    rootUserId: job.root_user_id,
    userId: job.user_id,
    taskId: job.task_id,
    taskType: job.task_type,
    campaignId: job.campaign_id || "",
    externalContactId: job.external_contact_id || "",
    touchType: job.touch_type,
    templateKey: job.template_key,
    message: job.message,
    status: job.status,
    adapterType: job.adapter_type,
    attemptCount: job.attempt_count || 0,
    externalRef: job.external_ref || "",
    lastError: job.last_error || "",
    requestId: job.request_id || "",
    idempotencyKey: job.idempotency_key || "",
    dueAt: job.due_at || "",
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    deliveredAt: job.delivered_at || "",
  };
}

function candidateForTask(data, task, templates, nowText, cooldown, options = {}) {
  const rootUserId = rootUserIdForTask(data, task);
  const externalContactId = externalContactIdFor(data, task, rootUserId);
  const rendered = templateForTask(task, rootUserId, externalContactId, templates);
  const idempotencyKey = idempotencyKeyFor(task, rendered.templateKey);
  const existing = ensureList(data, "weworkTouchJobs").find((job) => job.idempotency_key === idempotencyKey) || null;
  const recent = existing ? null : recentTouchFor(data, rootUserId, task.task_type, nowText, cooldown);
  const blockedReason = !externalContactId
    ? "缺少企业微信外部联系人 ID"
    : recent
      ? `触达冷却中：${cooldown} 小时内已有同类触达`
      : "";
  return {
    task,
    rootUserId,
    externalContactId,
    templateKey: rendered.templateKey,
    message: rendered.message,
    idempotencyKey,
    existing,
    recent,
    blockedReason,
    status: blockedReason ? "BLOCKED" : "PENDING",
    dueAt: text(options.dueAt || options.due_at, nowText),
  };
}

function createJobFromCandidate(data, candidate, body = {}, context = {}) {
  if (candidate.existing) {
    if (candidate.existing.status === "BLOCKED" && candidate.status === "PENDING") {
      const now = nowISO();
      candidate.existing.external_contact_id = candidate.externalContactId;
      candidate.existing.message = candidate.message;
      candidate.existing.template_key = candidate.templateKey;
      candidate.existing.status = "PENDING";
      candidate.existing.adapter_type = text(body.adapterMode || body.adapter_mode, "AUTO").toUpperCase();
      candidate.existing.last_error = "";
      candidate.existing.request_id = text(body.requestId || body.request_id || context.requestId, candidate.existing.request_id);
      candidate.existing.due_at = candidate.dueAt;
      candidate.existing.updated_at = now;
      return { job: candidate.existing, created: false, reactivated: true, candidate };
    }
    return { job: candidate.existing, created: false, candidate };
  }
  const task = candidate.task;
  const metadata = task.metadata || {};
  const now = nowISO();
  const job = {
    wework_touch_job_id: createId("wwt"),
    root_user_id: candidate.rootUserId,
    user_id: task.user_id || "",
    task_id: task.task_id,
    task_type: task.task_type,
    campaign_id: text(metadata.campaignId),
    external_contact_id: candidate.externalContactId,
    touch_type: text(body.touchType || body.touch_type, "TASK_FOLLOWUP"),
    template_key: candidate.templateKey,
    message: candidate.message,
    status: candidate.status,
    adapter_type: candidate.status === "BLOCKED" ? "NONE" : text(body.adapterMode || body.adapter_mode, "AUTO").toUpperCase(),
    attempt_count: 0,
    external_ref: "",
    last_error: candidate.blockedReason,
    request_id: text(body.requestId || body.request_id || context.requestId),
    idempotency_key: candidate.idempotencyKey,
    due_at: candidate.dueAt,
    payload_json: {
      taskReason: task.reason || "",
      suggestedAction: task.suggested_action || "",
      sourceChannel: metadata.sourceChannel || "",
    },
    created_at: now,
    updated_at: now,
    delivered_at: "",
  };
  ensureList(data, "weworkTouchJobs").unshift(job);
  data.weworkTouchJobs = ensureList(data, "weworkTouchJobs").slice(0, 2000);
  return { job, created: true, candidate };
}

function listWeWorkTouchJobs(data, query = {}) {
  const status = text(query.status).toUpperCase();
  const taskId = text(query.taskId || query.task_id);
  const rootUserId = text(query.rootUserId || query.root_user_id);
  const limit = Math.max(1, Math.min(200, Number(query.limit || 50)));
  return ensureList(data, "weworkTouchJobs")
    .filter((job) => !status || job.status === status)
    .filter((job) => !taskId || job.task_id === taskId)
    .filter((job) => !rootUserId || job.root_user_id === rootUserId)
    .slice()
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")))
    .slice(0, limit)
    .map(toTouchJobPayload);
}

function planWeWorkTouches(data, body = {}, context = {}) {
  const env = context.env || process.env;
  const allowedTypes = taskTypesFromInput(body, env);
  const templates = parseTemplateConfig(env, body);
  const dryRun = boolValue(body.dryRun ?? body.dry_run, true);
  const nowText = text(body.now, nowISO());
  const limit = Math.max(1, Math.min(200, Number(body.limit || body.taskLimit || body.task_limit || 50)));
  const cooldown = cooldownHours(body, env);
  const tasks = operationTask.listOpenOperationTasks(data)
    .filter((task) => taskMatches(task, allowedTypes))
    .slice()
    .sort((left, right) => String(left.created_at || "").localeCompare(String(right.created_at || "")))
    .slice(0, limit);
  const candidates = tasks.map((task) => candidateForTask(data, task, templates, nowText, cooldown, body));
  const results = dryRun
    ? candidates.map((candidate) => ({
      candidate,
      job: candidate.existing || null,
      created: false,
    }))
    : candidates.map((candidate) => createJobFromCandidate(data, candidate, body, context));

  if (!dryRun) {
    auditLog.appendAuditLog(data, {
      action: "WEWORK_TOUCH_PLAN",
      targetType: "WEWORK_TOUCH_JOB",
      targetId: text(body.requestId || body.request_id || context.requestId),
      operatorId: text(body.operatorId || body.operator_id || context.operatorId),
      reason: text(body.reason, "生成企微自动触达队列"),
      before: null,
      after: {
        selectedCount: results.length,
        createdCount: results.filter((item) => item.created).length,
        reactivatedCount: results.filter((item) => item.reactivated).length,
        blockedCount: results.filter((item) => item.job && item.job.status === "BLOCKED").length,
      },
      metadata: { requestId: text(body.requestId || body.request_id || context.requestId) },
    });
  }

  return {
    dryRun,
    selectedCount: results.length,
    createdCount: results.filter((item) => item.created).length,
    reactivatedCount: results.filter((item) => item.reactivated).length,
    existingCount: results.filter((item) => item.job && !item.created).length,
    blockedCount: results.filter((item) => item.candidate.status === "BLOCKED").length,
    candidates: results.map((item) => ({
      taskId: item.candidate.task.task_id,
      taskType: item.candidate.task.task_type,
      rootUserId: item.candidate.rootUserId,
      externalContactId: item.candidate.externalContactId,
      templateKey: item.candidate.templateKey,
      message: item.candidate.message,
      status: item.candidate.status,
      blockedReason: item.candidate.blockedReason,
      existingJobId: item.candidate.existing ? item.candidate.existing.wework_touch_job_id : "",
    })),
    jobs: results.map((item) => toTouchJobPayload(item.job)).filter(Boolean),
  };
}

function manualTouchResult(job, body = {}) {
  return {
    ok: true,
    status: "DELIVERED",
    message: text(body.message, "企微自动触达已本地确认"),
    externalRef: text(body.externalRef || body.external_ref, `manual-${job.wework_touch_job_id}`),
    payload: {
      adapterType: "MANUAL",
      touchJobId: job.wework_touch_job_id,
    },
  };
}

async function adapterTouchResult(job, body = {}, context = {}) {
  const mode = text(body.adapterMode || body.adapter_mode || job.adapter_type, "AUTO").toUpperCase();
  if (["MANUAL", "LOCAL", "SIMULATED"].includes(mode)) return manualTouchResult(job, body);
  const env = context.env || process.env;
  const adapters = { ...(context.weworkTouchAdapters || {}) };
  if (!adapters[TOUCH_ADAPTER] && env.WEWORK_TOUCH_SEND_URL) {
    adapters[TOUCH_ADAPTER] = createWeworkTouchImplementation({ fetchImpl: context.fetchImpl });
  }
  const adapter = adapters[TOUCH_ADAPTER];
  if (typeof adapter !== "function") {
    return {
      ok: false,
      status: "FAILED",
      message: "企微自动触达 Adapter 尚未配置",
      externalRef: "",
      payload: { adapterType: TOUCH_ADAPTER, errorCode: "ADAPTER_NOT_CONFIGURED" },
    };
  }
  try {
    const result = await adapter({ env, data: context.data, job, body, fetchImpl: context.fetchImpl });
    return {
      ok: Boolean(result && result.ok),
      status: result && result.ok ? "DELIVERED" : "FAILED",
      message: text(result && result.message, result && result.ok ? "企微自动触达完成" : "企微自动触达失败"),
      externalRef: text(result && result.externalRef),
      payload: result && result.payload ? result.payload : result || {},
    };
  } catch (error) {
    return {
      ok: false,
      status: "FAILED",
      message: error.message || "企微自动触达 Adapter 运行失败",
      externalRef: "",
      payload: {
        adapterType: TOUCH_ADAPTER,
        errorCode: String(error.code || 500),
        errorMessage: error.message || "企微自动触达 Adapter 运行失败",
        detail: error.detail || null,
      },
    };
  }
}

async function runTouchJob(data, job, body = {}, context = {}) {
  if (!job || job.status !== "PENDING") return { ok: false, skipped: true, job: toTouchJobPayload(job), reason: "触达 Job 不在 PENDING 状态" };
  const before = clone(job);
  const result = await adapterTouchResult(job, body, { ...context, data });
  const now = nowISO();
  job.attempt_count = Number(job.attempt_count || 0) + 1;
  job.status = result.ok ? "DELIVERED" : "FAILED";
  job.adapter_type = text(body.adapterMode || body.adapter_mode || job.adapter_type, "AUTO").toUpperCase();
  job.external_ref = text(result.externalRef);
  job.last_error = result.ok ? "" : redactText(result.message);
  job.payload_json = { ...(job.payload_json || {}), adapterPayload: result.payload || {} };
  job.updated_at = now;
  job.delivered_at = result.ok ? now : "";

  let task = ensureList(data, "operationTasks").find((item) => item.task_id === job.task_id) || null;
  if (result.ok && task && task.status === "OPEN") {
    task = operationTask.completeOperationTask(data, task.task_id, {
      result: text(body.result || body.followResult || body.follow_result, "WEWORK_AUTO_TOUCHED"),
      note: redactText(job.message || result.message),
    });
  }

  const audit = auditLog.appendAuditLog(data, {
    action: "WEWORK_TOUCH_RUN",
    targetType: "WEWORK_TOUCH_JOB",
    targetId: job.wework_touch_job_id,
    operatorId: text(body.operatorId || body.operator_id || context.operatorId),
    reason: redactText(result.message),
    before,
    after: clone(job),
    metadata: {
      requestId: text(body.requestId || body.request_id || context.requestId),
      status: job.status,
      externalRef: job.external_ref,
      taskId: job.task_id,
    },
  });
  return { ok: result.ok, job: toTouchJobPayload(job), task, audit, message: redactText(result.message) };
}

function dueJobs(data, body = {}) {
  const nowText = text(body.now, nowISO());
  const limit = Math.max(1, Math.min(200, Number(body.batchSize || body.batch_size || body.limit || 20)));
  return ensureList(data, "weworkTouchJobs")
    .filter((job) => job.status === "PENDING")
    .filter((job) => !job.due_at || String(job.due_at) <= nowText)
    .slice()
    .sort((left, right) => String(left.due_at || left.created_at || "").localeCompare(String(right.due_at || right.created_at || "")))
    .slice(0, limit);
}

async function runDueWeWorkTouches(data, body = {}, context = {}) {
  const dryRun = boolValue(body.dryRun ?? body.dry_run, true);
  const requestId = text(body.requestId || body.request_id || context.requestId);
  const plan = dryRun
    ? planWeWorkTouches(data, { ...body, dryRun: true }, context)
    : planWeWorkTouches(data, { ...body, dryRun: false, requestId }, context);
  const jobs = dueJobs(data, body);
  if (dryRun) {
    return {
      dryRun: true,
      plan,
      selectedCount: jobs.length,
      executedCount: 0,
      successCount: 0,
      failedCount: 0,
      jobs: jobs.map(toTouchJobPayload),
      results: [],
    };
  }
  const results = [];
  for (const job of jobs) {
    results.push(await runTouchJob(data, job, { ...body, requestId }, context));
  }
  return {
    dryRun: false,
    plan,
    selectedCount: jobs.length,
    executedCount: results.length,
    successCount: results.filter((item) => item.ok).length,
    failedCount: results.filter((item) => !item.ok && !item.skipped).length,
    jobs: jobs.map(toTouchJobPayload),
    results,
  };
}

module.exports = {
  DEFAULT_TOUCH_TASK_TYPES,
  TOUCH_ADAPTER,
  listWeWorkTouchJobs,
  planWeWorkTouches,
  runDueWeWorkTouches,
  toTouchJobPayload,
};
