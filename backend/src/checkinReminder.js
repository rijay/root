const { addDays, nowISO, todayISO } = require("./dates");
const { createId } = require("./seed");

const TEMPLATE_KEY = "CHECKIN_REMINDER_NEXT_DAY";
const DEFAULT_TEMPLATE_VERSION = "v2026-06-28-tpl10850";
const DEFAULT_REMINDER_HOUR = 9;
const DEFAULT_PAGE = "pages/tasks/index";
const DEFAULT_TEMPLATE_TITLE = "活动提醒";
const DEFAULT_PRODUCT_NAME = "ROOT 7日身体重启计划";
const DEFAULT_ACTION_TEXT = "请完成今日打卡";

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizePage(value) {
  return text(value, DEFAULT_PAGE).replace(/^\/+/, "");
}

function clampHour(value) {
  const hour = Number(value);
  if (!Number.isFinite(hour)) return DEFAULT_REMINDER_HOUR;
  return Math.min(23, Math.max(0, Math.floor(hour)));
}

function padHour(hour) {
  return String(hour).padStart(2, "0");
}

function scheduleAtFor(dateText, hour) {
  return `${dateText}T${padHour(hour)}:00:00+08:00`;
}

function parseJsonObject(value) {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return objectValue(parsed);
  } catch (error) {
    return null;
  }
}

function truncateThing(value) {
  return text(value).slice(0, 20);
}

function defaultTemplateData(campaignTitle) {
  return {
    thing3: { value: truncateThing(campaignTitle || DEFAULT_PRODUCT_NAME) },
    thing2: { value: truncateThing(DEFAULT_ACTION_TEXT) },
    thing1: { value: truncateThing(DEFAULT_PRODUCT_NAME) },
  };
}

function expandPlaceholders(value, variables) {
  if (typeof value === "string") {
    return value.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, key) => {
      return variables[key] === undefined ? match : String(variables[key]);
    });
  }
  if (Array.isArray(value)) return value.map((item) => expandPlaceholders(item, variables));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expandPlaceholders(item, variables)]));
  }
  return value;
}

function normalizeWechatTemplateData(data) {
  return Object.fromEntries(Object.entries(objectValue(data)).map(([key, item]) => {
    if (/^thing\d+$/.test(key) && item && typeof item === "object" && !Array.isArray(item)) {
      return [key, { ...item, value: truncateThing(item.value) }];
    }
    return [key, item];
  }));
}

function resolveTemplate(env = process.env) {
  const templateId = text(env.ROOT_CHECKIN_REMINDER_TEMPLATE_ID || env.WECHAT_CHECKIN_REMINDER_TEMPLATE_ID);
  const enabledFlag = String(env.ROOT_CHECKIN_REMINDER_ENABLED || "").toLowerCase();
  const enabled = templateId && enabledFlag !== "false";
  const reminderHour = clampHour(env.ROOT_CHECKIN_REMINDER_HOUR);
  const templateData = parseJsonObject(env.ROOT_CHECKIN_REMINDER_TEMPLATE_DATA_JSON);
  return {
    templateKey: TEMPLATE_KEY,
    templateId,
    version: text(env.ROOT_CHECKIN_REMINDER_TEMPLATE_VERSION, DEFAULT_TEMPLATE_VERSION),
    title: text(env.ROOT_CHECKIN_REMINDER_TEMPLATE_TITLE, DEFAULT_TEMPLATE_TITLE),
    enabled: Boolean(enabled),
    page: normalizePage(env.ROOT_CHECKIN_REMINDER_PAGE),
    reminderHour,
    miniprogramState: text(env.ROOT_CHECKIN_REMINDER_MINIPROGRAM_STATE, "formal"),
    lang: text(env.ROOT_CHECKIN_REMINDER_LANG, "zh_CN"),
    source: "env",
    configured: Boolean(templateId),
    templateData,
  };
}

