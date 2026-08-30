const { request } = require("./request");
const env = require("../config/env");

const EVENT_FIELDS = Object.freeze({
  home_product_banner_click: ["productId", "bannerPosition", "loggedIn"],
  product_impression: ["productId", "skuId", "sourcePage"],
  product_detail_view: ["productId", "skuId", "sourcePage"],
  member_center_handoff: ["productId", "result", "failureReason", "sourcePage"],
  campaign_popup_view: ["campaignId", "loginSessionId", "sourcePage"],
  campaign_popup_action: ["campaignId", "loginSessionId", "action", "sourcePage"],
  channel_attribution_attempt: ["channelId", "result", "failureReason"],
  assessment_start: ["assessmentType", "questionnaireVersion", "isRetest"],
  assessment_complete: ["assessmentType", "questionnaireVersion", "isRetest"],
  assessment_source_confirm: ["assessmentType", "optionId", "configVersion"],
  assessment_compare_view: ["leftVersion", "rightVersion", "comparable"],
  page_share: ["pageType", "mappingType"],
  activity_signup: ["activityId", "action", "result", "failureReason"],
  home_banner_impression: ["contentId", "bannerPosition", "sourcePage"],
  home_banner_click: ["contentId", "bannerPosition", "sourcePage"],
  campaign_page_view: ["campaignId", "sourcePage"],
  campaign_assessment_start: ["campaignId", "result", "failureReason"],
  assessment_result_view: ["assessmentType", "questionnaireVersion", "resultCode"],
  trial_pack_action: ["assessmentType", "questionnaireVersion", "result", "failureReason"],
  activity_detail_view: ["activityId", "sourcePage"],
  share_menu_setup: ["pageType", "result", "failureReason"],
});

const LOCAL_HEALTH_EVENTS = new Set([
  "assessment_start",
  "assessment_complete",
  "assessment_compare_view",
  "campaign_assessment_start",
  "assessment_result_view",
  "trial_pack_action",
]);

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
    else if (["questionnaireVersion", "leftVersion", "rightVersion", "bannerPosition", "configVersion"].includes(key)) {
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
  if (env.healthAssessmentStorageMode === "LOCAL_DEVICE" && LOCAL_HEALTH_EVENTS.has(eventName)) {
    return { sent: false, reason: "LOCAL_HEALTH_STORAGE" };
  }
  if (env.localV060CompatMode) return { sent: false, reason: "LOCAL_V060_COMPAT" };
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
