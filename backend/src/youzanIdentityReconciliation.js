const crypto = require("node:crypto");
const auditLog = require("./auditLog");
const { nowISO } = require("./dates");
const orderFulfillment = require("./orderFulfillment");
const operationTask = require("./operationTask");
const youzanCustomerMirror = require("./youzanCustomerMirror");
const { createYouzanIdentityImplementation } = require("./youzanIdentityResolver");

const DEFAULT_BATCH_SIZE = 5;
const MAX_BATCH_SIZE = 20;

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(text(value).toLowerCase());
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(text(value)).digest("hex").slice(0, 24);
}

function timestamp(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function addMinutes(value, minutes) {
  const base = timestamp(value) || Date.now();
  return nowISO(new Date(base + minutes * 60 * 1000));
}

function accessTokenPresent(env) {
  return Boolean(text(env.YOUZAN_USER_QUERY_ACCESS_TOKEN || env.YOUZAN_CUSTOMER_ACCESS_TOKEN || env.YOUZAN_ACCESS_TOKEN));
}

function configStatus(env) {
  const missing = [];
  if (!text(env.YOUZAN_USER_QUERY_URL)) missing.push("YOUZAN_USER_QUERY_URL");
  if (!accessTokenPresent(env)) missing.push("YOUZAN_USER_QUERY_ACCESS_TOKEN|YOUZAN_CUSTOMER_ACCESS_TOKEN|YOUZAN_ACCESS_TOKEN");
  if (!enabled(env.ROOT_YOUZAN_IDENTITY_RECONCILE_ENABLED)) missing.push("ROOT_YOUZAN_IDENTITY_RECONCILE_ENABLED=true");
  return { ready: missing.length === 0, missing };
}

function latestRecord(data, rootUserId, unionidFingerprint) {
  return ensureList(data, "youzanIdentityReconciliations")
    .filter((item) => item.root_user_id === rootUserId && item.unionid_fingerprint === unionidFingerprint)
    .sort((left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || "")))[0] || null;
}