function ensureTemplateRecord(data, template) {
  const templates = ensureList(data, "notificationTemplates");
  let record = templates.find((item) => {
    return item.template_key === template.templateKey && item.template_version === template.version;
  });
  const now = nowISO();
  if (!record) {
    record = {
      notification_template_id: createId("ntpl"),
      template_key: template.templateKey,
      template_version: template.version,
      created_at: now,
    };
    templates.push(record);
  }
  Object.assign(record, {
    template_id: template.templateId,
    title: template.title,
    page: template.page,
    reminder_hour: template.reminderHour,
    miniprogram_state: template.miniprogramState,
    lang: template.lang,
    status: template.enabled ? "ACTIVE" : "MISSING_TEMPLATE_ID",
    source: template.source,
    data_schema_json: template.templateData || defaultTemplateData("ROOT 身体记录", addDays(todayISO(), 1), template.reminderHour),
    updated_at: now,
  });
  return record;
}

function publicTemplate(template) {
  return {
    templateKey: template.templateKey,
    templateId: template.templateId,
    version: template.version,
    title: template.title,
    enabled: template.enabled,
    configured: template.configured,
    page: template.page,
    reminderHour: template.reminderHour,
    miniprogramState: template.miniprogramState,
  };
}

function getCheckinReminderTemplate(data, context = {}) {
  const template = resolveTemplate(context.env || process.env);
  ensureTemplateRecord(data, template);
  return {
    template: publicTemplate(template),
    copy: {
      acceptedToast: "明天提醒你打卡",
      declinedToast: "已加入，提醒可稍后再开启",
    },
  };
}

function campaignIdOf(campaign) {
  return text(campaign && (campaign.campaign_id || campaign.campaignId));
}

function campaignTitleOf(campaign) {
  return text(campaign && campaign.title, "ROOT 身体记录");
}

function buildJobData(template, campaign, reminderDate) {
  const campaignTitle = campaignTitleOf(campaign);
  const variables = {
    campaignId: campaignIdOf(campaign),
    campaignTitle,
    reminderDate,
    reminderHour: padHour(template.reminderHour),
    reminderTimeText: `${reminderDate} ${padHour(template.reminderHour)}:00`,
    actionText: DEFAULT_ACTION_TEXT,
    productName: DEFAULT_PRODUCT_NAME,
  };
  const configured = template.templateData ? normalizeWechatTemplateData(expandPlaceholders(template.templateData, variables)) : null;
  return configured || defaultTemplateData(campaignTitle);
}

function scheduleNextDayCheckinReminder(data, rootUserId, campaign, context = {}) {
  const template = resolveTemplate(context.env || process.env);
  if (!template.enabled) {
    return { scheduled: false, reason: "TEMPLATE_NOT_CONFIGURED", template: publicTemplate(template) };
  }
  ensureTemplateRecord(data, template);

  const campaignId = campaignIdOf(campaign);
  if (!rootUserId || !campaignId) return { scheduled: false, reason: "MISSING_USER_OR_CAMPAIGN", template: publicTemplate(template) };

  const baseDate = text(context.dateText || context.date || todayISO());
  const reminderDate = text(context.reminderDate || context.reminder_date, addDays(baseDate, 1));
  const idempotencyKey = `${TEMPLATE_KEY}:${template.version}:${rootUserId}:${campaignId}:${reminderDate}`;
  const jobs = ensureList(data, "notificationJobs");
  const existing = jobs.find((item) => item.idempotency_key === idempotencyKey);
  if (existing) return { scheduled: false, reason: "ALREADY_SCHEDULED", job: existing, template: publicTemplate(template) };

  const now = nowISO();
  const job = {
    notification_job_id: createId("ntj"),
    root_user_id: rootUserId,
    campaign_id: campaignId,
    template_key: template.templateKey,
    template_id: template.templateId,
    template_version: template.version,
    reminder_date: reminderDate,
    scheduled_at: scheduleAtFor(reminderDate, template.reminderHour),
    page: template.page,
    miniprogram_state: template.miniprogramState,
    lang: template.lang,
    data_json: buildJobData(template, campaign, reminderDate),
    status: "SCHEDULED",
    attempts: 0,
    last_error: "",
    idempotency_key: idempotencyKey,
    source_channel: text(context.sourceChannel || context.source_channel, "MINIPROGRAM_TASK"),
    created_at: now,
    updated_at: now,
  };
  jobs.push(job);
  return { scheduled: true, job, template: publicTemplate(template) };
}

