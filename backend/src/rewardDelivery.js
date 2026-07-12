const { nowISO } = require("./dates");
const auditLog = require("./auditLog");
const { createDefaultRewardDeliveryAdapters, createDefaultRewardStatusAdapters } = require("./rewardDeliveryAdapters");
const { grantStatusForExternalStatus, normalizeExternalStatus } = require("./youzanCouponStatusAdapter");

function businessError(code, message, status = 200) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function clone(value) {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function bool(value) {
  if (value === true) return true;
  const textValue = String(value || "").trim().toLowerCase();
  return ["true", "1", "yes", "y", "confirmed"].includes(textValue);
}

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function deliveryJobIdsFromBody(body = {}) {
  const value = body.deliveryJobIds || body.delivery_job_ids || body.rewardDeliveryJobIds || body.ids || [];
  const list = Array.isArray(value) ? value : String(value || "").split(/[\s,，;；]+/);
  return Array.from(new Set(list.map((item) => String(item || "").trim()).filter(Boolean)));
}

function findDeliveryJob(data, deliveryJobId) {
  return ensureList(data, "rewardDeliveryJobs").find((item) => item.reward_delivery_job_id === deliveryJobId) || null;
}

function findRewardGrant(data, rewardGrantId) {
  return ensureList(data, "rewardGrants").find((item) => item.reward_grant_id === rewardGrantId) || null;
}

function rewardGrantIdsFromBody(body = {}) {
  const value = body.rewardGrantIds || body.reward_grant_ids || body.grantIds || body.grant_ids || [];
  const list = Array.isArray(value) ? value : String(value || "").split(/[\s,，;；]+/);
  return Array.from(new Set(list.map((item) => String(item || "").trim()).filter(Boolean)));
}

function targetDeliveryJobs(data, body = {}) {
  const deliveryJobIds = deliveryJobIdsFromBody(body);
  const rewardGrantIds = rewardGrantIdsFromBody(body);
  const jobs = ensureList(data, "rewardDeliveryJobs");
  const selected = [];
  deliveryJobIds.forEach((deliveryJobId) => {
    const job = findDeliveryJob(data, deliveryJobId);
    if (!job) throw businessError(404, `奖励发放任务不存在：${deliveryJobId}`, 404);
    selected.push(job);
  });
  rewardGrantIds.forEach((rewardGrantId) => {
    const grantJobs = jobs.filter((job) => job.reward_grant_id === rewardGrantId);
    if (!grantJobs.length) throw businessError(404, `奖励记录没有发放任务：${rewardGrantId}`, 404);
    grantJobs.forEach((job) => selected.push(job));
  });
  return Array.from(new Map(selected.map((job) => [job.reward_delivery_job_id, job])).values());
}

function shouldFail(body = {}) {
  const outcome = String(body.outcome || body.result || "").trim().toUpperCase();
  return outcome === "FAILED" || outcome === "FAIL" || bool(body.simulateFailure || body.simulate_failure);
}

function nextRetryAt(attemptCount) {
  const minutes = Math.min(120, Math.max(10, Number(attemptCount || 1) * 10));
  return nowISO(new Date(Date.now() + minutes * 60 * 1000));
}

function deliveryMode(body = {}) {
  return String(body.deliveryMode || body.delivery_mode || body.adapterMode || body.adapter_mode || "").trim().toUpperCase();
}

function adapterLabel(adapterType) {
  if (adapterType === "YOUZAN_COUPON") return "有赞优惠券";
  if (adapterType === "WEWORK_TAG") return "企业微信标签";
  return adapterType || "奖励";
}

function manualAdapterResultFor(job, grant, body = {}) {
  if (shouldFail(body)) {
    const message = text(body.errorMessage || body.error_message || body.lastError || body.last_error, "人工发放标记失败");
    return {
      ok: false,
      status: "FAILED",
      message,
      externalRef: "",
      payload: {
        adapterType: job.adapter_type,
        rewardGrantId: grant.reward_grant_id,
        message,
      },
    };
  }
  const externalRef = text(body.externalRef || body.external_ref || body.voucherNo || body.voucher_no, `manual-${job.reward_delivery_job_id}`);
  return {
    ok: true,
    status: "DELIVERED",
    message: text(body.successMessage || body.success_message, "人工确认发放完成"),
    externalRef,
    payload: {
      adapterType: job.adapter_type,
      rewardGrantId: grant.reward_grant_id,
      externalRef,
    },
  };
}

async function adapterResultFor(job, grant, body = {}, context = {}) {
  const mode = deliveryMode(body);
  if (shouldFail(body) || mode === "MANUAL") return manualAdapterResultFor(job, grant, body);
  const adapters = createDefaultRewardDeliveryAdapters(context.env || process.env, context);
  const adapter = adapters[job.adapter_type];
  if (typeof adapter !== "function") {
    if (mode === "AUTO") {
      return {
        ok: false,
        status: "FAILED",
        message: `${job.adapter_type} Adapter 尚未配置`,
        externalRef: "",
        payload: {
          adapterType: job.adapter_type,
          errorCode: "ADAPTER_NOT_CONFIGURED",
          errorMessage: `${job.adapter_type} Adapter 尚未配置`,
        },
      };
    }
    return manualAdapterResultFor(job, grant, body);
  }
  try {
    const result = await adapter({
      env: context.env || process.env,
      fetchImpl: context.fetchImpl,
      data: context.data,
      job,
      grant,
      body,
    });
    return {
      ok: Boolean(result && result.ok),
      status: result && result.ok ? "DELIVERED" : "FAILED",
      message: text(result && result.message, result && result.ok ? `${adapterLabel(job.adapter_type)}发放完成` : `${adapterLabel(job.adapter_type)}发放失败`),
      externalRef: text(result && result.externalRef),
      payload: result && result.payload ? result.payload : result || {},
    };
  } catch (error) {
    return {
      ok: false,
      status: "FAILED",
      message: error.message || "奖励发放 Adapter 运行失败",
      externalRef: "",
      payload: {
        adapterType: job.adapter_type,
        errorCode: String(error.code || 500),
        errorMessage: error.message || "奖励发放 Adapter 运行失败",
        detail: error.detail || null,
      },
    };
  }
}

function manualStatusResultFor(job, grant, body = {}) {
  const externalStatus = normalizeExternalStatus(body.externalStatus || body.external_status || body.status || body.couponStatus || body.coupon_status);
  const externalRef = text(body.externalRef || body.external_ref || body.couponNo || body.coupon_no || grant.external_ref);
  const message = text(body.statusMessage || body.status_message || body.message, "人工更新有赞优惠券状态");
  return {
    ok: externalStatus !== "UNKNOWN",
    externalStatus,
    grantStatus: grantStatusForExternalStatus(externalStatus, grant.status),
    message: externalStatus === "UNKNOWN" ? "人工状态无法识别" : message,
    externalRef,
    usedAt: text(body.usedAt || body.used_at),
    expiredAt: text(body.expiredAt || body.expired_at),
    payload: {
      adapterType: job.adapter_type,
      rewardGrantId: grant.reward_grant_id,
      externalStatus,
      externalRef,
      message,
      source: "MANUAL",
    },
  };
}

async function statusAdapterResultFor(job, grant, body = {}, context = {}) {
  const mode = deliveryMode(body);
  if (mode === "MANUAL" || body.externalStatus || body.external_status || body.couponStatus || body.coupon_status) {
    return manualStatusResultFor(job, grant, body);
  }
  const adapters = createDefaultRewardStatusAdapters(context.env || process.env, context);
  const adapter = adapters[job.adapter_type];
  if (typeof adapter !== "function") {
    if (mode === "AUTO") {
      return {
        ok: false,
        externalStatus: "UNKNOWN",
        grantStatus: grant.status,
        message: `${job.adapter_type} 状态查询 Adapter 尚未配置`,
        externalRef: grant.external_ref || "",
        payload: {
          adapterType: job.adapter_type,
          errorCode: "STATUS_ADAPTER_NOT_CONFIGURED",
          errorMessage: `${job.adapter_type} 状态查询 Adapter 尚未配置`,
        },
      };
    }
    return manualStatusResultFor(job, grant, body);
  }
  try {
    const result = await adapter({
      env: context.env || process.env,
      fetchImpl: context.fetchImpl,
      data: context.data,
      job,
      grant,
      body,
    });
    return {
      ok: Boolean(result && result.ok),
      externalStatus: text(result && result.externalStatus, "UNKNOWN"),
      grantStatus: text(result && result.grantStatus, grant.status),
      message: text(result && result.message, result && result.ok ? "有赞优惠券状态查询完成" : "有赞优惠券状态查询失败"),
      externalRef: text(result && result.externalRef, grant.external_ref || ""),
      usedAt: text(result && result.usedAt),
      expiredAt: text(result && result.expiredAt),
      payload: result && result.payload ? result.payload : result || {},
    };
  } catch (error) {
    return {
      ok: false,
      externalStatus: "UNKNOWN",
      grantStatus: grant.status,
      message: error.message || "奖励状态 Adapter 运行失败",
      externalRef: grant.external_ref || "",
      payload: {
        adapterType: job.adapter_type,
        errorCode: String(error.code || 500),
        errorMessage: error.message || "奖励状态 Adapter 运行失败",
        detail: error.detail || null,
      },
    };
  }
}

async function applyDeliveryResult(data, deliveryJobId, body = {}, context = {}) {
  const job = findDeliveryJob(data, deliveryJobId);
  if (!job) throw businessError(404, "奖励发放任务不存在", 404);
  const grant = findRewardGrant(data, job.reward_grant_id);
  if (!grant) throw businessError(8101, "奖励发放任务缺少对应奖励记录");

  const before = { job: clone(job), grant: clone(grant) };
  if (job.status === "DELIVERED") {
    return {
      deliveryJob: job,
      rewardGrant: grant,
      skipped: true,
      message: "奖励已发放，无需重复处理",
      audit: null,
    };
  }

  if (!["PENDING", "FAILED"].includes(job.status)) {
    throw businessError(8102, `当前发放任务状态不可执行：${job.status}`);
  }

  const now = nowISO();
  const adapterResult = await adapterResultFor(job, grant, body, context);
  job.attempt_count = Number(job.attempt_count || 0) + 1;
  job.updated_at = now;
  job.external_result_json = adapterResult.payload;
  job.request_id = body.requestId || body.request_id || "";

  if (adapterResult.ok) {
    job.status = "DELIVERED";
    job.last_error = "";
    job.next_retry_at = "";
    job.delivered_at = now;
    grant.status = "DELIVERED";
    grant.delivered_at = now;
    grant.external_ref = adapterResult.externalRef;
    grant.updated_at = now;
  } else {
    job.status = "FAILED";
    job.last_error = adapterResult.message;
    job.next_retry_at = nextRetryAt(job.attempt_count);
    grant.status = grant.status === "DELIVERED" ? "DELIVERED" : "PENDING_DELIVERY";
    grant.updated_at = now;
  }

  const audit = auditLog.appendAuditLog(data, {
    action: "REWARD_DELIVERY_EXECUTE",
    targetType: "REWARD_DELIVERY_JOB",
    targetId: deliveryJobId,
    operatorId: body.operatorId || body.operator_id || "",
    reason: body.reason || body.note || "处理奖励发放任务",
    before,
    after: { job: clone(job), grant: clone(grant), adapterResult },
    metadata: {
      requestId: body.requestId || body.request_id || "",
      adapterType: job.adapter_type,
      outcome: adapterResult.status,
      externalRef: adapterResult.externalRef || "",
    },
  });

  return {
    deliveryJob: job,
    rewardGrant: grant,
    skipped: false,
    message: adapterResult.message,
    adapterResult,
    audit,
  };
}

async function applyDeliveryStatusResult(data, deliveryJobId, body = {}, context = {}) {
  const job = findDeliveryJob(data, deliveryJobId);
  if (!job) throw businessError(404, "奖励发放任务不存在", 404);
  const grant = findRewardGrant(data, job.reward_grant_id);
  if (!grant) throw businessError(8101, "奖励发放任务缺少对应奖励记录");
  if (job.adapter_type !== "YOUZAN_COUPON") {
    throw businessError(8111, `当前发放任务不支持状态查询：${job.adapter_type}`);
  }

  const before = { job: clone(job), grant: clone(grant) };
  const now = nowISO();
  const adapterResult = await statusAdapterResultFor(job, grant, body, context);
  job.updated_at = now;
  job.status_checked_at = now;
  job.external_result_json = {
    ...(job.external_result_json && typeof job.external_result_json === "object" ? job.external_result_json : {}),
    statusQuery: adapterResult.payload,
    lastStatus: adapterResult.externalStatus,
    lastStatusCheckedAt: now,
  };
  job.request_id = body.requestId || body.request_id || job.request_id || "";

  if (adapterResult.ok) {
    job.last_error = "";
    if (job.status !== "DELIVERED") {
      job.status = "DELIVERED";
      job.delivered_at = job.delivered_at || now;
    }
    if (adapterResult.externalRef && !grant.external_ref) grant.external_ref = adapterResult.externalRef;
    grant.external_status = adapterResult.externalStatus;
    grant.external_status_checked_at = now;
    grant.external_status_json = adapterResult.payload;
    grant.status = adapterResult.grantStatus || grant.status;
    if (grant.status === "DELIVERED" && !grant.delivered_at) grant.delivered_at = now;
    if (adapterResult.usedAt) grant.used_at = adapterResult.usedAt;
    if (adapterResult.expiredAt) grant.expired_at = adapterResult.expiredAt;
    grant.updated_at = now;
  } else {
    job.last_error = adapterResult.message;
    grant.external_status = adapterResult.externalStatus || grant.external_status || "";
    grant.external_status_checked_at = now;
    grant.external_status_json = adapterResult.payload;
    grant.updated_at = now;
  }

  const audit = auditLog.appendAuditLog(data, {
    action: "REWARD_DELIVERY_STATUS_QUERY",
    targetType: "REWARD_DELIVERY_JOB",
    targetId: deliveryJobId,
    operatorId: body.operatorId || body.operator_id || "",
    reason: body.reason || body.note || "查询奖励发放状态",
    before,
    after: { job: clone(job), grant: clone(grant), adapterResult },
    metadata: {
      requestId: body.requestId || body.request_id || "",
      adapterType: job.adapter_type,
      externalStatus: adapterResult.externalStatus || "",
      externalRef: adapterResult.externalRef || grant.external_ref || "",
      ok: adapterResult.ok,
    },
  });

  return {
    deliveryJob: job,
    rewardGrant: grant,
    skipped: false,
    message: adapterResult.message,
    adapterResult,
    audit,
  };
}

async function executeDeliveryBatch(data, body = {}, context = {}) {
  const deliveryJobIds = deliveryJobIdsFromBody(body);
  const requestId = text(body.requestId || body.request_id);
  if (!deliveryJobIds.length) throw businessError(8103, "请选择要处理的奖励发放任务");
  if (!requestId) throw businessError(8104, "奖励发放必须提供 request_id");
  if (!bool(body.confirmRisk || body.confirm_risk || body.confirmed)) {
    throw businessError(8105, "奖励发放需要二次确认");
  }

  deliveryJobIds.forEach((deliveryJobId) => {
    if (!findDeliveryJob(data, deliveryJobId)) throw businessError(404, `奖励发放任务不存在：${deliveryJobId}`, 404);
  });

  const items = [];
  for (const deliveryJobId of deliveryJobIds) {
    items.push(await applyDeliveryResult(data, deliveryJobId, {
      ...body,
      requestId,
    }, context));
  }
  const summary = items.reduce((result, item) => {
    result.total += 1;
    if (item.skipped) result.skipped += 1;
    else if (item.deliveryJob.status === "DELIVERED") result.delivered += 1;
    else if (item.deliveryJob.status === "FAILED") result.failed += 1;
    return result;
  }, { total: 0, delivered: 0, failed: 0, skipped: 0 });

  const audit = auditLog.appendAuditLog(data, {
    action: "REWARD_DELIVERY_BATCH_EXECUTE",
    targetType: "REWARD_DELIVERY_BATCH",
    targetId: requestId,
    operatorId: body.operatorId || body.operator_id || "",
    reason: body.reason || body.note || "批量处理奖励发放任务",
    before: null,
    after: { deliveryJobIds, summary },
    metadata: {
      requestId,
      outcome: shouldFail(body) ? "FAILED" : "DELIVERED",
    },
  });

  return {
    requestId,
    summary,
    items,
    audit,
  };
}

async function queryDeliveryStatusBatch(data, body = {}, context = {}) {
  const jobs = targetDeliveryJobs(data, body);
  const requestId = text(body.requestId || body.request_id);
  if (!jobs.length) throw businessError(8103, "请选择要查询状态的奖励发放任务");
  if (!requestId) throw businessError(8104, "奖励状态查询必须提供 request_id");

  const items = [];
  for (const job of jobs) {
    items.push(await applyDeliveryStatusResult(data, job.reward_delivery_job_id, {
      ...body,
      requestId,
    }, context));
  }
  const summary = items.reduce((result, item) => {
    result.total += 1;
    if (item.adapterResult && item.adapterResult.ok) result.updated += 1;
    else result.failed += 1;
    const status = item.adapterResult && item.adapterResult.externalStatus;
    if (status) result.byStatus[status] = (result.byStatus[status] || 0) + 1;
    return result;
  }, { total: 0, updated: 0, failed: 0, byStatus: {} });

  const audit = auditLog.appendAuditLog(data, {
    action: "REWARD_DELIVERY_STATUS_BATCH_QUERY",
    targetType: "REWARD_DELIVERY_BATCH",
    targetId: requestId,
    operatorId: body.operatorId || body.operator_id || "",
    reason: body.reason || body.note || "批量查询奖励发放状态",
    before: null,
    after: { deliveryJobIds: jobs.map((job) => job.reward_delivery_job_id), summary },
    metadata: {
      requestId,
      adapterType: "YOUZAN_COUPON",
    },
  });

  return {
    requestId,
    summary,
    items,
    audit,
  };
}

module.exports = {
  applyDeliveryResult,
  applyDeliveryStatusResult,
  deliveryJobIdsFromBody,
  executeDeliveryBatch,
  queryDeliveryStatusBatch,
  manualAdapterResultFor,
  manualStatusResultFor,
};
