const { getToken, request } = require("./request");

const FORMAL_ACCESS_STATE = Object.freeze({
  PHONE_REQUIRED: "PHONE_REQUIRED",
  PROFILE_REQUIRED: "PROFILE_REQUIRED",
  READY: "READY",
});

function classifyFormalProfile(profile) {
  if (!profile || profile.phoneVerified !== true) return FORMAL_ACCESS_STATE.PHONE_REQUIRED;
  if (profile.complete !== true) return FORMAL_ACCESS_STATE.PROFILE_REQUIRED;
  return FORMAL_ACCESS_STATE.READY;
}

async function inspectFormalAccess(scope = "formal-access") {
  if (!getToken()) {
    return { state: FORMAL_ACCESS_STATE.PHONE_REQUIRED, profile: null };
  }
  const data = await request({
    url: "/api/v1/user/formal-profile",
    method: "GET",
    scope,
  });
  const profile = data && data.profile || null;
  return { state: classifyFormalProfile(profile), profile };
}

function loginRoute(intent = "") {
  const target = String(intent || "").trim();
  return target
    ? `/pages/login/index?intent=${encodeURIComponent(target)}`
    : "/pages/login/index";
}

module.exports = {
  FORMAL_ACCESS_STATE,
  classifyFormalProfile,
  inspectFormalAccess,
  loginRoute,
};
