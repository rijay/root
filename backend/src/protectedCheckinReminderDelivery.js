const crypto = require("node:crypto");

const campaign = require("./campaign");
const checkinReminder = require("./checkinReminder");
const { isProtectedRuntime } = require("./credentialProtection");
const { addDays, nowISO, todayISO } = require("./dates");
const {
  freezeWechatRecipientBinding,
  verifyWechatRecipientBinding,
} = require("./wechatRecipientBinding");
const { createId } = require("./seed");
const taskProgress = require("./taskProgress");

const SEND_ENABLE_FLAG = "ROOT_CHECKIN_REMINDER_SEND_ENABLED";
const CORE_AUTHORITY = "MYSQL_NOTIFICATION_DELIVERY_CORE_V1";

function deliveryError(code, message, status = 503) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function protectedRuntime(context = {}) {
  return isProtectedRuntime(context.env || process.env);
}

function assertCore(context = {}) {
  const core = context.notificationDeliveryCore;
  const methods = [
    "assertReady",
    "recordDecision",
    "schedule",
    "beginSendAttempt",
    "claimProviderCall",
    "startProviderCall",
    "inspectSendAttempt",
    "completeSendAttempt",
    "recoverProviderCall",
  ];
  if (!core || methods.some((method) => typeof core[method] !== "function")) {
    throw deliveryError(
      "CHECKIN_REMINDER_NOTIFICATION_CORE_REQUIRED",
      "受保护运行环境缺少关系型提醒发送 Core Interface"
    );
  }
  try {
    core.assertReady();
  } catch (error) {
    if (error && error.status) throw error;
    throw deliveryError(
      "CHECKIN_REMINDER_NOTIFICATION_CORE_UNAVAILABLE",
      "关系型提醒发送 Core 尚未就绪"
    );
  }
  return core;
}

function releaseId(context = {}) {
  const runtimeMetadata = context.runtimeMetadata || {};
  const configured = runtimeMetadata.releaseIdConfigured === true
    ? runtimeMetadata.releaseId
    : context.env && context.env.ROOT_RELEASE_ID;
  const value = text(configured);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value)) {
    throw deliveryError(
      "CHECKIN_REMINDER_RELEASE_ID_REQUIRED",
      "受保护运行环境必须绑定显式 ROOT_RELEASE_ID"
    );
  }
  return value;
}

function exactIsoTimestamp(value, fieldName) {
  const normalized = text(value);
  const timestamp = Date.parse(normalized);
  if (!normalized
    || !Number.isFinite(timestamp)
    || new Date(timestamp).toISOString() !== normalized) {
    throw deliveryError(
      "CHECKIN_REMINDER_DECISION_INPUT_INVALID",
      `${fieldName} 必须是毫秒精度 UTC 时间`,
      400
    );
  }
  return normalized;
}

