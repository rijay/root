const test = require("node:test");
const assert = require("node:assert/strict");

const { createSeedData } = require("../src/seed");
const profileModule = require("../src/profileModule");

function fixture() {
  const data = createSeedData();
  const user = {
    user_id: "usr_formal_profile",
    root_user_id: "usr_formal_profile",
    phone: "13800138000",
    nickname: "ROOT体验官",
    avatar_url: "",
    state: "UNREGISTERED",
    created_at: "2026-08-03T00:00:00.000Z",
    registered_at: "",
  };
  data.users.push(user);
  return { data, user };
}

test("formal profile defaults hide raw phone and use Root user fallback", () => {
  const { data, user } = fixture();
  const result = profileModule.read(data, user);
  assert.equal(result.profile.nickname, "Root用户");
  assert.equal(result.profile.phone, "138****8000");
  assert.equal(result.profile.complete, false);
  assert.equal(result.profile.phoneVerified, true);
});

test("formal profile requires verified phone, birthday and gender", () => {
  const { data, user } = fixture();
  assert.throws(
    () => profileModule.save(data, user, { birthDate: "", gender: "" }),
    (error) => error.code === "PROFILE_REQUIRED_FIELDS_MISSING",
  );
  user.phone = "";
  assert.throws(
    () => profileModule.save(data, user, { birthDate: "1990-01-01", gender: "FEMALE" }),
    (error) => error.code === "PROFILE_VERIFIED_PHONE_REQUIRED",
  );
});

test("formal profile rejects future birthday and unsupported gender", () => {
  const { data, user } = fixture();
  assert.throws(
    () => profileModule.save(data, user, { birthDate: "2999-01-01", gender: "FEMALE" }),
    (error) => error.code === "PROFILE_BIRTH_DATE_INVALID",
  );
  assert.throws(
    () => profileModule.save(data, user, { birthDate: "1990-01-01", gender: "UNKNOWN" }),
    (error) => error.code === "PROFILE_GENDER_INVALID",
  );
});

test("formal profile completion is idempotent for the same user", () => {
  const { data, user } = fixture();
  const first = profileModule.save(data, user, {
    nickname: "小根",
    birthDate: "1990-01-01",
    gender: "FEMALE",
  });
  const second = profileModule.save(data, user, {
    nickname: "小根",
    birthDate: "1990-01-01",
    gender: "FEMALE",
  });
  assert.equal(first.profile.profileId, second.profile.profileId);
  assert.equal(data.formalProfiles.length, 1);
  assert.equal(user.state, "REGISTERED_IDLE");
  assert.equal(user.nickname, "小根");
  assert.equal(second.profile.complete, true);
});
