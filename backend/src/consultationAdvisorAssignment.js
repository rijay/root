const auditLog = require("./auditLog");
const { nowISO } = require("./dates");
const { createId } = require("./seed");
const { FOLLOW_TASK_TYPE } = require("./consultationFollowup");

const ASSIGNMENT_MODE_AUTO = "AUTO";
const ASSIGNMENT_MODE_MANUAL = "MANUAL";

function businessError(code, message, status = code) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || null));
}

function text(value, fallback = "") {
  const result = String(value || "").trim();
  return result || fallback;
}

function upper(value, fallback = "") {
  return text(value, fallback).toUpperCase();
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function parseAdvisorList(value) {
  if (Array.isArray(value)) return value.map(normalizeAdvisor).filter((item) => item.advisorId);
  const parsed = parseJson(value, null);
  if (Array.isArray(parsed)) return parsed.map(normalizeAdvisor).filter((item) => item.advisorId);
  return String(value || "")
    .split(",")
    .map((item) => normalizeAdvisor(item))
    .filter((item) => item.advisorId);
}

function normalizeAdvisor(value = {}) {
  if (typeof value === "string") {
    const [id, name, role] = value.split(":").map((part) => String(part || "").trim());
    return {
      advisorId: id,
      advisorName: name || id,
      advisorRole: role || "ADVISOR",
    };
  }
  const advisorId = text(value.advisorId || value.advisor_id || value.operatorId || value.operator_id || value.id || value.name);
  return {
    advisorId,
    advisorName: text(value.advisorName || value.advisor_name || value.name, advisorId),
    advisorRole: upper(value.advisorRole || value.advisor_role || value.role, "ADVISOR"),
  };
}

function assignmentMode(body = {}) {
  const mode = upper(body.assignmentMode || body.assignment_mode || body.mode, ASSIGNMENT_MODE_MANUAL);
  return mode === ASSIGNMENT_MODE_AUTO ? ASSIGNMENT_MODE_AUTO : ASSIGNMENT_MODE_MANUAL;
}

function advisorCandidates(data, body = {}, context = {}) {
  const explicit = body.advisors || body.advisorCandidates || body.advisor_candidates;
  const env = context.env || process.env;
  const list = explicit !== undefined
    ? parseAdvisorList(explicit)
    : parseAdvisorList(env.ROOT_CONSULTATION_ADVISORS || env.ROOT_ADVISORS || "");
  const activeAdvisorIds = new Set(ensureList(data, "consultationAdvisorAssignments")
    .filter((item) => item.status === "ACTIVE")
    .map((item) => item.advisor_id)
    .filter(Boolean));
  return list.map((item) => ({
    ...item,
    activeCount: activeAdvisorIds.has(item.advisorId)
      ? ensureList(data, "consultationAdvisorAssignments").filter((assignment) => assignment.status === "ACTIVE" && assignment.advisor_id === item.advisorId).length
      : 0,
  }));
}

function chooseAutoAdvisor(data, body = {}, context = {}) {
  const candidates = advisorCandidates(data, body, context);
  if (!candidates.length) {
    throw businessError(400, "顾问自动分配缺少候选顾问，请配置 ROOT_CONSULTATION_ADVISORS 或传入 advisors", 400);
  }
  return candidates.slice().sort((left, right) => left.activeCount - right.activeCount || left.advisorId.localeCompare(right.advisorId))[0];
}

function manualAdvisor(body = {}) {
  const advisor = normalizeAdvisor({
    advisorId: body.advisorId || body.advisor_id,
    advisorName: body.advisorName || body.advisor_name,
    advisorRole: body.advisorRole || body.advisor_role,
  });
  if (!advisor.advisorId) throw businessError(400, "顾问分配 advisor_id 必填", 400);
  return advisor;
}

function taskFor(data, taskId) {
  const task = ensureList(data, "operationTasks").find((item) => item.task_id === taskId);
  if (!task) throw businessError(404, "咨询跟进待办不存在", 404);
  if (task.task_type !== FOLLOW_TASK_TYPE) throw businessError(400, "顾问分配只支持 CONSULTATION_FOLLOW 待办", 400);
  return task;
}

function activeAssignmentForTask(data, taskId) {
  return ensureList(data, "consultationAdvisorAssignments")
    .filter((item) => item.task_id === taskId && item.status === "ACTIVE")
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")))[0] || null;
}

function assignmentSummary(record = {}) {
  return {
    assignmentId: record.assignment_id || "",
    taskId: record.task_id || "",
    consultationId: record.consultation_id || "",
    rootUserId: record.root_user_id || "",
    userId: record.user_id || "",
    campaignId: record.campaign_id || "",
    consultationType: record.consultation_type || "",
    assignmentMode: record.assignment_mode || ASSIGNMENT_MODE_MANUAL,
    advisorId: record.advisor_id || "",
    advisorName: record.advisor_name || "",
    advisorRole: record.advisor_role || "",
    previousAdvisorId: record.previous_advisor_id || "",
    previousAdvisorName: record.previous_advisor_name || "",
    status: record.status || "",
    operatorId: record.operator_id || "",
    requestId: record.request_id || "",
    reason: record.reason || "",
    createdAt: record.created_at || "",
    replacedAt: record.replaced_at || "",
  };
}

function listConsultationAdvisorAssignments(data, query = {}) {
  const taskId = text(query.taskId || query.task_id);
  const userId = text(query.userId || query.user_id);
  const rootUserId = text(query.rootUserId || query.root_user_id);
  const advisorId = text(query.advisorId || query.advisor_id);
  const status = upper(query.status);
  const limit = Math.max(1, Math.min(Number(query.limit || 100), 300));
  return ensureList(data, "consultationAdvisorAssignments")
    .filter((item) => !taskId || item.task_id === taskId)
    .filter((item) => !userId || item.user_id === userId)
    .filter((item) => !rootUserId || item.root_user_id === rootUserId)
    .filter((item) => !advisorId || item.advisor_id === advisorId)
    .filter((item) => !status || item.status === status)
    .slice()
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")))
    .slice(0, limit)
    .map(assignmentSummary);
}

function recordConsultationAdvisorAssignment(data, body = {}, context = {}) {
  const requestId = text(body.requestId || body.request_id || context.requestId);
  if (!requestId) throw businessError(400, "顾问分配 request_id 必填", 400);

  const existing = ensureList(data, "consultationAdvisorAssignments").find((item) => item.request_id === requestId);
  if (existing) {
    return {
      success: true,
      idempotent: true,
      assignment: assignmentSummary(existing),
      task: taskFor(data, existing.task_id),
    };
  }

  const taskId = text(body.taskId || body.task_id);
  if (!taskId) throw businessError(400, "顾问分配 task_id 必填", 400);
  const task = taskFor(data, taskId);
  const metadata = task.metadata || {};
  const mode = assignmentMode(body);
  const advisor = mode === ASSIGNMENT_MODE_AUTO ? chooseAutoAdvisor(data, body, context) : manualAdvisor(body);
  const previous = activeAssignmentForTask(data, task.task_id);
  const beforeTask = clone(task);
  const now = nowISO();

  if (previous) {
    previous.status = "REPLACED";
    previous.replaced_at = now;
  }

  const record = {
    assignment_id: createId("caa"),
    task_id: task.task_id,
    consultation_id: metadata.consultationId || "",
    root_user_id: metadata.rootUserId || "",
    user_id: task.user_id || "",
    campaign_id: metadata.campaignId || "",
    consultation_type: metadata.consultationType || "",
    assignment_mode: mode,
    advisor_id: advisor.advisorId,
    advisor_name: advisor.advisorName,
    advisor_role: advisor.advisorRole,
    previous_advisor_id: previous ? previous.advisor_id || "" : metadata.assignedAdvisorId || "",
    previous_advisor_name: previous ? previous.advisor_name || "" : metadata.assignedAdvisorName || "",
    status: "ACTIVE",
    operator_id: text(body.operatorId || body.operator_id || context.operatorId),
    request_id: requestId,
    reason: text(body.reason || body.note, mode === ASSIGNMENT_MODE_AUTO ? "自动分配咨询顾问" : "人工分配咨询顾问"),
    created_at: now,
    replaced_at: "",
  };

  task.metadata = {
    ...metadata,
    assignedAdvisorId: record.advisor_id,
    assignedAdvisorName: record.advisor_name,
    assignedAdvisorRole: record.advisor_role,
    assignedAt: now,
    assignmentId: record.assignment_id,
    assignmentMode: mode,
  };
  task.suggested_action = task.suggested_action || "查看咨询主题并联系用户";

  ensureList(data, "consultationAdvisorAssignments").unshift(record);
  data.consultationAdvisorAssignments = ensureList(data, "consultationAdvisorAssignments").slice(0, 1000);

  auditLog.appendAuditLog(data, {
    action: "CONSULTATION_ADVISOR_ASSIGN",
    targetType: "OPERATION_TASK",
    targetId: task.task_id,
    operatorId: record.operator_id,
    reason: record.reason,
    before: beforeTask,
    after: clone(task),
    metadata: {
      requestId,
      assignmentId: record.assignment_id,
      assignmentMode: mode,
      advisorId: record.advisor_id,
      previousAdvisorId: record.previous_advisor_id,
    },
  });

  return {
    success: true,
    idempotent: false,
    assignment: assignmentSummary(record),
    task,
  };
}

module.exports = {
  ASSIGNMENT_MODE_AUTO,
  ASSIGNMENT_MODE_MANUAL,
  assignmentSummary,
  listConsultationAdvisorAssignments,
  recordConsultationAdvisorAssignment,
};
