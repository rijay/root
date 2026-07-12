const adminUserPresenter = require("./adminUserPresenter");
const campaign = require("./campaign");
const consultationFollowup = require("./consultationFollowup");
const lifecycleExportPolicy = require("./adminLifecycleExportPolicy");
const rewardGrant = require("./rewardGrant");
const settlement = require("./settlement");
const taskProgress = require("./taskProgress");

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function latestBy(items, field) {
  return items.slice().sort((left, right) => String(right[field] || "").localeCompare(String(left[field] || "")))[0] || null;
}

function matchesKeyword(row, keyword) {
  if (!keyword) return true;
  const haystack = [
    row.rootUserId,
    row.userId,
    row.nickname,
    row.phone,
    row.unionid,
    row.unionidStatus,
    row.openidList.join(" "),
    row.latestLifecycleEvent,
    row.currentBlockage,
    row.nextAction,
    row.consultationSummary.latestLabel,
    row.consultationSummary.latest ? row.consultationSummary.latest.consultationTypeLabel : "",
  ].join(" ").toLowerCase();
  return haystack.includes(keyword.toLowerCase());
}

function upperText(value) {
  return String(value || "").trim().toUpperCase();
}

function text(value) {
  return String(value || "").trim();
}

function identitySummary(data, rootUserId) {
  const identities = ensureList(data, "wechatIdentities").filter((item) => item.root_user_id === rootUserId);
  const linkedUnion = identities.find((item) => item.unionid);
  return {
    unionidStatus: linkedUnion ? "LINKED" : "PENDING",
    unionid: linkedUnion ? linkedUnion.unionid : "",
    openidList: identities.map((item) => `${item.app_code || "MYROOT"}:${item.openid}`).filter(Boolean),
    identityCount: identities.length,
  };
}

function contactSummary(data, rootUserId) {
  const contacts = ensureList(data, "userContactMethods").filter((item) => item.root_user_id === rootUserId);
  const phone = contacts.find((item) => item.contact_type === "PHONE" && item.status !== "REVOKED");
  return {
    contactCount: contacts.length,
    verifiedPhone: phone ? phone.contact_value : "",
  };
}

function latestLifecycle(data, rootUserId) {
  const events = ensureList(data, "userLifecycleEvents").filter((item) => item.root_user_id === rootUserId);
  const latest = latestBy(events, "occurred_at");
  return {
    lifecycleEventCount: events.length,
    latestLifecycleEvent: latest ? latest.event_type : "",
    latestLifecycleAt: latest ? latest.occurred_at : "",
  };
}

function latestSettlement(data, rootUserId) {
  const record = latestBy(ensureList(data, "settlementRecords").filter((item) => item.root_user_id === rootUserId), "created_at");
  return record ? settlement.toSettlementRecordPayload(record) : null;
}

function rewardSummary(data, rootUserId) {
  const grants = rewardGrant.listRewardGrants(data, { rootUserId });
  return {
    rewardCount: grants.length,
    pendingRewardCount: grants.filter((item) => ["PENDING_DELIVERY", "PENDING_REVIEW"].includes(item.status)).length,
    latestRewardStatus: grants[0] ? grants[0].status : "",
  };
}

