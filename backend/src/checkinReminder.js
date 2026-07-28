const { addDays, nowISO, todayISO } = require("./dates");
const { createId } = require("./seed");
const { isProtectedRuntime } = require("./credentialProtection");
const {
  freezeWechatRecipientBinding,
  verifyWechatRecipientBinding,
} = require("./wechatRecipientBinding");

const TEMPLATE_KEY = "CHECKIN_REMINDER_NEXT_DAY";
const DEFAULT_TEMPLATE_VERSION = "v2026-06-28-tpl10850";
const DEFAULT_REMINDER_HOUR = 9;
const DEFAULT_PAGE = "pages/tasks/index";
const DEFAULT_TEMPLATE_TITLE = "活动提醒";
const DEFAULT_PRODUCT_NAME = "ROOT 7日身体重启计划";
const DEFAULT_ACTION_TEXT = "请完成今日打卡";
const GRANT_STATUS = Object.freeze({
  AVAILABLE: "AVAILABLE",
  RESERVED: "RESERVED",
  CONSUMED: "CONSUMED",
  INVALIDATED: "INVALIDATED",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
});

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

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function transactionalCheckpointError() {
  const error = new Error("真实提醒发送需要支持 checkpoint/resume 的事务 Store Interface");
  error.code = 50301;
  error.status = 503;
  error.internalCode = "CHECKIN_REMINDER_TRANSACTION_CHECKPOINT_REQUIRED";
  return error;
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

function sanitizeFailureText(value, fallback = "SEND_FAILED") {
  return text(value, fallback)
    .replace(/\b(access_token|cloudbase_access_token|secret|token|openid|unionid|phone)=([^&\s]+)/gi, "$1=[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[REDACTED_ID]")
    .slice(0, 240);
}

function failureDetails(error) {
  const errorCode = sanitizeFailureText(error && error.code, "SEND_FAILED").slice(0, 64);
  const externalErrorCode = sanitizeFailureText(error && error.externalCode, "").slice(0, 64);
  const errorMessage = sanitizeFailureText(error && (error.message || error), errorCode);
  const deliveryOutcome = ["NOT_SENT", "NO_GRANT", "UNKNOWN"].includes(error && error.deliveryOutcome)
    ? error.deliveryOutcome
    : "UNKNOWN";
  return {
    errorCode,
    externalErrorCode,
    errorMessage,
    deliveryOutcome,
    lastError: errorMessage === errorCode ? errorCode : `${errorCode}: ${errorMessage}`.slice(0, 240),
  };
}

function normalizeGrantRequestId(value) {
  return text(value)
    .replace(/[^A-Za-z0-9:._-]/g, "")
    .slice(0, 96);
}

function grantRequestIdFor(input, rootUserId, template, context = {}) {
  const supplied = normalizeGrantRequestId(input.grantRequestId || input.grant_request_id);
  if (supplied) return supplied;
  const dateText = text(context.dateText || context.date || nowISO().slice(0, 10));
  const campaignId = text(input.campaignId || input.campaign_id, "NO_CAMPAIGN").slice(0, 32);
  return normalizeGrantRequestId(`legacy:${dateText}:${template.version}:${campaignId}:${rootUserId.slice(-8)}`);
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
  if (isProtectedRuntime(context.env || process.env)) {
    return {
      scheduled: false,
      reason: "AWAITING_SUBSCRIPTION_GRANT",
      authority: "MYSQL_NOTIFICATION_DELIVERY_CORE_V1",
    };
  }
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
  const grantRequestId = status === "ACCEPTED"
    ? grantRequestIdFor(input, rootUserId, template, context)
    : "";
  const recipientBinding = status === "ACCEPTED"
    ? freezeWechatRecipientBinding(data, {
      rootUserId,
      grantRequestId,
      templateKey,
      templateId,
      templateVersion,
    }, { env: context.env || process.env })
    : null;
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
  let grant = null;
  if (status === "ACCEPTED") {
    const idempotencyKey = `SUBSCRIPTION_GRANT:${rootUserId}:${grantRequestId}`;
    const grants = ensureList(data, "notificationSubscriptionGrants");
    grant = grants.find((item) => item.idempotency_key === idempotencyKey) || null;
    if (!grant) {
      grant = {
        notification_subscription_grant_id: createId("nsg"),
        notification_subscription_id: subscription.notification_subscription_id,
        root_user_id: rootUserId,
        campaign_id: text(input.campaignId || input.campaign_id),
        template_key: templateKey,
        template_id: templateId,
        template_version: templateVersion,
        grant_request_id: grantRequestId,
        status: GRANT_STATUS.AVAILABLE,
        notification_job_id: "",
        last_notification_job_id: "",
        idempotency_key: idempotencyKey,
        source_channel: text(context.sourceChannel || context.source_channel, "MINIPROGRAM_SUBSCRIBE"),
        granted_at: now,
        reserved_at: "",
        consumed_at: "",
        released_at: "",
        invalidated_at: "",
        review_required_at: "",
        release_reason: "",
        created_at: now,
        updated_at: now,
        ...recipientBinding,
      };
      grants.push(grant);
    } else if (Object.keys(recipientBinding).some((key) => grant[key] !== recipientBinding[key])) {
      const error = new Error("订阅授权的固定收件人和历史请求冲突");
      error.code = "CHECKIN_REMINDER_RECIPIENT_BINDING_REPLAY_CONFLICT";
      error.status = 409;
      throw error;
    }
  }
  return { subscription, grant };
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

function availableSubscriptionGrant(data, job, excludedGrantIds = new Set()) {
  const candidates = ensureList(data, "notificationSubscriptionGrants")
    .filter((item) => item.root_user_id === job.root_user_id &&
      item.template_key === job.template_key &&
      item.template_id === job.template_id &&
      item.template_version === job.template_version &&
      item.status === GRANT_STATUS.AVAILABLE &&
      !excludedGrantIds.has(item.notification_subscription_grant_id) &&
      (!item.campaign_id || item.campaign_id === job.campaign_id))
    .sort((left, right) => {
      const leftExact = left.campaign_id === job.campaign_id ? 0 : 1;
      const rightExact = right.campaign_id === job.campaign_id ? 0 : 1;
      if (leftExact !== rightExact) return leftExact - rightExact;
      return String(left.granted_at || left.created_at || "").localeCompare(String(right.granted_at || right.created_at || ""));
    });
  return candidates[0] || null;
}

function reserveSubscriptionGrant(grant, job) {
  const now = nowISO();
  grant.status = GRANT_STATUS.RESERVED;
  grant.notification_job_id = job.notification_job_id;
  grant.last_notification_job_id = job.notification_job_id;
  grant.reserved_at = now;
  grant.updated_at = now;
  job.notification_subscription_grant_id = grant.notification_subscription_grant_id;
  return grant;
}

function consumeSubscriptionGrant(grant) {
  const now = nowISO();
  grant.status = GRANT_STATUS.CONSUMED;
  grant.consumed_at = now;
  grant.updated_at = now;
  return grant;
}

function settleSubscriptionGrantFailure(grant, job, failure) {
  const now = nowISO();
  grant.last_notification_job_id = job.notification_job_id;
  grant.release_reason = text(failure.externalErrorCode || failure.errorCode, "SEND_FAILED").slice(0, 128);
  if (failure.deliveryOutcome === "NOT_SENT") {
    grant.status = GRANT_STATUS.AVAILABLE;
    grant.notification_job_id = "";
    grant.released_at = now;
  } else if (failure.deliveryOutcome === "NO_GRANT") {
    grant.status = GRANT_STATUS.INVALIDATED;
    grant.invalidated_at = now;
  } else {
    grant.status = GRANT_STATUS.REVIEW_REQUIRED;
    grant.review_required_at = now;
  }
  grant.updated_at = now;
  return grant;
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

function deliveryRequestEvidence(request = {}) {
  return {
    recipient_present: Boolean(request.touser),
    template_id: text(request.template_id),
    page: text(request.page),
    miniprogram_state: text(request.miniprogram_state),
    lang: text(request.lang),
    data_keys: Object.keys(objectValue(request.data)).sort(),
  };
}

function deliveryResponseEvidence(response) {
  const present = Boolean(response && typeof response === "object" && Object.keys(response).length);
  const normalized = present ? response : {};
  return {
    response_present: present,
    accepted: present && !Number(normalized.errcode || 0),
    errcode: normalized.errcode === undefined ? null : Number(normalized.errcode),
    errmsg: sanitizeFailureText(normalized.errmsg, "").slice(0, 160),
    msgid_present: Boolean(normalized.msgid),
  };
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
    notification_subscription_grant_id: payload.grantId || job.notification_subscription_grant_id || "",
    status: payload.status,
    error_code: payload.errorCode || "",
    external_error_code: payload.externalErrorCode || "",
    error_message: payload.errorMessage || "",
    delivery_outcome: payload.deliveryOutcome || "",
    response_json: deliveryResponseEvidence(payload.response),
    request_json: deliveryRequestEvidence(payload.request),
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

function markJobSending(job) {
  const now = nowISO();
  job.status = "SENDING";
  job.attempts = Number(job.attempts || 0) + 1;
  job.last_error = "";
  job.sending_at = now;
  job.updated_at = now;
  return job;
}

function staleSendingJobs(data, nowText, input = {}, context = {}) {
  const env = context.env || process.env;
  const reviewAfterMinutes = boundedInteger(
    input.sendingReviewAfterMinutes ||
    input.sending_review_after_minutes ||
    env.ROOT_CHECKIN_REMINDER_SENDING_REVIEW_MINUTES ||
    15,
    15,
    5,
    1440
  );
  const cutoff = Date.parse(nowText) - reviewAfterMinutes * 60 * 1000;
  if (!Number.isFinite(cutoff)) return [];
  return ensureList(data, "notificationJobs").filter((job) => {
    if (job.status !== "SENDING") return false;
    const updatedAt = Date.parse(job.sending_at || job.updated_at || "");
    return Number.isFinite(updatedAt) && updatedAt <= cutoff;
  });
}

function requireStaleSendingReview(data, job) {
  const now = nowISO();
  const errorCode = "SEND_OUTCOME_UNKNOWN_AFTER_CHECKPOINT";
  job.status = "REVIEW_REQUIRED";
  job.last_error = errorCode;
  job.updated_at = now;
  const grant = ensureList(data, "notificationSubscriptionGrants").find((item) => {
    return item.notification_subscription_grant_id === job.notification_subscription_grant_id &&
      item.notification_job_id === job.notification_job_id &&
      item.status === GRANT_STATUS.RESERVED;
  });
  if (grant) {
    grant.status = GRANT_STATUS.REVIEW_REQUIRED;
    grant.last_notification_job_id = job.notification_job_id;
    grant.release_reason = errorCode;
    grant.review_required_at = now;
    grant.updated_at = now;
  }
  addDelivery(data, job, {
    status: "REVIEW_REQUIRED",
    grantId: grant && grant.notification_subscription_grant_id,
    errorCode,
    errorMessage: "发送结果未确认，禁止自动重试",
    deliveryOutcome: "UNKNOWN",
  });
  return grant;
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

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function consume() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  const workerCount = Math.min(items.length, Math.max(1, concurrency));
  await Promise.all(Array.from({ length: workerCount }, () => consume()));
  return results;
}

async function runDueCheckinReminders(data, input = {}, context = {}) {
  const nowText = text(input.now || input.nowText || input.now_text, nowISO());
  const limit = boundedInteger(input.limit || 50, 50, 1, 200);
  const dryRun = input.dryRun === true || input.dry_run === true;
  const hasCheckpoint = typeof context.transactionCheckpoint === "function";
  const hasResume = typeof context.transactionResume === "function";
  const checkpointed = hasCheckpoint && hasResume;
  if (!dryRun && (hasCheckpoint !== hasResume || (context.requireTransactionalCheckpoint === true && !checkpointed))) {
    throw transactionalCheckpointError();
  }
  const staleJobs = staleSendingJobs(data, nowText, input, context);
  const jobIds = ensureList(data, "notificationJobs")
    .filter((job) => job.status === "SCHEDULED" && job.scheduled_at <= nowText)
    .sort((left, right) => String(left.scheduled_at).localeCompare(String(right.scheduled_at)))
    .slice(0, limit)
    .map((job) => job.notification_job_id);
  const results = [];
  const sender = context.sendSubscribeMessage;
  const pendingSends = [];
  const dryRunGrantIds = new Set();
  const env = context.env || process.env;
  const sendConcurrency = boundedInteger(
    input.sendConcurrency || input.send_concurrency || env.ROOT_CHECKIN_REMINDER_SEND_CONCURRENCY || 5,
    5,
    1,
    20
  );

  staleJobs.forEach((job) => {
    if (!dryRun) requireStaleSendingReview(data, job);
    results.push({
      jobId: job.notification_job_id,
      status: dryRun ? "DRY_RUN_REVIEW_REQUIRED" : "REVIEW_REQUIRED",
      errorCode: "SEND_OUTCOME_UNKNOWN_AFTER_CHECKPOINT",
      deliveryOutcome: "UNKNOWN",
    });
  });

  for (const jobId of jobIds) {
    let job = ensureList(data, "notificationJobs").find((item) => item.notification_job_id === jobId);
    if (!job || job.status !== "SCHEDULED") {
      results.push({ jobId, status: "SKIPPED_STATE_CHANGED" });
      continue;
    }
    if (hasCheckinForDate(data, job.root_user_id, job.campaign_id, job.reminder_date)) {
      if (!dryRun) {
        markJob(job, "SKIPPED_ALREADY_CHECKED_IN");
        addDelivery(data, job, { status: "SKIPPED_ALREADY_CHECKED_IN" });
      }
      results.push({ jobId: job.notification_job_id, status: "SKIPPED_ALREADY_CHECKED_IN" });
      continue;
    }
    const accepted = acceptedSubscription(data, job.root_user_id, job);
    const availableGrant = availableSubscriptionGrant(data, job, dryRunGrantIds);
    if (!availableGrant) {
      const status = accepted ? "SKIPPED_NO_GRANT" : "SKIPPED_NO_SUBSCRIPTION";
      if (!dryRun) {
        markJob(job, status);
        addDelivery(data, job, { status });
      }
      results.push({ jobId: job.notification_job_id, status });
      continue;
    }
    let recipient;
    try {
      recipient = verifyWechatRecipientBinding(data, availableGrant, { env });
    } catch (error) {
      if (!dryRun) {
        markJob(job, "REVIEW_REQUIRED", { error: error.code || "RECIPIENT_BINDING_INVALID" });
        availableGrant.status = GRANT_STATUS.REVIEW_REQUIRED;
        availableGrant.review_required_at = nowISO();
        availableGrant.release_reason = error.code || "RECIPIENT_BINDING_INVALID";
        availableGrant.updated_at = nowISO();
        addDelivery(data, job, { status: "REVIEW_REQUIRED", errorCode: error.code || "RECIPIENT_BINDING_INVALID" });
      }
      results.push({
        jobId: job.notification_job_id,
        status: dryRun ? "DRY_RUN_REVIEW_REQUIRED" : "REVIEW_REQUIRED",
        errorCode: error.code || "RECIPIENT_BINDING_INVALID",
      });
      continue;
    }
    const request = buildSendRequest(job, recipient.openid);
    if (dryRun) {
      dryRunGrantIds.add(availableGrant.notification_subscription_grant_id);
      results.push({
        jobId: job.notification_job_id,
        status: "DRY_RUN_READY",
        grantReady: true,
        request: deliveryRequestEvidence(request),
      });
      continue;
    }
    if (typeof sender !== "function") {
      markJob(job, "FAILED", { attempted: true, error: "SEND_ADAPTER_NOT_CONFIGURED" });
      addDelivery(data, job, { status: "FAILED", errorCode: "SEND_ADAPTER_NOT_CONFIGURED", request });
      results.push({ jobId: job.notification_job_id, status: "FAILED", errorCode: "SEND_ADAPTER_NOT_CONFIGURED" });
      continue;
    }
    const grant = reserveSubscriptionGrant(availableGrant, job);
    markJobSending(job);
    pendingSends.push({
      jobId,
      grantId: grant.notification_subscription_grant_id,
      request,
    });
  }

  if (pendingSends.length) {
    if (checkpointed) {
      await context.transactionCheckpoint({
        reason: "CHECKIN_REMINDER_SEND_RESERVED",
        notificationJobIds: pendingSends.map((item) => item.jobId),
        notificationSubscriptionGrantIds: pendingSends.map((item) => item.grantId),
      });
    }
    const sendOutcomes = await mapWithConcurrency(pendingSends, sendConcurrency, async (item) => {
      try {
        return { response: await sender(item.request), error: null };
      } catch (error) {
        return { response: null, error };
      }
    });
    if (checkpointed && typeof context.transactionResume === "function") {
      await context.transactionResume({
        reason: "CHECKIN_REMINDER_SEND_FINALIZE",
        notificationJobIds: pendingSends.map((item) => item.jobId),
        notificationSubscriptionGrantIds: pendingSends.map((item) => item.grantId),
      });
    }

    const finalizations = pendingSends.map((item, index) => {
      const job = ensureList(data, "notificationJobs").find((candidate) => candidate.notification_job_id === item.jobId);
      const grant = ensureList(data, "notificationSubscriptionGrants").find((candidate) => {
        return candidate.notification_subscription_grant_id === item.grantId;
      });
      if (!job || job.status !== "SENDING" || !grant || grant.status !== GRANT_STATUS.RESERVED || grant.notification_job_id !== item.jobId) {
        const error = new Error("提醒发送占用状态发生变化，禁止覆盖");
        error.code = "CHECKIN_REMINDER_RESERVATION_LOST";
        error.deliveryOutcome = "UNKNOWN";
        throw error;
      }
      return { ...item, job, grant, outcome: sendOutcomes[index] };
    });

    finalizations.forEach(({ job, grant, request, outcome }) => {
      if (!outcome.error) {
        consumeSubscriptionGrant(grant);
        markJob(job, "SENT");
        addDelivery(data, job, {
          status: "SENT",
          grantId: grant.notification_subscription_grant_id,
          deliveryOutcome: "ACCEPTED_BY_WECHAT",
          request,
          response: outcome.response,
        });
        results.push({ jobId: job.notification_job_id, status: "SENT" });
      } else {
        const failure = failureDetails(outcome.error);
        settleSubscriptionGrantFailure(grant, job, failure);
        markJob(job, "FAILED", { error: failure.lastError });
        addDelivery(data, job, {
          status: "FAILED",
          grantId: grant.notification_subscription_grant_id,
          errorCode: failure.errorCode,
          externalErrorCode: failure.externalErrorCode,
          errorMessage: failure.errorMessage,
          deliveryOutcome: failure.deliveryOutcome,
          request,
        });
        results.push({
          jobId: job.notification_job_id,
          status: "FAILED",
          errorCode: failure.errorCode,
          externalErrorCode: failure.externalErrorCode,
          errorMessage: failure.errorMessage,
          deliveryOutcome: failure.deliveryOutcome,
        });
      }
    });
  }

  return {
    dryRun,
    now: nowText,
    scannedCount: jobIds.length,
    staleSendingCount: staleJobs.length,
    sendConcurrency,
    results,
  };
}

module.exports = {
  TEMPLATE_KEY,
  GRANT_STATUS,
  buildJobData,
  getCheckinReminderTemplate,
  recordSubscription,
  resolveTemplate,
  runDueCheckinReminders,
  scheduleNextDayCheckinReminder,
};
