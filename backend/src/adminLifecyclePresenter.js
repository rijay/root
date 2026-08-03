const adminUserPresenter = require("./adminUserPresenter");
const consultationFollowup = require("./consultationFollowup");
const lifecycleExportPolicy = require("./adminLifecycleExportPolicy");
const { listVerifiedWechatUnionIdAuthorities } = require("./wechatUnionIdAuthority");

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function latestBy(items, field) {
  return items.slice().sort((left, right) => String(right[field] || "").localeCompare(String(left[field] || "")))[0] || null;
}

function text(value) {
  return String(value || "").trim();
}

function upperText(value) {
  return text(value).toUpperCase();
}

function identitySummary(data, rootUserId, options = {}) {
  const identities = ensureList(data, "wechatIdentities").filter((item) => item.root_user_id === rootUserId);
  const authorities = listVerifiedWechatUnionIdAuthorities(identities, { env: options.env || process.env });
  const verifiedUnionIds = [...new Set(authorities.map((item) => item.unionid))];
  const linkedUnionid = verifiedUnionIds.length === 1 ? verifiedUnionIds[0] : "";
  return {
    unionidStatus: linkedUnionid ? "LINKED" : "PENDING",
    unionid: linkedUnionid,
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

function lifecycleSummary(data, rootUserId) {
  const events = ensureList(data, "userLifecycleEvents").filter((item) => item.root_user_id === rootUserId);
  const latest = latestBy(events, "occurred_at");
  return {
    lifecycleEventCount: events.length,
    latestLifecycleEvent: latest ? latest.event_type : "",
    latestLifecycleAt: latest ? latest.occurred_at : "",
  };
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
  };
}

function activitySummary(data, rootUserId) {
  const enrollments = ensureList(data, "activityEnrollments")
    .filter((item) => item.root_user_id === rootUserId)
    .sort((left, right) => String(right.updated_at || right.created_at || "").localeCompare(String(left.updated_at || left.created_at || "")));
  const latest = enrollments[0] || null;
  return {
    enrollmentCount: enrollments.length,
    activeEnrollmentCount: enrollments.filter((item) => !["CANCELED", "REJECTED"].includes(item.status)).length,
    latestEnrollmentStatus: latest ? latest.status : "",
    latestActivitySessionId: latest ? latest.activity_session_id : "",
  };
}

function consultationStatus(summary) {
  if (summary.pendingCount > 0 || summary.openTaskCount > 0) return "PENDING";
  if (summary.handledCount > 0) return "HANDLED";
  if (summary.totalCount > 0) return "RECORDED";
  return "NONE";
}

function rootUserForLegacyUser(data, user) {
  return ensureList(data, "rootUsers").find((item) => item.root_user_id === (user.root_user_id || user.user_id)) || null;
}

function lifecycleRow(data, user, options = {}) {
  const rootUserId = user.root_user_id || user.user_id;
  const rootUser = rootUserForLegacyUser(data, user);
  const ops = adminUserPresenter.buildAdminUserDetailSummary(data, user.user_id) || {};
  const consultation = consultationFollowup.adminSummary(data, user);
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
    ...identitySummary(data, rootUserId, options),
    ...contactSummary(data, rootUserId),
    ...lifecycleSummary(data, rootUserId),
    questionnaireSummary: questionnaireSummary(data, rootUserId),
    activitySummary: activitySummary(data, rootUserId),
    consultationSummary: consultation,
    consultationStatus: consultationStatus(consultation),
  };
  return { ...row, hasOpenTasks: row.openTaskCount > 0 };
}