function answerText(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return value.join("、");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function questionnaireSummary(data, rootUserId) {
  const answers = ensureList(data, "questionnaireAnswers")
    .filter((item) => item.root_user_id === rootUserId)
    .sort((left, right) => String(right.submitted_at || "").localeCompare(String(left.submitted_at || "")));
  const latest = answers[0] || null;
  return {
    answerCount: answers.length,
    latestQuestionnaireId: latest ? latest.questionnaire_id : "",
    latestSubmittedAt: latest ? latest.submitted_at : "",
    latestNeedsFollow: latest ? Boolean(latest.needs_follow) : false,
    answers: answers.slice(0, 6).map((item) => {
      const answersJson = item.answers_json || {};
      return {
        questionnaireAnswerId: item.questionnaire_answer_id,
        campaignId: item.campaign_id,
        questionnaireId: item.questionnaire_id,
        version: item.version,
        submittedAt: item.submitted_at,
        needsFollow: Boolean(item.needs_follow),
        answerSummary: Object.entries(answersJson)
          .map(([key, value]) => `${key}: ${answerText(value)}`)
          .join("；"),
      };
    }),
  };
}

function taskProgressStatus(taskSummary) {
  if (taskSummary.settlementReady) return "SETTLEMENT_READY";
  if (Number(taskSummary.progressPercent || 0) >= 100) return "COMPLETED";
  if (Number(taskSummary.progressPercent || 0) > 0) return "IN_PROGRESS";
  return "NOT_STARTED";
}

function consultationStatus(summary) {
  if (summary.pendingCount > 0 || summary.openTaskCount > 0) return "PENDING";
  if (summary.handledCount > 0) return "HANDLED";
  if (summary.totalCount > 0) return "RECORDED";
  return "NONE";
}

function settlementStatus(row) {
  if (row.latestSettlement?.status) return row.latestSettlement.status;
  if (row.taskSummary.settlementReady) return "SETTLEMENT_READY";
  return "NOT_SETTLED";
}

function rewardStatus(summary) {
  if (!summary.rewardCount) return "NONE";
  if (summary.pendingRewardCount > 0) return "PENDING";
  return summary.latestRewardStatus || "RECORDED";
}

function activeCampaignId(data, rootUserId) {
  const participant = latestBy(ensureList(data, "campaignParticipants").filter((item) => item.root_user_id === rootUserId), "joined_at");
  return participant ? participant.campaign_id : campaign.DEFAULT_CAMPAIGN_ID;
}

function taskSummary(data, rootUserId) {
  const campaignId = activeCampaignId(data, rootUserId);
  const progress = taskProgress.computeTaskProgress(data, rootUserId, campaignId);
  return {
    campaignId,
    progressPercent: progress.summary.progressPercent,
    requiredCompletedTasks: progress.summary.requiredCompletedTasks,
    requiredTasks: progress.summary.requiredTasks,
    settlementReady: progress.summary.settlementReady,
  };
}

function rootUserForLegacyUser(data, user) {
  return ensureList(data, "rootUsers").find((item) => item.root_user_id === (user.root_user_id || user.user_id)) || null;
}

function lifecycleRow(data, user) {
  const rootUserId = user.root_user_id || user.user_id;
  const rootUser = rootUserForLegacyUser(data, user);
  const ops = adminUserPresenter.buildAdminUserDetailSummary(data, user.user_id) || {};
  const task = taskSummary(data, rootUserId);
  const consultation = consultationFollowup.adminSummary(data, user);
  const settlementRecord = latestSettlement(data, rootUserId);
  const rewards = rewardSummary(data, rootUserId);
  const questionnaires = questionnaireSummary(data, rootUserId);
  const row = {
    userId: user.user_id,
    rootUserId,
    nickname: user.nickname || "ROOT用户",
    phone: user.phone || "",
    appCode: rootUser ? rootUser.app_code : user.app_code || "MYROOT",
    state: user.state || "",
    createdAt: rootUser ? rootUser.created_at : user.created_at || "",
    updatedAt: rootUser ? rootUser.updated_at : user.updated_at || "",
    currentBlockage: ops.currentBlockage || "",
    nextAction: ops.nextAction || "",
    severity: ops.severity || "LOW",
    orderStatusLabel: ops.orderStatusLabel || "暂无订单",
    totalRecords: ops.totalRecords || 0,
    openTaskCount: ops.openTaskCount || 0,
    ...identitySummary(data, rootUserId),
    ...contactSummary(data, rootUserId),
    ...latestLifecycle(data, rootUserId),
    taskSummary: task,
    consultationSummary: consultation,
    questionnaireSummary: questionnaires,
    latestSettlement: settlementRecord,
    rewardSummary: rewards,
  };
  return {
    ...row,
    taskProgressStatus: taskProgressStatus(task),
    consultationStatus: consultationStatus(consultation),
    settlementStatus: settlementStatus(row),
    rewardStatus: rewardStatus(rewards),
    hasOpenTasks: row.openTaskCount > 0,
  };
}

function metrics(rows) {
  return {
    totalUsers: rows.length,
    unionidLinked: rows.filter((row) => row.unionidStatus === "LINKED").length,
    pendingUnionid: rows.filter((row) => row.unionidStatus !== "LINKED").length,
    settlementReady: rows.filter((row) => row.taskSummary.settlementReady).length,
    pendingConsultations: rows.reduce((sum, row) => sum + row.consultationSummary.pendingCount, 0),
    overdueConsultations: rows.reduce((sum, row) => sum + Number(row.consultationSummary.slaOverdueCount || 0), 0),
    openTasks: rows.reduce((sum, row) => sum + row.openTaskCount, 0),
    pendingRewards: rows.reduce((sum, row) => sum + row.rewardSummary.pendingRewardCount, 0),
  };
}

function csvCell(value) {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function csvLine(values) {
  return values.map(csvCell).join(",");
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function normalizeLifecycleFilters(query = {}) {
  const keyword = String(query.keyword || "").trim();
  const state = String(query.state || "").trim();
  const unionidStatus = String(query.unionidStatus || query.unionid_status || "").trim().toUpperCase();
  const campaignId = text(query.campaignId || query.campaign_id);
  const taskProgressFilter = upperText(query.taskProgress || query.task_progress);
  const consultationFilter = upperText(query.consultationStatus || query.consultation_status);
  const settlementFilter = upperText(query.settlementStatus || query.settlement_status);
  const rewardFilter = upperText(query.rewardStatus || query.reward_status);
  const blockage = text(query.blockage || query.currentBlockage || query.current_blockage);
  const severity = upperText(query.severity);
  const openTasks = upperText(query.openTasks || query.open_tasks);
  const limit = clampNumber(query.limit || 100, 100, 1, 200);
  return {
    keyword,
    state,
    unionidStatus,
    campaignId,
    taskProgress: taskProgressFilter,
    consultationStatus: consultationFilter,
    settlementStatus: settlementFilter,
    rewardStatus: rewardFilter,
    blockage,
    severity,
    openTasks,
    limit,
  };
}

function filteredLifecycleRows(data, query = {}) {
  const filters = normalizeLifecycleFilters(query);
  const allRows = ensureList(data, "users")
    .map((user) => lifecycleRow(data, user))
    .filter((row) => matchesKeyword(row, filters.keyword))
    .filter((row) => !filters.state || row.state === filters.state)
    .filter((row) => !filters.unionidStatus || row.unionidStatus === filters.unionidStatus)
    .filter((row) => !filters.campaignId || row.taskSummary.campaignId === filters.campaignId)
    .filter((row) => !filters.taskProgress || row.taskProgressStatus === filters.taskProgress)
    .filter((row) => !filters.consultationStatus || row.consultationStatus === filters.consultationStatus)
    .filter((row) => !filters.settlementStatus || row.settlementStatus === filters.settlementStatus || (filters.settlementStatus === "SETTLEMENT_READY" && row.taskSummary.settlementReady))
    .filter((row) => !filters.rewardStatus || row.rewardStatus === filters.rewardStatus || (filters.rewardStatus === "PENDING" && row.rewardSummary.pendingRewardCount > 0))
    .filter((row) => !filters.blockage || row.currentBlockage.includes(filters.blockage))
    .filter((row) => !filters.severity || row.severity === filters.severity)
    .filter((row) => !filters.openTasks || (filters.openTasks === "HAS_OPEN_TASKS" ? row.hasOpenTasks : !row.hasOpenTasks))
    .sort((left, right) => {
      return right.openTaskCount - left.openTaskCount
        || String(right.latestLifecycleAt || right.updatedAt || "").localeCompare(String(left.latestLifecycleAt || left.updatedAt || ""));
    });
  return { filters, rows: allRows };
}

function buildLifecycleWorkbench(data, query = {}) {
  const { filters, rows } = filteredLifecycleRows(data, query);
  return {
    metrics: metrics(rows),
    users: rows.slice(0, filters.limit),
    total: rows.length,
    filters,
  };
}

function batchSelectionUser(row) {
  return {
    rootUserId: row.rootUserId,
    userId: row.userId,
    nickname: row.nickname,
    phone: row.phone || row.verifiedPhone || "",
    unionidStatus: row.unionidStatus,
    campaignId: row.taskSummary.campaignId,
    taskProgressStatus: row.taskProgressStatus,
    settlementStatus: row.settlementStatus,
    rewardStatus: row.rewardStatus,
    consultationStatus: row.consultationStatus,
  };
}

function buildLifecycleBatchSelection(data, query = {}) {
  const { filters, rows } = filteredLifecycleRows(data, query);
  const selectionLimit = clampNumber(
    query.selectionLimit || query.selection_limit || query.batchLimit || query.batch_limit || 500,
    500,
    1,
    1000,
  );
  const selectedRows = rows.slice(0, selectionLimit);
  return {
    source: "LIFECYCLE_FILTER",
    total: rows.length,
    selectionLimit,
    selectedCount: selectedRows.length,
    truncated: rows.length > selectedRows.length,
    filters,
    rootUserIds: selectedRows.map((row) => row.rootUserId),
    users: selectedRows.map(batchSelectionUser),
  };
}

function buildLifecycleUsersCsv(data, query = {}, options = {}) {
  const workbench = buildLifecycleWorkbench(data, query);
  const policy = options.exportPolicy || lifecycleExportPolicy.resolveLifecycleExportPolicy(query, options);
  const lines = [
    csvLine([
      "root_user_id",
      "user_id",
      "nickname",
      "phone",
      "verified_phone",
      "state",
      "unionid_status",
      "unionid",
      "openid_list",
      "campaign_id",
      "task_progress_status",
      "progress_percent",
      "required_completed_tasks",
      "required_tasks",
      "consultation_status",
      "pending_consultations",
      "settlement_status",
      "latest_settlement_status",
      "reward_status",
      "reward_count",
      "pending_reward_count",
      "current_blockage",
      "severity",
      "open_task_count",
      "next_action",
      "latest_lifecycle_event",
      "latest_lifecycle_at",
    ]),
  ];
  workbench.users.forEach((row) => {
    const exportRow = lifecycleExportPolicy.applyLifecycleRowExportPolicy(row, policy);
    lines.push(csvLine([
      exportRow.rootUserId,
      exportRow.userId,
      exportRow.nickname,
      exportRow.phone,
      exportRow.verifiedPhone,
      exportRow.state,
      exportRow.unionidStatus,
      exportRow.unionid,
      exportRow.openidList.join(" | "),
      exportRow.taskSummary.campaignId,
      exportRow.taskProgressStatus,
      exportRow.taskSummary.progressPercent,
      exportRow.taskSummary.requiredCompletedTasks,
      exportRow.taskSummary.requiredTasks,
      exportRow.consultationStatus,
      exportRow.consultationSummary.pendingCount,
      exportRow.settlementStatus,
      exportRow.latestSettlement?.status || "",
      exportRow.rewardStatus,
      exportRow.rewardSummary.rewardCount,
      exportRow.rewardSummary.pendingRewardCount,
      exportRow.currentBlockage,
      exportRow.severity,
      exportRow.openTaskCount,
      exportRow.nextAction,
      exportRow.latestLifecycleEvent,
      exportRow.latestLifecycleAt,
    ]));
  });
  return `${lines.join("\n")}\n`;
}

module.exports = {
  buildLifecycleBatchSelection,
  buildLifecycleWorkbench,
  buildLifecycleUsersCsv,
};
