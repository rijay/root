const { safeOpaqueId } = require("./activity-presenter");

const ROUTE_INTENT_STORAGE_KEY = "MYROOT_ACTIVITY_ROUTE_INTENT_V1";
const CLOSED_ACTIONS = Object.freeze({
  COMING_SOON: ["即将开放", "报名尚未开放，请稍后再来查看。"],
  FULL: ["已满员", "当前场次暂无可用名额。"],
  REGISTRATION_CLOSED: ["报名已截止", "当前场次已停止接受报名或取消。"],
  IN_PROGRESS: ["活动进行中", "当前场次已开始。"],
  CANCELED: ["活动已取消", "当前场次已由运营方取消。"],
  ENDED: ["活动已结束", "当前场次已结束。"],
});

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function noWriteAction(label, explanation, reasonCode) {
  return {
    kind: "NONE",
    label,
    disabled: true,
    explanation,
    reasonCode,
    confirmationTitle: "",
    confirmationBody: "",
    confirmLabel: "",
  };
}

function writeAction(kind, activity, label) {
  const manualApproval = upper(activity.approvalMode) === "MANUAL";
  const isCancel = kind === "CANCEL";
  return {
    kind,
    label,
    disabled: false,
    explanation: isCancel
      ? "取消结果以运营后台返回的报名记录为准。"
      : (manualApproval ? "提交后需等待运营审核。" : "提交后将以运营后台返回的报名状态为准。"),
    reasonCode: "",
    confirmationTitle: isCancel
      ? "确认取消报名？"
      : (manualApproval ? "确认提交报名申请？" : "确认报名？"),
    confirmationBody: isCancel
      ? "取消后是否还能再次报名，以活动当前规则与剩余名额为准。"
      : "请确认活动时间与地点。提交后，本页会重新读取运营后台的权威报名状态。",
    confirmLabel: isCancel ? "确认取消" : (manualApproval ? "提交申请" : "确认报名"),
  };
}

function deriveActivityAction(activity, options = {}) {
  const item = activity && typeof activity === "object" ? activity : {};
  const authenticated = options.authenticated === true;
  const listingState = upper(item.listingState);
  const enrollmentStatus = upper(item.enrollment && item.enrollment.status);

  if (!safeOpaqueId(item.sessionId)) {
    return noWriteAction("活动信息待确认", "未取得有效场次标识，无法提交操作。", "SESSION_ID_INVALID");
  }

  if (["PENDING", "CONFIRMED"].includes(enrollmentStatus)) {
    if (!authenticated) {
      return {
        ...noWriteAction("登录后管理报名", "请先使用微信身份进入，再读取最新报名状态。", "AUTH_REQUIRED"),
        kind: "LOGIN",
        disabled: false,
      };
    }
    if (item.cancelAllowed === true) {
      return writeAction("CANCEL", item, enrollmentStatus === "PENDING" ? "取消申请" : "取消报名");
    }
    return noWriteAction(
      enrollmentStatus === "PENDING" ? "审核中" : "报名已确认",
      item.cancelReasonCode === "CUTOFF_PASSED"
        ? "当前已超过自助取消时点，如需协助请联系 ROOT 顾问。"
        : "当前报名不可自助取消，如需协助请联系 ROOT 顾问。",
      item.cancelReasonCode || "CANCEL_NOT_ALLOWED",
    );
  }

  if (enrollmentStatus === "REJECTED") {
    return noWriteAction("报名未通过", "当前记录不可直接重新提交，如需了解原因请联系 ROOT 顾问。", "REAPPLY_NOT_ALLOWED");
  }

  if (enrollmentStatus === "CANCELED" && item.allowReapply !== true) {
    return noWriteAction("报名已取消", "当前活动规则不允许再次报名。", "REAPPLY_NOT_ALLOWED");
  }

  if (listingState !== "AVAILABLE") {
    const copy = CLOSED_ACTIONS[listingState] || ["暂不可报名", "活动当前未开放报名。"];
    return noWriteAction(copy[0], copy[1], listingState || "LISTING_STATE_UNKNOWN");
  }

  if (!authenticated) {
    return {
      ...noWriteAction(
        upper(item.visibility) === "MEMBER" ? "登录并确认会员资格" : "登录后报名",
        "登录只用于读取你的报名资格，不会自动提交报名。",
        "AUTH_REQUIRED",
      ),
      kind: "LOGIN",
      disabled: false,
    };
  }

  return writeAction("ENROLL", item, enrollmentStatus === "CANCELED" ? "再次报名" : "立即报名");
}

