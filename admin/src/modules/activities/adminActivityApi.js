import { adminRequest, postAdminJson, postAdminRead } from "@/api/client";

function queryString(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      params.set(key, String(value).trim());
    }
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}

function requestId(prefix) {
  const entropy = globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${entropy}`;
}

export async function fetchFormalActivities(filters = {}, options = {}) {
  const definitionFilters = {
    search: filters.keyword,
    status: ["DRAFT", "PUBLISHED", "UNPUBLISHED", "ARCHIVED"].includes(filters.status) ? filters.status : "",
    page: filters.page,
    pageSize: filters.pageSize,
  };
  const [definitions, sessions] = await Promise.all([
    adminRequest(`/api/v1/admin/activities${queryString(definitionFilters)}`, options),
    adminRequest("/api/v1/admin/activity-sessions?page=1&pageSize=50", options),
  ]);
  const sessionsByVersion = new Map((sessions?.sessions || sessions?.items || [])
    .map((session) => [session.activityVersionId, session]));
  const items = (definitions?.activities || definitions?.items || []).map((activity) => {
    const session = sessionsByVersion.get(activity.activityVersionId) || {};
    const effectiveStatus = session.status === "OPEN" ? "OPEN" : activity.status;
    return {
      ...activity,
      id: activity.activityVersionId,
      versionId: activity.activityVersionId,
      sourceVersionId: "",
      status: effectiveStatus,
      scheduleLabel: session.sessionStartAt
        ? `${new Date(session.sessionStartAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · ${activity.city}`
        : "活动时间待配置",
      activityTypeLabel: activity.activityType === "OFFLINE_EVENT" ? "线下活动" : activity.activityType,
      detailTitle: activity.title,
      detailVersionLabel: activity.detailVersion,
      startAtLabel: session.sessionStartAt ? new Date(session.sessionStartAt).toLocaleString("zh-CN") : "未设置",
      locationLabel: [activity.city, activity.venueSummary].filter(Boolean).join(" · "),
      sessionStartAt: session.sessionStartAt || "",
      sessionEndAt: session.sessionEndAt || "",
      registrationOpenAt: session.registrationOpenAt || "",
      registrationCloseAt: session.registrationCloseAt || "",
      capacity: session.capacity || 80,
      approvalMode: session.approvalMode || "AUTO",
      allowCancellation: Boolean(session.cancelCloseAt),
      city: activity.city,
      venue: activity.venueSummary,
      assetId: activity.heroAssetRef,
      assetName: activity.heroAssetRef,
      assetMeta: "已关联受控活动素材",
      sharedDetailVersionId: activity.detailVersion,
    };
  }).filter((item) => !filters.status || item.status === filters.status);
  return {
    ...definitions,
    items,
    total: definitions?.pagination?.total ?? items.length,
    previewPath: "/pages/activities/index",
  };
}

export function saveFormalActivityDraft(input = {}) {
  const id = requestId("formal-activity-draft");
  return postAdminJson("/api/v1/admin/formal-activities/draft", { ...input, requestId: id }, {
    headers: {
      "X-Request-Id": id,
      "X-Idempotency-Key": id,
    },
  });
}

export async function fetchActivityEnrollments(filters = {}, options = {}) {
  const data = await postAdminRead("/api/v1/admin/activity-enrollments/query", filters, options);
  return { ...data, items: data?.items || data?.enrollments || [] };
}

export async function fetchActivityOptions(options = {}) {
  const data = await adminRequest("/api/v1/admin/activities?status=PUBLISHED&page=1&pageSize=50", options);
  return { ...data, items: data?.items || data?.activities || [] };
}

export function exportActivityEnrollments(filters = {}) {
  const id = requestId("activity-enrollment-export");
  return postAdminJson("/api/v1/admin/activity-enrollments/export", { ...filters, requestId: id }, {
    headers: {
      "X-Request-Id": id,
      "X-Idempotency-Key": id,
    },
  });
}
