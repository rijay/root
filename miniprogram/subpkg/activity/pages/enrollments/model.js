const PAGE_SIZE = 10;

const GROUPS = Object.freeze({
  UPCOMING: Object.freeze({
    key: "UPCOMING",
    label: "接下来",
    copy: "即将开始与正在进行的报名",
    rank: 0,
  }),
  ENDED: Object.freeze({
    key: "ENDED",
    label: "已结束",
    copy: "已结束活动的历史报名记录",
    rank: 1,
  }),
  CANCELED: Object.freeze({
    key: "CANCELED",
    label: "已取消或未通过",
    copy: "已取消、活动取消或审核未通过的记录",
    rank: 2,
  }),
});

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function parseTimestamp(value, fallback) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

function buildEnrollmentsUrl(page) {
  return `/api/v1/activities/enrollments?page=${positiveInteger(page, 1)}&pageSize=${PAGE_SIZE}`;
}

function paginationFrom(payload, requestedPage, itemCount) {
  const pagination = payload && payload.pagination && typeof payload.pagination === "object"
    ? payload.pagination
    : null;
  if (!pagination) {
    return {
      page: positiveInteger(requestedPage, 1),
      total: Math.max(0, Number(itemCount) || 0),
      hasMore: false,
    };
  }
  return {
    page: positiveInteger(pagination.page, positiveInteger(requestedPage, 1)),
    total: Number.isInteger(pagination.total) && pagination.total >= 0 ? pagination.total : null,
    hasMore: pagination.hasNextPage === true,
  };
}

function rawSessionIndex(payload) {
  const rows = payload && Array.isArray(payload.enrollments) ? payload.enrollments : [];
  return rows.reduce((index, row) => {
    const activity = row && row.activity && typeof row.activity === "object" ? row.activity : {};
    const session = activity.session && typeof activity.session === "object" ? activity.session : {};
    const sessionId = String(session.sessionId || "").trim();
    if (sessionId) index[sessionId] = session;
    return index;
  }, {});
}

function decorateEnrollment(item, session, nowMs) {
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const startAtMs = parseTimestamp(session && session.sessionStartAt, Number.MAX_SAFE_INTEGER);
  const endAtMs = parseTimestamp(session && session.sessionEndAt, startAtMs);
  const enrollmentStatus = String(item.enrollmentStatus || "").toUpperCase();
  const listingState = String(item.listingState || "").toUpperCase();
  let group = GROUPS.UPCOMING;
  if (["CANCELED", "REJECTED"].includes(enrollmentStatus) || listingState === "CANCELED") {
    group = GROUPS.CANCELED;
  } else if (listingState === "ENDED" || endAtMs <= now) {
    group = GROUPS.ENDED;
  }
  return {
    ...item,
    enrollmentGroup: group.key,
    enrollmentGroupRank: group.rank,
    sessionStartAtMs: startAtMs,
    sessionEndAtMs: endAtMs,
  };
}

function compareEnrollments(left, right) {
  if (left.enrollmentGroupRank !== right.enrollmentGroupRank) {
    return left.enrollmentGroupRank - right.enrollmentGroupRank;
  }
  const direction = left.enrollmentGroup === "UPCOMING" ? 1 : -1;
  const timeDifference = (left.sessionStartAtMs - right.sessionStartAtMs) * direction;
  if (timeDifference) return timeDifference;
  return String(left.enrollmentId).localeCompare(String(right.enrollmentId));
}

function mergeEnrollments(current, incoming) {
  const byId = new Map();
  (Array.isArray(current) ? current : []).forEach((item) => byId.set(item.enrollmentId, item));
  (Array.isArray(incoming) ? incoming : []).forEach((item) => byId.set(item.enrollmentId, item));
  return Array.from(byId.values()).sort(compareEnrollments);
}

function groupEnrollments(enrollments) {
  const buckets = new Map();
  (Array.isArray(enrollments) ? enrollments : []).forEach((item) => {
    const key = GROUPS[item.enrollmentGroup] ? item.enrollmentGroup : "UPCOMING";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  });
  return Object.values(GROUPS)
    .filter((group) => buckets.has(group.key))
    .map((group) => ({
      key: group.key,
      label: group.label,
      copy: group.copy,
      items: buckets.get(group.key).slice().sort(compareEnrollments),
    }));
}

function cancellationSheet(item) {
  const activity = item && typeof item === "object" ? item : {};
  return {
    enrollmentId: String(activity.enrollmentId || ""),
    sessionId: String(activity.sessionId || ""),
    title: String(activity.title || "活动报名"),
    startText: String(activity.startText || "时间待确认"),
    venueSummary: String(activity.venueSummary || "地点待确认"),
    cancelCloseText: String(activity.cancelCloseText || "以活动规则为准"),
    cancelPolicy: String(activity.cancelPolicy || "取消后是否还能再次报名，以活动当前规则与剩余名额为准。"),
  };
}

module.exports = Object.freeze({
  PAGE_SIZE,
  buildEnrollmentsUrl,
  cancellationSheet,
  decorateEnrollment,
  groupEnrollments,
  mergeEnrollments,
  paginationFrom,
  rawSessionIndex,
});