function createActivityCommand(kind, sessionId, nowMs, entropy) {
  const commandKind = upper(kind);
  const safeSessionId = safeOpaqueId(sessionId);
  const timestamp = Number.isFinite(Number(nowMs)) ? Math.trunc(Number(nowMs)) : 0;
  const safeEntropy = String(entropy || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 20);
  if (!["ENROLL", "CANCEL"].includes(commandKind) || !safeSessionId || timestamp <= 0 || !safeEntropy) {
    throw new Error("ACTIVITY_COMMAND_INVALID");
  }
  const idempotencyKey = `ACTIVITY_INTENT_${commandKind}_${timestamp}_${safeEntropy}_${safeSessionId.slice(-40)}`
    .slice(0, 128);
  return Object.freeze({
    kind: commandKind,
    sessionId: safeSessionId,
    idempotencyKey,
  });
}

function createMemberSupportRouteIntent(activity, nowMs) {
  const sessionId = safeOpaqueId(activity && activity.sessionId);
  const timestamp = Number.isFinite(Number(nowMs)) ? Math.trunc(Number(nowMs)) : 0;
  if (!sessionId || timestamp <= 0) throw new Error("ACTIVITY_ROUTE_INTENT_INVALID");
  return Object.freeze({
    version: 1,
    routeId: "ACTIVITY_DETAIL",
    sourceAction: "ACTIVITY_ENROLL_CONFIRM",
    sessionId,
    createdAt: timestamp,
    expiresAt: timestamp + (15 * 60 * 1000),
  });
}

function createActivityLoginRouteIntent(activity, nowMs) {
  const intent = createMemberSupportRouteIntent(activity, nowMs);
  return Object.freeze({ ...intent, sourceAction: "ACTIVITY_LOGIN" });
}

function createMyEnrollmentsLoginRouteIntent(nowMs) {
  const timestamp = Number.isFinite(Number(nowMs)) ? Math.trunc(Number(nowMs)) : 0;
  if (timestamp <= 0) throw new Error("ACTIVITY_ROUTE_INTENT_INVALID");
  return Object.freeze({
    version: 1,
    routeId: "MY_ENROLLMENTS",
    sourceAction: "MY_ENROLLMENTS_LOGIN",
    createdAt: timestamp,
    expiresAt: timestamp + (15 * 60 * 1000),
  });
}

function readActivityLoginRouteIntent(value, nowMs) {
  const intent = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const now = Number.isFinite(Number(nowMs)) ? Math.trunc(Number(nowMs)) : 0;
  const createdAt = Number(intent.createdAt);
  const expiresAt = Number(intent.expiresAt);
  const sessionId = safeOpaqueId(intent.sessionId);
  const isActivityDetail = intent.routeId === "ACTIVITY_DETAIL"
    && intent.sourceAction === "ACTIVITY_LOGIN"
    && Boolean(sessionId);
  const isMyEnrollments = intent.routeId === "MY_ENROLLMENTS"
    && intent.sourceAction === "MY_ENROLLMENTS_LOGIN"
    && !intent.sessionId;
  if (intent.version !== 1
    || (!isActivityDetail && !isMyEnrollments)
    || !Number.isInteger(createdAt)
    || !Number.isInteger(expiresAt)
    || now <= 0
    || createdAt > now
    || expiresAt <= now
    || expiresAt - createdAt !== 15 * 60 * 1000) return null;
  return Object.freeze({
    version: 1,
    routeId: intent.routeId,
    sourceAction: intent.sourceAction,
    ...(isActivityDetail ? { sessionId } : {}),
    createdAt,
    expiresAt,
  });
}