function shanghaiDate(isoTimestamp) {
  return new Date(Date.parse(isoTimestamp) + (8 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

function dueAtFor(occurrenceDate, hour) {
  const normalizedHour = Math.max(0, Math.min(23, Number(hour) || 0));
  const utcHour = normalizedHour - 8;
  const base = new Date(`${occurrenceDate}T00:00:00.000Z`);
  base.setUTCHours(utcHour);
  return base.toISOString();
}

function normalizeNativeDecision(body = {}) {
  const result = text(body.result || body.status || body.subscribeResult || body.subscribe_result).toLowerCase();
  if (body.subscribed === true || ["accept", "accepted"].includes(result)) {
    return { nativeDecision: "ACCEPTED", reasonCode: null, mirrorStatus: "ACCEPTED" };
  }
  if (["reject", "rejected"].includes(result)) {
    return { nativeDecision: "REJECTED", reasonCode: "USER_REJECTED", mirrorStatus: "REJECTED" };
  }
  if (["ban", "banned"].includes(result)) {
    return { nativeDecision: "PLATFORM_DISABLED", reasonCode: "PLATFORM_DISABLED", mirrorStatus: "BANNED" };
  }
  // The native result is authoritative when present. `subscribed=false` is
  // only a compatibility fallback for older callers that did not forward it.
  if (!result && body.subscribed === false) {
    return { nativeDecision: "REJECTED", reasonCode: "USER_REJECTED", mirrorStatus: "REJECTED" };
  }
  return { nativeDecision: "OUTCOME_UNKNOWN", reasonCode: "OUTCOME_UNKNOWN", mirrorStatus: "UNKNOWN" };
}

function grantRequestId(body = {}) {
  const value = text(body.grantRequestId || body.grant_request_id);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(value)) {
    throw deliveryError(
      "CHECKIN_REMINDER_DECISION_INPUT_INVALID",
      "grantRequestId 不合法",
      400
    );
  }
  return value;
}

function authoritativeTaskContext(data, rootUserId, body, context, decidedAt) {
  const campaignId = text(body.campaignId || body.campaign_id);
  if (!campaignId) {
    throw deliveryError(
      "CHECKIN_REMINDER_CAMPAIGN_REQUIRED",
      "开启明日提醒前必须选择已参与的任务活动",
      400
    );
  }
  const decisionDate = shanghaiDate(decidedAt);
  const activeCampaign = campaign.getActiveCampaign(data, { campaignId, dateText: decisionDate });
  const participant = campaign.findParticipant(data, rootUserId, activeCampaign.campaign_id);
  if (!participant || participant.status !== "JOINED") {
    throw deliveryError(
      "CHECKIN_REMINDER_PARTICIPATION_REQUIRED",
      "仅已参与任务的会员可以开启明日提醒",
      409
    );
  }
  const definition = taskProgress.listTaskDefinitions(data, activeCampaign.campaign_id)
    .find((item) => item.task_type === "CHECKIN" && item.status !== "ARCHIVED");
  if (!definition || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(definition.task_definition_id)) {
    throw deliveryError(
      "CHECKIN_REMINDER_TASK_DEFINITION_REQUIRED",
      "当前活动没有可用的打卡任务定义"
    );
  }
  const taskOccurrenceDate = addDays(decisionDate, 1);
  return {
    campaign: activeCampaign,
    taskId: definition.task_definition_id,
    taskOccurrenceDate,
  };
}

function validateTemplate(body, context) {
  const template = checkinReminder.resolveTemplate(context.env || process.env);
  const requestedKey = text(body.templateKey || body.template_key, template.templateKey);
  const requestedId = text(body.templateId || body.template_id);
  const requestedVersion = text(body.templateVersion || body.template_version);
  if (!template.enabled
    || !template.templateId
    || requestedKey !== template.templateKey
    || requestedId !== template.templateId
    || requestedVersion !== template.version) {
    throw deliveryError(
      "CHECKIN_REMINDER_TEMPLATE_MISMATCH",
      "提醒模板未启用或与当前发布版本不一致",
      409
    );
  }
  return template;
}

function mirrorDecision(
  data,
  rootUserId,
  body,
  template,
  decision,
  authorityDecision,
  taskContext,
  recipientBinding
) {
  const subscriptions = ensureList(data, "notificationSubscriptions");
  let subscription = subscriptions.find((item) => item.root_user_id === rootUserId
    && item.template_key === template.templateKey
    && item.template_version === template.version
    && item.campaign_id === taskContext.campaign.campaign_id);
  const timestamp = nowISO();
  if (!subscription) {
    subscription = {
      notification_subscription_id: createId("nts"),
      root_user_id: rootUserId,
      template_key: template.templateKey,
      template_id: template.templateId,
      template_version: template.version,
      campaign_id: taskContext.campaign.campaign_id,
      created_at: timestamp,
    };
    subscriptions.push(subscription);
  }
  Object.assign(subscription, {
    status: decision.mirrorStatus,
    result: text(body.result || body.status),
    subscribed: decision.nativeDecision === "ACCEPTED",
    trigger: text(body.trigger, "TASK_PAGE"),
    raw_result_json: {},
    setting_json: {},
    source_channel: "MINIPROGRAM_SUBSCRIBE",
    authority: CORE_AUTHORITY,
    authority_attempt_id: authorityDecision.attemptId,
    task_id: taskContext.taskId,
    task_occurrence_date: taskContext.taskOccurrenceDate,
    updated_at: timestamp,
  });

  let grant = null;
  if (authorityDecision.grantId) {
    const authorityBinding = {
      recipient_binding_status: "VERIFIED",
      recipient_wechat_identity_id: authorityDecision.recipientWechatIdentityId,
      recipient_app_code: authorityDecision.recipientAppCode,
      recipient_binding_canonical_version: authorityDecision.recipientBindingCanonicalVersion,
      recipient_binding_digest: authorityDecision.recipientBindingDigest,
      recipient_binding_digest_scheme: authorityDecision.recipientBindingDigestScheme,
      recipient_binding_key_id: authorityDecision.recipientBindingKeyId,
    };
    if (!recipientBinding
      || Object.keys(authorityBinding).some((key) => authorityBinding[key] !== recipientBinding[key])) {
      throw deliveryError(
        "CHECKIN_REMINDER_RECIPIENT_BINDING_AUTHORITY_CONFLICT",
        "关系型授权收件人绑定与本地验证结果冲突"
      );
    }
    const grants = ensureList(data, "notificationSubscriptionGrants");
    grant = grants.find((item) => item.notification_subscription_grant_id === authorityDecision.grantId) || null;
    if (!grant) {
      grant = {
        notification_subscription_grant_id: authorityDecision.grantId,
        notification_subscription_id: subscription.notification_subscription_id,
        root_user_id: rootUserId,
        campaign_id: taskContext.campaign.campaign_id,
        template_key: template.templateKey,
        template_id: template.templateId,
        template_version: template.version,
        grant_request_id: authorityDecision.grantRequestId,
        status: "AVAILABLE",
        notification_job_id: "",
        last_notification_job_id: "",
        idempotency_key: `CORE_GRANT:${authorityDecision.grantRequestId}`,
        source_channel: "MINIPROGRAM_SUBSCRIBE",
        granted_at: timestamp,
        created_at: timestamp,
      };
      grants.push(grant);
    }
    Object.assign(grant, {
      status: authorityDecision.grantStatus,
      authority: CORE_AUTHORITY,
      authority_attempt_id: authorityDecision.attemptId,
      task_id: taskContext.taskId,
      task_occurrence_date: taskContext.taskOccurrenceDate,
      updated_at: timestamp,
      ...authorityBinding,
    });
  }
  return { subscription, grant };
}

function mirrorSchedule(data, rootUserId, template, taskContext, authorityJob, grant) {
  const jobs = ensureList(data, "notificationJobs");
  let job = jobs.find((item) => item.notification_job_id === authorityJob.jobId) || null;
  const timestamp = nowISO();
  const dueAt = dueAtFor(taskContext.taskOccurrenceDate, template.reminderHour);
  if (!job) {
    job = {
      notification_job_id: authorityJob.jobId,
      root_user_id: rootUserId,
      campaign_id: taskContext.campaign.campaign_id,
      template_key: template.templateKey,
      template_id: template.templateId,
      template_version: template.version,
      notification_subscription_grant_id: authorityJob.grantId,
      reminder_date: taskContext.taskOccurrenceDate,
      scheduled_at: dueAt,
      page: template.page,
      miniprogram_state: template.miniprogramState,
      lang: template.lang,
      data_json: checkinReminder.buildJobData(template, taskContext.campaign, taskContext.taskOccurrenceDate),
      status: authorityJob.status,
      attempts: 0,
      last_error: "",
      idempotency_key: `CORE_JOB:${authorityJob.jobId}`,
      source_channel: "MINIPROGRAM_TASK",
      notification_core_authoritative: true,
      authority: CORE_AUTHORITY,
      created_at: timestamp,
    };
    jobs.push(job);
  }
  if (job.root_user_id !== rootUserId
    || job.notification_subscription_grant_id !== authorityJob.grantId
    || job.template_version !== template.version
    || job.reminder_date !== taskContext.taskOccurrenceDate) {
    throw deliveryError(
      "CHECKIN_REMINDER_MIRROR_CONFLICT_REVIEW_REQUIRED",
      "提醒调度镜像与关系权威事实冲突"
    );
  }
  Object.assign(job, {
    status: authorityJob.status,
    scheduled_at: dueAt,
    notification_core_authoritative: true,
    authority: CORE_AUTHORITY,
    updated_at: timestamp,
  });
  if (grant) {
    grant.notification_job_id = job.notification_job_id;
    grant.last_notification_job_id = job.notification_job_id;
    grant.updated_at = timestamp;
  }
  return job;
}

async function recordSubscriptionAndSchedule(data, rootUserId, body = {}, context = {}) {
  if (!protectedRuntime(context)) {
    return checkinReminder.recordSubscription(data, rootUserId, body, context);
  }
  const core = assertCore(context);
  const boundReleaseId = releaseId(context);
  const decidedAt = exactIsoTimestamp(
    body.decidedAt || body.decided_at || body.nativeDecidedAt || body.native_decided_at,
    "decidedAt"
  );
  const template = validateTemplate(body, context);
  const taskContext = authoritativeTaskContext(data, rootUserId, body, context, decidedAt);
  const requestId = grantRequestId(body);
  const decision = normalizeNativeDecision(body);
  const recipientBinding = decision.nativeDecision === "ACCEPTED"
    ? freezeWechatRecipientBinding(data, {
      rootUserId,
      grantRequestId: requestId,
      templateKey: template.templateKey,
      templateId: template.templateId,
      templateVersion: template.version,
    }, { env: context.env || process.env })
    : null;
  const authorityDecision = await core.recordDecision({
    rootUserId,
    taskId: taskContext.taskId,
    taskOccurrenceDate: taskContext.taskOccurrenceDate,
    templateVersion: template.version,
    grantRequestId: requestId,
    nativeDecision: decision.nativeDecision,
    reasonCode: decision.reasonCode,
    idempotencyKey: `notification-decision:${requestId}`,
    decidedAt,
    releaseId: boundReleaseId,
    recipientWechatIdentityId: recipientBinding
      ? recipientBinding.recipient_wechat_identity_id
      : null,
    recipientAppCode: recipientBinding ? recipientBinding.recipient_app_code : null,
    recipientBindingCanonicalVersion: recipientBinding
      ? recipientBinding.recipient_binding_canonical_version
      : null,
    recipientBindingDigest: recipientBinding ? recipientBinding.recipient_binding_digest : null,
    recipientBindingDigestScheme: recipientBinding
      ? recipientBinding.recipient_binding_digest_scheme
      : null,
    recipientBindingKeyId: recipientBinding ? recipientBinding.recipient_binding_key_id : null,
  });
  let authorityJob = null;
  if (authorityDecision.grantId) {
    authorityJob = await core.schedule({
      grantId: authorityDecision.grantId,
      rootUserId,
      taskId: taskContext.taskId,
      taskOccurrenceDate: taskContext.taskOccurrenceDate,
      templateVersion: template.version,
      dueAt: dueAtFor(taskContext.taskOccurrenceDate, template.reminderHour),
      idempotencyKey: `checkin-reminder:${authorityDecision.grantId}:${taskContext.taskOccurrenceDate}`,
      releaseId: boundReleaseId,
    });
  }
  // Relational rows are authoritative. Mutate the snapshot payload/queue
  // mirror only after every authority write needed for this decision succeeds.
  // An idempotent retry can therefore repair a missing mirror without ever
  // inventing a snapshot-only grant or job.
  const mirror = mirrorDecision(
    data,
    rootUserId,
    body,
    template,
    decision,
    authorityDecision,
    taskContext,
    recipientBinding
  );
  const job = authorityJob
    ? mirrorSchedule(data, rootUserId, template, taskContext, authorityJob, mirror.grant)
    : null;
  return {
    ...mirror,
    job,
    notificationCore: {
      authority: CORE_AUTHORITY,
      decisionReplayed: authorityDecision.replayed === true,
      decisionCommitAcknowledgementRecovered: authorityDecision.commitAcknowledgementRecovered === true,
      jobReplayed: authorityJob ? authorityJob.replayed === true : false,
      jobCommitAcknowledgementRecovered: authorityJob
        ? authorityJob.commitAcknowledgementRecovered === true
        : false,
      deviceDeliveryStatus: "NOT_VERIFIED",
    },
  };
}

function hasCheckinForDate(data, job) {
  return ensureList(data, "taskEvents").some((event) => event.root_user_id === job.root_user_id
    && event.campaign_id === job.campaign_id
    && event.task_type === "CHECKIN"
    && event.status !== "VOID"
    && (event.task_date || String(event.occurred_at || "").slice(0, 10)) === job.reminder_date);
}

function stableDigest(...values) {
  const hash = crypto.createHash("sha256");
  values.forEach((value) => {
    const bytes = Buffer.from(String(value), "utf8");
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.length);
    hash.update(length);
    hash.update(bytes);
  });
  return hash.digest("hex");
}

function publicRequestEvidence(request) {
  return {
    recipient_present: Boolean(request.touser),
    template_id: request.template_id,
    page: request.page,
    miniprogram_state: request.miniprogram_state,
    lang: request.lang,
    data_keys: Object.keys(request.data || {}).sort(),
  };
}

function addDelivery(data, job, input) {
  const delivery = {
    notification_delivery_id: createId("ntd"),
    notification_job_id: job.notification_job_id,
    root_user_id: job.root_user_id,
    campaign_id: job.campaign_id,
    template_key: job.template_key,
    template_id: job.template_id,
    template_version: job.template_version,
    notification_subscription_grant_id: job.notification_subscription_grant_id,
    status: input.status,
    error_code: input.errorCode || "",
    external_error_code: input.externalErrorCode || "",
    error_message: input.errorMessage || "",
    delivery_outcome: input.deliveryOutcome || "",
    request_json: input.request ? publicRequestEvidence(input.request) : {},
    response_json: input.responseEvidence || {},
    authority: CORE_AUTHORITY,
    created_at: nowISO(),
  };
  ensureList(data, "notificationDeliveries").push(delivery);
  return delivery;
}

function grantMirror(data, job) {
  return ensureList(data, "notificationSubscriptionGrants")
    .find((grant) => grant.notification_subscription_grant_id === job.notification_subscription_grant_id) || null;
}

const SEND_ATTEMPT_STATUSES = new Set(["REQUESTED", "ACCEPTED", "REJECTED", "FAILED", "UNKNOWN"]);

function assertAttemptRecipientBinding(attempt, grant) {
  if (!grant
    || attempt.recipientBindingStatus !== "VERIFIED"
    || grant.recipient_binding_status !== "VERIFIED"
    || attempt.recipientWechatIdentityId !== grant.recipient_wechat_identity_id
    || attempt.recipientAppCode !== grant.recipient_app_code
    || attempt.recipientBindingCanonicalVersion !== grant.recipient_binding_canonical_version
    || attempt.recipientBindingDigest !== grant.recipient_binding_digest
    || attempt.recipientBindingDigestScheme !== grant.recipient_binding_digest_scheme
    || attempt.recipientBindingKeyId !== grant.recipient_binding_key_id) {
    throw deliveryError(
      "CHECKIN_REMINDER_CORE_RECIPIENT_BINDING_MISMATCH",
      "关系型提醒授权与发送镜像的收件人绑定不一致"
    );
  }
  return grant;
}

function validateInspectedAttempt(attempt, expectedJobId, boundReleaseId) {
  if (!attempt
    || typeof attempt !== "object"
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,31}$/.test(String(attempt.attemptId || ""))
    || attempt.jobId !== expectedJobId
    || attempt.releaseId !== boundReleaseId
    || attempt.provider !== "WECHAT"
    || attempt.attemptNumber !== 1
    || !SEND_ATTEMPT_STATUSES.has(attempt.status)
    || !Number.isSafeInteger(attempt.transitionVersion)
    || attempt.transitionVersion < 1
    || !/^[0-9a-f]{64}$/.test(String(attempt.transitionFenceDigest || ""))
    || !/^[0-9a-f]{64}$/.test(String(attempt.requestDigest || ""))
    || attempt.recipientBindingStatus !== "VERIFIED"
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,31}$/.test(String(attempt.recipientWechatIdentityId || ""))
    || attempt.recipientAppCode !== "MYROOT"
    || attempt.recipientBindingCanonicalVersion !== "canonical-json:v1"
    || !/^[0-9a-f]{64}$/.test(String(attempt.recipientBindingDigest || ""))
    || attempt.recipientBindingDigestScheme !== "hmac-sha256:v1"
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(String(attempt.recipientBindingKeyId || ""))
    || attempt.providerCallAuthorized !== false
    || attempt.providerCallCheckpointRequired !== (attempt.status === "REQUESTED")
    || !["AVAILABLE", "LEASED", "STARTED", "COMPLETED", "REVIEW_REQUIRED"]
      .includes(attempt.providerCallState)
    || !Number.isSafeInteger(attempt.providerCallGeneration)
    || attempt.providerCallGeneration < 0
    || Object.prototype.hasOwnProperty.call(attempt, "providerReceipt")) {
    throw deliveryError(
      "CHECKIN_REMINDER_CORE_INSPECTION_INVALID",
      "关系型提醒发送 Core 返回了不可验证的发送尝试投影"
    );
  }
  return attempt;
}

