const consultationSla = require("./consultationSla");

const UNASSIGNED_ADVISOR_ID = "__UNASSIGNED__";

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

function limitFrom(query = {}) {
  return Math.max(1, Math.min(Math.floor(numberValue(query.limit, 100)), 300));
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function normalizeAdvisor(value = {}) {
  if (typeof value === "string") {
    const [advisorId, advisorName, advisorRole] = value.split(":").map((part) => String(part || "").trim());
    return advisorId ? {
      advisorId,
      advisorName: advisorName || advisorId,
      advisorRole: advisorRole || "ADVISOR",
    } : null;
  }
  const advisorId = text(value.advisorId || value.advisor_id || value.operatorId || value.operator_id || value.id || value.name);
  if (!advisorId) return null;
  return {
    advisorId,
    advisorName: text(value.advisorName || value.advisor_name || value.name, advisorId),
    advisorRole: upper(value.advisorRole || value.advisor_role || value.role, "ADVISOR"),
  };
}

function parseAdvisorList(value) {
  if (Array.isArray(value)) return value.map(normalizeAdvisor).filter(Boolean);
  const parsed = parseJson(value, null);
  if (Array.isArray(parsed)) return parsed.map(normalizeAdvisor).filter(Boolean);
  return String(value || "")
    .split(",")
    .map((item) => normalizeAdvisor(item))
    .filter(Boolean);
}

function configuredAdvisors(context = {}) {
  const env = context.env || process.env;
  return parseAdvisorList(env.ROOT_CONSULTATION_ADVISORS || env.ROOT_ADVISORS || "");
}

function taskAssignmentAdvisors(data) {
  const advisors = new Map();
  ensureList(data, "consultationAdvisorAssignments")
    .filter((item) => item.status === "ACTIVE" && item.advisor_id)
    .forEach((item) => {
      if (!advisors.has(item.advisor_id)) {
        advisors.set(item.advisor_id, {
          advisorId: item.advisor_id,
          advisorName: item.advisor_name || item.advisor_id,
          advisorRole: item.advisor_role || "ADVISOR",
        });
      }
    });
  return Array.from(advisors.values());
}

function advisorRegistry(data, context = {}) {
  const registry = new Map();
  configuredAdvisors(context).forEach((advisor) => registry.set(advisor.advisorId, advisor));
  taskAssignmentAdvisors(data).forEach((advisor) => {
    registry.set(advisor.advisorId, {
      ...registry.get(advisor.advisorId),
      ...advisor,
    });
  });
  return registry;
}

function advisorKey(item = {}) {
  return item.assignedAdvisorId || UNASSIGNED_ADVISOR_ID;
}

function advisorBase(key, item = {}, registry = new Map()) {
  if (key === UNASSIGNED_ADVISOR_ID) {
    return {
      advisorId: "",
      advisorName: "未分配顾问",
      advisorRole: "UNASSIGNED",
      assigned: false,
    };
  }
  const registered = registry.get(key) || {};
  return {
    advisorId: key,
    advisorName: registered.advisorName || item.assignedAdvisorName || key,
    advisorRole: registered.advisorRole || item.assignedAdvisorRole || "ADVISOR",
    assigned: true,
  };
}

function urgencyScore(status) {
  if (status === "OVERDUE") return 0;
  if (status === "DUE_SOON") return 1;
  return 2;
}

function sortWorkbenchItems(items) {
  return items.slice().sort((left, right) => (
    urgencyScore(left.status) - urgencyScore(right.status)
      || Number(right.overdueMinutes || 0) - Number(left.overdueMinutes || 0)
      || Number(right.ageMinutes || 0) - Number(left.ageMinutes || 0)
      || String(left.assignedAdvisorName || "").localeCompare(String(right.assignedAdvisorName || ""))
      || String(left.taskId || "").localeCompare(String(right.taskId || ""))
  ));
}

function advisorSummary(base, items) {
  const sorted = sortWorkbenchItems(items);
  const overdue = sorted.filter((item) => item.status === "OVERDUE");
  const dueSoon = sorted.filter((item) => item.status === "DUE_SOON");
  const maxOverdueMinutes = overdue.reduce((max, item) => Math.max(max, Number(item.overdueMinutes || 0)), 0);
  const latestAssignedAt = sorted.reduce((latest, item) => {
    const assignedAt = item.assignedAt || "";
    return assignedAt > latest ? assignedAt : latest;
  }, "");
  return {
    ...base,
    openCount: sorted.length,
    overdueCount: overdue.length,
    dueSoonCount: dueSoon.length,
    normalCount: sorted.length - overdue.length - dueSoon.length,
    maxOverdueMinutes,
    latestAssignedAt,
    mostUrgentTaskId: sorted[0] ? sorted[0].taskId : "",
    mostUrgentRootUserId: sorted[0] ? sorted[0].rootUserId : "",
    status: overdue.length ? "ATTENTION" : dueSoon.length ? "WATCH" : sorted.length ? "NORMAL" : "IDLE",
    nextAction: overdue.length
      ? "优先处理已超时咨询，并在企微联系后写回结果。"
      : dueSoon.length
        ? "先处理即将超时咨询，避免进入升级提醒。"
        : sorted.length
          ? "按创建时间继续处理待跟进咨询。"
          : "暂无待跟进咨询。",
    items: sorted,
  };
}

function buildAdvisorRows(data, items, context = {}) {
  const registry = advisorRegistry(data, context);
  const groups = new Map();
  registry.forEach((advisor, id) => groups.set(id, { base: advisorBase(id, advisor, registry), items: [] }));
  items.forEach((item) => {
    const key = advisorKey(item);
    if (!groups.has(key)) groups.set(key, { base: advisorBase(key, item, registry), items: [] });
    groups.get(key).items.push(item);
  });
  return Array.from(groups.values())
    .map((group) => advisorSummary(group.base, group.items))
    .sort((left, right) => (
      Number(right.overdueCount || 0) - Number(left.overdueCount || 0)
        || Number(right.dueSoonCount || 0) - Number(left.dueSoonCount || 0)
        || Number(right.openCount || 0) - Number(left.openCount || 0)
        || String(left.advisorName || "").localeCompare(String(right.advisorName || ""))
    ));
}

function matchesWorkbenchItem(item, query = {}) {
  const advisorId = text(query.advisorId || query.advisor_id);
  const advisorStatus = upper(query.advisorStatus || query.advisor_status);
  if (advisorId === UNASSIGNED_ADVISOR_ID && item.assignedAdvisorId) return false;
  if (advisorId && advisorId !== UNASSIGNED_ADVISOR_ID && item.assignedAdvisorId !== advisorId) return false;
  if (advisorStatus === "ASSIGNED" && !item.assignedAdvisorId) return false;
  if (advisorStatus === "UNASSIGNED" && item.assignedAdvisorId) return false;
  return true;
}

function matchesAdvisorRow(row, query = {}) {
  const advisorId = text(query.advisorId || query.advisor_id);
  const advisorStatus = upper(query.advisorStatus || query.advisor_status);
  if (advisorId === UNASSIGNED_ADVISOR_ID && row.assigned) return false;
  if (advisorId && advisorId !== UNASSIGNED_ADVISOR_ID && row.advisorId !== advisorId) return false;
  if (advisorStatus === "ASSIGNED" && !row.assigned) return false;
  if (advisorStatus === "UNASSIGNED" && row.assigned) return false;
  return true;
}

function summarizeWorkbench(items, advisors, query = {}, context = {}) {
  const slaSummary = consultationSla.summarizeItems(items, query, context);
  const activeAdvisors = advisors.filter((item) => item.assigned && item.openCount > 0);
  return {
    ...slaSummary,
    advisorCount: advisors.filter((item) => item.assigned).length,
    activeAdvisorCount: activeAdvisors.length,
    idleAdvisorCount: advisors.filter((item) => item.assigned && item.openCount === 0).length,
    attentionAdvisorCount: advisors.filter((item) => item.status === "ATTENTION").length,
    watchAdvisorCount: advisors.filter((item) => item.status === "WATCH").length,
  };
}

function advisorWorkbench(data, query = {}, context = {}) {
  const limit = limitFrom(query);
  const base = consultationSla.listConsultationSlaItems(data, { ...query, limit: 300 }, context);
  const items = sortWorkbenchItems(base.items.filter((item) => matchesWorkbenchItem(item, query)));
  const advisors = buildAdvisorRows(data, items, context).filter((row) => matchesAdvisorRow(row, query));
  return {
    summary: summarizeWorkbench(items, advisors, query, context),
    advisors: advisors.map((advisor) => ({
      ...advisor,
      items: advisor.items.slice(0, Math.min(limit, 50)),
    })),
    items: items.slice(0, limit),
    total: items.length,
  };
}

module.exports = {
  UNASSIGNED_ADVISOR_ID,
  advisorWorkbench,
  parseAdvisorList,
};