function normalizeSubscribeStatus(input) {
  const value = String(input || "").toLowerCase();
  if (value === "accept" || value === "accepted" || value === "true") return "ACCEPTED";
  if (value === "reject" || value === "rejected" || value === "false") return "REJECTED";
  if (value === "ban" || value === "banned") return "BANNED";
  return "UNKNOWN";
}

function recordSubscription(data, rootUserId, input = {}, context = {}) {
  const template = resolveTemplate(context.env || process.env);
  const templateKey = text(input.templateKey || input.template_key, template.templateKey);
  const templateId = text(input.templateId || input.template_id, template.templateId);
  const templateVersion = text(input.templateVersion || input.template_version, template.version);
  const result = text(input.result || input.status || input.subscribeResult || input.subscribe_result);
  const status = normalizeSubscribeStatus(input.subscribed === true ? "accept" : result);
  const subscriptions = ensureList(data, "notificationSubscriptions");
  let subscription = subscriptions.find((item) => {
    return item.root_user_id === rootUserId &&
      item.template_key === templateKey &&
      item.template_id === templateId &&
      item.template_version === templateVersion;
  });
  const now = nowISO();
  if (!subscription) {
    subscription = {
      notification_subscription_id: createId("nts"),
      root_user_id: rootUserId,
      template_key: templateKey,
      template_id: templateId,
      template_version: templateVersion,
      created_at: now,
    };
    subscriptions.push(subscription);
  }
  Object.assign(subscription, {
    status,
    result,
    subscribed: status === "ACCEPTED",
    trigger: text(input.trigger, "CAMPAIGN_JOIN"),
    campaign_id: text(input.campaignId || input.campaign_id),
    raw_result_json: {},
    setting_json: objectValue(input.setting || input.setting_json),
    source_channel: text(context.sourceChannel || context.source_channel, "MINIPROGRAM_SUBSCRIBE"),
    updated_at: now,
  });
  return subscription;
}

function acceptedSubscription(data, rootUserId, job) {
  return ensureList(data, "notificationSubscriptions").find((item) => {
    return item.root_user_id === rootUserId &&
      item.template_key === job.template_key &&
      item.template_id === job.template_id &&
      item.template_version === job.template_version &&
      item.status === "ACCEPTED";
  }) || null;
}

function openidForRootUser(data, rootUserId) {
  const identities = ensureList(data, "wechatIdentities")
    .filter((item) => item.root_user_id === rootUserId && item.app_code === "MYROOT" && item.openid)
    .sort((left, right) => String(right.last_seen_at || right.updated_at || "").localeCompare(String(left.last_seen_at || left.updated_at || "")));
  if (identities[0]) return identities[0].openid;
  const user = ensureList(data, "users").find((item) => (item.root_user_id || item.user_id) === rootUserId && item.openid);
  return user ? user.openid : "";
}

function hasCheckinForDate(data, rootUserId, campaignId, dateText) {
  return ensureList(data, "taskEvents").some((event) => {
    return event.root_user_id === rootUserId &&
      event.campaign_id === campaignId &&
      event.task_type === "CHECKIN" &&
      event.status !== "VOID" &&
      (event.task_date || String(event.occurred_at || "").slice(0, 10)) === dateText;
  });
}

function addDelivery(data, job, payload) {
  const deliveries = ensureList(data, "notificationDeliveries");
  const delivery = {
    notification_delivery_id: createId("ntd"),
    notification_job_id: job.notification_job_id,
    root_user_id: job.root_user_id,
    campaign_id: job.campaign_id,
    template_key: job.template_key,
    template_id: job.template_id,
    template_version: job.template_version,
    status: payload.status,
    error_code: payload.errorCode || "",
    error_message: payload.errorMessage || "",
    response_json: objectValue(payload.response),
    request_json: objectValue(payload.request),
    delivered_at: payload.status === "SENT" ? nowISO() : "",
    created_at: nowISO(),
  };
  deliveries.push(delivery);
  return delivery;
}

