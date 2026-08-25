const LISTING_STATUS = Object.freeze({
  AVAILABLE: { label: "可报名", tone: "available" },
  COMING_SOON: { label: "即将开放", tone: "muted" },
  FULL: { label: "已满员", tone: "closed" },
  REGISTRATION_CLOSED: { label: "报名截止", tone: "closed" },
  IN_PROGRESS: { label: "进行中", tone: "muted" },
  CANCELED: { label: "已取消", tone: "closed" },
  ENDED: { label: "已结束", tone: "closed" },
});

const ENROLLMENT_STATUS = Object.freeze({
  PENDING: { label: "审核中", tone: "pending" },
  CONFIRMED: { label: "已确认", tone: "available" },
  REJECTED: { label: "未通过", tone: "closed" },
  CANCELED: { label: "已取消", tone: "closed" },
});

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function safeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function safeOpaqueId(value) {
  const text = safeText(value);
  return /^[A-Za-z0-9._:-]{1,160}$/.test(text) ? text : "";
}

function safePublicImageUrl(value) {
  const text = safeText(value);
  return /^https:\/\/[^\s]{1,1016}$/.test(text) || /^cloud:\/\/[^\s]{1,1016}$/.test(text)
    ? text
    : "";
}

function dateText(value) {
  const text = safeText(value);
  if (!text) return "时间待确认";
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return "时间待确认";
  const chinaDate = new Date(timestamp + (8 * 60 * 60 * 1000));
  const year = chinaDate.getUTCFullYear();
  const month = chinaDate.getUTCMonth() + 1;
  const day = chinaDate.getUTCDate();
  const hour = String(chinaDate.getUTCHours()).padStart(2, "0");
  const minute = String(chinaDate.getUTCMinutes()).padStart(2, "0");
  return `${year}年${month}月${day}日 ${hour}:${minute}`;
}

function compactDateText(value) {
  const text = safeText(value);
  if (!text) return "时间待确认";
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return "时间待确认";
  const chinaDate = new Date(timestamp + (8 * 60 * 60 * 1000));
  const month = chinaDate.getUTCMonth() + 1;
  const day = chinaDate.getUTCDate();
  const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][chinaDate.getUTCDay()];
  const hour = String(chinaDate.getUTCHours()).padStart(2, "0");
  const minute = String(chinaDate.getUTCMinutes()).padStart(2, "0");
  return `${month}月${day}日  ${weekday}  ${hour}:${minute}`;
}

function listingStatus(value) {
  return LISTING_STATUS[safeText(value).toUpperCase()] || { label: "状态待确认", tone: "muted" };
}

function enrollmentStatus(value) {
  return ENROLLMENT_STATUS[safeText(value).toUpperCase()] || { label: "状态待确认", tone: "muted" };
}

