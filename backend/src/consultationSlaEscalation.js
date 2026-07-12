const { nowISO } = require("./dates");
const consultationSla = require("./consultationSla");

const DEFAULT_ESCALATION_RULES = [
  {
    stage: "ADVISOR_REMINDER",
    level: 1,
    thresholdMinutes: 0,
    label: "顾问提醒",
    ownerRole: "咨询顾问",
    severity: "warning",
    action: "提醒当前顾问优先处理该咨询，并在企微联系后写回处理结果。",
  },
  {
    stage: "OPS_ESCALATION",
    level: 2,
    thresholdMinutes: 60,
    label: "运营升级",
    ownerRole: "运营",
    severity: "danger",
    action: "运营介入确认顾问是否可处理；如顾问不可用，执行改派并记录原因。",
  },
  {
    stage: "LEAD_ESCALATION",
    level: 3,
    thresholdMinutes: 120,
    label: "负责人升级",
    ownerRole: "运营主管",
    severity: "danger",
    action: "运营主管确认处理方案，可改派、电话跟进或进入专项复盘，并保留处理留痕。",
  },
];

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

function clampMinutes(value, fallback) {
  return Math.max(0, Math.min(10080, Math.floor(numberValue(value, fallback))));
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function normalizeSeverity(value) {
  const severity = text(value, "warning").toLowerCase();
  return ["danger", "warning", "success", "info"].includes(severity) ? severity : "warning";
}

function normalizeRule(rule = {}, index = 0) {
  if (typeof rule === "string") {
    const [stage, thresholdMinutes, ownerRole, label, action] = rule.split(":").map((part) => text(part));
    if (!stage) return null;
    return normalizeRule({ stage, thresholdMinutes, ownerRole, label, action }, index);
  }
  const level = Math.max(1, Math.floor(numberValue(rule.level || rule.escalationLevel || rule.escalation_level, index + 1)));
  const thresholdMinutes = clampMinutes(
    rule.thresholdMinutes || rule.threshold_minutes || rule.overdueMinutes || rule.overdue_minutes,
    DEFAULT_ESCALATION_RULES[index]?.thresholdMinutes || 0,
  );
  const stage = upper(rule.stage || rule.escalationStage || rule.escalation_stage || `LEVEL_${level}`);
  if (!stage) return null;
  return {
    stage,
    level,
    thresholdMinutes,
    label: text(rule.label || rule.title, `L${level} 升级`),
    ownerRole: text(rule.ownerRole || rule.owner_role, "运营"),
    severity: normalizeSeverity(rule.severity),
    action: text(rule.action || rule.nextAction || rule.next_action, "按配置的升级规则处理该咨询，并记录处理结果。"),
  };
}

function configuredRules(query = {}, context = {}) {
  const env = context.env || process.env;
  const raw = query.escalationRules || query.escalation_rules || env.ROOT_CONSULTATION_SLA_ESCALATION_RULES;
  const parsed = parseJson(raw, null);
  const candidates = Array.isArray(parsed)
    ? parsed
    : parsed && Array.isArray(parsed.rules)
      ? parsed.rules
      : DEFAULT_ESCALATION_RULES;
  const rules = candidates.map(normalizeRule).filter(Boolean);
  const fallback = rules.length ? rules : DEFAULT_ESCALATION_RULES.map(normalizeRule);
  return fallback
    .sort((left, right) => left.thresholdMinutes - right.thresholdMinutes || left.level - right.level)
    .map((rule, index) => ({ ...rule, rank: index + 1 }));
}

function addMinutes(value, minutes) {
  const start = Date.parse(String(value || ""));
  if (!Number.isFinite(start)) return "";
  return nowISO(new Date(start + Number(minutes || 0) * 60000));
}

function escalationFor(item, rules) {
  const overdueMinutes = Number(item.overdueMinutes || 0);
  const current = rules.reduce((match, rule) => (
    overdueMinutes >= Number(rule.thresholdMinutes || 0) ? rule : match
  ), rules[0]);
  const next = rules.find((rule) => Number(rule.thresholdMinutes || 0) > overdueMinutes) || null;
  return { current, next };
}

function publicItem(item, rules) {
  const { current, next } = escalationFor(item, rules);
  return {
    ...item,
    escalationStage: current.stage,
    escalationLevel: current.level,
    escalationRank: current.rank,
    escalationLabel: current.label,
    escalationOwnerRole: current.ownerRole,
    escalationSeverity: current.severity,
    escalationThresholdMinutes: current.thresholdMinutes,
    escalationAction: current.action,
    nextAction: current.action,
    nextEscalationStage: next ? next.stage : "",
    nextEscalationLabel: next ? next.label : "",
    nextEscalationOwnerRole: next ? next.ownerRole : "",
    nextEscalationInMinutes: next ? Math.max(0, Number(next.thresholdMinutes || 0) - Number(item.overdueMinutes || 0)) : null,
    nextEscalationAt: next ? addMinutes(item.dueAt, next.thresholdMinutes) : "",
  };
}

function matchesEscalationItem(item, query = {}) {
  const advisorId = text(query.advisorId || query.advisor_id);
  const advisorStatus = upper(query.advisorStatus || query.advisor_status);
  const stage = upper(query.escalationStage || query.escalation_stage || query.stage);
  const ownerRole = text(query.ownerRole || query.owner_role);
  const minLevel = numberValue(query.minLevel || query.min_level, 0);
  const level = numberValue(query.escalationLevel || query.escalation_level || query.level, 0);
  if (advisorId === "__UNASSIGNED__" && item.assignedAdvisorId) return false;
  if (advisorId && advisorId !== "__UNASSIGNED__" && item.assignedAdvisorId !== advisorId) return false;
  if (advisorStatus === "ASSIGNED" && !item.assignedAdvisorId) return false;
  if (advisorStatus === "UNASSIGNED" && item.assignedAdvisorId) return false;
  if (stage && item.escalationStage !== stage) return false;
  if (ownerRole && item.escalationOwnerRole !== ownerRole) return false;
  if (minLevel && Number(item.escalationLevel || 0) < minLevel) return false;
  if (level && Number(item.escalationLevel || 0) !== level) return false;
  return true;
}

function summarizeItems(items, rules) {
  const stageCounts = items.reduce((acc, item) => {
    acc[item.escalationStage] = (acc[item.escalationStage] || 0) + 1;
    return acc;
  }, {});
  const maxOverdue = items.reduce((max, item) => Math.max(max, Number(item.overdueMinutes || 0)), 0);
  const highestLevel = items.reduce((max, item) => Math.max(max, Number(item.escalationLevel || 0)), 0);
  return {
    overdueCount: items.length,
    escalatedCount: items.filter((item) => Number(item.escalationLevel || 0) >= 2).length,
    level1Count: items.filter((item) => Number(item.escalationLevel || 0) === 1).length,
    level2Count: items.filter((item) => Number(item.escalationLevel || 0) === 2).length,
    level3Count: items.filter((item) => Number(item.escalationLevel || 0) >= 3).length,
    highestEscalationLevel: highestLevel,
    maxOverdueMinutes: maxOverdue,
    ownerRoles: Array.from(new Set(items.map((item) => item.escalationOwnerRole).filter(Boolean))),
    stageCounts,
    rules: rules.map((rule) => ({
      stage: rule.stage,
      level: rule.level,
      thresholdMinutes: rule.thresholdMinutes,
      label: rule.label,
      ownerRole: rule.ownerRole,
      severity: rule.severity,
      action: rule.action,
    })),
  };
}

function listConsultationSlaEscalations(data, query = {}, context = {}) {
  const limit = Math.max(1, Math.min(Number(query.limit || 100), 300));
  const rules = configuredRules(query, context);
  const base = consultationSla.listConsultationSlaItems(data, { ...query, status: "OVERDUE", limit: 300 }, context);
  const items = base.items
    .map((item) => publicItem(item, rules))
    .filter((item) => matchesEscalationItem(item, query))
    .sort((left, right) => (
      Number(right.escalationLevel || 0) - Number(left.escalationLevel || 0)
        || Number(right.overdueMinutes || 0) - Number(left.overdueMinutes || 0)
        || String(left.assignedAdvisorName || "").localeCompare(String(right.assignedAdvisorName || ""))
        || String(left.taskId || "").localeCompare(String(right.taskId || ""))
    ));
  return {
    summary: summarizeItems(items, rules),
    items: items.slice(0, limit),
    total: items.length,
  };
}

function consultationSlaEscalationAlertTargets(data, query = {}, context = {}) {
  return listConsultationSlaEscalations(data, { ...query, limit: query.limit || 100 }, context)
    .items
    .map((item) => ({
      key: item.taskId,
      label: `${item.escalationLabel}：咨询待办 ${item.taskId} 已超时 ${item.overdueMinutes} 分钟`,
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
      escalationStage: item.escalationStage,
      escalationLevel: item.escalationLevel,
      escalationLabel: item.escalationLabel,
      escalationOwnerRole: item.escalationOwnerRole,
      escalationSeverity: item.escalationSeverity,
      escalationThresholdMinutes: item.escalationThresholdMinutes,
      nextEscalationStage: item.nextEscalationStage,
      nextEscalationAt: item.nextEscalationAt,
      nextEscalationInMinutes: item.nextEscalationInMinutes,
      nextAction: item.escalationAction,
    }));
}

module.exports = {
  DEFAULT_ESCALATION_RULES,
  consultationSlaEscalationAlertTargets,
  listConsultationSlaEscalations,
};
