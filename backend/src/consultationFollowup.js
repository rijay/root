const { nowISO, todayISO } = require("./dates");
const operationTask = require("./operationTask");
const consultationSla = require("./consultationSla");
const { createId } = require("./seed");

const FOLLOW_TASK_TYPE = "CONSULTATION_FOLLOW";

const TOPICS = {
  ORDER: {
    label: "订单与物流",
    action: "核对用户订单、发货或物流状态，并把结果回写到待办备注。",
    script: "看到你咨询订单和物流问题了，我先帮你核对购买记录和配送状态。",
  },
  PRODUCT: {
    label: "产品使用",
    action: "确认用户的问题背景，并按已批准的产品说明进行回复。",
    script: "看到你的产品使用问题了，我先了解一下具体情况。",
  },
  BODY_FEEDBACK: {
    label: "身体反馈",
    action: "联系用户确认反馈背景，必要时升级给负责人处理。",
    script: "看到你的身体反馈了，我来确认一下具体情况，方便我们继续跟进体验。",
  },
  OTHER: {
    label: "其他问题",
    action: "确认用户问题并转交合适的运营负责人处理。",
    script: "看到你的咨询了，我先确认一下具体问题。",
  },
};

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function topicKey(value) {
  const key = text(value).toUpperCase();
  return TOPICS[key] ? key : "OTHER";
}

function topicView(value) {
  const key = topicKey(value);
  return { key, ...TOPICS[key] };
}

function rootUserIdFor(user) {
  return user.root_user_id || user.rootUserId || user.user_id || user.userId || "";
}

function legacyUserForRoot(data, rootUserId) {
  return ensureList(data, "users").find((user) => (user.root_user_id || user.user_id) === rootUserId) || null;
}

function metadataFor(task = {}) {
  return task.metadata && typeof task.metadata === "object" ? task.metadata : {};
}

function consultationTasksFor(data, rootUserId) {
  return ensureList(data, "operationTasks")
    .filter((task) => task.task_type === FOLLOW_TASK_TYPE)
    .filter((task) => metadataFor(task).rootUserId === rootUserId)
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
}

function statusView(task) {
  if (task.status === "DONE") {
    return { status: "DONE", label: "已跟进", tone: "done", copy: task.note || task.result || "顾问已完成本次跟进。" };
  }
  if (task.status === "SKIPPED") {
    return { status: "SKIPPED", label: "已关闭", tone: "muted", copy: task.note || task.result || "本次咨询已关闭。" };
  }
  return { status: "PENDING", label: "待跟进", tone: "pending", copy: "顾问会结合你的咨询主题继续处理。" };
}

function buildItem(task) {
  const metadata = metadataFor(task);
  const topic = topicView(metadata.consultationType);
  const status = statusView(task);
  const sla = task.status === "OPEN" ? consultationSla.taskSlaView(task) : null;
  return {
    consultationId: text(metadata.consultationId),
    rootUserId: text(metadata.rootUserId),
    campaignId: text(metadata.campaignId),
    consultationType: topic.key,
    consultationTypeLabel: topic.label,
    scene: text(metadata.scene),
    recordedAt: text(metadata.recordedAt || task.created_at),
    sourceChannel: text(metadata.sourceChannel),
    status: status.status,
    statusLabel: status.label,
    statusTone: status.tone,
    statusCopy: status.copy,
    followTaskId: task.task_id,
    followTaskStatus: task.status,
    followResult: task.result || "",
    followNote: task.note || "",
    followedAt: task.completed_at || "",
    assignedAdvisorId: text(metadata.assignedAdvisorId),
    assignedAdvisorName: text(metadata.assignedAdvisorName),
    assignedAdvisorRole: text(metadata.assignedAdvisorRole),
    assignedAt: text(metadata.assignedAt),
    assignmentId: text(metadata.assignmentId),
    assignedAdvisorLabel: text(metadata.assignedAdvisorName || metadata.assignedAdvisorId),
    slaStatus: sla ? sla.status : "",
    slaStatusLabel: sla ? sla.statusLabel : "",
    slaDueAt: sla ? sla.dueAt : "",
    slaMinutes: sla ? sla.slaMinutes : 0,
    slaAgeMinutes: sla ? sla.ageMinutes : 0,
    slaOverdueMinutes: sla ? sla.overdueMinutes : 0,
  };
}

function listUserConsultations(data, userOrRootUserId) {
  const rootUserId = typeof userOrRootUserId === "string" ? userOrRootUserId : rootUserIdFor(userOrRootUserId);
  return consultationTasksFor(data, rootUserId).map(buildItem);
}

