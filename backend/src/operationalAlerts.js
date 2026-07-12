const { nowISO } = require("./dates");
const { createId } = require("./seed");
const adminLifecycleSettlementJobs = require("./adminLifecycleSettlementJobs");
const adminLifecycleUserExports = require("./adminLifecycleUserExports");
const consultationSla = require("./consultationSla");
const consultationSlaEscalation = require("./consultationSlaEscalation");
const operationalAlertWebhookAdapter = require("./operationalAlertWebhookAdapter");

const DEFAULT_ALERT_RULES = [
  {
    alert_rule_id: "op_alert_unresolved_leads",
    title: "企微线索未补链",
    target_type: "BOTTLENECK",
    target_key: "unresolved_leads",
    metric_key: "count",
    operator: ">",
    threshold_value: 0,
    severity: "warning",
    channel: "IN_APP",
    owner_role: "运营",
    cooldown_minutes: 60,
    status: "ACTIVE",
  },
  {
    alert_rule_id: "op_alert_joined_without_task",
    title: "参与后未开始任务",
    target_type: "BOTTLENECK",
    target_key: "joined_without_task",
    metric_key: "count",
    operator: ">",
    threshold_value: 0,
    severity: "warning",
    channel: "IN_APP",
    owner_role: "运营",
    cooldown_minutes: 60,
    status: "ACTIVE",
  },
  {
    alert_rule_id: "op_alert_jump_without_bound_order",
    title: "跳有赞后订单未补链",
    target_type: "BOTTLENECK",
    target_key: "jump_without_bound_order",
    metric_key: "count",
    operator: ">",
    threshold_value: 0,
    severity: "warning",
    channel: "IN_APP",
    owner_role: "运营",
    cooldown_minutes: 60,
    status: "ACTIVE",
  },
  {
    alert_rule_id: "op_alert_ready_without_settlement",
    title: "达标未结算",
    target_type: "BOTTLENECK",
    target_key: "ready_without_settlement",
    metric_key: "count",
    operator: ">",
    threshold_value: 0,
    severity: "danger",
    channel: "IN_APP",
    owner_role: "运营",
    cooldown_minutes: 60,
    status: "ACTIVE",
  },
  {
    alert_rule_id: "op_alert_pending_rewards",
    title: "奖励待处理",
    target_type: "BOTTLENECK",
    target_key: "pending_rewards",
    metric_key: "count",
    operator: ">",
    threshold_value: 0,
    severity: "danger",
    channel: "IN_APP",
    owner_role: "运营",
    cooldown_minutes: 60,
    status: "ACTIVE",
  },
  {
    alert_rule_id: "op_alert_stage_conversion_low",
    title: "阶段转化偏低",
    target_type: "STAGE_CONVERSION",
    target_key: "*",
    metric_key: "conversionRate",
    operator: "<",
    threshold_value: 70,
    critical_threshold_value: 40,
    severity: "warning",
    channel: "IN_APP",
    owner_role: "运营",
    cooldown_minutes: 60,
    status: "ACTIVE",
  },
  {
    alert_rule_id: "op_alert_segment_task_start_low",
    title: "来源任务启动偏低",
    target_type: "SEGMENT_RATE",
    target_key: "*",
    metric_key: "taskStartRate",
    operator: "<",
    threshold_value: 50,
    critical_threshold_value: 30,
    severity: "warning",
    channel: "IN_APP",
    owner_role: "运营",
    cooldown_minutes: 60,
    status: "ACTIVE",
  },
  {
    alert_rule_id: "op_alert_adapter_retry_exhausted",
    title: "Adapter 重试耗尽",
    target_type: "ADAPTER_RETRY_EXHAUSTED",
    target_key: "*",
    metric_key: "retryAttempt",
    operator: ">=",
    threshold_value: 5,
    severity: "danger",
    channel: "IN_APP",
    owner_role: "研发",
    cooldown_minutes: 60,
    status: "ACTIVE",
  },
  {
    alert_rule_id: "op_alert_lifecycle_settlement_job_failed",
    title: "生命周期结算队列失败",
    target_type: "LIFECYCLE_SETTLEMENT_JOB_FAILED",
    target_key: "*",
    metric_key: "failedCount",
    operator: ">",
    threshold_value: 0,
    severity: "danger",
    channel: "IN_APP",
    owner_role: "运营主管",
    cooldown_minutes: 60,
    status: "ACTIVE",
  },
  {
    alert_rule_id: "op_alert_lifecycle_settlement_job_stalled",
    title: "生命周期结算队列长时间未推进",
    target_type: "LIFECYCLE_SETTLEMENT_JOB_STALLED",
    target_key: "*",
    metric_key: "ageMinutes",
    operator: ">=",
    threshold_value: 60,
    severity: "warning",
    channel: "IN_APP",
    owner_role: "运营",
    cooldown_minutes: 60,
    status: "ACTIVE",
  },
  {
    alert_rule_id: "op_alert_lifecycle_export_delivery_dead_letter",
    title: "生命周期导出交付死信",
    target_type: "LIFECYCLE_EXPORT_DELIVERY_HEALTH",
    target_key: "DEAD_LETTER",
    metric_key: "deadLetterCount",
    operator: ">",
    threshold_value: 0,
    severity: "danger",
    channel: "IN_APP",
    owner_role: "运营主管",
    cooldown_minutes: 60,
    status: "ACTIVE",
  },
  {
    alert_rule_id: "op_alert_lifecycle_export_delivery_due_retry",
    title: "生命周期导出交付到期重试",
    target_type: "LIFECYCLE_EXPORT_DELIVERY_HEALTH",
    target_key: "DUE_RETRY",
    metric_key: "dueRetryCount",
    operator: ">",
    threshold_value: 0,
    severity: "warning",
    channel: "IN_APP",
    owner_role: "运营",
    cooldown_minutes: 60,
    status: "ACTIVE",
  },
  {
    alert_rule_id: "op_alert_consultation_sla_overdue",
    title: "咨询 SLA 超时",
    target_type: "CONSULTATION_SLA_OVERDUE",
    target_key: "*",
    metric_key: "overdueMinutes",
    operator: ">",
    threshold_value: 0,
    critical_threshold_value: 60,
    severity: "warning",
    channel: "IN_APP",
    owner_role: "运营",
    cooldown_minutes: 30,
    status: "ACTIVE",
  },
  {
    alert_rule_id: "op_alert_consultation_sla_escalation",
    title: "咨询 SLA 升级",
    target_type: "CONSULTATION_SLA_ESCALATION",
    target_key: "*",
    metric_key: "escalationLevel",
    operator: ">=",
    threshold_value: 2,
    critical_threshold_value: 3,
    severity: "danger",
    channel: "IN_APP",
    owner_role: "运营主管",
    cooldown_minutes: 30,
    status: "ACTIVE",
  },
];

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeOperator(value) {
  const operator = text(value, ">").toUpperCase();
  if ([">", ">=", "<", "<=", "=", "=="].includes(operator)) return operator === "==" ? "=" : operator;
  return ">";
}

