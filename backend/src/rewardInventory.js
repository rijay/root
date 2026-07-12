const { nowISO } = require("./dates");
const { createId } = require("./seed");

function ensureList(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function positiveLimit(value) {
  const limit = Math.floor(numberValue(value));
  return limit > 0 ? limit : 0;
}

function activeReservation(item) {
  return text(item.status).toUpperCase() === "RESERVED";
}

function findPool(data, campaignId, quotaKey) {
  return ensureList(data, "rewardInventoryPools").find((pool) => {
    return pool.campaign_id === campaignId && pool.quota_key === quotaKey;
  }) || null;
}

function ensurePool(data, input = {}) {
  const campaignId = text(input.campaignId || input.campaign_id);
  const quotaKey = text(input.quotaKey || input.quota_key);
  const limit = positiveLimit(input.limit || input.quotaLimit || input.quota_limit);
  if (!campaignId || !quotaKey || !limit) return null;
  const pools = ensureList(data, "rewardInventoryPools");
  let pool = findPool(data, campaignId, quotaKey);
  const now = nowISO();
  if (!pool) {
    pool = {
      reward_inventory_pool_id: createId("rip"),
      campaign_id: campaignId,
      quota_key: quotaKey,
      quota_limit: limit,
      status: "ACTIVE",
      created_at: now,
      updated_at: now,
    };
    pools.push(pool);
    return pool;
  }
  if (limit && Number(pool.quota_limit || 0) !== limit) {
    pool.quota_limit = limit;
    pool.updated_at = now;
  }
  return pool;
}

function poolUsage(data, pool) {
  if (!pool) return { used: 0, limit: 0, available: 0 };
  const used = ensureList(data, "rewardInventoryReservations")
    .filter((reservation) => reservation.reward_inventory_pool_id === pool.reward_inventory_pool_id)
    .filter(activeReservation)
    .length;
  const limit = Number(pool.quota_limit || 0);
  return { used, limit, available: Math.max(0, limit - used) };
}

function existingReservation(data, idempotencyKey) {
  if (!idempotencyKey) return null;
  return ensureList(data, "rewardInventoryReservations").find((reservation) => {
    return reservation.idempotency_key === idempotencyKey && activeReservation(reservation);
  }) || null;
}

function reserve(data, input = {}) {
  const campaignId = text(input.campaignId || input.campaign_id);
  const quotaKey = text(input.quotaKey || input.quota_key);
  const limit = positiveLimit(input.limit || input.quotaLimit || input.quota_limit);
  if (!campaignId || !quotaKey || !limit) {
    return { limited: false, reserved: false, reservation: null, pool: null, used: 0, limit: 0 };
  }
  const idempotencyKey = text(input.idempotencyKey || input.idempotency_key);
  const existing = existingReservation(data, idempotencyKey);
  if (existing) {
    const pool = findPool(data, campaignId, quotaKey);
    const usage = poolUsage(data, pool);
    return { limited: true, reserved: true, reservation: existing, pool, ...usage, existing: true };
  }
  const pool = ensurePool(data, { campaignId, quotaKey, limit });
  const usage = poolUsage(data, pool);
  if (usage.used >= usage.limit) {
    return {
      limited: true,
      reserved: false,
      reservation: null,
      pool,
      used: usage.used,
      limit: usage.limit,
      skipped: true,
      skippedReason: `奖励库存已达上限：${usage.used}/${usage.limit}`,
    };
  }
  const now = nowISO();
  const reservation = {
    reward_inventory_reservation_id: createId("rir"),
    reward_inventory_pool_id: pool.reward_inventory_pool_id,
    campaign_id: campaignId,
    quota_key: quotaKey,
    root_user_id: text(input.rootUserId || input.root_user_id),
    reward_type: text(input.rewardType || input.reward_type).toUpperCase(),
    reward_key: text(input.rewardKey || input.reward_key),
    settlement_record_id: text(input.settlementRecordId || input.settlement_record_id),
    reward_grant_id: text(input.rewardGrantId || input.reward_grant_id),
    status: "RESERVED",
    idempotency_key: idempotencyKey,
    release_reason: "",
    reserved_at: now,
    released_at: "",
    created_at: now,
    updated_at: now,
  };
  ensureList(data, "rewardInventoryReservations").push(reservation);
  return { limited: true, reserved: true, reservation, pool, used: usage.used + 1, limit: usage.limit };
}

function attachGrant(data, reservationId, rewardGrantId) {
  const reservation = ensureList(data, "rewardInventoryReservations")
    .find((item) => item.reward_inventory_reservation_id === reservationId);
  if (!reservation) return null;
  reservation.reward_grant_id = rewardGrantId;
  reservation.updated_at = nowISO();
  return reservation;
}

function release(data, input = {}) {
  const reservationId = text(input.reservationId || input.reservation_id);
  const rewardGrantId = text(input.rewardGrantId || input.reward_grant_id);
  const reservations = ensureList(data, "rewardInventoryReservations");
  const reservation = reservations.find((item) => {
    if (reservationId) return item.reward_inventory_reservation_id === reservationId;
    return rewardGrantId && item.reward_grant_id === rewardGrantId;
  });
  if (!reservation || !activeReservation(reservation)) return { released: false, reservation: reservation || null };
  const now = nowISO();
  reservation.status = "RELEASED";
  reservation.release_reason = text(input.reason || input.releaseReason || input.release_reason, "库存释放");
  reservation.released_at = now;
  reservation.updated_at = now;
  return { released: true, reservation };
}

function releaseForRewardGrant(data, grant, reason = "") {
  if (!grant) return { released: false, reservation: null };
  return release(data, {
    reservationId: grant.inventory_reservation_id,
    rewardGrantId: grant.reward_grant_id,
    reason,
  });
}

module.exports = {
  attachGrant,
  ensurePool,
  poolUsage,
  release,
  releaseForRewardGrant,
  reserve,
};
