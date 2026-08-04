const test = require("node:test");
const assert = require("node:assert/strict");
const adminFormalUserQuery = require("../src/adminFormalUserQuery");

function data() {
  return {
    users: [
      {
        user_id: "usr_001",
        root_user_id: "root_001",
        phone: "13800138000",
        nickname: "微信用户",
        created_at: "2026-08-01T00:00:00.000Z",
      },
    ],
    formalProfiles: [
      {
        profileId: "profile_001",
        rootUserId: "root_001",
        nickname: "节律体验官",
        complete: true,
        updatedAt: "2026-08-02T00:00:00.000Z",
      },
    ],
  };
}

test("formal admin user query accepts only an exact phone and returns minimal masked facts", () => {
  const result = adminFormalUserQuery.queryByPhone(data(), { phone: "13800138000" });
  assert.deepEqual(result, {
    user: {
      rootUserId: "root_001",
      nickname: "节律体验官",
      maskedPhone: "138****8000",
      profileComplete: true,
      accountStatus: "ACTIVE",
      registeredAt: "2026-08-01T00:00:00.000Z",
      lastLoginAt: "",
    },
  });
  assert.equal(JSON.stringify(result).includes("13800138000"), false);
  assert.equal(JSON.stringify(result).includes("birthDate"), false);
  assert.equal(JSON.stringify(result).includes("gender"), false);
});

test("formal admin user query rejects partial phones and ambiguous ownership", () => {
  assert.throws(
    () => adminFormalUserQuery.queryByPhone(data(), { phone: "1380" }),
    { code: "ADMIN_USER_PHONE_INVALID", status: 400 }
  );
  const duplicated = data();
  duplicated.users.push({
    user_id: "usr_002",
    root_user_id: "root_002",
    phone: "13800138000",
  });
  assert.throws(
    () => adminFormalUserQuery.queryByPhone(duplicated, { phone: "13800138000" }),
    { code: "ADMIN_USER_IDENTITY_CONFLICT", status: 409 }
  );
});

test("formal admin user query returns an explicit empty result", () => {
  assert.deepEqual(
    adminFormalUserQuery.queryByPhone(data(), { phone: "13900139000" }),
    { user: null }
  );
});

test("a canceled deletion request does not mark an active account as deleted", () => {
  const input = data();
  input.users[0].account_deletion_status = "CANCELED";
  assert.equal(
    adminFormalUserQuery.queryByPhone(input, { phone: "13800138000" }).user.accountStatus,
    "ACTIVE"
  );
});
