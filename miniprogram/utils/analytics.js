const { request } = require("./request");

const EVENT_FIELDS = Object.freeze({
  home_product_banner_click: ["productId", "bannerPosition", "loggedIn"],
  product_impression: ["productId", "skuId", "sourcePage"],
  product_detail_view: ["productId", "skuId", "sourcePage"],
  member_center_handoff: ["productId", "result", "failureReason", "sourcePage"],
  assessment_start: ["assessmentType", "questionnaireVersion", "isRetest"],
  assessment_complete: ["assessmentType", "questionnaireVersion", "isRetest"],
  assessment_compare_view: ["leftVersion", "rightVersion", "comparable"],
  page_share: ["pageType", "mappingType"],
  activity_signup: ["activityId", "action", "result", "failureReason"],
});

function safeText(value, maxLength = 96) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/[\r\n\t]/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizePayload(eventName, payload = {}) {
  const fields = EVENT_FIELDS[eventName];
  if (!fields || !payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return fields.reduce((result, key) => {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) return result;
    const value = payload[key];
    if (["loggedIn", "isRetest", "comparable"].includes(key)) result[key] = value === true;
    else if (["questionnaireVersion", "leftVersion", "rightVersion"].includes(key)) {
      const number = Number(value);
      result[key] = Number.isSafeInteger(number) && number >= 0 ? number : 0;
    } else result[key] = safeText(value, key === "sourcePage" || key === "pageType" ? 120 : 96);
    return result;
  }, {});
}

function failureReason(error) {
  const code = safeText(error && error.code, 64).toUpperCase();
  return /^[A-Z0-9_:-]{1,64}$/.test(code) ? code : "REQUEST_FAILED";
}

async function track(eventName, payload = {}) {
  const sanitized = sanitizePayload(eventName, payload);
  if (!sanitized) return { sent: false, reason: "EVENT_NOT_ALLOWED" };
  try {
    await request({
      url: "/api/v1/event/track",
      method: "POST",
      data: { eventName, payload: sanitized },
    });
    return { sent: true, reason: "" };
  } catch (_) {
    return { sent: false, reason: "TRACK_FAILED" };
  }
}

module.exports = Object.freeze({
  EVENT_FIELDS,
  failureReason,
  sanitizePayload,
  track,
});
