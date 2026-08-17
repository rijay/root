const { nowISO } = require("./dates");
const { createId } = require("./seed");

const EVENT_SCHEMAS = Object.freeze({
  home_product_banner_click: Object.freeze(["productId", "bannerPosition", "loggedIn"]),
  product_impression: Object.freeze(["productId", "skuId", "sourcePage"]),
  product_detail_view: Object.freeze(["productId", "skuId", "sourcePage"]),
  member_center_handoff: Object.freeze(["productId", "result", "failureReason", "sourcePage"]),
  assessment_start: Object.freeze(["assessmentType", "questionnaireVersion", "isRetest"]),
  assessment_complete: Object.freeze(["assessmentType", "questionnaireVersion", "isRetest"]),
  assessment_compare_view: Object.freeze(["leftVersion", "rightVersion", "comparable"]),
  page_share: Object.freeze(["pageType", "mappingType"]),
  activity_signup: Object.freeze(["activityId", "action", "result", "failureReason"]),
  shop_redirect_click: Object.freeze(["streak", "totalDays"]),
  share_complete: Object.freeze(["channel"]),
  share_poster_saved: Object.freeze(["source"]),
  share_poster_share_menu: Object.freeze(["source"]),
});

const GUEST_EVENTS = new Set([
  "home_product_banner_click",
  "product_impression",
  "product_detail_view",
  "member_center_handoff",
  "page_share",
]);

const REQUIRED_FIELDS = Object.freeze({
  home_product_banner_click: ["productId", "bannerPosition", "loggedIn"],
  product_impression: ["productId", "sourcePage"],
  product_detail_view: ["productId", "sourcePage"],
  member_center_handoff: ["productId", "result", "sourcePage"],
  assessment_start: ["assessmentType", "questionnaireVersion", "isRetest"],
  assessment_complete: ["assessmentType", "questionnaireVersion", "isRetest"],
  assessment_compare_view: ["leftVersion", "rightVersion", "comparable"],
  page_share: ["pageType", "mappingType"],
  activity_signup: ["activityId", "action", "result"],
});

function analyticsError(message) {
  const error = new Error(message);
  error.code = 6301;
  error.status = 400;
  return error;
}

function text(value, maxLength = 96) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/[\r\n\t]/g, " ")
    .trim()
    .slice(0, maxLength);
}

function integer(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function normalizedValue(key, value) {
  if (["loggedIn", "isRetest", "comparable"].includes(key)) return value === true;
  if (["questionnaireVersion", "leftVersion", "rightVersion", "streak", "totalDays"].includes(key)) {
    return integer(value);
  }
  if (key === "sourcePage" || key === "pageType") {
    const route = text(value, 120).split("?")[0];
    return /^\/[A-Za-z0-9_./-]{1,119}$/.test(route) ? route : "";
  }
  if (["result", "action", "mappingType", "assessmentType", "failureReason", "bannerPosition"].includes(key)) {
    return text(value, 64).toUpperCase().replace(/[^A-Z0-9_:-]/g, "_");
  }
  return text(value, 96);
}

function sanitizePayload(eventName, payload = {}) {
  const fields = EVENT_SCHEMAS[eventName];
  if (!fields || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw analyticsError("分析事件无效");
  }
  const result = {};
  fields.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(payload, key)) result[key] = normalizedValue(key, payload[key]);
  });
  const missing = (REQUIRED_FIELDS[eventName] || []).some((key) => (
    result[key] === undefined || result[key] === ""
  ));
  if (missing) throw analyticsError("分析事件字段不完整");
  return result;
}

function recordEvent(data, actor = {}, input = {}, context = {}) {
  if (!data) throw analyticsError("分析事件存储不可用");
  if (!Array.isArray(data.analyticsEvents)) data.analyticsEvents = [];
  const eventName = text(input.eventName || input.event_name, 64).toLowerCase();
  if (!EVENT_SCHEMAS[eventName]) throw analyticsError("分析事件名称无效");
  const rootUserId = text(actor.rootUserId || actor.root_user_id, 32);
  if (!rootUserId && !GUEST_EVENTS.has(eventName)) throw analyticsError("该分析事件需要登录");
  const occurredAt = context.now || nowISO();
  const event = {
    analytics_event_id: createId("ane"),
    root_user_id: rootUserId,
    event_name: eventName,
    payload_json: sanitizePayload(eventName, input.payload || {}),
    source: context.source || "MINIPROGRAM",
    occurred_at: occurredAt,
    created_at: occurredAt,
  };
  data.analyticsEvents.push(event);
  return event;
}

module.exports = Object.freeze({
  EVENT_SCHEMAS,
  GUEST_EVENTS,
  recordEvent,
  sanitizePayload,
});
