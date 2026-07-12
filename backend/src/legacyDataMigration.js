function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function ensureList(data, key) {
  return Array.isArray(data && data[key]) ? data[key] : [];
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function countBy(items, fn) {
  return items.reduce((acc, item) => {
    const key = fn(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function statusRank(status) {
  if (status === "BLOCKED") return 3;
  if (status === "NEEDS_REVIEW") return 2;
  if (status === "READY") return 1;
  return 0;
}

function worstStatus(statuses) {
  return statuses.reduce((worst, status) => statusRank(status) > statusRank(worst) ? status : worst, "READY");
}

function findUser(data, userId) {
  return ensureList(data, "users").find((user) => user.user_id === userId || user.root_user_id === userId) || null;
}

function rootUserIdFor(data, userId) {
  const user = findUser(data, userId);
  if (user) return text(user.root_user_id || user.user_id);
  const rootUser = ensureList(data, "rootUsers").find((item) => item.root_user_id === userId);
  return rootUser ? rootUser.root_user_id : "";
}

function taskEventForRecord(events, session, record) {
  const expectedKey = `legacy-checkin:${session.session_id}:${record.day_index}`;
  return events.find((event) => {
    const payload = event.payload_json || {};
    return event.idempotency_key === expectedKey ||
      (
        event.task_type === "CHECKIN" &&
        payload.sessionId === session.session_id &&
        Number(payload.dayIndex || 0) === Number(record.day_index || 0)
      );
  }) || null;
}

function taskEventForQuestionnaire(events, session, questionnaireType) {
  return events.find((event) => {
    const payload = event.payload_json || {};
    return event.task_type === "QUESTIONNAIRE" &&
      payload.sessionId === session.session_id &&
      payload.questionnaireType === questionnaireType;
  }) || null;
}

function rowDecision(row) {
  if (!row.userExists) {
    return {
      status: "BLOCKED",
      decision: "MISSING_USER",
      nextAction: "先确认旧用户是否需要保留；缺少用户时不能自动补迁。",
    };
  }
  if (row.duplicateSessionId) {
    return {
      status: "BLOCKED",
      decision: "DUPLICATE_SESSION",
      nextAction: "先修正重复 session_id，再评估补迁。",
    };
  }
  if (row.sessionStatus === "ACTIVE") {
    return {
      status: "NEEDS_REVIEW",
      decision: "ACTIVE_SESSION_REVIEW",
      nextAction: "确认旧试饮期是否继续保留在旧流程，或转为新任务事实。",
    };
  }
  if (row.unbridgedCheckinRecords > 0 || row.unbridgedQuestionnaires > 0) {
    return {
      status: "NEEDS_REVIEW",
      decision: "CAN_BRIDGE_TASK_EVENTS",
      nextAction: "如需在新生命周期展示旧打卡，应先补写对应 task_event；否则保留只读归档。",
    };
  }
  if ((row.refundWorkItems > 0 || row.couponEvents > 0) && !row.hasRewardGrant) {
    return {
      status: "NEEDS_REVIEW",
      decision: "REWARD_OR_REVIEW_DECISION",
      nextAction: "旧退款/优惠券权益需要运营决定是否映射为 reward_grant 或 manual_review_item。",
    };
  }
  return {
    status: "NEEDS_REVIEW",
    decision: "ARCHIVE_ONLY",
    nextAction: "建议保留只读归档；如后续要进入新生命周期，再按 session 选择性补迁。",
  };
}

function buildSessionRows(data) {
  const sessions = ensureList(data, "checkinSessions");
  const records = ensureList(data, "checkinRecords");
  const questionnaires = ensureList(data, "questionnaireResponses");
  const coupons = ensureList(data, "couponEvents");
  const refunds = ensureList(data, "refundWorkItems");
  const events = ensureList(data, "taskEvents");
  const grants = ensureList(data, "rewardGrants");
  const reviews = ensureList(data, "manualReviewItems");
  const sessionIdCounts = countBy(sessions, (session) => text(session.session_id));

  return sessions.map((session) => {
    const sessionRecords = records.filter((record) => record.session_id === session.session_id);
    const bridgedTaskEvents = sessionRecords.filter((record) => taskEventForRecord(events, session, record)).length;
    const sessionQuestionnaires = questionnaires.filter((item) => item.session_id === session.session_id);
    const bridgedQuestionnaires = sessionQuestionnaires.filter((item) => {
      return taskEventForQuestionnaire(events, session, item.questionnaire_type || item.questionnaireType || "");
    }).length;
    const sessionCoupons = coupons.filter((coupon) => coupon.session_id === session.session_id);
    const sessionRefunds = refunds.filter((refund) => refund.session_id === session.session_id);
    const rootUserId = rootUserIdFor(data, session.user_id);
    const rewardEvidence = grants.some((grant) => {
      const payload = grant.payload_json || grant.payload || {};
      return grant.root_user_id === rootUserId &&
        (payload.legacySessionId === session.session_id || payload.sessionId === session.session_id);
    });
    const reviewEvidence = reviews.some((review) => {
      const metadata = review.metadata || review.metadata_json || {};
      return review.root_user_id === rootUserId &&
        (metadata.legacySessionId === session.session_id || metadata.sessionId === session.session_id);
    });
    const base = {
      sessionId: text(session.session_id),
      userId: text(session.user_id),
      rootUserId,
      userExists: Boolean(rootUserId),
      sessionStatus: text(session.status, "UNKNOWN"),
      startDate: text(session.start_date),
      endDate: text(session.end_date),
      orderId: text(session.order_id),
      checkinRecords: sessionRecords.length,
      bridgedTaskEvents,
      unbridgedCheckinRecords: Math.max(0, sessionRecords.length - bridgedTaskEvents),
      questionnaireResponses: sessionQuestionnaires.length,
      bridgedQuestionnaires,
      unbridgedQuestionnaires: Math.max(0, sessionQuestionnaires.length - bridgedQuestionnaires),
      couponEvents: sessionCoupons.length,
      refundWorkItems: sessionRefunds.length,
      hasRewardGrant: rewardEvidence,
      hasManualReview: reviewEvidence,
      duplicateSessionId: sessionIdCounts[text(session.session_id)] > 1,
    };
    return {
      ...base,
      ...rowDecision(base),
    };
  });
}

function orphanCount(list, sessions, key = "session_id") {
  const sessionIds = new Set(sessions.map((session) => text(session.session_id)).filter(Boolean));
  return list.filter((item) => item[key] && !sessionIds.has(item[key])).length;
}

function normalizeTarget(value) {
  return value === "production" ? "production" : "gray";
}

function latestDecision(options = {}) {
  return list(options.decisions)[0] || null;
}

function latestExecution(options = {}) {
  return list(options.executions)[0] || null;
}

function expectedAction(policy) {
  const normalized = text(policy).toUpperCase();
  if (normalized === "NO_LEGACY_DATA") return "NO_OP_CONFIRMED";
  if (normalized === "READ_ONLY_ARCHIVE") return "ARCHIVE_CONFIRMED";
  if (normalized === "SELECTIVE_BACKFILL") return "BACKFILL_EXECUTED";
  if (normalized === "MANUAL_REVIEW") return "MANUAL_REVIEW_CONFIRMED";
  return "";
}

function decisionStatus({ target, decision, legacyFactCount, blockers, warnings }) {
  if (!legacyFactCount) return;
  if (decision && decision.status === "REJECTED") {
    blockers.push(`旧 7 日历史数据生产处置决策为 REJECTED：${decision.note || "需重新确认处置策略"}`);
    return;
  }
  if (decision && decision.status === "APPROVED" && decision.policy === "NO_LEGACY_DATA") {
    blockers.push("旧数据迁移决策为 NO_LEGACY_DATA，但当前仍检测到旧试饮历史数据。");
    return;
  }
  if (!decision) {
    const message = "存在旧 7 日试饮历史数据，需记录只读归档、选择性补迁或人工处理的 APPROVED 决策。";
    if (target === "production") blockers.push(message);
    else warnings.push(message);
  }
}

function executionReadyForDecision(execution, decision) {
  if (!execution || !decision) return false;
  return execution.status === "VERIFIED" &&
    execution.decisionId === decision.decisionId &&
    execution.action === expectedAction(decision.policy);
}

function executionStatus({ target, decision, execution, legacyFactCount, blockers, warnings }) {
  if (!legacyFactCount || !decision || decision.status !== "APPROVED" || decision.policy === "NO_LEGACY_DATA") return;
  const expected = expectedAction(decision.policy);
  const messagePrefix = `旧数据生产处置决策 ${decision.policy} 需要执行历史 ${expected}`;
  const pushIssue = (message) => {
    if (target === "production") blockers.push(message);
    else warnings.push(message);
  };
  if (!execution) {
    pushIssue(`${messagePrefix}。`);
    return;
  }
  if (execution.status === "FAILED") {
    blockers.push(`旧数据生产处置执行历史为 FAILED：${execution.note || "需重新执行或改写决策"}`);
    return;
  }
  if (execution.decisionId !== decision.decisionId) {
    pushIssue("旧数据生产处置执行历史绑定的是旧决策，需按最新 APPROVED 决策重新记录。");
    return;
  }
  if (execution.action !== expected) {
    pushIssue(`${messagePrefix}，当前记录为 ${execution.action || "UNKNOWN"}。`);
  }
}

function buildLegacyDataMigrationPlan(data, options = {}) {
  const target = normalizeTarget(options.target);
  const sessions = ensureList(data, "checkinSessions");
  const records = ensureList(data, "checkinRecords");
  const questionnaires = ensureList(data, "questionnaireResponses");
  const coupons = ensureList(data, "couponEvents");
  const refunds = ensureList(data, "refundWorkItems");
  const rows = buildSessionRows(data);
  const orphanCoupons = orphanCount(coupons, sessions);
  const orphanRefunds = orphanCount(refunds, sessions);
  const rowStatuses = rows.map((row) => row.status);
  const blockers = [];
  const warnings = [];
  const decision = latestDecision(options);
  const execution = latestExecution(options);

  rows.filter((row) => row.status === "BLOCKED").forEach((row) => {
    blockers.push(`旧试饮 ${row.sessionId || row.userId}: ${row.nextAction}`);
  });
  if (orphanCoupons) blockers.push(`发现 ${orphanCoupons} 条旧优惠券记录缺少对应 checkin session`);
  if (orphanRefunds) blockers.push(`发现 ${orphanRefunds} 条旧退款工作项缺少对应 checkin session`);
  if (rows.length) {
    warnings.push("存在旧 7 日试饮历史数据，生产切换前需确认只读归档或选择性补迁策略。");
  }
  const unbridged = rows.reduce((sum, row) => sum + row.unbridgedCheckinRecords + row.unbridgedQuestionnaires, 0);
  if (unbridged) warnings.push(`发现 ${unbridged} 条旧打卡/问卷记录尚未桥接为新 task_event。`);
  const rewardDecisionCount = rows.filter((row) => row.decision === "REWARD_OR_REVIEW_DECISION").length;
  if (rewardDecisionCount) warnings.push(`发现 ${rewardDecisionCount} 个旧试饮周期含退款/优惠券权益，需确认是否映射为新奖励/复核记录。`);
  const activeCount = rows.filter((row) => row.decision === "ACTIVE_SESSION_REVIEW").length;
  if (activeCount) warnings.push(`发现 ${activeCount} 个旧 ACTIVE 试饮周期，需确认是否继续沿用旧流程。`);
  const legacyFactCount = rows.length + coupons.length + refunds.length + records.length + questionnaires.length;
  decisionStatus({ target, decision, legacyFactCount, blockers, warnings });
  executionStatus({ target, decision, execution, legacyFactCount, blockers, warnings });
  const executionReady = !legacyFactCount || executionReadyForDecision(execution, decision) || (decision && decision.policy === "NO_LEGACY_DATA" && !legacyFactCount);

  const status = blockers.length
    ? "BLOCKED"
    : legacyFactCount && !executionReady
      ? worstStatus(rowStatuses.concat("NEEDS_REVIEW"))
      : "READY";

  return {
    status,
    target,
    generatedAt: options.generatedAt || new Date().toISOString(),
    recommendedPolicy: rows.length ? "ARCHIVE_WITH_SELECTIVE_BRIDGE" : "NO_LEGACY_DATA",
    writeMode: false,
    decision: decision || {
      decisionId: "",
      target,
      policy: "",
      policyLabel: "",
      status: "PENDING",
      snapshotRef: "",
      dryRunRef: "",
      evidenceRef: "",
      operatorId: "",
      requestId: "",
      note: legacyFactCount ? "待记录旧数据生产处置决策" : "未发现旧数据，决策可选",
      decidedAt: "",
    },
    decisions: list(options.decisions).slice(0, 20),
    execution: execution || {
      executionId: "",
      target,
      decisionId: decision ? decision.decisionId : "",
      policy: decision ? decision.policy : "",
      policyLabel: decision ? decision.policyLabel : "",
      action: decision ? expectedAction(decision.policy) : "",
      actionLabel: "",
      status: "PENDING",
      snapshotRef: "",
      dryRunRef: "",
      executionRef: "",
      evidenceRef: "",
      affectedSessionCount: 0,
      affectedFactCount: 0,
      operatorId: "",
      requestId: "",
      note: legacyFactCount ? "待记录旧数据生产处置执行历史" : "未发现旧数据，执行历史可选",
      executedAt: "",
    },
    executions: list(options.executions).slice(0, 20),
    summary: {
      legacySessionCount: sessions.length,
      legacyCheckinRecordCount: records.length,
      legacyQuestionnaireResponseCount: questionnaires.length,
      legacyCouponEventCount: coupons.length,
      legacyRefundWorkItemCount: refunds.length,
      unbridgedFactCount: unbridged,
      archiveOnlyCount: rows.filter((row) => row.decision === "ARCHIVE_ONLY").length,
      bridgeCandidateCount: rows.filter((row) => row.decision === "CAN_BRIDGE_TASK_EVENTS").length,
      rewardDecisionCount,
      manualDecisionCount: rows.filter((row) => ["MISSING_USER", "DUPLICATE_SESSION", "ACTIVE_SESSION_REVIEW"].includes(row.decision)).length,
      orphanCouponCount: orphanCoupons,
      orphanRefundWorkItemCount: orphanRefunds,
      decisionApproved: Boolean(decision && decision.status === "APPROVED"),
      decisionRejected: Boolean(decision && decision.status === "REJECTED"),
      decisionRequired: Boolean(legacyFactCount),
      executionVerified: Boolean(execution && execution.status === "VERIFIED"),
      executionFailed: Boolean(execution && execution.status === "FAILED"),
      executionRequired: Boolean(legacyFactCount && decision && decision.status === "APPROVED" && decision.policy !== "NO_LEGACY_DATA"),
      blockerCount: blockers.length,
      warningCount: warnings.length,
    },
    collections: [
      { key: "checkinSessions", label: "旧试饮周期", count: sessions.length },
      { key: "checkinRecords", label: "旧打卡记录", count: records.length },
      { key: "questionnaireResponses", label: "旧问卷响应", count: questionnaires.length },
      { key: "couponEvents", label: "旧优惠券事件", count: coupons.length },
      { key: "refundWorkItems", label: "旧退款工作项", count: refunds.length },
    ],
    sessions: rows,
    blockers,
    warnings,
    nextActions: rows.length
      ? unique([
        "生产切换前确认旧 7 日试饮历史采用只读归档、选择性补迁或人工处理。",
        decision && decision.status === "APPROVED" ? "" : "在 Element Plus Admin 开发发布页记录旧数据生产处置 APPROVED 决策。",
        decision && decision.status === "APPROVED" && !executionReadyForDecision(execution, decision) && decision.policy !== "NO_LEGACY_DATA" ? "按最新 APPROVED 决策记录旧数据生产处置执行历史。" : "",
        unbridged ? "若要在新生命周期页展示旧打卡，先把旧打卡/问卷补写为 task_event。" : "",
        rewardDecisionCount ? "旧退款/优惠券权益需由运营确认是否生成 reward_grant/manual_review_item。" : "",
        "执行写入型补迁前必须先导出快照并使用 request_id 留审计。",
      ])
      : ["未发现旧 7 日试饮历史数据，无需补迁。"],
  };
}

module.exports = {
  buildLegacyDataMigrationPlan,
};
