const crypto = require("node:crypto");

const { nowISO } = require("./dates");
const { createId } = require("./seed");
const manualReview = require("./manualReview");
const rewardInventory = require("./rewardInventory");

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

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function arrayValue(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value.split(/[\s,，;；]+/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function rewardStatus(reward) {
  const type = text(reward.rewardType || reward.reward_type).toUpperCase();
  if (type === "FREE_ORDER_CHANCE" || type === "MANUAL_REVIEW") return "PENDING_REVIEW";
  if (type === "POINTS") return "PROMISED";
  return "PENDING_DELIVERY";
}

function adapterTypeForReward(reward) {
  const type = text(reward.rewardType || reward.reward_type).toUpperCase();
  if (type === "YOUZAN_COUPON") return "YOUZAN_COUPON";
  if (type === "TAG") return "WEWORK_TAG";
  return "";
}

function rewardKey(reward, index) {
  return text(reward.rewardKey || reward.reward_key || reward.rewardType || reward.reward_type, `reward_${index + 1}`);
}

function quotaLimit(reward) {
  const limit = numberValue(
    reward.stockLimit
    || reward.stock_limit
    || reward.maxCount
    || reward.max_count
    || reward.quota
    || reward.quotaLimit
    || reward.quota_limit,
  );
  return limit > 0 ? Math.floor(limit) : 0;
}

function quotaKey(reward, index = 0) {
  return text(
    reward.quotaKey
    || reward.quota_key
    || reward.inventoryKey
    || reward.inventory_key
    || reward.budgetKey
    || reward.budget_key
    || rewardKey(reward, index),
  );
}

function normalizedRate(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = numberValue(value);
  if (number <= 0) return 0;
  if (number > 1) return Math.min(1, number / 100);
  return Math.min(1, number);
}

function deterministicScore(value) {
  const hash = crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
  return Number.parseInt(hash, 16) / 0xffffffffffff;
}

function blockedRootUsers(reward) {
  return new Set(arrayValue(
    reward.blockedRootUserIds
    || reward.blocked_root_user_ids
    || reward.blacklistRootUserIds
    || reward.blacklist_root_user_ids
    || reward.excludedRootUserIds
    || reward.excluded_root_user_ids,
  ));
}

function rewardChanceRate(reward) {
  return normalizedRate(firstPresent(
    reward.chanceRate,
    reward.chance_rate,
    reward.selectionRate,
    reward.selection_rate,
    reward.lotteryRate,
    reward.lottery_rate,
    reward.winRate,
    reward.win_rate,
    reward.probability,
  ));
}

function rewardEligibility(settlementRecord, reward = {}, index = 0) {
  const type = text(reward.rewardType || reward.reward_type).toUpperCase();
  const key = rewardKey(reward, index);
  if (blockedRootUsers(reward).has(settlementRecord.root_user_id)) {
    return {
      eligible: false,
      skippedReason: "用户在该奖励黑名单内",
      rewardType: type,
      rewardKey: key,
    };
  }
  const rate = rewardChanceRate(reward);
  if (rate === null || rate >= 1) return { eligible: true, rewardType: type, rewardKey: key };
  const seed = text(reward.lotterySeed || reward.lottery_seed, [
    settlementRecord.root_user_id,
    settlementRecord.campaign_id,
    settlementRecord.rule_version,
    key,
  ].join(":"));
  const score = deterministicScore(seed);
  if (score < rate) {
    return { eligible: true, rewardType: type, rewardKey: key, selectionRate: rate, selectionScore: score };
  }
  return {
    eligible: false,
    skippedReason: `未抽中该奖励：${Math.round(rate * 100)}%`,
    rewardType: type,
    rewardKey: key,
    selectionRate: rate,
    selectionScore: score,
  };
}

function reserveQuota(data, settlementRecord, reward = {}, index = 0, idempotencyKey = "") {
  const limit = quotaLimit(reward);
  if (!limit) return { limited: false, limit: 0, used: 0, key: "", reservation: null };
  const key = quotaKey(reward, index);
  const result = rewardInventory.reserve(data, {
    campaignId: settlementRecord.campaign_id,
    quotaKey: key,
    limit,
    rootUserId: settlementRecord.root_user_id,
    rewardType: reward.rewardType || reward.reward_type,
    rewardKey: rewardKey(reward, index),
    settlementRecordId: settlementRecord.settlement_record_id,
    idempotencyKey,
  });
  return { ...result, key };
}

function createDeliveryJob(data, grant, reward) {
  const adapterType = adapterTypeForReward(reward);
  if (!adapterType) return null;
  const jobs = ensureList(data, "rewardDeliveryJobs");
  const existing = jobs.find((job) => job.reward_grant_id === grant.reward_grant_id && job.adapter_type === adapterType);
  if (existing) return existing;
  const now = nowISO();
  const job = {
    reward_delivery_job_id: createId("rdj"),
    reward_grant_id: grant.reward_grant_id,
    adapter_type: adapterType,
    status: "PENDING",
    attempt_count: 0,
    last_error: "",
    next_retry_at: "",
    created_at: now,
    updated_at: now,
  };
  jobs.push(job);
  return job;
}

function grantReward(data, settlementRecord, reward = {}, context = {}) {
  const type = text(reward.rewardType || reward.reward_type).toUpperCase();
  if (!type) return null;
  const index = numberValue(reward.rewardIndex || reward.reward_index);
  const key = text(reward.idempotencyKey || reward.idempotency_key, [
    settlementRecord.root_user_id,
    settlementRecord.campaign_id,
    settlementRecord.rule_version,
    rewardKey(reward, index),
  ].join(":"));
  const grants = ensureList(data, "rewardGrants");
  const existing = grants.find((grant) => grant.idempotency_key === key);
  if (existing) return { grant: existing, created: false, deliveryJob: createDeliveryJob(data, existing, reward) };
  const eligibility = rewardEligibility(settlementRecord, reward, index);
  if (!eligibility.eligible) {
    return {
      grant: null,
      created: false,
      skipped: true,
      skippedReason: eligibility.skippedReason,
      rewardType: eligibility.rewardType,
      rewardKey: eligibility.rewardKey,
      selectionRate: eligibility.selectionRate,
      selectionScore: eligibility.selectionScore,
    };
  }
  const quota = reserveQuota(data, settlementRecord, reward, index, `reward-quota:${key}`);
  if (quota.skipped) {
    return {
      grant: null,
      created: false,
      skipped: true,
      skippedReason: `奖励库存已达上限：${quota.used}/${quota.limit}`,
      rewardType: type,
      rewardKey: rewardKey(reward, index),
      quotaKey: quota.key,
      quotaLimit: quota.limit,
      quotaUsed: quota.used,
    };
  }
  const now = nowISO();
  const payload = objectValue(reward.payload || reward.payload_json);
  const grant = {
    reward_grant_id: createId("rgr"),
    root_user_id: settlementRecord.root_user_id,
    campaign_id: settlementRecord.campaign_id,
    settlement_record_id: settlementRecord.settlement_record_id,
    order_id: text(reward.orderId || reward.order_id || payload.orderId || payload.order_id),
    reward_type: type,
    reward_key: rewardKey(reward, index),
    quota_key: quota.key,
    quota_limit: quota.limit,
    inventory_reservation_id: quota.reservation ? quota.reservation.reward_inventory_reservation_id : "",
    title: text(reward.title, type),
    description: text(reward.description),
    status: rewardStatus(reward),
    payload_json: payload,
    idempotency_key: key,
    created_at: now,
    updated_at: now,
  };
  grants.push(grant);
  if (quota.reservation) rewardInventory.attachGrant(data, quota.reservation.reward_inventory_reservation_id, grant.reward_grant_id);
  const deliveryJob = createDeliveryJob(data, grant, reward);
  if (grant.status === "PENDING_REVIEW") {
    manualReview.createManualReviewItem(data, {
      rootUserId: grant.root_user_id,
      campaignId: grant.campaign_id,
      reviewType: type === "FREE_ORDER_CHANCE" ? "FREE_ORDER_REVIEW" : "REWARD_REVIEW",
      sourceType: "REWARD_GRANT",
      sourceId: grant.reward_grant_id,
      reason: reward.reviewReason || reward.review_reason || "奖励需要人工复核",
      metadata: { settlementRecordId: settlementRecord.settlement_record_id, rewardType: type },
      idempotencyKey: `reward-review:${grant.idempotency_key}`,
    }, context);
  }
  return { grant, created: true, deliveryJob };
}

function grantRewards(data, settlementRecord, rewards = [], context = {}) {
  if (settlementRecord.status !== "QUALIFIED") return [];
  return rewards.map((reward, index) => {
    return grantReward(data, settlementRecord, {
      ...reward,
      rewardIndex: index,
      idempotencyKey: reward.idempotencyKey || reward.idempotency_key || [
        settlementRecord.root_user_id,
        settlementRecord.campaign_id,
        settlementRecord.rule_version,
        rewardKey(reward, index),
      ].join(":"),
    }, context);
  }).filter(Boolean);
}

function listRewardGrants(data, query = {}) {
  const rootUserId = query.rootUserId || query.root_user_id || "";
  const campaignId = query.campaignId || query.campaign_id || "";
  return ensureList(data, "rewardGrants")
    .filter((grant) => !rootUserId || grant.root_user_id === rootUserId)
    .filter((grant) => !campaignId || grant.campaign_id === campaignId)
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
}

function toRewardGrantPayload(grant) {
  if (!grant) return null;
  return {
    rewardGrantId: grant.reward_grant_id,
    settlementRecordId: grant.settlement_record_id,
    orderId: grant.order_id || "",
    rewardType: grant.reward_type,
    rewardKey: grant.reward_key,
    quotaKey: grant.quota_key || "",
    quotaLimit: grant.quota_limit || 0,
    inventoryReservationId: grant.inventory_reservation_id || "",
    title: grant.title,
    description: grant.description,
    status: grant.status,
    externalRef: grant.external_ref || "",
    externalStatus: grant.external_status || "",
    externalStatusCheckedAt: grant.external_status_checked_at || "",
    usedAt: grant.used_at || "",
    expiredAt: grant.expired_at || "",
    recoveryStatus: grant.recovery_status || "",
    recoveryReason: grant.recovery_reason || "",
    recoveryRecordId: grant.recovery_record_id || "",
    recoveredAt: grant.recovered_at || "",
    createdAt: grant.created_at,
    updatedAt: grant.updated_at,
  };
}

module.exports = {
  grantReward,
  grantRewards,
  listRewardGrants,
  toRewardGrantPayload,
};
