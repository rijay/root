const { nowISO, todayISO } = require("./dates");
const { createId } = require("./seed");
const campaign = require("./campaign");

const TASK_TYPES = new Set(["CHECKIN", "QUESTIONNAIRE", "SHARE", "CONSULTATION", "PURCHASE"]);

const DEFAULT_TASK_DEFINITIONS = [
  {
    task_definition_id: "td_root_7d_checkin",
    campaign_id: campaign.DEFAULT_CAMPAIGN_ID,
    task_type: "CHECKIN",
    title: "完成 7 天身体记录",
    description: "记录服用、排便和身体反馈。",
    required: true,
    display_order: 10,
    config_json: { targetCount: 7, uniqueBy: "taskDate" },
  },
  {
    task_definition_id: "td_root_day4_questionnaire",
    campaign_id: campaign.DEFAULT_CAMPAIGN_ID,
    task_type: "QUESTIONNAIRE",
    title: "完成中期问卷",
    description: "第 4 天后补充一次身体反馈。",
    required: true,
    display_order: 20,
    config_json: { questionnaireType: "DAY4_MIDPOINT", targetCount: 1 },
  },
  {
    task_definition_id: "td_root_day8_questionnaire",
    campaign_id: campaign.DEFAULT_CAMPAIGN_ID,
    task_type: "QUESTIONNAIRE",
    title: "完成收尾问卷",
    description: "第 7 天后填写活动收尾反馈。",
    required: true,
    display_order: 30,
    config_json: { questionnaireType: "DAY8_SUMMARY", targetCount: 1 },
  },
  {
    task_definition_id: "td_root_share",
    campaign_id: campaign.DEFAULT_CAMPAIGN_ID,
    task_type: "SHARE",
    title: "完成一次分享",
    description: "把活动分享给好友或社群。",
    required: false,
    display_order: 40,
    config_json: { targetCount: 1 },
  },
  {
    task_definition_id: "td_root_consultation",
    campaign_id: campaign.DEFAULT_CAMPAIGN_ID,
    task_type: "CONSULTATION",
    title: "联系 ROOT 顾问",
    description: "有疑问时可联系顾问，咨询行为会被记录。",
    required: false,
    display_order: 50,
    config_json: { targetCount: 1 },
  },
  {
    task_definition_id: "td_root_purchase",
    campaign_id: campaign.DEFAULT_CAMPAIGN_ID,
    task_type: "PURCHASE",
    title: "Root 会员中心购买记录",
    description: "购买不是参与任务前置条件，可作为运营规则的可选条件。",
    required: false,
    display_order: 60,
    config_json: { targetCount: 1 },
  },
];

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

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

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeTaskType(value) {
  const taskType = text(value).toUpperCase();
  if (!TASK_TYPES.has(taskType)) throw businessError(7001, "不支持的任务类型");
  return taskType;
}

function ensureDefaultTaskDefinitions(data) {
  campaign.ensureDefaultCampaign(data);
  const definitions = ensureList(data, "taskDefinitions");
  DEFAULT_TASK_DEFINITIONS.forEach((definition) => {
    const exists = definitions.some((item) => item.task_definition_id === definition.task_definition_id);
    if (exists) return;
    const now = nowISO();
    definitions.push({
      ...definition,
      status: "ACTIVE",
      created_at: now,
      updated_at: now,
    });
  });
  return definitions;
}

function listTaskDefinitions(data, campaignId) {
  ensureDefaultTaskDefinitions(data);
  return ensureList(data, "taskDefinitions")
    .filter((definition) => definition.campaign_id === campaignId && definition.status !== "ARCHIVED")
    .sort((left, right) => (left.display_order || 0) - (right.display_order || 0));
}

function eventMatchesDefinition(event, definition) {
  if (event.campaign_id !== definition.campaign_id) return false;
  if (event.task_type !== definition.task_type) return false;
  if (event.task_definition_id && event.task_definition_id !== definition.task_definition_id) return false;
  const config = definition.config_json || {};
  const payload = event.payload_json || {};
  if (definition.task_type === "QUESTIONNAIRE" && config.questionnaireType) {
    return payload.questionnaireType === config.questionnaireType || payload.questionnaire_type === config.questionnaireType;
  }
  if (definition.task_type === "PURCHASE" && config.youzanProductId) {
    return payload.youzanProductId === config.youzanProductId || payload.youzan_product_id === config.youzanProductId;
  }
  return true;
}

