const { createClientError } = require("./clientError");
const { todayISO } = require("./dates");
const { isProtectedRuntime } = require("./credentialProtection");

const MINIMUM_AGE = 18;

function ageOn(birthDate, asOf = todayISO()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(birthDate || ""))) return -1;
  const [year, month, day] = birthDate.split("-").map(Number);
  const [currentYear, currentMonth, currentDay] = asOf.split("-").map(Number);
  let age = currentYear - year;
  if (currentMonth < month || (currentMonth === month && currentDay < day)) age -= 1;
  return age;
}

function assertEligible(profile, context = {}) {
  if (!profile || !profile.complete) {
    throw createClientError("FORMAL_HEALTH_PROFILE_REQUIRED", "请先完善会员资料", 409);
  }
  const age = ageOn(profile.birthDate, context.today || todayISO());
  if (age < MINIMUM_AGE) {
    throw createClientError("FORMAL_HEALTH_AGE_RESTRICTED", "首发仅面向 18 岁及以上用户", 403);
  }
  return age;
}

function assertWriteEnabled(context = {}) {
  const env = context.env || context || {};
  if (!isProtectedRuntime(env)) return;
  if (String(env.ROOT_FORMAL_HEALTH_WRITES_ENABLED || "").trim().toLowerCase() === "true") return;
  throw createClientError("FORMAL_HEALTH_WRITES_DISABLED", "Root4U 健康评测暂未开放", 503);
}

module.exports = { MINIMUM_AGE, ageOn, assertEligible, assertWriteEnabled };