function presentActivity(input, options = {}) {
  const activity = plainObject(input);
  const session = plainObject(activity.session);
  const requireDetail = options.requireDetail !== false;
  const activityId = safeOpaqueId(activity.activityId);
  const sessionId = safeOpaqueId(session.sessionId);
  const title = safeText(activity.title);
  const summary = safeText(activity.summary);
  const city = safeText(activity.city);
  const venueSummary = safeText(activity.venueSummary);
  const activityType = safeText(activity.activityType);
  const objective = safeText(activity.objective);
  const audience = safeText(activity.audience);
  const agenda = safeText(activity.agenda);
  const organizer = safeText(activity.organizer);
  const feeDescription = safeText(activity.feeDescription);
  const bringItems = safeText(activity.bringItems);
  const cancelPolicy = safeText(activity.cancelPolicy);
  const privacyNoticeText = safeText(activity.privacyNoticeText);
  const photographyNoticeText = safeText(activity.photographyNoticeText);
  const contactDisplay = safeText(activity.contactDisplay);
  const commonInvalid = !activityId || !sessionId || !title || !summary || !city || !venueSummary
    || !activityType || !session.sessionStartAt || !session.cancelCloseAt;
  const detailInvalid = !objective || !audience || !agenda || !organizer || !feeDescription
    || !bringItems || !cancelPolicy || !privacyNoticeText || !photographyNoticeText || !contactDisplay;
  if (commonInvalid || (requireDetail && detailInvalid)) {
    throw new Error("ACTIVITY_ITEM_PAYLOAD_INVALID");
  }
  const status = listingStatus(session.listingState || session.status);
  const enrollment = plainObject(activity.enrollment);
  const actions = plainObject(activity.actions);
  const enrollmentView = safeOpaqueId(enrollment.enrollmentId)
    ? {
      ...enrollmentStatus(enrollment.status),
      enrollmentId: safeOpaqueId(enrollment.enrollmentId),
      status: safeText(enrollment.status).toUpperCase(),
      reasonCode: safeText(enrollment.reasonCode).toUpperCase(),
    }
    : null;
  return {
    activityId,
    sessionId,
    title,
    summary,
    city,
    venueSummary,
    activityType,
    typeLabel: activityType.replace(/_/g, " "),
    objective,
    audience,
    agenda,
    organizer,
    feeDescription,
    bringItems,
    cancelPolicy,
    privacyNoticeText,
    photographyNoticeText,
    contactDisplay,
    heroAssetUrl: safePublicImageUrl(activity.heroAssetUrl),
    startText: dateText(session.sessionStartAt),
    compactStartText: compactDateText(session.sessionStartAt),
    endText: dateText(session.sessionEndAt),
    listingState: safeText(session.listingState || session.status).toUpperCase(),
    definitionStatus: safeText(activity.status).toUpperCase(),
    visibility: safeText(activity.visibility, "PUBLIC").toUpperCase(),
    memberRequirement: safeText(activity.memberRequirement).toUpperCase(),
    approvalMode: safeText(session.approvalMode, "AUTO").toUpperCase(),
    allowReapply: session.allowReapply === true,
    cancelAllowed: actions.cancelAllowed === true,
    cancelReasonCode: safeText(actions.cancelReasonCode).toUpperCase(),
    registrationCloseText: dateText(session.registrationCloseAt),
    cancelCloseText: dateText(session.cancelCloseAt),
    privacyNoticeRef: safeOpaqueId(activity.privacyNoticeRef),
    photographyNoticeRef: safeOpaqueId(activity.photographyNoticeRef),
    statusLabel: status.label,
    statusTone: status.tone,
    remainingCapacity: Number.isInteger(session.remainingCapacity) && session.remainingCapacity >= 0
      ? session.remainingCapacity
      : null,
    enrollment: enrollmentView,
  };
}

function presentActivityList(payload) {
  const data = plainObject(payload);
  if (!Array.isArray(data.activities)) throw new Error("ACTIVITY_LIST_PAYLOAD_INVALID");
  const activities = data.activities.map((activity) => presentActivity(activity, { requireDetail: false }));
  if (activities.some((item) => !item.sessionId)) throw new Error("ACTIVITY_LIST_ITEM_INVALID");
  return activities;
}

function presentActivityDetail(payload) {
  const data = plainObject(payload);
  const activity = plainObject(data.activity);
  if (!Object.keys(activity).length) return null;
  const result = presentActivity(activity);
  return result.sessionId ? result : null;
}

function presentEnrollmentList(payload) {
  const data = plainObject(payload);
  if (!Array.isArray(data.enrollments)) throw new Error("ACTIVITY_ENROLLMENTS_PAYLOAD_INVALID");
  const enrollments = data.enrollments.map((entry) => {
    const row = plainObject(entry);
    const activity = presentActivity(row.activity);
    const enrollment = plainObject(row.enrollment);
    const status = enrollmentStatus(enrollment.status);
    return {
      ...activity,
      enrollmentId: safeOpaqueId(enrollment.enrollmentId),
      enrollmentStatus: safeText(enrollment.status).toUpperCase(),
      enrollmentStatusLabel: status.label,
      enrollmentStatusTone: status.tone,
      detailAvailable: activity.definitionStatus === "PUBLISHED",
    };
  });
  if (enrollments.some((item) => !item.sessionId || !item.enrollmentId)) {
    throw new Error("ACTIVITY_ENROLLMENT_ITEM_INVALID");
  }
  return enrollments;
}

module.exports = Object.freeze({
  presentActivityDetail,
  presentActivityList,
  presentEnrollmentList,
  safeOpaqueId,
});
