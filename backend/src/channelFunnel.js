const crypto = require("node:crypto");

const auditLog = require("./auditLog");
const { nowISO } = require("./dates");
const { createId } = require("./seed");

const DEFAULT_TARGET_PAGE = "/subpkg/campaign/pages/root-with-you/index";
const FUNNEL_STAGES = Object.freeze([
  "SCAN_OPEN",
  "INTRO_VIEW",
  "START_CLICK",
  "ASSESSMENT_CREATED",
  "ASSESSMENT_COMPLETED",
  "RESULT_VIEWED",
]);
const PUBLIC_STAGES = new Set(FUNNEL_STAGES.slice(0, 3));
const SAFE_TARGET_PAGES = new Set([DEFAULT_TARGET_PAGE]);

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function text(value, maxLength = 128) {
  return String(value === undefined || value === null ? "" : value).trim().slice(0, maxLength);
}

function timestamp(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function businessError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function validId(value, maxLength = 64) {
  const normalized = text(value, maxLength);
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(normalized) ? normalized : "";
}

function normalizeStatus(value, fallback = "ACTIVE") {
  const status = text(value || fallback, 16).toUpperCase();
  if (!new Set(["ACTIVE", "PAUSED", "ARCHIVED"]).has(status)) {
    throw businessError("CHANNEL_STATUS_INVALID", "渠道状态无效");
  }
  return status;
}

function normalizeTargetPage(value) {
  const target = text(value || DEFAULT_TARGET_PAGE, 240).split("?", 1)[0];
  if (!SAFE_TARGET_PAGES.has(target)) {
    throw businessError("CHANNEL_TARGET_INVALID", "渠道码仅允许进入肠道自测介绍页");
  }
  return target;
}

function normalizeTime(value) {
  if (!value) return "";
  if (timestamp(value) === null) throw businessError("CHANNEL_TIME_INVALID", "渠道有效期格式无效");
  return new Date(value).toISOString();
}

function isActive(row, currentTime = nowISO()) {
  const status = text(row && row.status, 16).toUpperCase();
  if (status !== "ACTIVE") return false;
  const current = timestamp(currentTime) || Date.now();
  const startsAt = timestamp(row.start_at || row.starts_at);
  const endsAt = timestamp(row.end_at || row.ends_at);
  return (!startsAt || startsAt <= current) && (!endsAt || endsAt >= current);
}

function shortCode() {
  return crypto.randomBytes(6).toString("base64url").replace(/[-_]/g, "A").slice(0, 8).toUpperCase();
}

function uniqueShortCode(data) {
  const existing = new Set(ensureList(data, "channelQrCodes").map((item) => item.short_code));
  for (let index = 0; index < 16; index += 1) {
    const candidate = shortCode();
    if (!existing.has(candidate)) return candidate;
  }
  throw businessError("CHANNEL_CODE_EXHAUSTED", "暂时无法生成唯一渠道短码", 503);
}

function publicChannel(row) {
  return {
    channelDefinitionId: row.channel_definition_id,
    channelId: row.channel_id,
    campaignId: row.campaign_id,
    status: row.status,
    allowedTargetPages: row.allowed_target_pages_json || [],
    startsAt: row.start_at || "",
    endsAt: row.end_at || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicCode(row, channel) {
  return {
    channelQrCodeId: row.channel_qr_code_id,
    shortCode: row.short_code,
    scene: `q=${row.short_code}`,
    label: row.label,
    channelDefinitionId: row.channel_definition_id,
    channelId: row.channel_id,
    campaignId: row.campaign_id,
    targetPage: row.target_page,
    status: row.status,
    startsAt: row.start_at || "",
    endsAt: row.end_at || "",
    envVersion: row.env_version || "release",
    channelStatus: channel ? channel.status : "UNKNOWN",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function channelById(data, definitionId) {
  return ensureList(data, "channelDefinitions")
    .find((item) => item.channel_definition_id === definitionId) || null;
}

function channelByBusinessId(data, channelId) {
  return ensureList(data, "channelDefinitions")
    .find((item) => item.channel_id === channelId) || null;
}

function codeByShortCode(data, value) {
  const normalized = text(value, 16).toUpperCase();
  return ensureList(data, "channelQrCodes").find((item) => item.short_code === normalized) || null;
}

function adminAudit(data, action, targetType, targetId, input, after) {
  return auditLog.appendAuditLog(data, {
    action,
    targetType,
    targetId,
    operatorId: input.operatorId || input.operator_id || "",
    reason: input.reason || "维护渠道归因配置",
    after,
    metadata: {
      requestId: input.requestId || input.request_id || "",
      releaseStage: "CHANNEL_ATTRIBUTION",
    },
  });
}

function upsertChannel(data, input = {}, context = {}) {
  const channelId = validId(input.channelId || input.channel_id);
  const campaignId = validId(input.campaignId || input.campaign_id);
  if (!channelId || !campaignId) {
    throw businessError("CHANNEL_ID_INVALID", "渠道 ID 和活动 ID 必填且只能包含字母、数字、下划线或短横线");
  }
  const status = normalizeStatus(input.status);
  const startsAt = normalizeTime(input.startsAt || input.start_at);
  const endsAt = normalizeTime(input.endsAt || input.end_at);
  if (startsAt && endsAt && timestamp(startsAt) >= timestamp(endsAt)) {
    throw businessError("CHANNEL_TIME_RANGE_INVALID", "渠道结束时间必须晚于开始时间");
  }
  const now = context.now || nowISO();
  const rows = ensureList(data, "channelDefinitions");
  let row = channelByBusinessId(data, channelId);
  const created = !row;
  if (!row) {
    row = {
      channel_definition_id: createId("chd"),
      channel_id: channelId,
      created_at: now,
    };
    rows.push(row);
  }
  Object.assign(row, {
    campaign_id: campaignId,
    status,
    signature_key_id: text(input.signatureKeyId || input.signature_key_id || "SHORT_CODE_V1", 48),
    allowed_target_pages_json: [DEFAULT_TARGET_PAGE],
    start_at: startsAt,
    end_at: endsAt,
    updated_at: now,
  });
  const channel = publicChannel(row);
  const audit = adminAudit(
    data,
    created ? "CHANNEL_CREATE" : "CHANNEL_UPDATE",
    "CHANNEL_DEFINITION",
    row.channel_definition_id,
    input,
    { status: row.status, channelId, campaignId },
  );
  return { channel, created, audit };
}

function createCode(data, input = {}, context = {}) {
  const channelId = validId(input.channelId || input.channel_id);
  const channel = channelByBusinessId(data, channelId);
  if (!channel) throw businessError("CHANNEL_NOT_FOUND", "渠道不存在", 404);
  const targetPage = normalizeTargetPage(input.targetPage || input.target_page);
  const label = text(input.label, 80);
  if (!label) throw businessError("CHANNEL_CODE_LABEL_REQUIRED", "渠道码名称必填");
  const startsAt = normalizeTime(input.startsAt || input.start_at || channel.start_at);
  const endsAt = normalizeTime(input.endsAt || input.end_at || channel.end_at);
  if (startsAt && endsAt && timestamp(startsAt) >= timestamp(endsAt)) {
    throw businessError("CHANNEL_CODE_TIME_RANGE_INVALID", "渠道码结束时间必须晚于开始时间");
  }
  const now = context.now || nowISO();
  const row = {
    channel_qr_code_id: createId("cqr"),
    channel_definition_id: channel.channel_definition_id,
    channel_id: channel.channel_id,
    campaign_id: channel.campaign_id,
    short_code: uniqueShortCode(data),
    label,
    target_page: targetPage,
    status: normalizeStatus(input.status),
    start_at: startsAt,
    end_at: endsAt,
    env_version: text(input.envVersion || input.env_version || "release", 16).toLowerCase(),
    created_by: text(input.operatorId || input.operator_id, 64),
    created_at: now,
    updated_at: now,
  };
  if (!new Set(["release", "trial", "develop"]).has(row.env_version)) {
    throw businessError("CHANNEL_CODE_ENV_INVALID", "小程序码环境只能是正式版、体验版或开发版");
  }
  ensureList(data, "channelQrCodes").push(row);
  const code = publicCode(row, channel);
  const audit = adminAudit(data, "CHANNEL_CODE_CREATE", "CHANNEL_QR_CODE", row.channel_qr_code_id, input, {
    status: row.status,
    channelId: row.channel_id,
    campaignId: row.campaign_id,
  });
  return { code, audit };
}

function updateCodeStatus(data, codeId, input = {}, context = {}) {
  const normalizedId = validId(codeId);
  const row = ensureList(data, "channelQrCodes").find((item) => item.channel_qr_code_id === normalizedId);
  if (!row) throw businessError("CHANNEL_CODE_NOT_FOUND", "渠道码不存在", 404);
  row.status = normalizeStatus(input.status);
  row.updated_at = context.now || nowISO();
  const code = publicCode(row, channelById(data, row.channel_definition_id));
  const audit = adminAudit(data, "CHANNEL_CODE_STATUS_UPDATE", "CHANNEL_QR_CODE", row.channel_qr_code_id, input, {
    status: row.status,
    channelId: row.channel_id,
    campaignId: row.campaign_id,
  });
  return { code, audit };
}

function listConfiguration(data, query = {}) {
  const channelId = text(query.channelId || query.channel_id, 64);
  const campaignId = text(query.campaignId || query.campaign_id, 64);
  const status = text(query.status, 16).toUpperCase();
  const channels = ensureList(data, "channelDefinitions")
    .filter((item) => !channelId || item.channel_id === channelId)
    .filter((item) => !campaignId || item.campaign_id === campaignId)
    .filter((item) => !status || item.status === status)
    .map(publicChannel);
  const channelMap = new Map(ensureList(data, "channelDefinitions")
    .map((item) => [item.channel_definition_id, item]));
  const codes = ensureList(data, "channelQrCodes")
    .filter((item) => !channelId || item.channel_id === channelId)
    .filter((item) => !campaignId || item.campaign_id === campaignId)
    .filter((item) => !status || item.status === status)
    .map((item) => publicCode(item, channelMap.get(item.channel_definition_id)));
  return { channels, codes };
}

function getCode(data, codeId) {
  const normalizedId = validId(codeId);
  const row = ensureList(data, "channelQrCodes").find((item) => item.channel_qr_code_id === normalizedId);
  if (!row) throw businessError("CHANNEL_CODE_NOT_FOUND", "渠道码不存在", 404);
  return publicCode(row, channelById(data, row.channel_definition_id));
}

function resolveCode(data, input = {}, context = {}) {
  const code = codeByShortCode(data, input.shortCode || input.short_code || input.q);
  const now = context.now || nowISO();
  if (!code || !isActive(code, now)) throw businessError("CHANNEL_CODE_UNAVAILABLE", "渠道码不存在或当前不可用", 404);
  const channel = channelById(data, code.channel_definition_id);
  if (!channel || !isActive(channel, now)) throw businessError("CHANNEL_UNAVAILABLE", "渠道当前不可用", 409);
  const clientVisitId = validId(input.clientVisitId || input.client_visit_id, 64);
  if (!clientVisitId || clientVisitId.length < 8) {
    throw businessError("CHANNEL_VISIT_ID_INVALID", "渠道访问标识无效");
  }
  const visits = ensureList(data, "channelFunnelVisits");
  let visit = visits.find((item) => item.client_visit_id === clientVisitId);
  if (visit && visit.channel_qr_code_id !== code.channel_qr_code_id) {
    throw businessError("CHANNEL_VISIT_CONFLICT", "渠道访问标识已被使用", 409);
  }
  if (!visit) {
    visit = {
      channel_funnel_visit_id: createId("cfv"),
      client_visit_id: clientVisitId,
      channel_qr_code_id: code.channel_qr_code_id,
      short_code: code.short_code,
      channel_definition_id: code.channel_definition_id,
      channel_id: code.channel_id,
      campaign_id: code.campaign_id,
      target_page: code.target_page,
      root_user_id: "",
      assessment_id: "",
      opened_at: now,
      created_at: now,
      updated_at: now,
    };
    visits.push(visit);
  }
  recordStage(data, "", { visitId: visit.channel_funnel_visit_id, stage: "SCAN_OPEN" }, { now });
  return {
    visitId: visit.channel_funnel_visit_id,
    shortCode: code.short_code,
    channelId: code.channel_id,
    campaignId: code.campaign_id,
    targetPage: code.target_page,
  };
}

function visitById(data, visitId) {
  const normalized = validId(visitId);
  return ensureList(data, "channelFunnelVisits")
    .find((item) => item.channel_funnel_visit_id === normalized) || null;
}

function recordStage(data, rootUserId, input = {}, context = {}) {
  const stage = text(input.stage, 32).toUpperCase();
  if (!FUNNEL_STAGES.includes(stage)) throw businessError("CHANNEL_FUNNEL_STAGE_INVALID", "渠道漏斗阶段无效");
  if (!rootUserId && !PUBLIC_STAGES.has(stage)) {
    throw businessError("CHANNEL_FUNNEL_LOGIN_REQUIRED", "该漏斗阶段需要登录", 401);
  }
  const visit = visitById(data, input.visitId || input.visit_id);
  if (!visit) throw businessError("CHANNEL_VISIT_NOT_FOUND", "渠道访问记录不存在", 404);
  if (visit.root_user_id && rootUserId && visit.root_user_id !== rootUserId) {
    throw businessError("CHANNEL_VISIT_OWNER_MISMATCH", "渠道访问记录不属于当前账号", 403);
  }
  const assessmentId = validId(input.assessmentId || input.assessment_id);
  if (["ASSESSMENT_CREATED", "ASSESSMENT_COMPLETED", "RESULT_VIEWED"].includes(stage) && !assessmentId) {
    throw businessError("CHANNEL_FUNNEL_ASSESSMENT_REQUIRED", "评测阶段缺少评测记录");
  }
  const now = context.now || nowISO();
  if (rootUserId) visit.root_user_id = rootUserId;
  if (assessmentId) visit.assessment_id = assessmentId;
  visit.updated_at = now;
  const events = ensureList(data, "channelFunnelEvents");
  const existing = events.find((item) => (
    item.channel_funnel_visit_id === visit.channel_funnel_visit_id
    && item.stage === stage
    && (item.assessment_id || "") === (assessmentId || "")
  ));
  if (existing) return { recorded: false, stage, visitId: visit.channel_funnel_visit_id };
  events.push({
    channel_funnel_event_id: createId("cfe"),
    channel_funnel_visit_id: visit.channel_funnel_visit_id,
    channel_qr_code_id: visit.channel_qr_code_id,
    channel_id: visit.channel_id,
    campaign_id: visit.campaign_id,
    root_user_id: rootUserId || visit.root_user_id || "",
    assessment_id: assessmentId,
    stage,
    occurred_at: now,
    created_at: now,
  });
  return { recorded: true, stage, visitId: visit.channel_funnel_visit_id };
}

function bindFirstTouch(data, rootUserId, input = {}, context = {}) {
  const visit = visitById(data, input.visitId || input.visit_id);
  if (!visit) throw businessError("CHANNEL_VISIT_NOT_FOUND", "渠道访问记录不存在", 404);
  if (visit.root_user_id && visit.root_user_id !== rootUserId) {
    throw businessError("CHANNEL_VISIT_OWNER_MISMATCH", "渠道访问记录不属于当前账号", 403);
  }
  const now = context.now || nowISO();
  visit.root_user_id = rootUserId;
  visit.updated_at = now;
  const attributions = ensureList(data, "channelAttributions");
  const existing = attributions.find((item) => item.root_user_id === rootUserId);
  if (existing) return { accepted: true, result: "EXISTING_KEPT", reason: "FIRST_TOUCH_ALREADY_SET", attribution: existing };
  const attribution = {
    channel_attribution_id: createId("cat"),
    root_user_id: rootUserId,
    channel_definition_id: visit.channel_definition_id,
    channel_id: visit.channel_id,
    campaign_id: visit.campaign_id,
    target_page: visit.target_page,
    signature_key_id: "SHORT_CODE_V1",
    signature_scheme: "SERVER_SHORT_CODE_V1",
    attributed_at: now,
    created_at: now,
  };
  attributions.push(attribution);
  return { accepted: true, result: "ATTRIBUTED", reason: "", attribution };
}

function assessmentSource(data, rootUserId, input = {}, context = {}) {
  const visitId = input.channelVisitId || input.channel_visit_id || input.visitId || input.visit_id;
  if (!visitId) return null;
  const visit = visitById(data, visitId);
  if (!visit) throw businessError("CHANNEL_VISIT_NOT_FOUND", "渠道访问记录不存在", 404);
  if (visit.root_user_id && visit.root_user_id !== rootUserId) {
    throw businessError("CHANNEL_VISIT_OWNER_MISMATCH", "渠道访问记录不属于当前账号", 403);
  }
  visit.root_user_id = rootUserId;
  visit.updated_at = context.now || nowISO();
  return {
    sourceChannel: visit.channel_id,
    sourceCampaignId: visit.campaign_id,
    sourceQrCodeId: visit.channel_qr_code_id,
    sourceVisitId: visit.channel_funnel_visit_id,
  };
}

function assessmentStage(data, rootUserId, assessment, stage, context = {}) {
  if (!assessment || !assessment.source_visit_id) return { recorded: false, reason: "NO_CHANNEL_VISIT" };
  return recordStage(data, rootUserId, {
    visitId: assessment.source_visit_id,
    assessmentId: assessment.assessment_id,
    stage,
  }, context);
}

function report(data, query = {}) {
  const startsAt = query.startsAt || query.starts_at || query.dateFrom || query.date_from || "";
  const endsAt = query.endsAt || query.ends_at || query.dateTo || query.date_to || "";
  const startTime = startsAt ? timestamp(startsAt) : null;
  const endTime = endsAt ? timestamp(endsAt) : null;
  if (startsAt && startTime === null) throw businessError("CHANNEL_REPORT_TIME_INVALID", "漏斗开始日期无效");
  if (endsAt && endTime === null) throw businessError("CHANNEL_REPORT_TIME_INVALID", "漏斗结束日期无效");
  const channelId = text(query.channelId || query.channel_id, 64);
  const campaignId = text(query.campaignId || query.campaign_id, 64);
  const short = text(query.shortCode || query.short_code, 16).toUpperCase();
  const events = ensureList(data, "channelFunnelEvents").filter((event) => {
    const occurred = timestamp(event.occurred_at) || 0;
    return (!channelId || event.channel_id === channelId)
      && (!campaignId || event.campaign_id === campaignId)
      && (!short || codeByShortCode(data, short)?.channel_qr_code_id === event.channel_qr_code_id)
      && (startTime === null || occurred >= startTime)
      && (endTime === null || occurred <= endTime);
  });
  const codeMap = new Map(ensureList(data, "channelQrCodes").map((item) => [item.channel_qr_code_id, item]));
  const groups = new Map();
  events.forEach((event) => {
    const key = event.channel_qr_code_id;
    if (!groups.has(key)) {
      const code = codeMap.get(key) || {};
      groups.set(key, {
        channelQrCodeId: key,
        shortCode: code.short_code || "",
        label: code.label || "",
        channelId: event.channel_id,
        campaignId: event.campaign_id,
        stageSets: new Map(FUNNEL_STAGES.map((stage) => [stage, new Set()])),
      });
    }
    groups.get(key).stageSets.get(event.stage)?.add(event.channel_funnel_visit_id);
  });
  const rows = [...groups.values()].map((group) => {
    const counts = Object.fromEntries(FUNNEL_STAGES.map((stage) => [stage, group.stageSets.get(stage).size]));
    const opened = counts.SCAN_OPEN || 0;
    return {
      channelQrCodeId: group.channelQrCodeId,
      shortCode: group.shortCode,
      label: group.label,
      channelId: group.channelId,
      campaignId: group.campaignId,
      counts,
      completionRate: opened ? Number((counts.ASSESSMENT_COMPLETED / opened).toFixed(4)) : 0,
      resultViewRate: opened ? Number((counts.RESULT_VIEWED / opened).toFixed(4)) : 0,
    };
  }).sort((left, right) => right.counts.SCAN_OPEN - left.counts.SCAN_OPEN);
  const totals = Object.fromEntries(FUNNEL_STAGES.map((stage) => [
    stage,
    new Set(events.filter((event) => event.stage === stage).map((event) => event.channel_funnel_visit_id)).size,
  ]));
  return {
    stages: FUNNEL_STAGES,
    totals,
    rows,
    filters: { startsAt, endsAt, channelId, campaignId, shortCode: short },
    generatedAt: nowISO(),
  };
}

module.exports = Object.freeze({
  DEFAULT_TARGET_PAGE,
  FUNNEL_STAGES,
  assessmentSource,
  assessmentStage,
  bindFirstTouch,
  createCode,
  getCode,
  listConfiguration,
  recordStage,
  report,
  resolveCode,
  updateCodeStatus,
  upsertChannel,
});
