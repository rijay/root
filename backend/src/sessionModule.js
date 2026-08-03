const profileModule = require("./profileModule");

const LOGIN_OUTCOMES = Object.freeze({
  REGISTERED: "REGISTERED",
  PROFILE_REQUIRED: "PROFILE_REQUIRED",
  NEW_USER: "NEW_USER",
  IDENTITY_CONFLICT: "IDENTITY_CONFLICT",
});

const IDENTITY_CONFLICT_CODES = new Set([
  "WECHAT_APP_OPENID_AMBIGUOUS",
  "WECHAT_UNIONID_BINDING_AMBIGUOUS",
  "WECHAT_IDENTITY_BINDING_CONFLICT",
]);

function classify({ data, user, created = false } = {}) {
  if (profileModule.isComplete(data, user)) return LOGIN_OUTCOMES.REGISTERED;
  return created ? LOGIN_OUTCOMES.NEW_USER : LOGIN_OUTCOMES.PROFILE_REQUIRED;
}

function nextRoute(outcome) {
  return [LOGIN_OUTCOMES.NEW_USER, LOGIN_OUTCOMES.PROFILE_REQUIRED].includes(outcome)
    ? "/pages/register/index"
    : "/pages/home/index";
}

function present({ data, user, created = false } = {}) {
  const sessionOutcome = classify({ data, user, created });
  return {
    sessionOutcome,
    nextRoute: nextRoute(sessionOutcome),
    profile: profileModule.read(data, user).profile,
  };
}

function fromIdentityError(error) {
  if (!error || !IDENTITY_CONFLICT_CODES.has(error.code)) return null;
  return {
    sessionOutcome: LOGIN_OUTCOMES.IDENTITY_CONFLICT,
    token: "",
    nextRoute: "/pages/home/index",
    message: "资料核验中",
  };
}

module.exports = {
  IDENTITY_CONFLICT_CODES,
  LOGIN_OUTCOMES,
  classify,
  fromIdentityError,
  nextRoute,
  present,
};
