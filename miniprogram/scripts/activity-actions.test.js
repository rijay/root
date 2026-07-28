const assert = require("node:assert/strict");
const {
  ROUTE_INTENT_STORAGE_KEY,
  activityLoginRecoveryUrl,
  commandReachedAuthorityState,
  createActivityLoginRouteIntent,
  createActivityCommand,
  createMemberSupportRouteIntent,
  createMyEnrollmentsLoginRouteIntent,
  deriveActivityAction,
  presentActivityWriteError,
  readActivityLoginRouteIntent,
} = require("../utils/activity-actions");

const base = {
  sessionId: "session_001",
  listingState: "AVAILABLE",
  visibility: "PUBLIC",
  approvalMode: "AUTO",
  allowReapply: false,
  enrollment: null,
};

assert.equal(deriveActivityAction(base, { authenticated: false }).kind, "LOGIN");
assert.equal(deriveActivityAction({ ...base, visibility: "MEMBER" }, { authenticated: false }).label, "登录并确认会员资格");
assert.equal(deriveActivityAction(base, { authenticated: true }).kind, "ENROLL");
assert.match(deriveActivityAction({ ...base, approvalMode: "MANUAL" }, { authenticated: true }).confirmLabel, /提交/);
assert.equal(deriveActivityAction({ ...base, enrollment: { status: "PENDING" }, cancelAllowed: true }, { authenticated: true }).kind, "CANCEL");
assert.equal(deriveActivityAction({ ...base, listingState: "FULL", enrollment: { status: "CONFIRMED" }, cancelAllowed: true }, { authenticated: true }).kind, "CANCEL");
assert.equal(deriveActivityAction({ ...base, listingState: "CLOSED", enrollment: { status: "CONFIRMED" }, cancelAllowed: true }, { authenticated: true }).kind, "CANCEL");
assert.equal(deriveActivityAction({ ...base, enrollment: { status: "CONFIRMED" }, cancelAllowed: false, cancelReasonCode: "CUTOFF_PASSED" }, { authenticated: true }).reasonCode, "CUTOFF_PASSED");
assert.equal(deriveActivityAction({ ...base, listingState: "ENDED", enrollment: { status: "CONFIRMED" } }, { authenticated: true }).kind, "NONE");
assert.equal(deriveActivityAction({ ...base, enrollment: { status: "CANCELED" }, allowReapply: true }, { authenticated: true }).label, "再次报名");
assert.equal(deriveActivityAction({ ...base, enrollment: { status: "REJECTED" } }, { authenticated: true }).reasonCode, "REAPPLY_NOT_ALLOWED");

const command = createActivityCommand("ENROLL", base.sessionId, 1720000000000, "abc123");
assert.equal(command.kind, "ENROLL");
assert.match(command.idempotencyKey, /^ACTIVITY_INTENT_ENROLL_/);
assert.equal(Object.prototype.hasOwnProperty.call(command, "requestId"), false);
assert.equal(commandReachedAuthorityState(command, { ...base, enrollment: { status: "PENDING" } }), true);
assert.equal(commandReachedAuthorityState(command, { ...base, enrollment: null }), false);
assert.equal(commandReachedAuthorityState({ ...command, kind: "CANCEL" }, { ...base, enrollment: { status: "CANCELED" } }), true);

const intent = createMemberSupportRouteIntent(base, 1720000000000);
assert.equal(ROUTE_INTENT_STORAGE_KEY, "MYROOT_ACTIVITY_ROUTE_INTENT_V1");
assert.deepEqual(Object.keys(intent), ["version", "routeId", "sourceAction", "sessionId", "createdAt", "expiresAt"]);
assert.equal(intent.expiresAt - intent.createdAt, 15 * 60 * 1000);
assert.throws(() => createMemberSupportRouteIntent({ sessionId: "https://bad.example" }, 1), /ACTIVITY_ROUTE_INTENT_INVALID/);
const loginIntent = createActivityLoginRouteIntent(base, 1720000000000);
assert.equal(readActivityLoginRouteIntent(loginIntent, 1720000000001).sessionId, base.sessionId);
assert.match(activityLoginRecoveryUrl(loginIntent, 1720000000001), /session_001/);
assert.equal(readActivityLoginRouteIntent({ ...loginIntent, sessionId: "https://bad.example" }, 1720000000001), null);
assert.equal(readActivityLoginRouteIntent(loginIntent, loginIntent.expiresAt), null);
assert.equal(readActivityLoginRouteIntent(intent, 1720000000001), null);
const myEnrollmentsIntent = createMyEnrollmentsLoginRouteIntent(1720000000000);
assert.deepEqual(Object.keys(myEnrollmentsIntent), ["version", "routeId", "sourceAction", "createdAt", "expiresAt"]);
assert.equal(readActivityLoginRouteIntent(myEnrollmentsIntent, 1720000000001).routeId, "MY_ENROLLMENTS");
assert.equal(
  activityLoginRecoveryUrl(myEnrollmentsIntent, 1720000000001),
  "/subpkg/activity/pages/enrollments/index?source=login_recovery",
);
assert.equal(readActivityLoginRouteIntent({ ...myEnrollmentsIntent, sessionId: "session_001" }, 1720000000001), null);
assert.throws(() => createMyEnrollmentsLoginRouteIntent(0), /ACTIVITY_ROUTE_INTENT_INVALID/);
assert.equal(presentActivityWriteError({ code: "ACTIVE_MEMBERSHIP_REQUIRED" }).kind, "MEMBERSHIP_SUPPORT");
assert.equal(presentActivityWriteError({ code: "NETWORK_ERROR" }).kind, "UNKNOWN");

console.log("activity action tests ok");
