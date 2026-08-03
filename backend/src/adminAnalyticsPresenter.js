const campaign = require("./campaign");
const consultationFollowup = require("./consultationFollowup");
const operationalAlerts = require("./operationalAlerts");

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function datePart(value) {
  const date = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

function inRange(value, range) {
  const date = datePart(value);
  if (!date) return true;
  if (range.dateFrom && date < range.dateFrom) return false;
  if (range.dateTo && date > range.dateTo) return false;
  return true;
}

function numberRate(count, total) {
  if (!total) return null;
  return Math.round((Number(count || 0) / total) * 1000) / 10;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function stage(key, label, count, previousCount, note) {
  return {
    key,
    label,
    count,
    conversionRate: previousCount === null ? null : numberRate(count, previousCount),
    dropoff: previousCount === null ? 0 : Math.max(0, previousCount - count),
    note,
  };
}

function countUsers(items, field = "root_user_id") {
  return unique(items.map((item) => item[field] || item.user_id)).length;
}

function sourceFor(item = {}) {
  return text(item.source_channel || item.register_source || item.channel, "UNKNOWN");
}

function dateRange(query = {}) {
  return {
    dateFrom: text(query.dateFrom || query.date_from),
    dateTo: text(query.dateTo || query.date_to),
  };
}

function campaignIdFromQuery(data, query = {}) {
  const requested = text(query.campaignId || query.campaign_id);
  if (requested) return requested;
  const active = ensureList(data, "campaignDefinitions").find((item) => item.status === "ACTIVE");
  return active ? active.campaign_id : campaign.DEFAULT_CAMPAIGN_ID;
}

function collectInput(data, query = {}) {
  const campaignId = campaignIdFromQuery(data, query);
  const range = dateRange(query);
  const rootUsers = ensureList(data, "rootUsers").filter((item) => inRange(item.created_at || item.updated_at, range));
  const questionnaireAnswers = ensureList(data, "questionnaireAnswers")
    .filter((item) => !item.campaign_id || item.campaign_id === campaignId)
    .filter((item) => inRange(item.submitted_at || item.created_at, range));
  const activityEnrollments = ensureList(data, "activityEnrollments")
    .filter((item) => !item.campaign_id || item.campaign_id === campaignId)
    .filter((item) => inRange(item.created_at || item.updated_at, range));
  const activeEnrollments = activityEnrollments.filter((item) => !["CANCELED", "REJECTED"].includes(item.status));
  const consultationItems = ensureList(data, "users")
    .flatMap((user) => consultationFollowup.listUserConsultations(data, user))
    .filter((item) => inRange(item.recordedAt, range));
  return { campaignId, range, rootUsers, questionnaireAnswers, activityEnrollments, activeEnrollments, consultationItems };
}

function buildStages(input) {
  const registeredUsers = countUsers(input.rootUsers);
  const healthProfiledUsers = countUsers(input.questionnaireAnswers);
  const activityUsers = countUsers(input.activeEnrollments);
  const consultationUsers = unique(input.consultationItems.map((item) => item.rootUserId || item.userId)).length;
  return [
    stage("registered", "完成注册", registeredUsers, null, "关注登录和手机号注册完成率"),
    stage("health_profiled", "完成健康建档或评测", healthProfiledUsers, registeredUsers, "优化 Root4U 首次建档引导"),
    stage("activity_enrolled", "完成活动报名", activityUsers, registeredUsers, "检查活动内容、场次与报名流程"),
    stage("consultation_recorded", "产生客服跟进记录", consultationUsers, registeredUsers, "确保客服咨询及时承接"),
  ];
}

function buildBottlenecks(input) {
  const pendingConsultations = input.consultationItems.filter((item) => ["PENDING", "RECORDED"].includes(item.status)).length;
  const rejectedEnrollments = input.activityEnrollments.filter((item) => item.status === "REJECTED").length;
  const canceledEnrollments = input.activityEnrollments.filter((item) => item.status === "CANCELED").length;
  return [
    {
      key: "pending_consultations",
      label: "客服待跟进",
      count: pendingConsultations,
      severity: pendingConsultations ? "warning" : "success",
      nextAction: pendingConsultations ? "进入客服跟进工作台分配并处理待办" : "客服跟进正常",
    },
    {
      key: "rejected_activity_enrollments",
      label: "活动报名未通过",
      count: rejectedEnrollments,
      severity: rejectedEnrollments ? "warning" : "success",
      nextAction: rejectedEnrollments ? "复核活动报名资格说明和拒绝原因" : "活动报名审核正常",
    },
    {
      key: "canceled_activity_enrollments",
      label: "活动报名取消",
      count: canceledEnrollments,
      severity: canceledEnrollments ? "warning" : "success",
      nextAction: canceledEnrollments ? "检查场次信息、提醒节奏和取消原因" : "活动报名稳定",
    },
  ];
}

function countByDate(items, dateField, userField = "root_user_id") {
  const buckets = new Map();
  items.forEach((item) => {
    const date = datePart(dateField(item));
    const userId = text(item[userField] || item.user_id || item.consultationId);
    if (!date || !userId) return;
    if (!buckets.has(date)) buckets.set(date, new Set());
    buckets.get(date).add(userId);
  });
  return Object.fromEntries([...buckets.entries()].map(([date, values]) => [date, values.size]));
}

function buildTrend(input) {
  const dates = unique([
    ...input.rootUsers.map((item) => datePart(item.created_at || item.updated_at)),
    ...input.questionnaireAnswers.map((item) => datePart(item.submitted_at || item.created_at)),
    ...input.activityEnrollments.map((item) => datePart(item.created_at || item.updated_at)),
    ...input.consultationItems.map((item) => datePart(item.recordedAt)),
  ]).sort();
  const registrations = countByDate(input.rootUsers, (item) => item.created_at || item.updated_at);
  const healthProfiles = countByDate(input.questionnaireAnswers, (item) => item.submitted_at || item.created_at);
  const activityEnrollments = countByDate(input.activeEnrollments, (item) => item.created_at || item.updated_at);
  const consultations = countByDate(input.consultationItems, (item) => item.recordedAt, "rootUserId");
  return dates.map((date) => ({
    date,
    registeredUsers: registrations[date] || 0,
    healthProfiledUsers: healthProfiles[date] || 0,
    activityUsers: activityEnrollments[date] || 0,
    consultationUsers: consultations[date] || 0,
  }));
}

function buildRetentionSegments(input) {
  const buckets = new Map();
  const bucket = (source) => {
    const key = text(source, "UNKNOWN");
    if (!buckets.has(key)) buckets.set(key, {
      key,
      rootUsers: new Set(),
      healthUsers: new Set(),
      activityUsers: new Set(),
    });
    return buckets.get(key);
  };
  const userSource = new Map(input.rootUsers.map((item) => [item.root_user_id, sourceFor(item)]));
  input.rootUsers.forEach((item) => bucket(sourceFor(item)).rootUsers.add(item.root_user_id));
  input.questionnaireAnswers.forEach((item) => bucket(userSource.get(item.root_user_id)).healthUsers.add(item.root_user_id));
  input.activeEnrollments.forEach((item) => bucket(userSource.get(item.root_user_id) || sourceFor(item)).activityUsers.add(item.root_user_id));
  return [...buckets.values()].map((item) => {
    const row = {
      key: item.key,
      label: item.key === "UNKNOWN" ? "未知来源" : item.key,
      rootUsers: item.rootUsers.size,
      healthUsers: item.healthUsers.size,
      activityUsers: item.activityUsers.size,
      participantUsers: item.activityUsers.size,
    };
    row.healthProfileRate = numberRate(row.healthUsers, row.rootUsers);
    row.activityEnrollmentRate = numberRate(row.activityUsers, row.rootUsers);
    row.severity = row.rootUsers && row.healthProfileRate !== null && row.healthProfileRate < 50 ? "warning" : "success";
    row.nextAction = row.severity === "warning" ? "优化该来源的注册后 Root4U 建档引导" : "保持当前来源节奏";
    return row;
  }).sort((left, right) => right.rootUsers - left.rootUsers || left.label.localeCompare(right.label));
}

function buildRecentActivity(input) {
  return [
    ...input.questionnaireAnswers.map((item) => ({
      type: "HEALTH_ASSESSMENT",
      label: item.questionnaire_id || "健康评测",
      rootUserId: item.root_user_id || "",
      occurredAt: item.submitted_at || item.created_at || "",
    })),
    ...input.activityEnrollments.map((item) => ({
      type: "ACTIVITY_ENROLLMENT",
      label: item.status || "活动报名",
      rootUserId: item.root_user_id || "",
      occurredAt: item.updated_at || item.created_at || "",
    })),
    ...input.consultationItems.map((item) => ({
      type: "CONSULTATION",
      label: item.consultationTypeLabel || "客服咨询",
      rootUserId: item.rootUserId || "",
      occurredAt: item.recordedAt || "",
    })),
  ].filter((item) => item.occurredAt)
    .sort((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt)))
    .slice(0, 20);
}

function buildCharts(stages, trend, retentionSegments) {
  const maxStage = Math.max(1, ...stages.map((item) => item.count));
  return {
    funnelBars: stages.map((item) => ({ ...item, widthRate: numberRate(item.count, maxStage) || 0 })),
    trendSeries: [
      ["registeredUsers", "完成注册"],
      ["healthProfiledUsers", "健康建档或评测"],
      ["activityUsers", "活动报名"],
      ["consultationUsers", "客服咨询"],
    ].map(([key, label]) => ({
      key,
      label,
      total: trend.reduce((sum, item) => sum + Number(item[key] || 0), 0),
      points: trend.map((item) => ({ date: item.date, value: Number(item[key] || 0) })),
    })),
    segmentBars: retentionSegments.map((item) => ({
      key: item.key,
      label: item.label,
      rootUsers: item.rootUsers,
      healthProfileRate: item.healthProfileRate,
      activityEnrollmentRate: item.activityEnrollmentRate,
      severity: item.severity,
    })),
  };
}

function buildOperationalAnalytics(data, query = {}) {
  const input = collectInput(data, query);
  const stages = buildStages(input);
  const bottlenecks = buildBottlenecks(input);
  const trend = buildTrend(input);
  const retentionSegments = buildRetentionSegments(input);
  const alertEvaluation = operationalAlerts.evaluateOperationalAlerts(data, {
    filters: { campaignId: input.campaignId, ...input.range },
    stages,
    bottlenecks,
    trend,
    retentionSegments,
  }, { campaignId: input.campaignId, ...input.range });
  return {
    filters: { campaignId: input.campaignId, ...input.range },
    generatedAt: new Date().toISOString(),
    stages,
    bottlenecks,
    alerts: alertEvaluation.alerts,
    alertRules: alertEvaluation.rules,
    alertSummary: alertEvaluation.summary,
    alertRuns: operationalAlerts.listAlertRuns(data, { campaignId: input.campaignId, limit: 10 }),
    alertNotifications: operationalAlerts.recentNotifications(data, { campaignId: input.campaignId, limit: 20 }),
    trend,
    retentionSegments,
    charts: buildCharts(stages, trend, retentionSegments),
    refresh: { defaultIntervalSeconds: 60, maxTrendDays: 93 },
    distributions: {
      registrationSource: retentionSegments.map((item) => ({ key: item.key, count: item.rootUsers, rate: numberRate(item.rootUsers, input.rootUsers.length) })),
      activityStatus: Object.entries(input.activityEnrollments.reduce((acc, item) => {
        const key = text(item.status, "UNKNOWN");
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {})).map(([key, count]) => ({ key, count, rate: numberRate(count, input.activityEnrollments.length) })),
    },
    recentActivity: buildRecentActivity(input),
    totals: {
      rootUsers: input.rootUsers.length,
      healthAssessments: input.questionnaireAnswers.length,
      activityEnrollments: input.activityEnrollments.length,
      consultations: input.consultationItems.length,
    },
  };
}

function csvCell(value) {
  const raw = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function csvLine(values) {
  return values.map(csvCell).join(",");
}

function buildOperationalAnalyticsCsv(data, query = {}) {
  const analytics = buildOperationalAnalytics(data, query);
  const lines = [csvLine(["section", "key", "label", "date", "count", "conversion_rate", "dropoff", "severity", "note"])];
  analytics.stages.forEach((item) => lines.push(csvLine(["stage", item.key, item.label, "", item.count, item.conversionRate ?? "", item.dropoff, "", item.note])));
  analytics.bottlenecks.forEach((item) => lines.push(csvLine(["bottleneck", item.key, item.label, "", item.count, "", "", item.severity, item.nextAction])));
  analytics.alerts.forEach((item) => lines.push(csvLine(["alert", item.key, item.label, "", item.count, "", "", item.severity, item.nextAction])));
  analytics.trend.forEach((item) => {
    lines.push(csvLine(["trend", "registered_users", "完成注册", item.date, item.registeredUsers, "", "", "", ""]));
    lines.push(csvLine(["trend", "health_profiled_users", "健康建档或评测", item.date, item.healthProfiledUsers, "", "", "", ""]));
    lines.push(csvLine(["trend", "activity_users", "活动报名", item.date, item.activityUsers, "", "", "", ""]));
    lines.push(csvLine(["trend", "consultation_users", "客服咨询", item.date, item.consultationUsers, "", "", "", ""]));
  });
  return `${lines.join("\n")}\n`;
}

module.exports = { buildOperationalAnalytics, buildOperationalAnalyticsCsv };