function normalizeTargetType(value) {
  const type = text(value, "BOTTLENECK").toUpperCase();
  return [
    "BOTTLENECK",
    "STAGE_CONVERSION",
    "SEGMENT_RATE",
    "ADAPTER_RETRY_EXHAUSTED",
    "LIFECYCLE_SETTLEMENT_JOB_FAILED",
    "LIFECYCLE_SETTLEMENT_JOB_STALLED",
    "LIFECYCLE_EXPORT_DELIVERY_HEALTH",
    "CONSULTATION_SLA_OVERDUE",
    "CONSULTATION_SLA_ESCALATION",
  ].includes(type) ? type : "BOTTLENECK";
}

function normalizeSeverity(value) {
  const severity = text(value, "warning").toLowerCase();
  return ["danger", "warning", "success", "info"].includes(severity) ? severity : "warning";
}

function normalizeStatus(value) {
  const status = text(value, "ACTIVE").toUpperCase();
  return status === "DISABLED" ? "DISABLED" : "ACTIVE";
}

function normalizeChannel(value) {
  const channel = text(value, "IN_APP").toUpperCase();
  return ["IN_APP", "WEBHOOK"].includes(channel) ? channel : "IN_APP";
}

function clone(value) {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function defaultRulePayload(rule) {
  const timestamp = nowISO();
  return {
    campaign_id: "",
    description: "",
    webhook_url: "",
    owner_role: "",
    owner_name: "",
    owner_contact: "",
    route_key: "",
    config_json: {},
    created_at: timestamp,
    updated_at: timestamp,
    ...clone(rule),
    default: true,
  };
}

function normalizeRule(input = {}, existing = null) {
  const timestamp = nowISO();
  const targetType = normalizeTargetType(input.targetType || input.target_type || (existing && existing.target_type));
  const targetKey = text(input.targetKey || input.target_key || (existing && existing.target_key), targetType === "BOTTLENECK" ? "unresolved_leads" : "*");
  const metricFallback = targetType === "BOTTLENECK"
    ? "count"
    : targetType === "ADAPTER_RETRY_EXHAUSTED"
      ? "retryAttempt"
      : targetType === "LIFECYCLE_SETTLEMENT_JOB_FAILED"
        ? "failedCount"
        : targetType === "LIFECYCLE_SETTLEMENT_JOB_STALLED"
          ? "ageMinutes"
          : targetType === "LIFECYCLE_EXPORT_DELIVERY_HEALTH"
            ? "deliveryIssueCount"
            : targetType === "CONSULTATION_SLA_OVERDUE"
              ? "overdueMinutes"
              : targetType === "CONSULTATION_SLA_ESCALATION"
                ? "escalationLevel"
              : "conversionRate";
  const metricKey = text(input.metricKey || input.metric_key || (existing && existing.metric_key), metricFallback);
  const alertRuleId = text(input.alertRuleId || input.alert_rule_id || (existing && existing.alert_rule_id), [
    "op_alert",
    targetType.toLowerCase(),
    targetKey.replace(/[^a-zA-Z0-9_]+/g, "_").toLowerCase(),
    metricKey.replace(/[^a-zA-Z0-9_]+/g, "_").toLowerCase(),
  ].join("_"));
  const criticalThresholdValue = input.criticalThresholdValue ?? input.critical_threshold_value ?? (existing ? existing.critical_threshold_value : undefined);
  return {
    alert_rule_id: alertRuleId,
    campaign_id: text(input.campaignId || input.campaign_id || (existing && existing.campaign_id)),
    title: text(input.title || (existing && existing.title), "运营预警"),
    description: text(input.description || (existing && existing.description)),
    target_type: targetType,
    target_key: targetKey,
    metric_key: metricKey,
    operator: normalizeOperator(input.operator || (existing && existing.operator)),
    threshold_value: numberValue(input.thresholdValue ?? input.threshold_value ?? (existing && existing.threshold_value), 0),
    critical_threshold_value: criticalThresholdValue !== undefined
      ? numberValue(criticalThresholdValue, 0)
      : null,
    severity: normalizeSeverity(input.severity || (existing && existing.severity)),
    channel: normalizeChannel(input.channel || (existing && existing.channel)),
    cooldown_minutes: Math.max(0, Math.min(numberValue(input.cooldownMinutes ?? input.cooldown_minutes ?? (existing && existing.cooldown_minutes), 60), 10080)),
    webhook_url: text(input.webhookUrl || input.webhook_url || (existing && existing.webhook_url)),
    owner_role: text(input.ownerRole || input.owner_role || (existing && existing.owner_role)),
    owner_name: text(input.ownerName || input.owner_name || (existing && existing.owner_name)),
    owner_contact: text(input.ownerContact || input.owner_contact || (existing && existing.owner_contact)),
    route_key: text(input.routeKey || input.route_key || (existing && existing.route_key), `${targetType}:${targetKey}`),
    status: normalizeStatus(input.status || (existing && existing.status)),
    config_json: input.config || input.config_json || (existing && existing.config_json) || {},
    created_at: existing && existing.created_at || timestamp,
    updated_at: timestamp,
    default: false,
  };
}

function publicRule(rule) {
  return {
    alertRuleId: rule.alert_rule_id,
    campaignId: rule.campaign_id || "",
    title: rule.title,
    description: rule.description || "",
    targetType: rule.target_type,
    targetKey: rule.target_key,
    metricKey: rule.metric_key,
    operator: rule.operator,
    thresholdValue: rule.threshold_value,
    criticalThresholdValue: rule.critical_threshold_value ?? null,
    severity: rule.severity,
    channel: rule.channel,
    cooldownMinutes: rule.cooldown_minutes,
    webhookUrl: rule.webhook_url || "",
    ownerRole: rule.owner_role || "",
    ownerName: rule.owner_name || "",
    ownerContact: rule.owner_contact || "",
    routeKey: rule.route_key || "",
    status: rule.status,
    default: Boolean(rule.default),
    updatedAt: rule.updated_at || "",
  };
}

function listStoredAlertRules(data) {
  return ensureList(data, "operationalAlertRules");
}

function listEffectiveAlertRules(data, query = {}) {
  const campaignId = text(query.campaignId || query.campaign_id);
  const rulesById = new Map(DEFAULT_ALERT_RULES.map((rule) => [rule.alert_rule_id, defaultRulePayload(rule)]));
  listStoredAlertRules(data).forEach((rule) => {
    rulesById.set(rule.alert_rule_id, normalizeRule(rule, rulesById.get(rule.alert_rule_id) || null));
  });
  return Array.from(rulesById.values())
    .filter((rule) => !rule.campaign_id || !campaignId || rule.campaign_id === campaignId)
    .sort((left, right) => {
      const statusRank = { ACTIVE: 0, DISABLED: 1 };
      return (statusRank[left.status] ?? 2) - (statusRank[right.status] ?? 2)
        || left.target_type.localeCompare(right.target_type)
        || left.target_key.localeCompare(right.target_key);
    });
}

function compareMetric(value, operator, threshold) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return false;
  const numericValue = Number(value);
  const numericThreshold = Number(threshold);
  if (operator === ">") return numericValue > numericThreshold;
  if (operator === ">=") return numericValue >= numericThreshold;
  if (operator === "<") return numericValue < numericThreshold;
  if (operator === "<=") return numericValue <= numericThreshold;
  return numericValue === numericThreshold;
}