async function inspectAuthorityAttempt(core, attemptId, expectedJobId, boundReleaseId) {
  const inspected = await core.inspectSendAttempt({
    attemptId,
    releaseId: boundReleaseId,
  });
  return validateInspectedAttempt(inspected, expectedJobId, boundReleaseId);
}

function applyAuthorityAttemptToMirror(data, job, attempt, reasonCode = "") {
  const grant = grantMirror(data, job);
  if (!grant) {
    throw deliveryError(
      "CHECKIN_REMINDER_MIRROR_GRANT_REQUIRED",
      "提醒发送镜像缺少对应授权额度"
    );
  }
  assertAttemptRecipientBinding(attempt, grant);
  const timestamp = nowISO();
  Object.assign(job, {
    attempts: 1,
    notification_core_attempt_id: attempt.attemptId,
    notification_core_transition_version: attempt.transitionVersion,
    notification_core_transition_fence_digest: attempt.transitionFenceDigest,
    notification_core_release_id: attempt.releaseId,
    updated_at: timestamp,
  });

  if (attempt.status === "REQUESTED") {
    job.status = "SENDING";
    job.last_error = reasonCode;
    job.notification_core_review_required = Boolean(reasonCode);
    job.notification_core_review_reason_code = reasonCode;
    grant.status = "RESERVED";
    grant.release_reason = reasonCode;
    grant.notification_core_review_required = Boolean(reasonCode);
    grant.notification_core_review_reason_code = reasonCode;
    grant.reserved_at = grant.reserved_at || timestamp;
    grant.updated_at = timestamp;
    return {
      status: "SENDING",
      errorCode: reasonCode,
      deliveryOutcome: "UNKNOWN",
      reviewRequired: Boolean(reasonCode),
    };
  }

  const terminalStatus = attempt.status === "ACCEPTED"
    ? "PROVIDER_ACCEPTED"
    : attempt.status === "UNKNOWN"
      ? "OUTCOME_UNKNOWN"
      : "FAILED";
  const errorCode = text(attempt.stableErrorCode);
  job.status = terminalStatus;
  job.last_error = errorCode;
  job.notification_core_review_required = attempt.status === "UNKNOWN" || attempt.status === "FAILED";
  job.notification_core_review_reason_code = errorCode;
  if (job.notification_core_review_required) job.review_required_at = timestamp;
  grant.status = attempt.status === "ACCEPTED"
    ? "CONSUMED"
    : attempt.status === "REJECTED"
      ? "INVALID"
      : "REVIEW_REQUIRED";
  grant.release_reason = errorCode;
  grant.notification_core_review_required = grant.status === "REVIEW_REQUIRED";
  grant.notification_core_review_reason_code = errorCode;
  if (grant.status === "CONSUMED") grant.consumed_at = grant.consumed_at || timestamp;
  if (grant.status === "INVALID") grant.invalidated_at = grant.invalidated_at || timestamp;
  if (grant.status === "REVIEW_REQUIRED") grant.review_required_at = grant.review_required_at || timestamp;
  grant.updated_at = timestamp;
  return {
    status: terminalStatus,
    errorCode,
    deliveryOutcome: attempt.status === "ACCEPTED"
      ? "ACCEPTED_BY_WECHAT"
      : attempt.status === "UNKNOWN"
        ? "UNKNOWN"
        : "NOT_SENT",
    reviewRequired: grant.status === "REVIEW_REQUIRED",
  };
}