function uniqueCompletionCount(events, definition) {
  const config = definition.config_json || {};
  const uniqueBy = config.uniqueBy || "";
  const matched = events.filter((event) => eventMatchesDefinition(event, definition));
  if (!uniqueBy) return matched.length;
  const values = new Set(matched.map((event) => {
    if (uniqueBy === "taskDate") return event.task_date || event.occurred_at.slice(0, 10);
    const payload = event.payload_json || {};
    return payload[uniqueBy] || event[uniqueBy] || event.task_event_id;
  }));
  return values.size;
}

function statusForCount(count, target) {
  if (count >= target) return "DONE";
  if (count > 0) return "IN_PROGRESS";
  return "NOT_STARTED";
}

function buildTaskProgress(events, definition) {
  const config = definition.config_json || {};
  const target = Math.max(1, Number(config.targetCount || config.minCount || 1));
  const completedCount = uniqueCompletionCount(events, definition);
  return {
    taskDefinitionId: definition.task_definition_id,
    taskType: definition.task_type,
    title: definition.title,
    description: definition.description || "",
    required: Boolean(definition.required),
    status: statusForCount(completedCount, target),
    completedCount,
    targetCount: target,
    config,
  };
}

function taskTargetCount(definition) {
  const config = definition.config_json || {};
  return Math.max(1, Number(config.targetCount || config.minCount || 1));
}

function assertCanRecordTaskEvent(events, definition) {
  const config = definition.config_json || {};
  if (config.allowAfterDone === true) return;
  if (definition.task_type !== "CHECKIN") return;

  const completedCount = uniqueCompletionCount(events, definition);
  if (completedCount >= taskTargetCount(definition)) {
    throw businessError(7003, "每日任务已完成，无需继续打卡");
  }
}

function computeTaskProgress(data, rootUserId, campaignId) {
  const definitions = listTaskDefinitions(data, campaignId);
  const events = ensureList(data, "taskEvents").filter((event) => {
    return event.root_user_id === rootUserId && event.campaign_id === campaignId && event.status !== "VOID";
  });
  const tasks = definitions.map((definition) => buildTaskProgress(events, definition));
  const requiredTasks = tasks.filter((task) => task.required);
  const requiredDone = requiredTasks.filter((task) => task.status === "DONE").length;
  const completedCount = tasks.filter((task) => task.status === "DONE").length;
  const progressPercent = requiredTasks.length ? Math.round((requiredDone / requiredTasks.length) * 100) : 100;
  return {
    rootUserId,
    campaignId,
    tasks,
    summary: {
      totalTasks: tasks.length,
      completedTasks: completedCount,
      requiredTasks: requiredTasks.length,
      requiredCompletedTasks: requiredDone,
      progressPercent,
      settlementReady: requiredTasks.length > 0 && requiredDone === requiredTasks.length,
    },
    computedAt: nowISO(),
  };
}

function upsertProgressSnapshot(data, progress) {
  const snapshots = ensureList(data, "taskProgressSnapshots");
  let snapshot = snapshots.find((item) => {
    return item.root_user_id === progress.rootUserId && item.campaign_id === progress.campaignId;
  });
  if (!snapshot) {
    snapshot = {
      task_progress_snapshot_id: createId("tps"),
      root_user_id: progress.rootUserId,
      campaign_id: progress.campaignId,
      created_at: nowISO(),
    };
    snapshots.push(snapshot);
  }
  snapshot.snapshot_json = progress;
  snapshot.computed_at = progress.computedAt;
  snapshot.updated_at = nowISO();
  return snapshot;
}

function idempotencyKeyFor(input, taskType, payload) {
  return text(
    input.idempotencyKey ||
      input.idempotency_key ||
      payload.idempotencyKey ||
      payload.idempotency_key ||
      [taskType, input.rootUserId || input.root_user_id, input.campaignId || input.campaign_id, payload.taskDate || input.taskDate || input.task_date || todayISO()].join(":")
  );
}

function matchTaskDefinition(data, campaignId, taskType, payload = {}) {
  const taskDefinitionId = payload.taskDefinitionId || payload.task_definition_id || "";
  const definitions = listTaskDefinitions(data, campaignId).filter((definition) => definition.task_type === taskType);
  if (taskDefinitionId) {
    const exact = definitions.find((definition) => definition.task_definition_id === taskDefinitionId);
    if (!exact) throw businessError(7002, "任务配置不存在");
    return exact;
  }
  if (taskType === "QUESTIONNAIRE") {
    const questionnaireType = payload.questionnaireType || payload.questionnaire_type || "";
    return definitions.find((definition) => (definition.config_json || {}).questionnaireType === questionnaireType) || definitions[0];
  }
  if (taskType === "PURCHASE" && (payload.youzanProductId || payload.youzan_product_id)) {
    const productId = payload.youzanProductId || payload.youzan_product_id;
    return definitions.find((definition) => (definition.config_json || {}).youzanProductId === productId) || definitions[0];
  }
  return definitions[0] || null;
}