function severityForRule(rule, metricValue) {
  if (rule.critical_threshold_value === null || rule.critical_threshold_value === undefined) return rule.severity;
  if (["<", "<="].includes(rule.operator) && metricValue <= Number(rule.critical_threshold_value)) return "danger";
  if ([">", ">="].includes(rule.operator) && metricValue >= Number(rule.critical_threshold_value)) return "danger";
  return rule.severity;
}

function retryChildSourceIds(runs) {
  return new Set((runs || []).map((run) => run.retry_source_run_id).filter(Boolean));
}

function adapterRetryExhaustedTargets(data) {
  const runs = ensureList(data, "externalAdapterRuns");
  const childSourceIds = retryChildSourceIds(runs);
  return runs
    .filter((run) => run.status === "FAILED" && run.retry_status === "RETRYABLE")
    .filter((run) => !childSourceIds.has(run.run_id))
    .map((run) => ({
      key: run.run_id,
      label: `${run.source_type || "UNKNOWN"} / ${run.adapter_kind || "UNKNOWN"} 重试耗尽`,
      sourceType: run.source_type || "",
      adapterKind: run.adapter_kind || "",
      retryAttempt: Number(run.retry_attempt || 0),
      count: 1,
      retryReason: run.retry_reason || run.error_message || "",
      nextRetryAt: run.next_retry_at || "",
      startedAt: run.started_at || "",
      nextAction: "检查 Adapter 配置、字段映射或外部平台状态；必要时切回 MANUAL_SAMPLE，并在修正后先 PREVIEW 再 IMPORT。",
    }));
}