function markJob(job, status, extra = {}) {
  job.status = status;
  job.updated_at = nowISO();
  if (extra.error) job.last_error = extra.error;
  if (extra.attempted) job.attempts = Number(job.attempts || 0) + 1;
  if (status === "SENT") job.sent_at = nowISO();
  if (status.startsWith("SKIPPED")) job.skipped_at = nowISO();
  return job;
}

function buildSendRequest(job, openid) {
  return {
    touser: openid,
    template_id: job.template_id,
    page: job.page || DEFAULT_PAGE,
    miniprogram_state: job.miniprogram_state || "formal",
    lang: job.lang || "zh_CN",
    data: job.data_json || {},
  };
}

async function runDueCheckinReminders(data, input = {}, context = {}) {
  const nowText = text(input.now || input.nowText || input.now_text, nowISO());
  const limit = Math.max(1, Math.min(200, Number(input.limit || 50)));
  const dryRun = input.dryRun === true || input.dry_run === true;
  const jobs = ensureList(data, "notificationJobs")
    .filter((job) => job.status === "SCHEDULED" && job.scheduled_at <= nowText)
    .sort((left, right) => String(left.scheduled_at).localeCompare(String(right.scheduled_at)))
    .slice(0, limit);
  const results = [];
  const sender = context.sendSubscribeMessage;

  for (const job of jobs) {
    if (hasCheckinForDate(data, job.root_user_id, job.campaign_id, job.reminder_date)) {
      if (!dryRun) {
        markJob(job, "SKIPPED_ALREADY_CHECKED_IN");
        addDelivery(data, job, { status: "SKIPPED_ALREADY_CHECKED_IN" });
      }
      results.push({ jobId: job.notification_job_id, status: "SKIPPED_ALREADY_CHECKED_IN" });
      continue;
    }
    if (!acceptedSubscription(data, job.root_user_id, job)) {
      if (!dryRun) {
        markJob(job, "SKIPPED_NO_SUBSCRIPTION");
        addDelivery(data, job, { status: "SKIPPED_NO_SUBSCRIPTION" });
      }
      results.push({ jobId: job.notification_job_id, status: "SKIPPED_NO_SUBSCRIPTION" });
      continue;
    }
    const openid = openidForRootUser(data, job.root_user_id);
    if (!openid) {
      if (!dryRun) {
        markJob(job, "FAILED", { error: "OPENID_NOT_FOUND" });
        addDelivery(data, job, { status: "FAILED", errorCode: "OPENID_NOT_FOUND" });
      }
      results.push({ jobId: job.notification_job_id, status: "FAILED", errorCode: "OPENID_NOT_FOUND" });
      continue;
    }
    const request = buildSendRequest(job, openid);
    if (dryRun) {
      results.push({ jobId: job.notification_job_id, status: "DRY_RUN_READY", request });
      continue;
    }
    if (typeof sender !== "function") {
      markJob(job, "FAILED", { attempted: true, error: "SEND_ADAPTER_NOT_CONFIGURED" });
      addDelivery(data, job, { status: "FAILED", errorCode: "SEND_ADAPTER_NOT_CONFIGURED", request });
      results.push({ jobId: job.notification_job_id, status: "FAILED", errorCode: "SEND_ADAPTER_NOT_CONFIGURED" });
      continue;
    }
    try {
      const response = await sender(request);
      markJob(job, "SENT", { attempted: true });
      addDelivery(data, job, { status: "SENT", request, response });
      results.push({ jobId: job.notification_job_id, status: "SENT" });
    } catch (error) {
      const errorMessage = error && (error.code || error.message || String(error));
      markJob(job, "FAILED", { attempted: true, error: errorMessage });
      addDelivery(data, job, { status: "FAILED", errorCode: error && error.code, errorMessage, request });
      results.push({ jobId: job.notification_job_id, status: "FAILED", errorCode: error && error.code, errorMessage });
    }
  }

  return {
    dryRun,
    now: nowText,
    scannedCount: jobs.length,
    results,
  };
}

module.exports = {
  TEMPLATE_KEY,
  getCheckinReminderTemplate,
  recordSubscription,
  resolveTemplate,
  runDueCheckinReminders,
  scheduleNextDayCheckinReminder,
};