function activityLoginRecoveryUrl(value, nowMs) {
  const intent = readActivityLoginRouteIntent(value, nowMs);
  if (!intent) return "";
  if (intent.routeId === "MY_ENROLLMENTS") {
    return "/subpkg/activity/pages/enrollments/index?source=login_recovery";
  }
  return `/subpkg/activity/pages/detail/index?sessionId=${encodeURIComponent(intent.sessionId)}&source=login_recovery`;
}

function errorCode(error) {
  return upper(error && error.code);
}

function presentActivityWriteError(error) {
  const code = errorCode(error);
  const known = {
    ACTIVE_MEMBERSHIP_REQUIRED: {
      kind: "MEMBERSHIP_SUPPORT",
      title: "需要确认 ROOT 会员资格",
      body: "当前小程序尚未取得可用的会员关联状态。你的报名没有被伪造或提交，请联系 ROOT 顾问协助核验。",
      support: true,
    },
    CAPACITY_FULL: { kind: "DEFINITIVE", title: "当前场次已满员", body: "名额可能刚刚发生变化，请以最新活动详情为准。" },
    CUTOFF_PASSED: { kind: "DEFINITIVE", title: "已超过操作截止时间", body: "请以最新活动详情为准；如需协助可联系 ROOT 顾问。", support: true },
    REGISTRATION_NOT_OPEN: { kind: "DEFINITIVE", title: "报名尚未开始", body: "请以活动详情中的最新开放状态为准。" },
    ACTIVITY_SESSION_NOT_OPEN: { kind: "DEFINITIVE", title: "当前场次暂不可报名", body: "活动状态可能刚刚发生变化，请以最新详情为准。" },
    ACTIVITY_NOT_AVAILABLE: { kind: "DEFINITIVE", title: "活动当前不可报名", body: "活动状态可能刚刚发生变化，请以最新详情为准。" },
    ACTIVITY_REAPPLY_NOT_ALLOWED: { kind: "DEFINITIVE", title: "当前不可再次报名", body: "活动规则不允许再次申请，如需协助可联系 ROOT 顾问。", support: true },
    ACTIVITY_ENROLLMENT_STATE_CONFLICT: { kind: "DEFINITIVE", title: "报名状态已变化", body: "本页已重新读取最新记录，请以最新状态为准。" },
    ACTIVITY_ENROLLMENT_NOT_FOUND: { kind: "DEFINITIVE", title: "未找到可操作的报名记录", body: "本页已重新读取最新记录，请以最新状态为准。" },
  };
  return known[code] || {
    kind: "UNKNOWN",
    title: "操作结果待确认",
    body: "网络或服务响应未能确认结果。本页会读取权威记录，不会自动重放本次操作。",
    support: true,
  };
}

function commandReachedAuthorityState(command, activity) {
  const status = upper(activity && activity.enrollment && activity.enrollment.status);
  if (!command || command.sessionId !== (activity && activity.sessionId)) return false;
  if (command.kind === "ENROLL") return ["PENDING", "CONFIRMED"].includes(status);
  if (command.kind === "CANCEL") return status === "CANCELED";
  return false;
}

module.exports = Object.freeze({
  ROUTE_INTENT_STORAGE_KEY,
  activityLoginRecoveryUrl,
  commandReachedAuthorityState,
  createActivityLoginRouteIntent,
  createActivityCommand,
  createMemberSupportRouteIntent,
  createMyEnrollmentsLoginRouteIntent,
  deriveActivityAction,
  presentActivityWriteError,
  readActivityLoginRouteIntent,
});