function minutesSince(value, nowText = nowISO()) {
  const base = Date.parse(String(value || ""));
  const now = Date.parse(nowText);
  if (!Number.isFinite(base) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.floor((now - base) / 60000));
}

function lifecycleSettlementJobTargets(data, targetType) {
  const nowText = nowISO();
  return ensureList(data, "adminLifecycleSettlementJobs")
    .map((job) => adminLifecycleSettlementJobs.toJobPayload(job))
    .filter((job) => {
      if (targetType === "LIFECYCLE_SETTLEMENT_JOB_FAILED") {
        return job.status === "FAILED" || job.status === "COMPLETED_WITH_ERRORS" || Number(job.summary?.failed || 0) > 0;
      }
      if (targetType === "LIFECYCLE_SETTLEMENT_JOB_STALLED") {
        return ["QUEUED", "RUNNING"].includes(job.status) && Number(job.summary?.pending || 0) > 0;
      }
      return false;
    })
    .map((job) => {
      const failedCount = Number(job.summary?.failed || 0);
      const pendingCount = Number(job.summary?.pending || 0);
      const ageMinutes = minutesSince(job.updatedAt || job.startedAt || job.createdAt, nowText);
      return {
        key: job.jobId,
        label: targetType === "LIFECYCLE_SETTLEMENT_JOB_FAILED"
          ? `生命周期结算队列 ${job.jobId} 有失败项`
          : `生命周期结算队列 ${job.jobId} 长时间未推进`,
        campaignId: job.campaignId || "",
        lifecycleJobId: job.jobId,
        lifecycleJobStatus: job.status,
        failedCount,
        pendingCount,
        processedCount: Number(job.summary?.processed || 0),
        selectedCount: Number(job.summary?.selected || 0),
        ageMinutes,
        count: targetType === "LIFECYCLE_SETTLEMENT_JOB_FAILED" ? Math.max(1, failedCount) : pendingCount,
        errorMessage: job.errorMessage || "",
        nextAction: targetType === "LIFECYCLE_SETTLEMENT_JOB_FAILED"
          ? "打开用户生命周期队列抽屉，核对失败项后执行重试失败；如为规则或字段问题，先修正配置再重试。"
          : "打开用户生命周期队列抽屉，确认是否需要继续调度执行、取消队列或拆小批次处理。",
      };
    });
}

function firstExportDeliveryIssue(health, predicate) {
  return (health.recentIssues || []).find(predicate) || {};
}

function firstExportDeliveryReason(health, fallback = "") {
  const reason = (health.failureReasons || [])[0];
  return reason && reason.reason || fallback;
}