function matchesKeyword(row, keyword) {
  if (!keyword) return true;
  return [
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
  ].join(" ").toLowerCase().includes(keyword.toLowerCase());
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function normalizeLifecycleFilters(query = {}) {
  return {
    keyword: text(query.keyword),
    state: text(query.state),
    unionidStatus: upperText(query.unionidStatus || query.unionid_status),
    consultationStatus: upperText(query.consultationStatus || query.consultation_status),
    activityStatus: upperText(query.activityStatus || query.activity_status),
    blockage: text(query.blockage || query.currentBlockage || query.current_blockage),
    severity: upperText(query.severity),
    openTasks: upperText(query.openTasks || query.open_tasks),
    limit: clampNumber(query.limit || 100, 100, 1, 200),
  };
}

function filteredLifecycleRows(data, query = {}, options = {}) {
  const filters = normalizeLifecycleFilters(query);
  const rows = ensureList(data, "users")
    .map((user) => lifecycleRow(data, user, options))
    .filter((row) => matchesKeyword(row, filters.keyword))
    .filter((row) => !filters.state || row.state === filters.state)
    .filter((row) => !filters.unionidStatus || row.unionidStatus === filters.unionidStatus)
    .filter((row) => !filters.consultationStatus || row.consultationStatus === filters.consultationStatus)
    .filter((row) => !filters.activityStatus || row.activitySummary.latestEnrollmentStatus === filters.activityStatus)
    .filter((row) => !filters.blockage || row.currentBlockage.includes(filters.blockage))
    .filter((row) => !filters.severity || row.severity === filters.severity)
    .filter((row) => !filters.openTasks || (filters.openTasks === "HAS_OPEN_TASKS" ? row.hasOpenTasks : !row.hasOpenTasks))
    .sort((left, right) => right.openTaskCount - left.openTaskCount
      || String(right.latestLifecycleAt || right.updatedAt || "").localeCompare(String(left.latestLifecycleAt || left.updatedAt || "")));
  return { filters, rows };
}

function metrics(rows) {
  return {
    totalUsers: rows.length,
    unionidLinked: rows.filter((row) => row.unionidStatus === "LINKED").length,
    pendingUnionid: rows.filter((row) => row.unionidStatus !== "LINKED").length,
    healthProfiledUsers: rows.filter((row) => row.questionnaireSummary.answerCount > 0).length,
    activeActivityUsers: rows.filter((row) => row.activitySummary.activeEnrollmentCount > 0).length,
    pendingConsultations: rows.reduce((sum, row) => sum + row.consultationSummary.pendingCount, 0),
    overdueConsultations: rows.reduce((sum, row) => sum + Number(row.consultationSummary.slaOverdueCount || 0), 0),
    openTasks: rows.reduce((sum, row) => sum + row.openTaskCount, 0),
  };
}

function buildLifecycleWorkbench(data, query = {}, options = {}) {
  const { filters, rows } = filteredLifecycleRows(data, query, options);
  return { metrics: metrics(rows), users: rows.slice(0, filters.limit), total: rows.length, filters };
}

function batchSelectionUser(row) {
  return {
    rootUserId: row.rootUserId,
    userId: row.userId,
    nickname: row.nickname,
    phone: row.phone || row.verifiedPhone || "",
    unionidStatus: row.unionidStatus,
    consultationStatus: row.consultationStatus,
    activityStatus: row.activitySummary.latestEnrollmentStatus,
  };
}

function buildLifecycleBatchSelection(data, query = {}, options = {}) {
  const { filters, rows } = filteredLifecycleRows(data, query, options);
  const selectionLimit = clampNumber(query.selectionLimit || query.selection_limit || 500, 500, 1, 1000);
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

function csvCell(value) {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function csvLine(values) {
  return values.map(csvCell).join(",");
}

function buildLifecycleUsersCsv(data, query = {}, options = {}) {
  const workbench = buildLifecycleWorkbench(data, query, options);
  const policy = options.exportPolicy || lifecycleExportPolicy.resolveLifecycleExportPolicy(query, options);
  const lines = [csvLine([
    "root_user_id", "user_id", "nickname", "phone", "verified_phone", "state",
    "unionid_status", "unionid", "openid_list", "health_answer_count",
    "activity_enrollment_count", "latest_activity_status", "consultation_status",
    "pending_consultations", "current_blockage", "severity", "open_task_count",
    "next_action", "latest_lifecycle_event", "latest_lifecycle_at",
  ])];
  workbench.users.forEach((row) => {
    const item = lifecycleExportPolicy.applyLifecycleRowExportPolicy(row, policy);
    lines.push(csvLine([
      item.rootUserId, item.userId, item.nickname, item.phone, item.verifiedPhone, item.state,
      item.unionidStatus, item.unionid, item.openidList.join(" | "), item.questionnaireSummary.answerCount,
      item.activitySummary.enrollmentCount, item.activitySummary.latestEnrollmentStatus, item.consultationStatus,
      item.consultationSummary.pendingCount, item.currentBlockage, item.severity, item.openTaskCount,
      item.nextAction, item.latestLifecycleEvent, item.latestLifecycleAt,
    ]));
  });
  return `${lines.join("\n")}\n`;
}

module.exports = {
  buildLifecycleBatchSelection,
  buildLifecycleWorkbench,
  buildLifecycleUsersCsv,
};
