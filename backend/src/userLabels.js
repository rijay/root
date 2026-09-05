const crypto = require("node:crypto");
const { createClientError } = require("./clientError");
const { appendAuditLog } = require("./auditLog");
const { HEALTH_AI_DATA_LIMITS } = require("./healthAiDataPolicy");

const QUESTIONNAIRE = "ROOT_GUT_5Q";
const SOURCE_TYPES = new Set(["QR_CODE", "SELF_REPORTED"]);
const CHANNEL_TYPES = new Set(["市集活动", "场馆陪伴计划", "内部测试", "通用自然流量", "待确认"]);
const list = (data, key) => Array.isArray(data[key]) ? data[key] : [];
const text = (value) => String(value ?? "").trim();
const date = (value) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : "";
const byTime = (field) => (a, b) => text(a[field]).localeCompare(text(b[field])) || text(a.assessment_id).localeCompare(text(b.assessment_id));
function fail(message, status = 400) { throw createClientError("USER_LABEL_INVALID", message, status); }

function configuration(data) {
  return { mappings: list(data, "userLabelMappings").slice().sort(byTime("effective_from")), selfReportedSources: selfReportedSources(data) };
}

function selfReportedSources(data) {
  const sources = new Map();
  const add = (sourceId, sourceVersion, label) => {
    const version = Number(sourceVersion);
    if (/^[A-Za-z0-9_-]{1,64}$/.test(sourceId) && Number.isSafeInteger(version) && version > 0)
      sources.set(`${version}:${sourceId}`, { sourceId, sourceVersion: version, label: text(label) || sourceId });
  };
  for (const attempt of list(data, "healthAssessmentAttempts")) {
    if (attempt.questionnaire_id === QUESTIONNAIRE && date(attempt.discovery_channel_confirmed_at))
      add(attempt.discovery_channel_option_id, attempt.discovery_channel_config_version, attempt.discovery_channel_option_label);
  }
  for (const config of list(data, "assessmentSourceSurveyConfigs"))
    for (const option of config.options_json || []) add(option.optionId || option.option_id, config.config_version, option.label);
  return [...sources.values()].sort((a, b) => a.sourceVersion - b.sourceVersion || a.sourceId.localeCompare(b.sourceId));
}

function saveMapping(data, input = {}) {
  const sourceType = text(input.sourceType);
  const sourceId = text(input.sourceId);
  const sourceVersion = sourceType === "SELF_REPORTED" ? Number(input.sourceVersion) : 0;
  const effectiveFrom = date(input.effectiveFrom);
  if (!SOURCE_TYPES.has(sourceType) || !/^[A-Za-z0-9_-]{1,64}$/.test(sourceId) || !effectiveFrom) fail("请选择有效来源并填写生效时间");
  if (sourceType === "QR_CODE" && !list(data, "channelQrCodes").some((r) => r.channel_qr_code_id === sourceId)) fail("渠道码不存在");
  if (sourceType === "SELF_REPORTED" && (!Number.isSafeInteger(sourceVersion) || sourceVersion < 1
    || !selfReportedSources(data).some((r) => r.sourceVersion === sourceVersion && r.sourceId === sourceId))) fail("来源选项或配置版本不存在");
  const attributes = Object.fromEntries(["activity", "city", "partner", "channelType"].map((key) => [key, text(input[key])]));
  if (Object.values(attributes).some((v) => !v || v.length > 80) || !CHANNEL_TYPES.has(attributes.channelType)) fail("请填写活动、城市、合作方及有效的渠道类型");
  const reason = text(input.reason);
  if (!reason || reason.length > 200) fail("请填写映射依据，最多 200 字");
  const rows = list(data, "userLabelMappings");
  const versions = rows.filter((r) => r.source_type === sourceType && r.source_id === sourceId && r.source_version === sourceVersion);
  if (Number(input.expectedVersion) !== versions.length) fail("映射已更新，请刷新后重试", 409);
  if (versions.some((r) => r.effective_from >= effectiveFrom)) fail("新版本生效时间必须晚于已有版本；历史映射保持不变", 409);
  if (versions.length && Date.parse(effectiveFrom) < Date.now()) fail("后续映射版本须从未来时间生效，不能改写已有历史来源", 409);
  const now = new Date().toISOString();
  const row = {
    user_label_mapping_id: `ulm_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`,
    source_type: sourceType, source_id: sourceId, source_version: sourceVersion,
    mapping_version: versions.length + 1, effective_from: effectiveFrom,
    attributes_json: attributes, reason, created_by: text(input.operatorId), created_at: now,
  };
  data.userLabelMappings = [...rows, row];
  appendAuditLog(data, { action: "USER_LABEL_MAPPING_CREATE", targetType: "USER_LABEL_MAPPING",
    targetId: row.user_label_mapping_id, operatorId: input.operatorId, reason,
    after: row, metadata: { requestId: input.requestId } });
  return { mapping: row };
}