function lifecycleExportDeliveryHealthTargets(data) {
  const health = adminLifecycleUserExports.getLifecycleExportDeliveryHealth(data, { now: nowISO(), issueLimit: 20 });
  const summary = health.summary || {};
  const baseTarget = {
    healthStatus: health.status || "",
    deliveryIssueCount: Number(summary.actionableCount || 0),
    failedCount: Number(summary.failedCount || 0),
    retryScheduledCount: Number(summary.retryScheduledCount || 0),
    dueRetryCount: Number(summary.dueRetryCount || 0),
    deadLetterCount: Number(summary.deadLetterCount || 0),
    skippedCount: Number(summary.skippedCount || 0),
    requestedCount: Number(summary.requestedCount || 0),
    deliveredCount: Number(summary.deliveredCount || 0),
    successRate: Number(summary.successRate || 0),
    nextRetryAt: health.nextRetryAt || "",
  };
  const targets = [];
  if (baseTarget.deadLetterCount > 0) {
    const issue = firstExportDeliveryIssue(health, (item) => item.status === "DEAD_LETTER");
    targets.push({
      ...baseTarget,
      key: "DEAD_LETTER",
      label: "用户生命周期导出交付存在死信",
      deliveryStatus: "DEAD_LETTER",
      count: baseTarget.deadLetterCount,
      exportId: issue.exportId || "",
      exportFilename: issue.filename || "",
      deliveryChannel: issue.channel || "",
      attemptCount: Number(issue.attemptCount || 0),
      maxAttempts: Number(issue.maxAttempts || 0),
      deadLetterReason: issue.deadLetterReason || issue.error || firstExportDeliveryReason(health, "delivery dead letter"),
      errorMessage: issue.deadLetterReason || issue.error || firstExportDeliveryReason(health, ""),
      nextAction: "打开用户生命周期导出记录抽屉，查看死信记录和失败原因；修正通道配置后重新交付或重建导出。",
    });
  }
  if (baseTarget.dueRetryCount > 0) {
    const issue = firstExportDeliveryIssue(health, (item) => item.status === "RETRY_SCHEDULED" && item.dueRetry);
    targets.push({
      ...baseTarget,
      key: "DUE_RETRY",
      label: "用户生命周期导出交付到期重试",
      deliveryStatus: "RETRY_SCHEDULED",
      count: baseTarget.dueRetryCount,
      exportId: issue.exportId || "",
      exportFilename: issue.filename || "",
      deliveryChannel: issue.channel || "",
      attemptCount: Number(issue.attemptCount || 0),
      maxAttempts: Number(issue.maxAttempts || 0),
      errorMessage: issue.error || firstExportDeliveryReason(health, ""),
      nextRetryAt: issue.nextRetryAt || health.nextRetryAt || "",
      nextAction: "运行用户生命周期导出交付重试 Job，或在导出记录抽屉中确认通道配置后手动重试。",
    });
  }
  return targets;
}

function targetsForRule(rule, analytics = {}, data = {}) {
  if (rule.target_type === "BOTTLENECK") return analytics.bottlenecks || [];
  if (rule.target_type === "STAGE_CONVERSION") return (analytics.stages || []).filter((stage) => stage.conversionRate !== null && stage.dropoff > 0);
  if (rule.target_type === "SEGMENT_RATE") return (analytics.retentionSegments || []).filter((segment) => Number(segment.participantUsers || 0) > 0);
  if (rule.target_type === "ADAPTER_RETRY_EXHAUSTED") return adapterRetryExhaustedTargets(data);
  if (rule.target_type === "LIFECYCLE_SETTLEMENT_JOB_FAILED") return lifecycleSettlementJobTargets(data, rule.target_type);
  if (rule.target_type === "LIFECYCLE_SETTLEMENT_JOB_STALLED") return lifecycleSettlementJobTargets(data, rule.target_type);
  if (rule.target_type === "LIFECYCLE_EXPORT_DELIVERY_HEALTH") return lifecycleExportDeliveryHealthTargets(data);
  if (rule.target_type === "CONSULTATION_SLA_OVERDUE") return consultationSla.consultationSlaAlertTargets(data, { campaignId: rule.campaign_id || "" });
  if (rule.target_type === "CONSULTATION_SLA_ESCALATION") return consultationSlaEscalation.consultationSlaEscalationAlertTargets(data, { campaignId: rule.campaign_id || "" });
  return [];
}

function alertKey(rule, target) {
  if (rule.target_type === "BOTTLENECK") return `bottleneck_${target.key}`;
  if (rule.target_type === "STAGE_CONVERSION") return `conversion_${target.key}`;
  if (rule.target_type === "ADAPTER_RETRY_EXHAUSTED") return `adapter_retry_exhausted_${target.key}`;
  if (rule.target_type === "LIFECYCLE_SETTLEMENT_JOB_FAILED") return `lifecycle_settlement_job_failed_${target.key}`;
  if (rule.target_type === "LIFECYCLE_SETTLEMENT_JOB_STALLED") return `lifecycle_settlement_job_stalled_${target.key}`;
  if (rule.target_type === "LIFECYCLE_EXPORT_DELIVERY_HEALTH") return `lifecycle_export_delivery_health_${String(target.key || "unknown").toLowerCase()}`;
  if (rule.target_type === "CONSULTATION_SLA_OVERDUE") return `consultation_sla_overdue_${target.key}`;
  if (rule.target_type === "CONSULTATION_SLA_ESCALATION") return `consultation_sla_escalation_${target.key}_${String(target.escalationStage || target.escalationLevel || "unknown").toLowerCase()}`;
  return `segment_${rule.metric_key}_${target.key}`;
}

function alertCount(rule, target) {
  if (rule.target_type === "BOTTLENECK") return Number(target.count || 0);
  if (rule.target_type === "STAGE_CONVERSION") return Number(target.dropoff || 0);
  if (rule.target_type === "ADAPTER_RETRY_EXHAUSTED") return 1;
  if (rule.target_type === "LIFECYCLE_SETTLEMENT_JOB_FAILED") return Number(target.failedCount || target.count || 0);
  if (rule.target_type === "LIFECYCLE_SETTLEMENT_JOB_STALLED") return Number(target.pendingCount || target.count || 0);
  if (rule.target_type === "LIFECYCLE_EXPORT_DELIVERY_HEALTH") return Number(target.count || target.deliveryIssueCount || 0);
  if (rule.target_type === "CONSULTATION_SLA_OVERDUE") return Number(target.count || 1);
  if (rule.target_type === "CONSULTATION_SLA_ESCALATION") return Number(target.count || 1);
  return Number(target.participantUsers || 0);
}

