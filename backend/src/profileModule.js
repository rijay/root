const { createClientError } = require("./clientError");
const { nowISO, todayISO } = require("./dates");
const { createId } = require("./seed");

const GENDERS = Object.freeze(["MALE", "FEMALE"]);
const DEFAULT_NICKNAME = "Root用户";

function list(data) {
  if (!Array.isArray(data.formalProfiles)) data.formalProfiles = [];
  return data.formalProfiles;
}

function maskPhone(phone) {
  const value = String(phone || "");
  if (value.length < 7) return value;
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

function normalizedNickname(value) {
  const text = String(value || "").trim();
  if (!text || text === "微信用户" || text === "ROOT体验官") return DEFAULT_NICKNAME;
  return text.slice(0, 24);
}

function normalizedAvatarUrl(value) {
  const text = String(value || "").trim();
  return /^(https?:\/\/|cloud:\/\/)/i.test(text) ? text.slice(0, 1024) : "";
}

function existing(data, user) {
  const rootUserId = user && (user.root_user_id || user.user_id);
  return list(data).find((item) => item.rootUserId === rootUserId) || null;
}

function isComplete(data, user) {
  const profile = existing(data, user);
  return Boolean(profile && profile.complete && user && user.phone);
}

function present(profile, user) {
  return {
    profileId: profile ? profile.profileId : "",
    nickname: normalizedNickname((profile && profile.nickname) || (user && user.nickname)),
    avatarUrl: (profile && profile.avatarUrl) || (user && user.avatar_url) || "",
    phone: maskPhone(user && user.phone),
    phoneVerified: Boolean(user && user.phone),
    birthDate: (profile && profile.birthDate) || "",
    gender: (profile && profile.gender) || "",
    complete: Boolean(profile && profile.complete && user && user.phone),
    updatedAt: (profile && profile.updatedAt) || "",
  };
}

function read(data, user) {
  return { profile: present(existing(data, user), user) };
}

function validBirthDate(value, today = todayISO()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value <= today;
}

function save(data, user, input = {}, context = {}) {
  if (!user || !user.phone) {
    throw createClientError("PROFILE_VERIFIED_PHONE_REQUIRED", "请先完成手机号验证", 409);
  }
  const birthDate = String(input.birthDate || input.birth_date || "").trim();
  const gender = String(input.gender || "").trim().toUpperCase();
  if (!birthDate || !gender) {
    throw createClientError("PROFILE_REQUIRED_FIELDS_MISSING", "必填项未填写", 422);
  }
  if (!validBirthDate(birthDate, context.today || todayISO())) {
    throw createClientError("PROFILE_BIRTH_DATE_INVALID", "生日填写不正确", 422);
  }
  if (!GENDERS.includes(gender)) {
    throw createClientError("PROFILE_GENDER_INVALID", "性别填写不正确", 422);
  }

  const profiles = list(data);
  const timestamp = context.now || nowISO();
  let profile = existing(data, user);
  if (!profile) {
    profile = {
      profileId: createId("fpr"),
      rootUserId: user.root_user_id || user.user_id,
      createdAt: timestamp,
    };
    profiles.push(profile);
  }
  profile.nickname = normalizedNickname(input.nickname || user.nickname);
  profile.avatarUrl = normalizedAvatarUrl(input.avatarUrl || input.avatar_url || user.avatar_url);
  profile.birthDate = birthDate;
  profile.gender = gender;
  profile.complete = true;
  profile.completedAt = profile.completedAt || timestamp;
  profile.updatedAt = timestamp;

  user.nickname = profile.nickname;
  user.avatar_url = profile.avatarUrl;
  user.state = "REGISTERED_IDLE";
  user.lifecycle_status = "REGISTERED_IDLE";
  user.registered_at = user.registered_at || timestamp;

  return { success: true, profile: present(profile, user) };
}

module.exports = {
  DEFAULT_NICKNAME,
  GENDERS,
  isComplete,
  read,
  save,
};