function markReviewRequired(data, job, code, request = null) {
  const timestamp = nowISO();
  job.status = "REVIEW_REQUIRED";
  job.last_error = code;
  job.review_required_at = timestamp;
  job.updated_at = timestamp;
  const grant = grantMirror(data, job);
  if (grant) {
    grant.status = "REVIEW_REQUIRED";
    grant.release_reason = code;
    grant.review_required_at = timestamp;
    grant.updated_at = timestamp;
  }
  addDelivery(data, job, {
    status: "REVIEW_REQUIRED",
    errorCode: code,
    errorMessage: "发送权威状态需要人工复核，禁止自动重试",
    deliveryOutcome: "UNKNOWN",
    request,
  });
}

function buildRequest(data, job, context) {
  const template = checkinReminder.resolveTemplate(context.env || process.env);
  if (!template.enabled
    || template.templateId !== job.template_id
    || template.version !== job.template_version) {
    throw deliveryError(
      "CHECKIN_REMINDER_TEMPLATE_MISMATCH",
      "排期模板与当前发布版本不一致"
    );
  }
  const grant = grantMirror(data, job);
  if (!grant) throw deliveryError("CHECKIN_REMINDER_RECIPIENT_BINDING_REQUIRED", "提醒授权镜像不可用");
  const recipient = verifyWechatRecipientBinding(data, grant, { env: context.env || process.env });
  return {
    touser: recipient.openid,
    template_id: job.template_id,
    page: job.page,
    miniprogram_state: job.miniprogram_state || "formal",
    lang: job.lang || "zh_CN",
    data: job.data_json || {},
  };
}

