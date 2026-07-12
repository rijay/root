const { nowISO } = require("./dates");

const FOLLOW_TASK_TYPE = "CONSULTATION_FOLLOW";
const DEFAULT_CONSULTATION_SLA_MINUTES = 120;
const DEFAULT_DUE_SOON_MINUTES = 30;

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function upper(value, fallback = "") {
  return text(value, fallback).toUpperCase();
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampMinutes(value, fallback, min = 5, max = 10080) {
  return Math.max(min, Math.min(max, Math.floor(numberValue(value, fallback))));
}

function slaMinutesFrom(query = {}, context = {}) {
  const env = context.env || process.env;
  return clampMinutes(
    query.slaMinutes || query.sla_minutes || env.ROOT_CONSULTATION_SLA_MINUTES,
    DEFAULT_CONSULTATION_SLA_MINUTES,
  );
}

function dueSoonMinutesFrom(query = {}, context = {}) {
  const env = context.env || process.env;
  return clampMinutes(
    query.dueSoonMinutes || query.due_soon_minutes || env.ROOT_CONSULTATION_SLA_DUE_SOON_MINUTES,
    DEFAULT_DUE_SOON_MINUTES,
    0,
    1440,
  );
}

function minutesSince(value, nowText = nowISO()) {
  const start = Date.parse(String(value || ""));
  const now = Date.parse(nowText);
  if (!Number.isFinite(start) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.floor((now - start) / 60000));
}

function addMinutes(value, minutes) {
  const start = Date.parse(String(value || ""));
  if (!Number.isFinite(start)) return "";
  return nowISO(new Date(start + Number(minutes || 0) * 60000));
}

function taskMetadata(task = {}) {
  return task.metadata && typeof task.metadata === "object" ? task.metadata : {};
}

function taskSlaView(task = {}, query = {}, context = {}) {
  const slaMinutes = slaMinutesFrom(query, context);
  const dueSoonMinutes = dueSoonMinutesFrom(query, context);
  const nowText = text(query.now || query.nowISO || query.now_iso || context.now) || nowISO();
  const createdAt = text(task.created_at || task.createdAt);
  const ageMinutes = minutesSince(createdAt, nowText);
  const overdueMinutes = Math.max(0, ageMinutes - slaMinutes);
  const dueAt = addMinutes(createdAt, slaMinutes);
  const dueSoon = overdueMinutes <= 0 && ageMinutes >= Math.max(0, slaMinutes - dueSoonMinutes);
  const status = overdueMinutes > 0 ? "OVERDUE" : dueSoon ? "DUE_SOON" : "OPEN";
  return {
    status,
    statusLabel: status === "OVERDUE" ? "已超时" : status === "DUE_SOON" ? "即将超时" : "跟进中",
    slaMinutes,
    dueSoonMinutes,
    ageMinutes,
    overdueMinutes,
    dueAt,
    now: nowText,
  };
}

function userForTask(data, task) {
  return ensureList(data, "users").find((user) => user.user_id === task.user_id) || null;
}

function eventForTask(data, task) {
  const metadata = taskMetadata(task);
  const taskEventId = text(metadata.taskEventId);
  return ensureList(data, "taskEvents").find((event) => event.task_event_id === taskEventId) || null;
}

function publicItem(data, task, query = {}, context = {}) {
  const metadata = taskMetadata(task);
  const event = eventForTask(data, task);
  const user = userForTask(data, task);
  const sla = taskSlaView(task, query, context);
  const advisorId = text(metadata.assignedAdvisorId);
  const advisorName = text(metadata.assignedAdvisorName, advisorId);
  return {
    taskId: task.task_id,
    taskEventId: text(metadata.taskEventId || (event && event.task_event_id)),
    rootUserId: text(metadata.rootUserId || (event && event.root_user_id) || (user && (user.root_user_id || user.user_id))),
    userId: task.user_id || "",
    userLabel: user ? user.nickname || user.phone || user.user_id : task.user_id || "",
    campaignId: text(metadata.campaignId || (event && event.campaign_id)),
    consultationType: text(metadata.consultationType),
    scene: text(metadata.scene),
    sourceChannel: text(metadata.sourceChannel || task.source_channel),
    assignedAdvisorId: advisorId,
    assignedAdvisorName: advisorName,
    assignedAdvisorRole: text(metadata.assignedAdvisorRole),
    assignedAt: text(metadata.assignedAt),
    assignmentId: text(metadata.assignmentId),
    reason: task.reason || "",
    suggestedAction: task.suggested_action || "",
    createdAt: task.created_at || "",
    taskStatus: task.status || "",
    ...sla,
    nextAction: advisorName
      ? `提醒 ${advisorName} 优先处理该咨询，并在企微联系后回写处理结果。`
      : "先分配咨询顾问，再联系用户并回写处理结果。",
  };
}

function openConsultationTasks(data) {
  return ensureList(data, "operationTasks")
    .filter((task) => task.task_type === FOLLOW_TASK_TYPE && task.status === "OPEN");
}

function matchesItem(item, query = {}) {
  const status = upper(query.status || query.slaStatus || query.sla_status);
  const advisorId = text(query.advisorId || query.advisor_id);
  const campaignId = text(query.campaignId || query.campaign_id);
  const rootUserId = text(query.rootUserId || query.root_user_id);
  const userId = text(query.userId || query.user_id);
  if (status && item.status !== status) return false;
  if (advisorId && item.assignedAdvisorId !== advisorId) return false;
  if (campaignId && item.campaignId !== campaignId) return false;
  if (rootUserId && item.rootUserId !== rootUserId) return false;
  if (userId && item.userId !== userId) return false;
  return true;
}

function summarizeItems(items, query = {}, context = {}) {
  const slaMinutes = slaMinutesFrom(query, context);
  const dueSoonMinutes = dueSoonMinutesFrom(query, context);
  const overdueItems = items.filter((item) => item.status === "OVERDUE");
  const dueSoonItems = items.filter((item) => item.status === "DUE_SOON");
  const assignedItems = items.filter((item) => item.assignedAdvisorId);
  const maxOverdue = overdueItems.reduce((max, item) => Math.max(max, Number(item.overdueMinutes || 0)), 0);
  const mostUrgent = items[0] || null;
  return {
    slaMinutes,
    dueSoonMinutes,
    openCount: items.length,
    overdueCount: overdueItems.length,
    dueSoonCount: dueSoonItems.length,
    assignedCount: assignedItems.length,
    unassignedCount: items.length - assignedItems.length,
    maxOverdueMinutes: maxOverdue,
    mostUrgentTaskId: mostUrgent ? mostUrgent.taskId : "",
    mostUrgentAdvisorName: mostUrgent ? mostUrgent.assignedAdvisorName || "" : "",
  };
}

function listConsultationSlaItems(data, query = {}, context = {}) {
  const limit = Math.max(1, Math.min(Number(query.limit || 100), 300));
  const items = openConsultationTasks(data)
    .map((task) => publicItem(data, task, query, context))
    .filter((item) => matchesItem(item, query))
    .sort((left, right) => {
      const rank = { OVERDUE: 0, DUE_SOON: 1, OPEN: 2 };
      return (rank[left.status] ?? 3) - (rank[right.status] ?? 3)
        || Number(right.overdueMinutes || 0) - Number(left.overdueMinutes || 0)
        || Number(right.ageMinutes || 0) - Number(left.ageMinutes || 0)
        || left.taskId.localeCompare(right.taskId);
    });
  return {
    summary: summarizeItems(items, query, context),
    items: items.slice(0, limit),
    total: items.length,
  };
}

function consultationSlaAlertTargets(data, query = {}, context = {}) {
  return listConsultationSlaItems(data, { ...query, status: "OVERDUE", limit: query.limit || 100 }, context)
    .items
    .map((item) => ({
      key: item.taskId,
      label: item.assignedAdvisorName
        ? `咨询待办 ${item.taskId} 已超过 SLA（${item.assignedAdvisorName}）`
        : `咨询待办 ${item.taskId} 已超过 SLA（未分配顾问）`,
      count: 1,
      consultationTaskId: item.taskId,
      consultationTaskEventId: item.taskEventId,
      rootUserId: item.rootUserId,
      userId: item.userId,
      userLabel: item.userLabel,
      campaignId: item.campaignId,
      consultationType: item.consultationType,
      assignedAdvisorId: item.assignedAdvisorId,
      assignedAdvisorName: item.assignedAdvisorName,
      assignedAdvisorRole: item.assignedAdvisorRole,
      slaStatus: item.status,
      slaMinutes: item.slaMinutes,
      ageMinutes: item.ageMinutes,
      overdueMinutes: item.overdueMinutes,
      dueAt: item.dueAt,
      createdAt: item.createdAt,
      nextAction: item.nextAction,
    }));
}

module.exports = {
  DEFAULT_CONSULTATION_SLA_MINUTES,
  consultationSlaAlertTargets,
  listConsultationSlaItems,
  summarizeItems,
  taskSlaView,
};