function recordTaskEvent(data, input = {}, context = {}) {
  const rootUserId = text(input.rootUserId || input.root_user_id);
  if (!rootUserId) throw businessError(1003, "请先登录", 401);
  const activeCampaign = campaign.getActiveCampaign(data, { ...context, campaignId: input.campaignId || input.campaign_id });
  campaign.joinCampaign(data, rootUserId, activeCampaign.campaign_id, context);
  const payload = objectValue(input.payload || input.payload_json);
  const taskType = normalizeTaskType(input.taskType || input.task_type || payload.taskType || payload.task_type);
  const definition = matchTaskDefinition(data, activeCampaign.campaign_id, taskType, payload);
  if (!definition) throw businessError(7002, "任务配置不存在");

  const idempotencyKey = idempotencyKeyFor(input, taskType, payload);
  const events = ensureList(data, "taskEvents");
  const existing = events.find((event) => event.idempotency_key === idempotencyKey);
  if (existing) {
    const progress = computeTaskProgress(data, rootUserId, activeCampaign.campaign_id);
    upsertProgressSnapshot(data, progress);
    return { event: existing, created: false, progress };
  }
  const scopedEvents = events.filter((event) => {
    return event.root_user_id === rootUserId && event.campaign_id === activeCampaign.campaign_id && event.status !== "VOID";
  });
  assertCanRecordTaskEvent(scopedEvents, definition);

  const now = nowISO();
  const taskDate = text(input.taskDate || input.task_date || payload.taskDate || payload.task_date, todayISO());
  const event = {
    task_event_id: createId("tev"),
    root_user_id: rootUserId,
    campaign_id: activeCampaign.campaign_id,
    task_definition_id: definition.task_definition_id,
    task_type: taskType,
    event_type: text(input.eventType || input.event_type || payload.eventType || payload.event_type, `${taskType}_COMPLETED`),
    task_date: taskDate,
    payload_json: payload,
    idempotency_key: idempotencyKey,
    status: "RECORDED",
    source_channel: context.sourceChannel || context.source_channel || input.sourceChannel || input.source_channel || "",
    occurred_at: input.occurredAt || input.occurred_at || now,
    created_at: now,
  };
  events.push(event);
  const progress = computeTaskProgress(data, rootUserId, activeCampaign.campaign_id);
  upsertProgressSnapshot(data, progress);
  return { event, created: true, progress };
}

function getProgressView(data, rootUserId, campaignId = "", context = {}) {
  const activeCampaign = campaign.getActiveCampaign(data, { ...context, campaignId });
  const participant = campaign.findParticipant(data, rootUserId, activeCampaign.campaign_id);
  const progress = computeTaskProgress(data, rootUserId, activeCampaign.campaign_id);
  const snapshot = upsertProgressSnapshot(data, progress);
  return {
    campaign: campaign.toCampaignPayload(activeCampaign, participant),
    progress,
    snapshotId: snapshot.task_progress_snapshot_id,
  };
}

function upsertTaskDefinition(data, input = {}) {
  const campaignId = text(input.campaignId || input.campaign_id, campaign.DEFAULT_CAMPAIGN_ID);
  campaign.ensureDefaultCampaign(data);
  const taskType = normalizeTaskType(input.taskType || input.task_type);
  const definitions = ensureList(data, "taskDefinitions");
  const taskDefinitionId = text(input.taskDefinitionId || input.task_definition_id, createId("tdf"));
  let definition = definitions.find((item) => item.task_definition_id === taskDefinitionId);
  const now = nowISO();
  if (!definition) {
    definition = {
      task_definition_id: taskDefinitionId,
      campaign_id: campaignId,
      created_at: now,
    };
    definitions.push(definition);
  }
  Object.assign(definition, {
    campaign_id: campaignId,
    task_type: taskType,
    title: text(input.title, definition.title || taskType),
    description: text(input.description, definition.description || ""),
    required: Boolean(input.required),
    display_order: Number(input.displayOrder || input.display_order || definition.display_order || 10),
    status: text(input.status, definition.status || "ACTIVE").toUpperCase(),
    config_json: {
      ...objectValue(definition.config_json),
      ...objectValue(input.config || input.config_json),
    },
    updated_at: now,
  });
  return definition;
}

module.exports = {
  DEFAULT_TASK_DEFINITIONS,
  TASK_TYPES,
  computeTaskProgress,
  getProgressView,
  listTaskDefinitions,
  recordTaskEvent,
  upsertProgressSnapshot,
  upsertTaskDefinition,
};
