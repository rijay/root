const ADMIN_CAPABILITIES = {
  ADMIN_READ: "ADMIN_READ",
  AUDIT_READ: "AUDIT_READ",
  CONFIG_WRITE: "CONFIG_WRITE",
  REVIEW_RESOLVE: "REVIEW_RESOLVE",
  REFUND_APPROVE: "REFUND_APPROVE",
  COUPON_USE: "COUPON_USE",
  REWARD_DELIVERY_WRITE: "REWARD_DELIVERY_WRITE",
  SETTLEMENT_EXECUTE: "SETTLEMENT_EXECUTE",
  DATA_EXPORT_APPROVE: "DATA_EXPORT_APPROVE",
  RUNTIME_CYCLE_EXECUTE: "RUNTIME_CYCLE_EXECUTE",
  ACTIVITY_CONTENT_WRITE: "ACTIVITY_CONTENT_WRITE",
  ACTIVITY_PUBLISH: "ACTIVITY_PUBLISH",
  ACTIVITY_ENROLLMENT_REVIEW: "ACTIVITY_ENROLLMENT_REVIEW",
  ACTIVITY_SESSION_CONTROL: "ACTIVITY_SESSION_CONTROL",
  HEALTH_CONTENT_WRITE: "HEALTH_CONTENT_WRITE",
  HEALTH_PUBLISH: "HEALTH_PUBLISH",
};

const ROLE_CAPABILITIES = {
  admin: new Set(Object.values(ADMIN_CAPABILITIES)),
  job: new Set([
    ADMIN_CAPABILITIES.ADMIN_READ,
    ADMIN_CAPABILITIES.CONFIG_WRITE,
    ADMIN_CAPABILITIES.SETTLEMENT_EXECUTE,
    ADMIN_CAPABILITIES.DATA_EXPORT_APPROVE,
    ADMIN_CAPABILITIES.RUNTIME_CYCLE_EXECUTE,
    ADMIN_CAPABILITIES.ACTIVITY_ENROLLMENT_REVIEW,
  ]),
  operator: new Set([
    ADMIN_CAPABILITIES.ADMIN_READ,
    ADMIN_CAPABILITIES.AUDIT_READ,
    ADMIN_CAPABILITIES.CONFIG_WRITE,
    ADMIN_CAPABILITIES.REVIEW_RESOLVE,
    ADMIN_CAPABILITIES.COUPON_USE,
    ADMIN_CAPABILITIES.REWARD_DELIVERY_WRITE,
    ADMIN_CAPABILITIES.SETTLEMENT_EXECUTE,
    ADMIN_CAPABILITIES.ACTIVITY_CONTENT_WRITE,
    ADMIN_CAPABILITIES.ACTIVITY_ENROLLMENT_REVIEW,
    ADMIN_CAPABILITIES.ACTIVITY_SESSION_CONTROL,
    ADMIN_CAPABILITIES.HEALTH_CONTENT_WRITE,
  ]),
  finance: new Set([
    ADMIN_CAPABILITIES.ADMIN_READ,
    ADMIN_CAPABILITIES.AUDIT_READ,
    ADMIN_CAPABILITIES.REVIEW_RESOLVE,
    ADMIN_CAPABILITIES.REFUND_APPROVE,
    ADMIN_CAPABILITIES.COUPON_USE,
    ADMIN_CAPABILITIES.REWARD_DELIVERY_WRITE,
    ADMIN_CAPABILITIES.SETTLEMENT_EXECUTE,
    ADMIN_CAPABILITIES.DATA_EXPORT_APPROVE,
  ]),
  viewer: new Set([
    ADMIN_CAPABILITIES.ADMIN_READ,
    ADMIN_CAPABILITIES.AUDIT_READ,
  ]),
};

const ADMIN_COMMANDS = Object.freeze({
  TASK_COMPLETE: "TASK_COMPLETE",
  TASK_RESOLVE: "TASK_RESOLVE",
  REFUND_APPROVE: "REFUND_APPROVE",
  COUPON_USE: "COUPON_USE",
});

const ADMIN_COMMAND_CAPABILITIES = Object.freeze({
  [ADMIN_COMMANDS.TASK_COMPLETE]: ADMIN_CAPABILITIES.REVIEW_RESOLVE,
  [ADMIN_COMMANDS.TASK_RESOLVE]: ADMIN_CAPABILITIES.REVIEW_RESOLVE,
  [ADMIN_COMMANDS.REFUND_APPROVE]: ADMIN_CAPABILITIES.REFUND_APPROVE,
  [ADMIN_COMMANDS.COUPON_USE]: ADMIN_CAPABILITIES.COUPON_USE,
});

function businessError(code, message, status = 200) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function normalizeRole(role) {
  const text = String(role || "viewer").trim().toLowerCase();
  return ROLE_CAPABILITIES[text] ? text : "viewer";
}

function capabilitiesForRole(role) {
  return ROLE_CAPABILITIES[normalizeRole(role)] || ROLE_CAPABILITIES.viewer;
}

function capabilityListForRole(role) {
  return Array.from(capabilitiesForRole(role));
}

function hasAdminCapability(principal, capability) {
  if (!principal) return false;
  if (principal.tokenConfigured === false) return true;
  return capabilitiesForRole(principal.role).has(capability);
}

function requireAdminCapability(principal, capability) {
  if (hasAdminCapability(principal, capability)) return true;
  throw businessError(40301, "当前后台角色无权执行该操作", 403);
}

function capabilityForAdminCommand(command) {
  return ADMIN_COMMAND_CAPABILITIES[String(command || "").trim()] || "";
}

function requireAdminCommandCapability(principal, command) {
  const capability = capabilityForAdminCommand(command);
  if (!capability) throw businessError(40301, "后台命令未登记授权能力", 403);
  return requireAdminCapability(principal, capability);
}

module.exports = {
  ADMIN_COMMANDS,
  ADMIN_CAPABILITIES,
  capabilityForAdminCommand,
  capabilityListForRole,
  capabilitiesForRole,
  hasAdminCapability,
  normalizeRole,
  requireAdminCapability,
  requireAdminCommandCapability,
};