function candidateIdentities(data, options = {}) {
  const now = text(options.now, nowISO());
  const rootUsersByFingerprint = new Map();
  for (const identity of ensureList(data, "wechatIdentities")) {
    const rootUserId = text(identity.root_user_id || identity.rootUserId);
    const unionid = text(identity.unionid || identity.unionId || identity.union_id);
    if (!rootUserId || !unionid) continue;
    const unionidFingerprint = fingerprint(unionid);
    if (!rootUsersByFingerprint.has(unionidFingerprint)) rootUsersByFingerprint.set(unionidFingerprint, new Set());
    rootUsersByFingerprint.get(unionidFingerprint).add(rootUserId);
  }
  const seen = new Set();
  const candidates = [];
  for (const identity of ensureList(data, "wechatIdentities")) {
    const rootUserId = text(identity.root_user_id || identity.rootUserId);
    const unionid = text(identity.unionid || identity.unionId || identity.union_id);
    if (!rootUserId || !unionid) continue;
    const unionidFingerprint = fingerprint(unionid);
    const key = `${rootUserId}:${unionidFingerprint}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const latest = latestRecord(data, rootUserId, unionidFingerprint);
    const conflictRootUserIds = Array.from(rootUsersByFingerprint.get(unionidFingerprint) || []);
    const identityConflict = conflictRootUserIds.length > 1;
    const sameUnresolvedConflict = Boolean(
      latest &&
      latest.status === "REVIEW_REQUIRED" &&
      latest.error_code === "DUPLICATE_ROOT_UNIONID" &&
      identityConflict
    );
    const duplicateConflictResolved = Boolean(
      latest &&
      latest.status === "REVIEW_REQUIRED" &&
      latest.error_code === "DUPLICATE_ROOT_UNIONID" &&
      !identityConflict
    );
    if (sameUnresolvedConflict) continue;
    if (!duplicateConflictResolved && latest && latest.next_retry_at && timestamp(latest.next_retry_at) > timestamp(now)) continue;
    candidates.push({
      rootUserId,
      unionid,
      unionidFingerprint,
      previousStatus: latest ? latest.status : "",
      identityConflict,
      conflictRootUserIds,
    });
  }
  return candidates;
}

function publicCandidate(candidate) {
  return {
    rootUserId: candidate.rootUserId,
    previousStatus: candidate.previousStatus,
    reviewRequired: candidate.identityConflict,
  };
}

function upsertRecord(data, candidate, updates = {}) {
  const records = ensureList(data, "youzanIdentityReconciliations");
  let record = latestRecord(data, candidate.rootUserId, candidate.unionidFingerprint);
  const now = text(updates.updated_at, nowISO());
  if (!record) {
    record = {
      reconciliation_id: `yzr_${crypto.randomBytes(8).toString("hex")}`,
      root_user_id: candidate.rootUserId,
      unionid_fingerprint: candidate.unionidFingerprint,
      status: "PENDING",
      attempts: 0,
      resolved_identity_count: 0,
      linked_order_count: 0,
      conflict_order_count: 0,
      identity_conflict_count: 0,
      error_code: "",
      next_retry_at: "",
      created_at: now,
      updated_at: now,
    };
    records.unshift(record);
  }
  Object.assign(record, updates, { updated_at: now });
  return record;
}

function retryDelayMinutes(attempt) {
  return [15, 60, 240, 720, 1440][Math.min(4, Math.max(0, attempt - 1))];
}

function publicResult(record) {
  return {
    rootUserId: record.root_user_id,
    status: record.status,
    attempts: record.attempts,
    identityCount: record.resolved_identity_count,
    linkedOrderCount: record.linked_order_count,
    conflictOrderCount: record.conflict_order_count,
    identityConflictCount: record.identity_conflict_count,
    errorCode: record.error_code,
    nextRetryAt: record.next_retry_at,
  };
}

function createIdentityReviewTask(data, candidate, body, details = {}) {
  const dedupeKey = `${candidate.unionidFingerprint}:${text(details.dedupeSuffix, "review")}`;
  const existing = ensureList(data, "operationTasks").find((task) => (
    task.task_type === "YOUZAN_IDENTITY_REVIEW_REQUIRED" &&
    task.status === "OPEN" &&
    task.dedupe_key === dedupeKey
  ));
  if (existing) return existing;
  return operationTask.createOperationTaskOnce(data, {
    task_type: "YOUZAN_IDENTITY_REVIEW_REQUIRED",
    task_date: text(body.date || body.dateText, text(body.now, nowISO()).slice(0, 10)),
    dedupe_key: dedupeKey,
    reason: details.reason,
    suggested_action: details.suggestedAction,
    metadata: {
      reasonCode: details.reasonCode,
      rootUserId: candidate.rootUserId,
      unionidFingerprint: candidate.unionidFingerprint,
      ...(details.metadata || {}),
    },
  }).task;
}

function completeIdentityReviewTasks(data, candidate) {
  const prefix = `${candidate.unionidFingerprint}:`;
  ensureList(data, "operationTasks")
    .filter((task) => (
      task.task_type === "YOUZAN_IDENTITY_REVIEW_REQUIRED" &&
      task.status === "OPEN" &&
      String(task.dedupe_key || "").startsWith(prefix)
    ))
    .forEach((task) => operationTask.completeOperationTask(data, task.task_id, {
      result: "IDENTITY_RECONCILED",
      note: "有赞身份重新核对通过，自动关闭旧复核待办",
    }));
}

function legacyUserForRoot(data, rootUserId) {
  return ensureList(data, "users").find((item) => (item.root_user_id || item.user_id) === rootUserId) || null;
}

async function reconcileYouzanIdentities(data, body = {}, context = {}) {
  const env = context.env || process.env;
  const dryRun = !(body.execute === true || body.dryRun === false || body.dry_run === false);
  const now = text(body.now, nowISO());
  const batchSize = clampInteger(body.batchSize || body.batch_size || body.limit, DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const refreshHours = clampInteger(
    body.refreshHours || body.refresh_hours || env.ROOT_YOUZAN_IDENTITY_RECONCILE_REFRESH_HOURS,
    168,
    1,
    720
  );
  const config = configStatus(env);
  const candidates = candidateIdentities(data, { now }).slice(0, batchSize);
  const plan = {
    dryRun,
    batchSize,
    refreshHours,
    config,
    candidateCount: candidates.length,
    candidates: candidates.map(publicCandidate),
  };
  if (dryRun) return { ...plan, executedCount: 0, successCount: 0, failedCount: 0, reviewCount: 0, results: [] };
  if (!config.ready) {
    const error = new Error(`有赞身份对账配置不完整：${config.missing.join(", ")}`);
    error.code = 400;
    throw error;
  }

  const implementation = context.identityImplementation || createYouzanIdentityImplementation({ fetchImpl: context.fetchImpl });
  const results = [];
  for (const candidate of candidates) {
    const previous = latestRecord(data, candidate.rootUserId, candidate.unionidFingerprint);
    const attempts = Number(previous && previous.attempts || 0) + 1;
    if (candidate.identityConflict) {
      const record = upsertRecord(data, candidate, {
        status: "REVIEW_REQUIRED",
        attempts,
        resolved_identity_count: 0,
        linked_order_count: 0,
        conflict_order_count: 0,
        identity_conflict_count: 0,
        error_code: "DUPLICATE_ROOT_UNIONID",
        next_retry_at: addMinutes(now, 1440),
        updated_at: now,
      });
      createIdentityReviewTask(data, candidate, { ...body, now }, {
        dedupeSuffix: "duplicate-root-user",
        reasonCode: "DUPLICATE_ROOT_UNIONID",
        reason: "同一 UnionID 关联多个 Root 用户，已停止有赞身份自动补链",
        suggestedAction: "核对微信身份归属并合并或修正重复 Root 用户后，再重跑有赞身份对账",
        metadata: {
          rootUserIds: candidate.conflictRootUserIds,
          rootUserCount: candidate.conflictRootUserIds.length,
        },
      });
      results.push(publicResult(record));
      continue;
    }
    if (!legacyUserForRoot(data, candidate.rootUserId)) {
      const record = upsertRecord(data, candidate, {
        status: "REVIEW_REQUIRED",
        attempts,
        resolved_identity_count: 0,
        linked_order_count: 0,
        conflict_order_count: 0,
        identity_conflict_count: 0,
        error_code: "ROOT_USER_BRIDGE_MISSING",
        next_retry_at: addMinutes(now, 1440),
        updated_at: now,
      });
      createIdentityReviewTask(data, candidate, { ...body, now }, {
        dedupeSuffix: "root-user-bridge-missing",
        reasonCode: "ROOT_USER_BRIDGE_MISSING",
        reason: "微信身份对应的 Root 用户缺少订单域用户桥接，已停止有赞身份自动补链",
        suggestedAction: "修复 root_user_id 到用户记录的桥接关系后，再重跑有赞身份对账",
      });
      results.push(publicResult(record));
      continue;
    }
    try {
      const resolved = await implementation({
        unionid: candidate.unionid,
        env,
        fetchImpl: context.fetchImpl,
      });
      let linkedOrderCount = 0;
      let conflictOrderCount = 0;
      let identityConflictCount = 0;
      const resolvedIdentities = Array.isArray(resolved.identities) ? resolved.identities : [];
      if (resolved.status === "RESOLVED") {
        for (const identity of resolvedIdentities) {
          const existingCustomer = youzanCustomerMirror.findCustomer(data, identity.youzanYzUid);
          if (existingCustomer && existingCustomer.root_user_id && existingCustomer.root_user_id !== candidate.rootUserId) {
            identityConflictCount += 1;
            createIdentityReviewTask(data, candidate, { ...body, now }, {
              dedupeSuffix: `yz-owner-${fingerprint(identity.youzanYzUid)}`,
              reasonCode: "YZ_OPEN_ID_OWNER_CONFLICT",
              reason: "有赞 yz_open_id 已归属其他 Root 用户，未覆盖客户镜像或订单归属",
              suggestedAction: "核对有赞账号合并历史、微信身份和现有订单归属后人工处理",
              metadata: {
                existingRootUserId: existingCustomer.root_user_id,
                yzOpenIdFingerprint: fingerprint(identity.youzanYzUid),
              },
            });
            continue;
          }
          youzanCustomerMirror.upsertYouzanCustomer(data, {
            youzanYzUid: identity.youzanYzUid,
            unionid: candidate.unionid,
            rootUserId: candidate.rootUserId,
            phone: identity.phone,
            nickname: identity.nickname,
            matchSource: "UNIONID",
          }, { sourceChannel: "YOUZAN_UNIONID_RECONCILE" });
          const binding = orderFulfillment.bindOrdersByYouzanIdentity(data, {
            youzanYzUid: identity.youzanYzUid,
            rootUserId: candidate.rootUserId,
          }, { dateText: body.date || body.dateText });
          linkedOrderCount += binding.linkedCount;
          conflictOrderCount += binding.conflictCount;
        }
      }
      const status = resolved.status === "UNIONID_MISMATCH"
        ? "REVIEW_REQUIRED"
        : resolved.status === "RESOLVED" && resolvedIdentities.length && !identityConflictCount
          ? "RESOLVED"
          : identityConflictCount ? "REVIEW_REQUIRED" : "NOT_FOUND";
      if (status === "REVIEW_REQUIRED") {
        if (resolved.status === "UNIONID_MISMATCH") {
          createIdentityReviewTask(data, candidate, { ...body, now }, {
            dedupeSuffix: "response-mismatch",
            reasonCode: "UNIONID_RESPONSE_MISMATCH",
            reason: "有赞身份查询返回的 UnionID 与请求身份不一致，已停止自动补链",
            suggestedAction: "核对微信开放平台绑定、有赞用户身份和 User Query 响应后再重跑",
          });
        }
      }
      if (status === "RESOLVED") completeIdentityReviewTasks(data, candidate);
      const errorCode = resolved.status === "UNIONID_MISMATCH"
        ? "UNIONID_RESPONSE_MISMATCH"
        : identityConflictCount ? "YZ_OPEN_ID_OWNER_CONFLICT" : "";
      const record = upsertRecord(data, candidate, {
        status,
        attempts,
        resolved_identity_count: resolvedIdentities.length,
        linked_order_count: linkedOrderCount,
        conflict_order_count: conflictOrderCount,
        identity_conflict_count: identityConflictCount,
        error_code: errorCode,
        next_retry_at: status === "RESOLVED"
          ? addMinutes(now, refreshHours * 60)
          : addMinutes(now, 1440),
        updated_at: now,
      });
      results.push(publicResult(record));
    } catch (error) {
      const record = upsertRecord(data, candidate, {
        status: "FAILED",
        attempts,
        resolved_identity_count: 0,
        linked_order_count: 0,
        conflict_order_count: 0,
        identity_conflict_count: 0,
        error_code: text(error.code, "500").slice(0, 32),
        next_retry_at: addMinutes(now, retryDelayMinutes(attempts)),
        updated_at: now,
      });
      results.push(publicResult(record));
    }
  }

  const successCount = results.filter((item) => item.status === "RESOLVED").length;
  const failedCount = results.filter((item) => item.status === "FAILED").length;
  const reviewCount = results.filter((item) => item.status === "REVIEW_REQUIRED").length;
  auditLog.appendAuditLog(data, {
    action: "YOUZAN_IDENTITY_RECONCILE",
    targetType: "YOUZAN_IDENTITY_RECONCILIATION",
    targetId: text(body.requestId || body.request_id),
    operatorId: text(body.operatorId || body.operator_id),
    reason: "有赞 UnionID 到 yz_open_id 小批量对账",
    after: {
      candidateCount: candidates.length,
      executedCount: results.length,
      successCount,
      failedCount,
      reviewCount,
      linkedOrderCount: results.reduce((sum, item) => sum + item.linkedOrderCount, 0),
      conflictOrderCount: results.reduce((sum, item) => sum + item.conflictOrderCount, 0),
      identityConflictCount: results.reduce((sum, item) => sum + item.identityConflictCount, 0),
    },
    metadata: { requestId: text(body.requestId || body.request_id) },
  });
  return {
    ...plan,
    executedCount: results.length,
    successCount,
    failedCount,
    reviewCount,
    results,
  };
}

module.exports = {
  candidateIdentities,
  configStatus,
  reconcileYouzanIdentities,
};
