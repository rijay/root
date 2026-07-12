const operationTask = require("./operationTask");
const consultationSla = require("./consultationSla");

const FOLLOW_TASK_TYPE = "CONSULTATION_FOLLOW";

const TOPICS = {
  ORDER: {
    label: "订单与物流",
    action: "核对用户订单同步、发货或物流状态，并把结果回写到待办备注。",
    script: "看到你咨询订单和物流问题了，我先帮你核对购买记录和配送状态。",
  },
  TASK: {
    label: "打卡与问卷",
    action: "检查用户任务进度、打卡或问卷记录，必要时说明补记方式。",
    script: "看到你咨询打卡或问卷问题了，我先帮你看一下当前任务进度。",
  },
  REWARD: {
    label: "奖励与复核",
    action: "核对结算、奖励发放和人工复核状态，并同步下一步处理结果。",
    script: "看到你咨询奖励或复核问题了，我先帮你确认当前处理进度。",
  },
  BODY_FEEDBACK: {
    label: "身体反馈",
    action: "联系用户确认反馈背景，必要时升级给负责人处理。",
    script: "看到你的身体反馈了，我来确认一下具体情况，方便我们继续跟进体验。",
  },
};

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function topicKey(value) {
  const key = String(value || "").trim().toUpperCase();
  return TOPICS[key] ? key : "ORDER";
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

function consultationEventsFor(data, rootUserId) {
  return ensureList(data, "taskEvents")
    .filter((event) => event.root_user_id === rootUserId && event.task_type === "CONSULTATION" && event.status !== "VOID")
    .sort((left, right) => String(right.occurred_at || right.created_at || "").localeCompare(String(left.occurred_at || left.created_at || "")));
}

function followTaskForEvent(data, event) {
  const eventId = event.task_event_id || "";
  return ensureList(data, "operationTasks").find((task) => {
    const metadata = task.metadata || {};
    return task.task_type === FOLLOW_TASK_TYPE && (metadata.taskEventId === eventId || task.dedupe_key === `event:${eventId}`);
  }) || null;
}

function statusView(task) {
  if (!task) {
    return {
      status: "RECORDED",
      label: "已记录",
      tone: "pending",
      copy: "咨询已进入记录，顾问待确认。",
    };
  }
  if (task.status === "DONE") {
    return {
      status: "DONE",
      label: "已跟进",
      tone: "done",
      copy: task.note || task.result || "顾问已完成本次跟进。",
    };
  }
  if (task.status === "SKIPPED") {
    return {
      status: "SKIPPED",
      label: "已关闭",
      tone: "muted",
      copy: task.note || task.result || "本次咨询已关闭。",
    };
  }
  return {
    status: "PENDING",
    label: "待跟进",
    tone: "pending",
    copy: "顾问会结合你的咨询主题继续处理。",
  };
}

function buildItem(data, event) {
  const payload = event.payload_json || {};
  const topic = topicView(payload.consultationType || payload.consultation_type);
  const task = followTaskForEvent(data, event);
  const metadata = task ? task.metadata || {} : {};
  const status = statusView(task);
  const sla = task && task.status === "OPEN" ? consultationSla.taskSlaView(task) : null;
  return {
    consultationId: event.task_event_id,
    taskEventId: event.task_event_id,
    campaignId: event.campaign_id,
    consultationType: topic.key,
    consultationTypeLabel: topic.label,
    scene: payload.scene || "",
    taskDate: event.task_date,
    recordedAt: event.occurred_at || event.created_at || "",
    sourceChannel: event.source_channel || "",
    status: status.status,
    statusLabel: status.label,
    statusTone: status.tone,
    statusCopy: status.copy,
    followTaskId: task ? task.task_id : "",
    followTaskStatus: task ? task.status : "",
    followResult: task ? task.result || "" : "",
    followNote: task ? task.note || "" : "",
    followedAt: task ? task.completed_at || "" : "",
    assignedAdvisorId: metadata.assignedAdvisorId || "",
    assignedAdvisorName: metadata.assignedAdvisorName || "",
    assignedAdvisorRole: metadata.assignedAdvisorRole || "",
    assignedAt: metadata.assignedAt || "",
    assignmentId: metadata.assignmentId || "",
    assignedAdvisorLabel: metadata.assignedAdvisorName || metadata.assignedAdvisorId || "",
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
  return consultationEventsFor(data, rootUserId).map((event) => buildItem(data, event));
}

function summaryFor(items) {
  const pendingCount = items.filter((item) => item.status === "PENDING" || item.status === "RECORDED").length;
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
  return {
    summary: summaryFor(items),
    consultations: items.slice(0, 10),
  };
}

function createFollowTaskForEvent(data, user, event) {
  if (!event || event.task_type !== "CONSULTATION") return null;
  const payload = event.payload_json || {};
  const topic = topicView(payload.consultationType || payload.consultation_type);
  const result = operationTask.createOperationTaskOnce(data, {
    task_type: FOLLOW_TASK_TYPE,
    user_id: user.user_id,
    order_id: "",
    task_date: event.task_date,
    dedupe_key: `event:${event.task_event_id}`,
    reason: `${topic.label}咨询待跟进`,
    suggested_action: topic.action,
    suggested_script: topic.script,
    metadata: {
      taskEventId: event.task_event_id,
      rootUserId: event.root_user_id,
      campaignId: event.campaign_id,
      consultationType: topic.key,
      scene: payload.scene || "",
      sourceChannel: event.source_channel || "",
    },
  });
  return {
    created: result.created,
    task: result.task,
    item: buildItem(data, event),
  };
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
    assignedAdvisorId: (task.metadata || {}).assignedAdvisorId || "",
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
  createFollowTaskForEvent,
  listUserConsultations,
};