function summaryFor(items) {
  const pendingCount = items.filter((item) => item.status === "PENDING").length;
  const handledCount = items.filter((item) => item.status === "DONE").length;
  const latest = items[0] || null;
  return {
    totalCount: items.length,
    pendingCount,
    handledCount,
    latestStatus: latest ? latest.status : "",
    latestLabel: latest ? latest.statusLabel : "暂无咨询",
    latestAssignedAdvisor: latest ? latest.assignedAdvisorLabel || "" : "",
    title: pendingCount > 0 ? "顾问待跟进" : handledCount > 0 ? "最近咨询已处理" : "暂无咨询记录",
    copy: pendingCount > 0
      ? "你的咨询已记录，顾问处理后会更新状态。"
      : handledCount > 0
        ? "最近一次咨询已有处理结果，如仍有问题可继续联系顾问。"
        : "选择咨询主题并联系顾问后，这里会展示跟进状态。",
  };
}

function buildUserView(data, user) {
  const items = listUserConsultations(data, user);
  return { summary: summaryFor(items), consultations: items.slice(0, 10) };
}

function consultationInput(user, input = {}) {
  const payload = input.payload && typeof input.payload === "object" && !Array.isArray(input.payload) ? input.payload : {};
  const idempotencyKey = typeof (input.idempotencyKey || input.idempotency_key) === "string"
    ? input.idempotencyKey || input.idempotency_key
    : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(idempotencyKey)) {
    const error = new Error("客服咨询幂等键无效");
    error.code = "CONSULTATION_IDEMPOTENCY_SCOPE_INVALID";
    error.status = 400;
    throw error;
  }
  const topic = topicView(input.consultationType || input.consultation_type || payload.consultationType || payload.consultation_type);
  return {
    rootUserId: rootUserIdFor(user),
    campaignId: text(input.campaignId || input.campaign_id),
    consultationType: topic.key,
    scene: text(input.scene || payload.scene),
    sourceChannel: text(input.sourceChannel || input.source_channel, "MINIPROGRAM_SUPPORT"),
    taskDate: text(input.taskDate || input.task_date || payload.taskDate || payload.task_date, todayISO()),
    idempotencyKey,
    topic,
  };
}

function sameRequest(metadata, input) {
  return metadata.rootUserId === input.rootUserId
    && text(metadata.campaignId) === input.campaignId
    && metadata.consultationType === input.consultationType
    && text(metadata.scene) === input.scene
    && text(metadata.sourceChannel) === input.sourceChannel
    && text(metadata.taskDate) === input.taskDate
    && metadata.idempotencyKey === input.idempotencyKey;
}

function consultationForKey(data, user, idempotencyKey) {
  return ensureList(data, "operationTasks").find((task) => {
    const metadata = metadataFor(task);
    return task.task_type === FOLLOW_TASK_TYPE
      && task.user_id === user.user_id
      && metadata.idempotencyKey === idempotencyKey;
  }) || null;
}

function recordConsultation(data, user, rawInput = {}) {
  const input = consultationInput(user, rawInput);
  const existing = consultationForKey(data, user, input.idempotencyKey);
  if (existing) {
    if (!sameRequest(metadataFor(existing), input)) {
      const error = new Error("相同客服咨询幂等键对应了不同请求");
      error.code = 40901;
      error.status = 409;
      throw error;
    }
    return { created: false, task: existing, item: buildItem(existing) };
  }
  const recordedAt = nowISO();
  const result = operationTask.createOperationTaskOnce(data, {
    task_type: FOLLOW_TASK_TYPE,
    user_id: user.user_id,
    order_id: "",
    task_date: input.taskDate,
    dedupe_key: `consultation:${input.idempotencyKey}`,
    reason: `${input.topic.label}咨询待跟进`,
    suggested_action: input.topic.action,
    suggested_script: input.topic.script,
    metadata: {
      consultationId: createId("csl"),
      rootUserId: input.rootUserId,
      campaignId: input.campaignId,
      consultationType: input.consultationType,
      scene: input.scene,
      sourceChannel: input.sourceChannel,
      taskDate: input.taskDate,
      recordedAt,
      idempotencyKey: input.idempotencyKey,
    },
  });
  return { created: result.created, task: result.task, item: buildItem(result.task) };
}

function adminSummary(data, userOrRootUserId) {
  const rootUserId = typeof userOrRootUserId === "string" ? userOrRootUserId : rootUserIdFor(userOrRootUserId);
  const user = legacyUserForRoot(data, rootUserId);
  const items = listUserConsultations(data, rootUserId);
  const summary = summaryFor(items);
  const openTasks = user
    ? ensureList(data, "operationTasks").filter((task) => task.user_id === user.user_id && task.task_type === FOLLOW_TASK_TYPE && task.status === "OPEN")
    : [];
  const slaItems = openTasks.map((task) => ({
    ...consultationSla.taskSlaView(task),
    assignedAdvisorId: metadataFor(task).assignedAdvisorId || "",
  }));
  const slaSummary = consultationSla.summarizeItems(slaItems);
  return {
    ...summary,
    openTaskCount: openTasks.length,
    slaSummary,
    slaOverdueCount: slaSummary.overdueCount,
    slaDueSoonCount: slaSummary.dueSoonCount,
    latest: items[0] || null,
  };
}

module.exports = {
  FOLLOW_TASK_TYPE,
  adminSummary,
  buildUserView,
  listUserConsultations,
  recordConsultation,
};