function revalidateProviderRecipient(data, job, attempt, request, context) {
  const grant = assertAttemptRecipientBinding(attempt, grantMirror(data, job));
  const recipient = verifyWechatRecipientBinding(data, grant, {
    env: context.env || process.env,
  });
  if (!request
    || typeof request !== "object"
    || request.touser !== recipient.openid) {
    throw deliveryError(
      "CHECKIN_REMINDER_PROVIDER_RECIPIENT_CHANGED",
      "发送前收件人身份已变化，禁止调用微信发送"
    );
  }
  return recipient;
}

function normalizeProviderRecipientFacts(recipient, job, attempt, request) {
  const identity = recipient && recipient.identity;
  const facts = {
    recipientWechatIdentityId: identity && identity.wechat_identity_id,
    recipientRootUserId: identity && identity.root_user_id,
    recipientAppCode: identity && identity.app_code,
    recipientOpenid: recipient && recipient.openid,
  };
  if (!identity
    || typeof identity !== "object"
    || typeof facts.recipientWechatIdentityId !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,31}$/.test(facts.recipientWechatIdentityId)
    || facts.recipientWechatIdentityId !== attempt.recipientWechatIdentityId
    || typeof facts.recipientRootUserId !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,31}$/.test(facts.recipientRootUserId)
    || facts.recipientRootUserId !== job.root_user_id
    || facts.recipientAppCode !== "MYROOT"
    || facts.recipientAppCode !== attempt.recipientAppCode
    || typeof facts.recipientOpenid !== "string"
    || !/^[A-Za-z0-9_-]{1,64}$/.test(facts.recipientOpenid)
    || identity.openid !== facts.recipientOpenid
    || !request
    || request.touser !== facts.recipientOpenid) {
    throw deliveryError(
      "CHECKIN_REMINDER_PROVIDER_RECIPIENT_FACTS_INVALID",
      "发送前当前微信身份事实无法严格绑定到关系型 START"
    );
  }
  return Object.freeze(facts);
}

function assertProviderReservationHeld(data, job, grantId, attempt, boundReleaseId) {
  const grant = grantMirror(data, job);
  if (!job
    || job.notification_core_authoritative !== true
    || job.authority !== CORE_AUTHORITY
    || job.status !== "SENDING"
    || job.notification_subscription_grant_id !== grantId
    || job.notification_core_attempt_id !== attempt.attemptId
    || job.notification_core_transition_version !== attempt.transitionVersion
    || job.notification_core_transition_fence_digest !== attempt.transitionFenceDigest
    || job.notification_core_release_id !== boundReleaseId
    || !grant
    || grant.notification_subscription_grant_id !== grantId
    || grant.notification_job_id !== job.notification_job_id
    || grant.status !== "RESERVED") {
    throw deliveryError(
      "CHECKIN_REMINDER_RESERVATION_LOST",
      "checkpoint 恢复后提醒发送镜像不再持有该关系型发送尝试的占用权"
    );
  }
  return grant;
}

function mapProviderOutcome(error) {
  if (!error) return { outcome: "ACCEPTED", stableErrorCode: null, deliveryOutcome: "ACCEPTED_BY_WECHAT" };
  if (String(error.externalCode || "") === "43101" || error.deliveryOutcome === "NO_GRANT") {
    return { outcome: "REJECTED", stableErrorCode: "WECHAT_NO_GRANT", deliveryOutcome: "NO_GRANT" };
  }
  if (error.deliveryOutcome === "NOT_SENT") {
    return {
      outcome: error.externalCode ? "REJECTED" : "FAILED",
      stableErrorCode: error.externalCode ? "WECHAT_REJECTED" : "WECHAT_SEND_FAILED",
      deliveryOutcome: "NOT_SENT",
    };
  }
  const unknownCode = [
    "PROVIDER_RESULT_UNKNOWN",
    "HTTP_OUTCOME_UNKNOWN",
    "NETWORK_OUTCOME_UNKNOWN",
    "NON_JSON_OUTCOME_UNKNOWN",
  ].includes(String(error.stableErrorCode || ""))
    ? String(error.stableErrorCode)
    : "NETWORK_OUTCOME_UNKNOWN";
  return {
    outcome: "UNKNOWN",
    stableErrorCode: unknownCode,
    deliveryOutcome: "UNKNOWN",
  };
}

function invalidProviderResponse(response) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    const error = deliveryError("WECHAT_RESPONSE_UNVERIFIED", "微信发送响应不可验证");
    error.deliveryOutcome = "UNKNOWN";
    error.stableErrorCode = "NON_JSON_OUTCOME_UNKNOWN";
    return error;
  }
  if (!Object.prototype.hasOwnProperty.call(response, "errcode")
    || response.errcode === null
    || response.errcode === undefined
    || String(response.errcode).trim() === "") {
    const error = deliveryError("WECHAT_RESPONSE_UNVERIFIED", "微信发送响应缺少明确结果码");
    error.deliveryOutcome = "UNKNOWN";
    error.stableErrorCode = "PROVIDER_RESULT_UNKNOWN";
    return error;
  }
  if (String(response.errcode) !== "0") {
    const error = deliveryError("WECHAT_PROVIDER_REJECTED", "微信发送未获成功确认");
    error.externalCode = text(response.errcode).slice(0, 64);
    error.deliveryOutcome = error.externalCode === "43101" ? "NO_GRANT" : "NOT_SENT";
    return error;
  }
  return null;
}

function providerReceipt(response) {
  const value = response && typeof response === "object" ? response : {};
  return JSON.stringify({
    errcode: Number(value.errcode || 0),
    errmsg: text(value.errmsg).slice(0, 120),
    msgid: text(value.msgid).slice(0, 160),
  }).slice(0, 512);
}

async function completeWithSingleRecovery(core, input) {
  try {
    return await core.completeSendAttempt(input);
  } catch (error) {
    // Only an unknown COMMIT acknowledgement can benefit from replaying the
    // exact same terminal transition for authoritative readback. Input,
    // permission, disabled-foundation and known persistence failures are
    // deterministic here and must not be retried blindly.
    if (!error || error.code !== "NOTIFICATION_DELIVERY_COMMIT_OUTCOME_UNKNOWN") throw error;
    return core.completeSendAttempt(input);
  }
}