function mappingAt(mappings, type, id, version, at) {
  if (!at) return null;
  return (mappings.get(JSON.stringify([type, id, version])) || []).find((r) => r.effective_from <= at) || null;
}

function indexBy(rows, key) {
  const result = new Map();
  for (const row of rows) {
    const id = typeof key === "function" ? key(row) : row[key];
    if (!result.has(id)) result.set(id, []);
    result.get(id).push(row);
  }
  return result;
}

function sourceFor(indexes, visits, attempts, uid) {
  const firstTouch = indexes.attributions.get(uid)?.[0];
  const sourceVisits = firstTouch ? visits.filter((v) => v.channel_id === firstTouch.channel_id && v.campaign_id === firstTouch.campaign_id) : visits;
  const visit = sourceVisits.slice().filter((v) => date(v.opened_at)).sort(byTime("opened_at"))[0];
  const self = attempts.filter((a) => date(a.discovery_channel_confirmed_at)).sort(byTime("discovery_channel_confirmed_at"))[0];
  const qrMap = visit && mappingAt(indexes.mappings, "QR_CODE", visit.channel_qr_code_id, 0, date(visit.opened_at));
  const selfMap = self && mappingAt(indexes.mappings, "SELF_REPORTED", self.discovery_channel_option_id,
    Number(self.discovery_channel_config_version), date(self.discovery_channel_confirmed_at));
  const conflict = qrMap && selfMap && JSON.stringify(qrMap.attributes_json) !== JSON.stringify(selfMap.attributes_json);
  const selected = conflict ? null : (qrMap || selfMap);
  return {
    ...(selected?.attributes_json || { activity: "待确认", city: "待确认", partner: "待确认", channelType: "待确认" }),
    status: conflict ? "来源冲突待核验" : selected ? "已匹配" : "待确认",
    evidence: {
      firstTouch: firstTouch ? { channelId: firstTouch.channel_id, campaignId: firstTouch.campaign_id, attributedAt: firstTouch.attributed_at } : null,
      qr: visit ? { channelId: visit.channel_id, qrCodeId: visit.channel_qr_code_id, campaignId: visit.campaign_id,
        openedAt: visit.opened_at, mappingId: qrMap?.user_label_mapping_id || "" } : null,
      selfReported: self ? { optionId: self.discovery_channel_option_id, label: self.discovery_channel_option_label,
        version: self.discovery_channel_config_version, confirmedAt: self.discovery_channel_confirmed_at,
        mappingId: selfMap?.user_label_mapping_id || "" } : null,
    },
  };
}

function healthFor(indexes, uid, attempts, now) {
  const consents = (indexes.consents.get(uid) || []).slice()
    .sort(byTime("occurred_at"));
  if (consents.at(-1)?.decision === "WITHDRAWN") return { status: "已撤回", baseline: null };
  const cutoff = Date.parse(now) - HEALTH_AI_DATA_LIMITS.healthContentRetentionDays * 86400000;
  const valid = attempts.filter((a) => !a.health_data_redacted_at && a.status === "COMPLETED"
    && date(a.completed_at) && Date.parse(a.completed_at) > cutoff).sort(byTime("completed_at"));
  const attemptTime = (a) => date(a.started_at || a.created_at || a.completed_at || a.updated_at);
  const latest = attempts.slice().sort((a, b) => attemptTime(a).localeCompare(attemptTime(b))).at(-1);
  // First valid completion is provisional until an independently verified payment time is available.
  const baseline = valid[0];
  if (!baseline) {
    const expired = latest && (latest.health_data_redacted_at || latest.status === "EXPIRED"
      || Date.parse(latest.completed_at || latest.updated_at) <= cutoff);
    return { status: expired ? "已失效" : ({ IN_PROGRESS: "进行中", SAFETY_STOPPED: "安全终止" }[latest?.status] || "未开始"), baseline: null };
  }
  const definition = indexes.definitions.get(JSON.stringify([
    baseline.assessment_definition_id, Number(baseline.questionnaire_version),
  ]))?.[0];
  const result = baseline.result_json || {};
  const resultCode = text(result.resultCode || result.result_code);
  const copies = definition?.result_copies || definition?.result_copies_json || [];
  const copy = copies.find((c) => c.code === resultCode);
  const questions = definition?.questions || definition?.questions_json || [];
  const keys = questions.length ? questions.map((q) => q.field) : ["Q1", "Q2", "Q3", "Q4", "Q5"];
  const answers = baseline.answers_json || {};
  const answerText = keys.map((key) => `${key}=${Array.isArray(answers[key]) ? answers[key].join(",") : text(answers[key]) || "未记录"}`).join("；");
  const latestExpired = latest && (latest.health_data_redacted_at || latest.status === "EXPIRED"
    || Date.parse(latest.completed_at || latest.started_at || latest.updated_at) <= cutoff);
  const status = latestExpired ? "已失效" : ({ IN_PROGRESS: "进行中", SAFETY_STOPPED: "安全终止" }[latest?.status] || "已完成");
  return { status, latestStatus: latest?.status || "", baseline: {
    assessmentId: baseline.assessment_id, questionnaireVersion: baseline.questionnaire_version,
    completedAt: baseline.completed_at, selection: "首次有效测评，购买基准待核验",
    answerText, resultCode, resultTitle: text(result.title || copy?.title),
    resultVerified: Boolean(copy),
  } };
}

