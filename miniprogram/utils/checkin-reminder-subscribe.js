const { request, safeErrorSummary } = require("./request");

const STORAGE_PREFIX = "ROOT_CHECKIN_REMINDER_SUBSCRIBE:";

function wxAvailable(method) {
  return typeof wx !== "undefined" && wx && typeof wx[method] === "function";
}

function storageKey(template) {
  return `${STORAGE_PREFIX}${template.templateKey}:${template.templateId}:${template.version}`;
}

function requestSubscribeMessage(tmplIds) {
  return new Promise((resolve) => {
    wx.requestSubscribeMessage({
      tmplIds,
      success: resolve,
      fail: resolve,
    });
  });
}

function resultOf(rawResult, templateId) {
  if (!rawResult || typeof rawResult !== "object") return "unknown";
  return rawResult[templateId] || (rawResult.errMsg && rawResult.errMsg.includes("ban") ? "ban" : "unknown");
}

async function recordSubscription(template, rawResult, options = {}) {
  const result = resultOf(rawResult, template.templateId);
  await request({
    url: "/api/v1/notifications/subscriptions",
    method: "POST",
    data: {
      templateKey: template.templateKey,
      templateId: template.templateId,
      templateVersion: template.version,
      result,
      subscribed: result === "accept",
      trigger: options.trigger || "CAMPAIGN_JOIN",
      campaignId: options.campaignId || "",
    },
  });
  return result;
}

async function requestCheckinReminderSubscribe(options = {}) {
  if (!wxAvailable("requestSubscribeMessage")) return { skipped: true, reason: "WX_SUBSCRIBE_UNSUPPORTED" };
  let templateData;
  try {
    templateData = await request({ url: "/api/v1/notifications/checkin-reminder-template" });
  } catch (error) {
    console.warn("MYROOT_CHECKIN_REMINDER_TEMPLATE_LOAD_FAILED", safeErrorSummary(error));
    return { skipped: true, reason: "TEMPLATE_LOAD_FAILED" };
  }

  const template = templateData && templateData.template;
  if (!template || !template.enabled || !template.templateId) return { skipped: true, reason: "TEMPLATE_NOT_CONFIGURED" };
  const key = storageKey(template);
  const storedResult = wxAvailable("getStorageSync") ? wx.getStorageSync(key) : "";
  if (storedResult) {
    return { skipped: true, reason: "ALREADY_DECIDED", result: storedResult };
  }

  const rawResult = await requestSubscribeMessage([template.templateId]);
  let result = "unknown";
  try {
    result = await recordSubscription(template, rawResult, options);
    if (wxAvailable("setStorageSync")) wx.setStorageSync(key, result);
  } catch (error) {
    console.warn("MYROOT_CHECKIN_REMINDER_SUBSCRIBE_RECORD_FAILED", safeErrorSummary(error));
  }

  if (result === "accept") {
    wx.showToast({ title: "明天提醒你打卡", icon: "none" });
  }
  return { skipped: false, result };
}

module.exports = {
  requestCheckinReminderSubscribe,
};