async function runDueReminders(data, input = {}, context = {}) {
  if (!protectedRuntime(context)) {
    return checkinReminder.runDueCheckinReminders(data, input, context);
  }
  const core = assertCore(context);
  const boundReleaseId = releaseId(context);
  const dryRun = input.dryRun === true || input.dry_run === true;
  const hasCheckpoint = typeof context.transactionCheckpoint === "function";
  const hasResume = typeof context.transactionResume === "function";
  const checkpointed = hasCheckpoint && hasResume;
  if (!dryRun && !checkpointed) {
    throw deliveryError(
      "CHECKIN_REMINDER_TRANSACTION_CHECKPOINT_REQUIRED",
      "真实提醒发送必须配置成对的持久 checkpoint/resume Interface"
    );
  }
  const nowText = exactIsoTimestamp(input.now || input.nowText || input.now_text || nowISO(), "now");
  const limit = Math.max(1, Math.min(200, Number(input.limit) || 50));
  const jobs = ensureList(data, "notificationJobs");
  const results = [];
  const resumableAttempts = new Map();

  const staleSending = jobs.filter((job) => job.notification_core_authoritative === true && job.status === "SENDING");
  if (!dryRun) {
    for (const job of staleSending) {
      try {
        const inspected = await inspectAuthorityAttempt(
          core,
          text(job.notification_core_attempt_id),
          job.notification_job_id,
          boundReleaseId
        );
        let authoritative = inspected;
        if (inspected.status === "REQUESTED" && inspected.providerCallState === "STARTED") {
          const recovery = await core.recoverProviderCall({
            attemptId: inspected.attemptId,
            releaseId: boundReleaseId,
          });
          if (recovery && recovery.providerCallRecoveredUnknown === true) {
            authoritative = validateInspectedAttempt(
              recovery,
              job.notification_job_id,
              boundReleaseId
            );
          }
        }
        if (authoritative.status === "REQUESTED"
          && ["AVAILABLE", "LEASED"].includes(authoritative.providerCallState)) {
          applyAuthorityAttemptToMirror(data, job, authoritative);
          resumableAttempts.set(job.notification_job_id, authoritative);
          continue;
        }
        const reasonCode = authoritative.status === "REQUESTED"
          ? (authoritative.providerCallState === "STARTED"
            ? "PROVIDER_CALL_IN_FLIGHT"
            : "SEND_ATTEMPT_REQUIRES_MANUAL_REVIEW")
          : "";
        const mirrorResult = applyAuthorityAttemptToMirror(data, job, authoritative, reasonCode);
        if (authoritative.status !== "REQUESTED") {
          addDelivery(data, job, {
            status: mirrorResult.status,
            errorCode: mirrorResult.errorCode,
            errorMessage: "关系型发送终态已只读回查并收敛镜像",
            deliveryOutcome: mirrorResult.deliveryOutcome,
          });
        }
        results.push({
          jobId: job.notification_job_id,
          status: authoritative.status === "REQUESTED"
            ? (authoritative.providerCallState === "STARTED"
              ? "SENDING_PROVIDER_CALL_IN_FLIGHT"
              : "SENDING_REVIEW_REQUIRED")
            : mirrorResult.status,
          errorCode: mirrorResult.errorCode,
          deliveryOutcome: mirrorResult.deliveryOutcome,
        });
      } catch (error) {
        results.push({
          jobId: job.notification_job_id,
          status: "CORE_INSPECTION_UNCONFIRMED",
          errorCode: text(error && error.code, "CORE_INSPECTION_UNCONFIRMED"),
          deliveryOutcome: "UNKNOWN",
        });
      }
    }
  }

  const dueJobs = jobs
    .filter((job) => (
      (job.status === "SCHEDULED" && Date.parse(job.scheduled_at) <= Date.parse(nowText))
      || resumableAttempts.has(job.notification_job_id)
    ))
    .sort((left, right) => String(left.scheduled_at).localeCompare(String(right.scheduled_at)))
    .slice(0, limit);

  if (!dryRun && String((context.env || process.env)[SEND_ENABLE_FLAG] || "") !== "true") {
    throw deliveryError(
      "CHECKIN_REMINDER_REAL_SEND_DISABLED",
      `真实提醒发送默认关闭；必须显式配置 ${SEND_ENABLE_FLAG}=true`
    );
  }
  if (!dryRun && typeof context.sendSubscribeMessage !== "function") {
    throw deliveryError("CHECKIN_REMINDER_SEND_ADAPTER_REQUIRED", "提醒发送 Adapter 未配置");
  }

  for (const selectedJob of dueJobs) {
    let job = ensureList(data, "notificationJobs")
      .find((candidate) => candidate.notification_job_id === selectedJob.notification_job_id);
    if (!job) {
      results.push({ jobId: selectedJob.notification_job_id, status: "SKIPPED_STATE_CHANGED" });
      continue;
    }
    if (job.notification_core_authoritative !== true || job.authority !== CORE_AUTHORITY) {
      if (!dryRun) markReviewRequired(data, job, "SNAPSHOT_ONLY_JOB_FORBIDDEN");
      results.push({
        jobId: job.notification_job_id,
        status: "REVIEW_REQUIRED",
        errorCode: "SNAPSHOT_ONLY_JOB_FORBIDDEN",
      });
      continue;
    }
    if (hasCheckinForDate(data, job)) {
      results.push({
        jobId: job.notification_job_id,
        status: dryRun ? "DRY_RUN_SKIP_ALREADY_CHECKED_IN" : "CORE_SKIP_TRANSITION_REQUIRED",
        errorCode: "ALREADY_CHECKED_IN_CORE_SKIP_REQUIRED",
      });
      continue;
    }
    let request;
    try {
      request = buildRequest(data, job, context);
    } catch (error) {
      results.push({
        jobId: job.notification_job_id,
        status: "CORE_REVIEW_TRANSITION_REQUIRED",
        errorCode: text(error.code, "REQUEST_BUILD_FAILED"),
      });
      continue;
    }
    if (dryRun) {
      results.push({
        jobId: job.notification_job_id,
        status: "DRY_RUN_READY",
        request: publicRequestEvidence(request),
      });
      continue;
    }

    const requestDigest = stableDigest("myroot:checkin-reminder-request:v1", JSON.stringify(request));
    const transitionFenceDigest = stableDigest(
      "myroot:checkin-reminder-begin-fence:v1",
      job.notification_job_id,
      requestDigest,
      boundReleaseId
    );
    let attempt = resumableAttempts.get(job.notification_job_id) || null;
    if (!attempt) {
      try {
        const canonicalStartedAt = exactIsoTimestamp(job.scheduled_at, "scheduledAt");
        if (!grantMirror(data, job)) {
          throw deliveryError("CHECKIN_REMINDER_RECIPIENT_BINDING_REQUIRED", "提醒授权镜像不可用");
        }
        attempt = await core.beginSendAttempt({
          jobId: job.notification_job_id,
          requestDigest,
          transitionFenceDigest,
          startedAt: canonicalStartedAt,
          releaseId: boundReleaseId,
        });
      } catch (error) {
        results.push({
          jobId: job.notification_job_id,
          status: "CORE_BEGIN_UNCONFIRMED",
          errorCode: text(error && error.code, "CORE_BEGIN_NOT_PERSISTED"),
        });
        continue;
      }
    }
    try {
      validateInspectedAttempt(attempt, job.notification_job_id, boundReleaseId);
      if (attempt.requestDigest !== requestDigest) {
        throw deliveryError("CORE_BEGIN_RESPONSE_INVALID", "关系型发送尝试请求摘要不匹配");
      }
    } catch (error) {
      const code = text(error && error.code, "CORE_BEGIN_RESPONSE_INVALID");
      markReviewRequired(data, job, code, request);
      results.push({ jobId: job.notification_job_id, status: "REVIEW_REQUIRED", errorCode: code });
      continue;
    }
    if (attempt.status !== "REQUESTED") {
      const mirrorResult = applyAuthorityAttemptToMirror(data, job, attempt);
      results.push({
        jobId: job.notification_job_id,
        status: mirrorResult.status,
        errorCode: mirrorResult.errorCode,
        deliveryOutcome: mirrorResult.deliveryOutcome,
      });
      continue;
    }
    if (attempt.providerCallState === "STARTED") {
      try {
        const recovered = await core.recoverProviderCall({
          attemptId: attempt.attemptId,
          releaseId: boundReleaseId,
        });
        attempt = validateInspectedAttempt(recovered, job.notification_job_id, boundReleaseId);
        const reasonCode = attempt.status === "REQUESTED" ? "PROVIDER_CALL_IN_FLIGHT" : "";
        const mirrorResult = applyAuthorityAttemptToMirror(data, job, attempt, reasonCode);
        results.push({
          jobId: job.notification_job_id,
          status: attempt.status === "REQUESTED"
            ? "SENDING_PROVIDER_CALL_IN_FLIGHT"
            : mirrorResult.status,
          errorCode: mirrorResult.errorCode,
          deliveryOutcome: mirrorResult.deliveryOutcome,
        });
      } catch (error) {
        results.push({
          jobId: job.notification_job_id,
          status: "CORE_RECOVERY_UNCONFIRMED",
          errorCode: text(error && error.code, "CORE_RECOVERY_UNCONFIRMED"),
        });
      }
      continue;
    }
    if (!["AVAILABLE", "LEASED"].includes(attempt.providerCallState)
      || attempt.transitionFenceDigest !== transitionFenceDigest) {
      const code = "CORE_BEGIN_RESPONSE_INVALID";
      markReviewRequired(data, job, code, request);
      results.push({ jobId: job.notification_job_id, status: "REVIEW_REQUIRED", errorCode: code });
      continue;
    }
    let providerRecipientFacts;
    try {
      applyAuthorityAttemptToMirror(data, job, attempt);
      providerRecipientFacts = normalizeProviderRecipientFacts(
        revalidateProviderRecipient(data, job, attempt, request, context),
        job,
        attempt,
        request
      );
    } catch (error) {
      const code = text(error && error.code, "CHECKIN_REMINDER_PROVIDER_RECIPIENT_REVALIDATION_FAILED");
      markReviewRequired(data, job, code, request);
      results.push({ jobId: job.notification_job_id, status: "REVIEW_REQUIRED", errorCode: code });
      continue;
    }

    const jobId = job.notification_job_id;
    const grantId = job.notification_subscription_grant_id;
    let snapshotAwaitingResume = false;
    const checkpointSnapshot = async (reason) => {
      if (!checkpointed) return;
      await context.transactionCheckpoint({
        reason,
        notificationJobIds: [jobId],
        notificationSubscriptionGrantIds: [grantId],
      });
      snapshotAwaitingResume = true;
    };
    const resumeSnapshot = async (reason) => {
      if (!snapshotAwaitingResume) return;
      await context.transactionResume({
        reason,
        notificationJobIds: [jobId],
        notificationSubscriptionGrantIds: [grantId],
      });
      snapshotAwaitingResume = false;
      job = ensureList(data, "notificationJobs")
        .find((candidate) => candidate.notification_job_id === jobId);
      const resumedGrant = ensureList(data, "notificationSubscriptionGrants")
        .find((candidate) => candidate.notification_subscription_grant_id === grantId);
      if (!job || !resumedGrant) {
        throw deliveryError(
          "CHECKIN_REMINDER_RESERVATION_LOST",
          "checkpoint 恢复后提醒发送占用记录不可用"
        );
      }
    };

    await checkpointSnapshot("CHECKIN_REMINDER_PROVIDER_CALL_AVAILABLE");

    let claim;
    try {
      claim = await core.claimProviderCall({
        attemptId: attempt.attemptId,
        releaseId: boundReleaseId,
      });
    } catch (error) {
      await resumeSnapshot("CHECKIN_REMINDER_PROVIDER_CALL_CLAIM_UNCONFIRMED");
      results.push({
        jobId: job.notification_job_id,
        status: "PROVIDER_CALL_CLAIM_UNCONFIRMED",
        errorCode: text(error && error.code, "PROVIDER_CALL_CLAIM_UNCONFIRMED"),
      });
      continue;
    }
    if (!claim || claim.leaseAcquired !== true
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,31}$/.test(String(claim.leaseOwner || ""))
      || !Number.isSafeInteger(claim.leaseGeneration)
      || claim.leaseGeneration < 1) {
      await resumeSnapshot("CHECKIN_REMINDER_PROVIDER_CALL_LEASE_HELD");
      results.push({
        jobId: job.notification_job_id,
        status: "SENDING_PROVIDER_CALL_LEASE_HELD",
        errorCode: "PROVIDER_CALL_LEASE_HELD",
      });
      continue;
    }

    await resumeSnapshot("CHECKIN_REMINDER_PROVIDER_CALL_CLAIMED");
    let preSendError = null;
    try {
      assertProviderReservationHeld(data, job, grantId, attempt, boundReleaseId);
      providerRecipientFacts = normalizeProviderRecipientFacts(
        revalidateProviderRecipient(data, job, attempt, request, context),
        job,
        attempt,
        request
      );
    } catch (error) {
      preSendError = error;
    }
    await checkpointSnapshot("CHECKIN_REMINDER_PROVIDER_CALL_STARTING");

    let startedCall;
    let response = null;
    let sendError = null;
    let outcome = null;
    let completed;
    let completionError = null;
    let resumeReason = "CHECKIN_REMINDER_PROVIDER_CALL_FINALIZE";
    try {
      try {
        startedCall = await core.startProviderCall({
          attemptId: attempt.attemptId,
          leaseOwner: claim.leaseOwner,
          leaseGeneration: claim.leaseGeneration,
          requestDigest,
          recipientBindingDigest: attempt.recipientBindingDigest,
          ...providerRecipientFacts,
          releaseId: boundReleaseId,
        });
      } catch (error) {
        resumeReason = "CHECKIN_REMINDER_PROVIDER_CALL_START_UNCONFIRMED";
        results.push({
          jobId,
          status: "PROVIDER_CALL_START_UNCONFIRMED",
          errorCode: text(error && error.code, "PROVIDER_CALL_START_UNCONFIRMED"),
        });
        continue;
      }
      const freshProviderCallStart = startedCall
        && startedCall.providerCallStarted === true
        && startedCall.replayed === false
        && startedCall.commitAcknowledgementRecovered === false;
      const recoveredProviderCallStart = startedCall
        && startedCall.providerCallStarted === true
        && startedCall.replayed === true
        && startedCall.commitAcknowledgementRecovered === true;
      if ((!freshProviderCallStart && !recoveredProviderCallStart)
        || startedCall.leaseOwner !== claim.leaseOwner
        || startedCall.leaseGeneration !== claim.leaseGeneration) {
        resumeReason = "CHECKIN_REMINDER_PROVIDER_CALL_FENCED";
        results.push({
          jobId,
          status: "SENDING_PROVIDER_CALL_FENCED",
          errorCode: "PROVIDER_CALL_FENCED",
        });
        continue;
      }
      attempt = startedCall;

      sendError = preSendError;
      if (!preSendError) {
        try {
          response = await context.sendSubscribeMessage(request);
          sendError = invalidProviderResponse(response);
        } catch (error) {
          sendError = error;
        }
      }
      outcome = preSendError
        ? {
          outcome: "FAILED",
          stableErrorCode: "PROVIDER_REQUEST_INVALID",
          deliveryOutcome: "NOT_SENT",
        }
        : mapProviderOutcome(sendError);
      const receipt = outcome.outcome === "ACCEPTED" ? providerReceipt(response) : null;
      const completedAt = new Date().toISOString();
      const completionInput = {
        attemptId: attempt.attemptId,
        leaseOwner: claim.leaseOwner,
        leaseGeneration: claim.leaseGeneration,
        expectedTransitionVersion: attempt.transitionVersion,
        expectedTransitionFenceDigest: attempt.transitionFenceDigest,
        nextTransitionFenceDigest: stableDigest(
          "myroot:checkin-reminder-complete-fence:v1",
          attempt.attemptId,
          attempt.transitionFenceDigest,
          outcome.outcome,
          outcome.stableErrorCode || "",
          receipt || ""
        ),
        outcome: outcome.outcome,
        providerReceipt: receipt,
        stableErrorCode: outcome.stableErrorCode,
        completedAt,
        releaseId: boundReleaseId,
      };
      try {
        completed = await completeWithSingleRecovery(core, completionInput);
      } catch (error) {
        completionError = error;
      }
    } finally {
      await resumeSnapshot(resumeReason);
    }
    if (completionError) {
      try {
        const inspected = await inspectAuthorityAttempt(
          core,
          attempt.attemptId,
          job.notification_job_id,
          boundReleaseId
        );
        const mirrorResult = applyAuthorityAttemptToMirror(
          data,
          job,
          inspected,
          inspected.status === "REQUESTED" ? "CORE_COMPLETE_REVIEW_REQUIRED" : ""
        );
        if (inspected.status !== "REQUESTED") {
          addDelivery(data, job, {
            status: mirrorResult.status,
            errorCode: mirrorResult.errorCode,
            errorMessage: sendError
              ? "微信发送结果已由关系型终态回查收敛"
              : "发送完成确认已由关系型终态回查收敛",
            deliveryOutcome: mirrorResult.deliveryOutcome,
            request,
            responseEvidence: response ? {
              response_present: true,
              accepted: inspected.status === "ACCEPTED",
              errcode: Number(response.errcode || 0),
              msgid_present: Boolean(response.msgid),
            } : {},
          });
        }
        results.push({
          jobId: job.notification_job_id,
          status: inspected.status === "REQUESTED"
            ? "SENDING_REVIEW_REQUIRED"
            : mirrorResult.status,
          errorCode: inspected.status === "REQUESTED"
            ? "CORE_COMPLETE_REVIEW_REQUIRED"
            : mirrorResult.errorCode,
          deliveryOutcome: mirrorResult.deliveryOutcome,
          deviceDeliveryStatus: "NOT_VERIFIED",
        });
      } catch (inspectionError) {
        results.push({
          jobId: job.notification_job_id,
          status: "CORE_INSPECTION_UNCONFIRMED",
          errorCode: text(inspectionError && inspectionError.code, "CORE_INSPECTION_UNCONFIRMED"),
          deliveryOutcome: "UNKNOWN",
        });
      }
      continue;
    }

    let authoritativeCompleted;
    let mirrorResult;
    try {
      authoritativeCompleted = validateInspectedAttempt(
        completed,
        job.notification_job_id,
        boundReleaseId
      );
      if (authoritativeCompleted.status === "REQUESTED") {
        throw deliveryError(
          "CHECKIN_REMINDER_CORE_COMPLETION_INVALID",
          "关系型提醒发送 Core 未返回终态"
        );
      }
      mirrorResult = applyAuthorityAttemptToMirror(data, job, authoritativeCompleted);
    } catch (error) {
      const code = text(error && error.code, "CHECKIN_REMINDER_CORE_COMPLETION_INVALID");
      markReviewRequired(data, job, code, request);
      results.push({
        jobId: job.notification_job_id,
        status: "REVIEW_REQUIRED",
        errorCode: code,
        deliveryOutcome: "UNKNOWN",
        deviceDeliveryStatus: "NOT_VERIFIED",
      });
      continue;
    }
    const terminalStatus = mirrorResult.status;
    addDelivery(data, job, {
      status: terminalStatus,
      errorCode: mirrorResult.errorCode,
      externalErrorCode: text(sendError && sendError.externalCode).slice(0, 64),
      errorMessage: sendError ? "微信发送未获确认，详见受控运行日志" : "",
      deliveryOutcome: outcome.deliveryOutcome,
      request,
      responseEvidence: response ? {
        response_present: true,
        accepted: authoritativeCompleted.status === "ACCEPTED",
        errcode: Number(response.errcode || 0),
        msgid_present: Boolean(response.msgid),
      } : {},
    });
    results.push({
      jobId: job.notification_job_id,
      status: terminalStatus,
      deliveryOutcome: mirrorResult.deliveryOutcome,
      deviceDeliveryStatus: "NOT_VERIFIED",
    });
  }

  return {
    dryRun,
    now: nowText,
    scannedCount: dueJobs.length,
    staleSendingCount: staleSending.length,
    sendConcurrency: 1,
    authority: CORE_AUTHORITY,
    results,
  };
}

module.exports = Object.freeze({
  protectedRuntime,
  recordSubscriptionAndSchedule,
  runDueReminders,
});