function rows(data, options = {}) {
  const now = date(options.now) || new Date().toISOString();
  const users = new Map();
  for (const user of list(data, "users")) {
    if (user.app_code && user.app_code !== "MYROOT") continue;
    const uid = user.root_user_id || user.user_id;
    if (uid) users.set(uid, user);
  }
  const roots = new Map(list(data, "rootUsers").map((r) => [r.root_user_id, r]));
  const visitIndex = indexBy(list(data, "channelFunnelVisits"), "root_user_id");
  const attemptsIndex = indexBy(list(data, "healthAssessmentAttempts").filter((a) => a.questionnaire_id === QUESTIONNAIRE), "root_user_id");
  // Request-scoped indexes preserve snapshot freshness and first-match semantics.
  const indexes = {
    attributions: indexBy(list(data, "channelAttributions"), "root_user_id"),
    mappings: indexBy(list(data, "userLabelMappings"), (r) => JSON.stringify([r.source_type, r.source_id, Number(r.source_version)])),
  };
  for (const versions of indexes.mappings.values()) versions.sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  if (options.includeHealth) {
    indexes.consents = indexBy(list(data, "privacyConsentRecords").filter((c) => c.consent_type === "HEALTH_SENSITIVE_INFO"), "root_user_id");
    indexes.definitions = indexBy(list(data, "healthAssessmentDefinitions"), (r) => JSON.stringify([r.assessment_definition_id, Number(r.questionnaire_version)]));
  }
  const selectedIds = options.userIds ? new Set(options.userIds) : null;
  return [...users.entries()].sort(([a], [b]) => a.localeCompare(b)).filter(([id]) => !selectedIds || selectedIds.has(id)).map(([uid, user]) => {
    const root = roots.get(uid);
    const deleted = [user.account_deletion_status, user.deletion_status, root?.lifecycle_status, user.state]
      .some((s) => ["DELETED", "DELETION_PENDING", "COMPLETED_DELETION"].includes(s));
    const visits = visitIndex.get(uid) || [];
    const attempts = attemptsIndex.get(uid) || [];
    const firstVisitAt = visits.map((v) => date(v.opened_at)).filter(Boolean).sort()[0] || "";
    const row = { rootUserId: uid, accountStatus: deleted ? "已注销或注销中" : "有效",
      firstVisitAt, firstVisitBasis: firstVisitAt ? "已关联账号的渠道访问" : "未记录",
      source: sourceFor(indexes, visits, attempts, uid), userType: "待确认", trialOrder: "待核验",
      wecomAdded: "待核验", repurchase: "待观察", note: "", updatedAt: now };
    if (options.includeHealth) row.health = deleted ? { status: "已失效", baseline: null } : healthFor(indexes, uid, attempts, now);
    return row;
  });
}

function query(data, input = {}, options = {}) {
  const page = Number(input.page || 1), pageSize = Number(input.pageSize || 50);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) fail("分页参数无效");
  if (input.healthStatus && !options.includeHealth) fail("筛选测评状态需要个人健康标签读取权限", 403);
  const rowOptions = input.userId ? { ...options, userIds: options.userIds
    ? [...options.userIds].filter((id) => id === input.userId) : [input.userId] } : options;
  const all = rows(data, rowOptions).filter((r) => (!input.userId || r.rootUserId === input.userId)
    && (!input.sourceStatus || r.source.status === input.sourceStatus)
    && (!input.healthStatus || r.health?.status === input.healthStatus));
  return { rows: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize,
    healthExternalSyncAllowed: false,
    healthExternalSyncReason: "现有用户授权仅覆盖 myRoot 内部处理，健康字段暂不外发", manualFieldNotice: "订单、企微、用户类型与备注由飞书人工维护" };
}

module.exports = { configuration, saveMapping, rows, query };
