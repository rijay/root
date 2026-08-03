const { createClientError } = require("./clientError");
const profileModule = require("./profileModule");

function normalizedPhone(value) {
  const phone = String(value || "").trim();
  if (!/^1\d{10}$/.test(phone)) {
    throw createClientError("ADMIN_USER_PHONE_INVALID", "请输入完整的 11 位手机号", 400);
  }
  return phone;
}

function accountStatus(user, profile) {
  const deletionStatus = String(
    user.account_deletion_status || user.deletion_status || ""
  ).toUpperCase();
  if (["PENDING", "PROCESSING"].includes(deletionStatus)) return "DELETION_PENDING";
  if (["DELETED", "COMPLETED"].includes(deletionStatus)) return "DELETED";
  return profile.complete ? "ACTIVE" : "PROFILE_PENDING";
}

function present(data, user) {
  const profile = profileModule.read(data, user).profile;
  return {
    rootUserId: user.root_user_id || user.user_id,
    nickname: profile.nickname,
    maskedPhone: profile.phone,
    profileComplete: profile.complete,
    accountStatus: accountStatus(user, profile),
    registeredAt: user.registered_at || user.created_at || "",
    lastLoginAt: user.last_login_at || user.updated_at || "",
  };
}

function queryByPhone(data, input = {}) {
  const phone = normalizedPhone(input.phone);
  const users = (Array.isArray(data.users) ? data.users : []).filter(
    (user) => String(user.phone || "") === phone
  );
  if (users.length > 1) {
    throw createClientError(
      "ADMIN_USER_IDENTITY_CONFLICT",
      "该手机号关联多个账号，请转交账号核验",
      409
    );
  }
  return { user: users.length ? present(data, users[0]) : null };
}

module.exports = { queryByPhone };
