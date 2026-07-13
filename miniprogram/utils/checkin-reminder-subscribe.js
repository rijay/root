const { request, safeErrorSummary } = require("./request");

let cachedTemplate = null;

function wxAvailable(method) {
  return typeof wx !== "undefined" && wx && typeof wx[method] === "function";
}

function feedbackFor(value) {
  if (value === "accept") {
    return { message: "已开启，明天会提醒你打卡", tone: "success", buttonText: "已开启" };
  }
  if (value === "reject") {
    return { message: "本次未开启，可再次尝试", tone: "muted", buttonText: "再次尝试" };
  }
  if (value === "ban") {
    return { message: "订阅消息已关闭，请在小程序设置中开启", tone: "warning", buttonText: "再次尝试" };
  }
  if (value === "WX_SUBSCRIBE_UNSUPPORTED") {
    return { message: "当前微信版本暂不支持订阅提醒", tone: "warning", buttonText: "暂不可用" };
  }
  if (value === "RECORD_FAILED") {
    return { message: "微信已授权，提醒记录同步失败，请重新开启", tone: "warning", buttonText: "重新开启" };
  }
  if (["TEMPLATE_LOAD_FAILED", "TEMPLATE_NOT_CONFIGURED", "TEMPLATE_NOT_READY"].includes(value)) {
    return { message: "提醒暂不可用，请稍后再试", tone: "warning", buttonText: "重新加载" };
  }
  return { message: "未能打开微信授权，请再次尝试", tone: "warning", buttonText: "再次尝试" };
}

function validTemplate(template) {
  return Boolean(template && template.enabled && template.templateId);
}

async function preloadCheckinReminderTemplate(options = {}) {
  if (validTemplate(cachedTemplate) && !options.force) {
    return { ready: true };
  }

  try {
    const templateData = await request({ url: "/api/v1/notifications/checkin-reminder-template" });
    const template = templateData && templateData.template;
    if (!validTemplate(template)) {
      cachedTemplate = null;
      return { ready: false, reason: "TEMPLATE_NOT_CONFIGURED", ...feedbackFor("TEMPLATE_NOT_CONFIGURED") };
    }
    cachedTemplate = template;
    return { ready: true };
  } catch (error) {
    cachedTemplate = null;
    console.warn("MYROOT_CHECKIN_REMINDER_TEMPLATE_LOAD_FAILED", safeErrorSummary(error));
    return { ready: false, reason: "TEMPLATE_LOAD_FAILED", ...feedbackFor("TEMPLATE_LOAD_FAILED") };
  }
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
  const directResult = rawResult[templateId];
  if (["accept", "reject", "ban"].includes(directResult)) return directResult;
  return rawResult.errMsg && rawResult.errMsg.includes("ban") ? "ban" : "unknown";
}

function createGrantRequestId() {
  return `checkin-subscribe-${Date.now()}-${Math.random().toString(16).slice(2)}`.slice(0, 96);
}

async function recordSubscription(template, rawResult, options = {}) {
  const result = resultOf(rawResult, template.templateId);
  const grantRequestId = options.grantRequestId || createGrantRequestId();
  const requestOptions = {
    url: "/api/v1/notifications/subscriptions",
    method: "POST",
    requestId: grantRequestId,
    data: {
      templateKey: template.templateKey,
      templateId: template.templateId,
      templateVersion: template.version,
      grantRequestId,
      result,
      subscribed: result === "accept",
      trigger: options.trigger || "CAMPAIGN_JOIN",
      campaignId: options.campaignId || "",
    },
  };
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await request(requestOptions);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return result;
}

async function requestCheckinReminderSubscribe(options = {}) {
  if (!wxAvailable("requestSubscribeMessage")) {
    return { skipped: true, reason: "WX_SUBSCRIBE_UNSUPPORTED", ...feedbackFor("WX_SUBSCRIBE_UNSUPPORTED") };
  }

  const template = cachedTemplate;
  if (!validTemplate(template)) {
    return { skipped: true, reason: "TEMPLATE_NOT_READY", ...feedbackFor("TEMPLATE_NOT_READY") };
  }

  // Keep the native request as the first asynchronous action in the tap handler.
  const grantRequestId = createGrantRequestId();
  let rawResult;
  try {
    rawResult = await requestSubscribeMessage([template.templateId]);
  } catch (error) {
    console.warn("MYROOT_CHECKIN_REMINDER_NATIVE_REQUEST_FAILED", safeErrorSummary(error));
    rawResult = { errMsg: "requestSubscribeMessage:fail" };
  }
  let result = resultOf(rawResult, template.templateId);
  let recorded = false;
  try {
    result = await recordSubscription(template, rawResult, {
      ...options,
      grantRequestId,
    });
    recorded = true;
  } catch (error) {
    console.warn("MYROOT_CHECKIN_REMINDER_SUBSCRIBE_RECORD_FAILED", safeErrorSummary(error));
  }

  if (result === "accept" && !recorded) {
    return { skipped: false, result: "RECORD_FAILED", ...feedbackFor("RECORD_FAILED") };
  }
  return { skipped: false, result, ...feedbackFor(result) };
}

module.exports = {
  preloadCheckinReminderTemplate,
  requestCheckinReminderSubscribe,
};