function alertMessage(rule, target, metricValue) {
  const thresholdText = `${rule.metric_key} ${rule.operator} ${rule.threshold_value}`;
  if (rule.target_type === "BOTTLENECK") return `${target.label} ${metricValue} 条，触发阈值 ${thresholdText}`;
  if (rule.target_type === "STAGE_CONVERSION") return `${target.label}转化率 ${metricValue}%，触发阈值 ${thresholdText}`;
  if (rule.target_type === "ADAPTER_RETRY_EXHAUSTED") return `${target.label} 已重试 ${metricValue} 次，触发阈值 ${thresholdText}`;
  if (rule.target_type === "LIFECYCLE_SETTLEMENT_JOB_FAILED") return `${target.label}，失败 ${metricValue} 个，触发阈值 ${thresholdText}`;
  if (rule.target_type === "LIFECYCLE_SETTLEMENT_JOB_STALLED") return `${target.label}，已等待 ${metricValue} 分钟，触发阈值 ${thresholdText}`;
  if (rule.target_type === "LIFECYCLE_EXPORT_DELIVERY_HEALTH") return `${target.label} ${metricValue} 条，触发阈值 ${thresholdText}`;
  if (rule.target_type === "CONSULTATION_SLA_OVERDUE") return `${target.label}，已超时 ${metricValue} 分钟，触发阈值 ${thresholdText}`;
  if (rule.target_type === "CONSULTATION_SLA_ESCALATION") return `${target.label}，升级等级 ${metricValue}，触发阈值 ${thresholdText}`;
  return `${target.label}${rule.metric_key} ${metricValue}%，触发阈值 ${thresholdText}`;
}

function targetMatchesRule(rule, target) {
  return rule.target_key === "*"
    || target.key === rule.target_key
    || target.sourceType === rule.target_key
    || target.adapterKind === rule.target_key
    || target.campaignId === rule.target_key
    || target.lifecycleJobStatus === rule.target_key
    || target.deliveryStatus === rule.target_key
    || target.deliveryChannel === rule.target_key
    || target.assignedAdvisorId === rule.target_key
    || target.assignedAdvisorRole === rule.target_key
    || target.escalationStage === rule.target_key
    || target.escalationOwnerRole === rule.target_key
    || target.consultationType === rule.target_key;
}

function evaluateOperationalAlerts(data, analytics = {}, query = {}) {
  const campaignId = text(query.campaignId || query.campaign_id || analytics.filters && analytics.filters.campaignId);
  const rules = listEffectiveAlertRules(data, { campaignId });
  const alerts = [];
  rules
    .filter((rule) => rule.status === "ACTIVE")
    .forEach((rule) => {
      targetsForRule(rule, analytics, data)
        .filter((target) => targetMatchesRule(rule, target))
        .forEach((target) => {
          const metricValue = target[rule.metric_key];
          if (!compareMetric(metricValue, rule.operator, rule.threshold_value)) return;
          const severity = severityForRule(rule, Number(metricValue));
          alerts.push({
            key: alertKey(rule, target),
            ruleId: rule.alert_rule_id,
            targetType: rule.target_type,
            targetKey: target.key,
            metricKey: rule.metric_key,
            metricValue,
            thresholdValue: rule.threshold_value,
            operator: rule.operator,
            severity,
            label: rule.target_type === "STAGE_CONVERSION" ? `${target.label}转化偏低` : target.label || rule.title,
            count: alertCount(rule, target),
            message: alertMessage(rule, target, metricValue),
            nextAction: target.nextAction || target.note || rule.description || "查看运营数据并处理对应用户或外部 Adapter",
            channel: rule.channel,
            cooldownMinutes: rule.cooldown_minutes,
            ownerRole: rule.owner_role || "",
            ownerName: rule.owner_name || "",
            ownerContact: rule.owner_contact || "",
            routeKey: rule.route_key || `${rule.target_type}:${rule.target_key}`,
            sourceType: target.sourceType || "",
            adapterKind: target.adapterKind || "",
            sourceRunId: rule.target_type === "ADAPTER_RETRY_EXHAUSTED" ? target.key : "",
            retryReason: target.retryReason || "",
            nextRetryAt: target.nextRetryAt || "",
            lifecycleJobId: target.lifecycleJobId || "",
            lifecycleJobStatus: target.lifecycleJobStatus || "",
            exportId: target.exportId || "",
            exportFilename: target.exportFilename || "",
            deliveryChannel: target.deliveryChannel || "",
            deliveryStatus: target.deliveryStatus || "",
            deliveryIssueCount: target.deliveryIssueCount || 0,
            consultationTaskId: target.consultationTaskId || "",
            consultationTaskEventId: target.consultationTaskEventId || "",
            consultationType: target.consultationType || "",
            assignedAdvisorId: target.assignedAdvisorId || "",
            assignedAdvisorName: target.assignedAdvisorName || "",
            assignedAdvisorRole: target.assignedAdvisorRole || "",
            slaStatus: target.slaStatus || "",
            slaMinutes: target.slaMinutes || 0,
            dueAt: target.dueAt || "",
            escalationStage: target.escalationStage || "",
            escalationLevel: target.escalationLevel || 0,
            escalationLabel: target.escalationLabel || "",
            escalationOwnerRole: target.escalationOwnerRole || "",
            escalationSeverity: target.escalationSeverity || "",
            escalationThresholdMinutes: target.escalationThresholdMinutes || 0,
            nextEscalationStage: target.nextEscalationStage || "",
            nextEscalationAt: target.nextEscalationAt || "",
            nextEscalationInMinutes: target.nextEscalationInMinutes ?? null,
            retryScheduledCount: target.retryScheduledCount || 0,
            dueRetryCount: target.dueRetryCount || 0,
            deadLetterCount: target.deadLetterCount || 0,
            deliveredCount: target.deliveredCount || 0,
            requestedCount: target.requestedCount || 0,
            successRate: target.successRate || 0,
            attemptCount: target.attemptCount || 0,
            maxAttempts: target.maxAttempts || 0,
            deadLetterReason: target.deadLetterReason || "",
            failedCount: target.failedCount || 0,
            pendingCount: target.pendingCount || 0,
            ageMinutes: target.ageMinutes || 0,
            overdueMinutes: target.overdueMinutes || 0,
            errorMessage: target.errorMessage || "",
          });
        });
    });
  const rank = { danger: 0, warning: 1, success: 2, info: 3 };
  const sortedAlerts = alerts.sort((left, right) => {
    return (rank[left.severity] ?? 3) - (rank[right.severity] ?? 3)
      || right.count - left.count
      || left.key.localeCompare(right.key);
  }).slice(0, 20);
  return {
    rules: rules.map(publicRule),
    alerts: sortedAlerts,
    summary: {
      activeRuleCount: rules.filter((rule) => rule.status === "ACTIVE").length,
      disabledRuleCount: rules.filter((rule) => rule.status === "DISABLED").length,
      triggeredCount: sortedAlerts.length,
      dangerCount: sortedAlerts.filter((alert) => alert.severity === "danger").length,
      warningCount: sortedAlerts.filter((alert) => alert.severity === "warning").length,
    },
  };
}

function recentNotifications(data, query = {}) {
  const campaignId = text(query.campaignId || query.campaign_id);
  return ensureList(data, "operationalAlertNotifications")
    .filter((item) => !campaignId || item.campaign_id === campaignId)
    .slice()
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")))
    .slice(0, Math.max(1, Math.min(Number(query.limit || 20), 100)))
    .map((item) => ({
      notificationId: item.operational_alert_notification_id,
      alertKey: item.alert_key,
      ruleId: item.alert_rule_id,
      campaignId: item.campaign_id,
      severity: item.severity,
      channel: item.channel,
      status: item.status,
      title: item.title,
      message: item.message,
      targetKey: item.target_key,
      requestId: item.request_id,
      createdAt: item.created_at,
      deliveredAt: item.delivered_at || "",
      externalRef: item.external_ref || "",
      error: item.error || "",
      ownerRole: item.owner_role || "",
      ownerName: item.owner_name || "",
      ownerContact: item.owner_contact || "",
      routeKey: item.route_key || "",
    }));
}

function upsertAlertRule(data, input = {}) {
  const rules = listStoredAlertRules(data);
  const incomingId = text(input.alertRuleId || input.alert_rule_id);
  const existing = incomingId ? rules.find((rule) => rule.alert_rule_id === incomingId) || DEFAULT_ALERT_RULES.find((rule) => rule.alert_rule_id === incomingId) || null : null;
  const normalized = normalizeRule(input, existing);
  const index = rules.findIndex((rule) => rule.alert_rule_id === normalized.alert_rule_id);
  if (index >= 0) {
    rules[index] = normalized;
  } else {
    rules.unshift(normalized);
  }
  data.operationalAlertRules = rules.slice(0, 200);
  return {
    rule: publicRule(normalized),
    rules: listEffectiveAlertRules(data, { campaignId: normalized.campaign_id }).map(publicRule),
    created: index < 0,
  };
}

function lastDeliveredNotification(data, alert, nowText) {
  const nowMs = Date.parse(nowText);
  return ensureList(data, "operationalAlertNotifications")
    .filter((item) => item.alert_rule_id === alert.ruleId && item.alert_key === alert.key && item.status === "DELIVERED")
    .find((item) => {
      const deliveredAt = Date.parse(item.delivered_at || item.created_at || "");
      if (!Number.isFinite(nowMs) || !Number.isFinite(deliveredAt)) return false;
      return nowMs - deliveredAt < Number(alert.cooldownMinutes || 0) * 60 * 1000;
    });
}

async function maybeSendWebhook(rule, alert, context = {}) {
  if (rule.channel !== "WEBHOOK") return { status: "DELIVERED", externalRef: "", error: "" };
  return operationalAlertWebhookAdapter.sendOperationalAlertWebhook(rule, alert, context, publicRule(rule));
}

async function deliverAlert(data, alert, rule, body = {}, context = {}) {
  const timestamp = text(body.now) || nowISO();
  const cooldownHit = lastDeliveredNotification(data, alert, timestamp);
  if (cooldownHit) {
    return {
      alert,
      status: "SKIPPED_COOLDOWN",
      notification: null,
      skippedBy: cooldownHit.operational_alert_notification_id,
    };
  }
  const delivery = await maybeSendWebhook(rule, alert, context);
  const notification = {
    operational_alert_notification_id: createId("oan"),
    alert_rule_id: alert.ruleId,
    alert_key: alert.key,
    campaign_id: text(body.campaignId || body.campaign_id || alert.campaignId),
    severity: alert.severity,
    channel: rule.channel,
    status: delivery.status,
    title: alert.label,
    message: alert.message,
    target_key: alert.targetKey,
    owner_role: alert.ownerRole || rule.owner_role || "",
    owner_name: alert.ownerName || rule.owner_name || "",
    owner_contact: alert.ownerContact || rule.owner_contact || "",
    route_key: alert.routeKey || rule.route_key || "",
    payload_json: { alert, rule: publicRule(rule), webhook: delivery.deliveryTarget || null },
    request_id: text(body.requestId || body.request_id),
    external_ref: delivery.externalRef,
    error: delivery.error,
    delivered_at: delivery.status === "DELIVERED" ? timestamp : "",
    created_at: timestamp,
  };
  ensureList(data, "operationalAlertNotifications").unshift(notification);
  data.operationalAlertNotifications = ensureList(data, "operationalAlertNotifications").slice(0, 500);
  return { alert, status: delivery.status, notification };
}

async function runOperationalAlertJob(data, analytics, body = {}, context = {}) {
  const dryRun = body.dryRun === true || body.dry_run === true;
  const requestId = text(body.requestId || body.request_id || context.requestId);
  const timestamp = text(body.now || context.now) || nowISO();
  const evaluation = evaluateOperationalAlerts(data, analytics, body);
  const rulesById = Object.fromEntries(listEffectiveAlertRules(data, body).map((rule) => [rule.alert_rule_id, rule]));
  const results = [];
  if (!dryRun) {
    for (const alert of evaluation.alerts) {
      const rule = rulesById[alert.ruleId];
      if (!rule) continue;
      results.push(await deliverAlert(data, alert, rule, { ...body, requestId, now: timestamp }, context));
    }
  }
  const summary = {
    triggeredCount: evaluation.alerts.length,
    deliveredCount: results.filter((item) => item.status === "DELIVERED").length,
    skippedCount: results.filter((item) => String(item.status || "").startsWith("SKIPPED")).length,
    failedCount: results.filter((item) => item.status === "FAILED").length,
  };
  const run = {
    operational_alert_run_id: createId("oar"),
    request_id: requestId,
    campaign_id: analytics.filters && analytics.filters.campaignId || text(body.campaignId || body.campaign_id),
    date_from: analytics.filters && analytics.filters.dateFrom || text(body.dateFrom || body.date_from),
    date_to: analytics.filters && analytics.filters.dateTo || text(body.dateTo || body.date_to),
    dry_run: dryRun,
    status: summary.failedCount ? "PARTIAL_FAILED" : "COMPLETED",
    triggered_count: summary.triggeredCount,
    delivered_count: summary.deliveredCount,
    skipped_count: summary.skippedCount,
    failed_count: summary.failedCount,
    summary_json: summary,
    created_at: timestamp,
  };
  ensureList(data, "operationalAlertRuns").unshift(run);
  data.operationalAlertRuns = ensureList(data, "operationalAlertRuns").slice(0, 200);
  return {
    requestId,
    dryRun,
    run,
    summary,
    alerts: evaluation.alerts,
    rules: evaluation.rules,
    results,
  };
}

function listAlertRuns(data, query = {}) {
  const campaignId = text(query.campaignId || query.campaign_id);
  return ensureList(data, "operationalAlertRuns")
    .filter((item) => !campaignId || item.campaign_id === campaignId)
    .slice(0, Math.max(1, Math.min(Number(query.limit || 20), 100)))
    .map((item) => ({
      runId: item.operational_alert_run_id,
      requestId: item.request_id,
      campaignId: item.campaign_id,
      dryRun: Boolean(item.dry_run),
      status: item.status,
      triggeredCount: item.triggered_count,
      deliveredCount: item.delivered_count,
      skippedCount: item.skipped_count,
      failedCount: item.failed_count,
      createdAt: item.created_at,
    }));
}

module.exports = {
  DEFAULT_ALERT_RULES,
  evaluateOperationalAlerts,
  listAlertRuns,
  listEffectiveAlertRules,
  recentNotifications,
  runOperationalAlertJob,
  upsertAlertRule,
};
