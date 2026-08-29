const ADMIN_CAPABILITIES = {
  ADMIN_READ: "ADMIN_READ",
  AUDIT_READ: "AUDIT_READ",
  CONFIG_WRITE: "CONFIG_WRITE",
  RUNTIME_CYCLE_EXECUTE: "RUNTIME_CYCLE_EXECUTE",
  ACTIVITY_CONTENT_WRITE: "ACTIVITY_CONTENT_WRITE",
  ACTIVITY_PUBLISH: "ACTIVITY_PUBLISH",
  ACTIVITY_ENROLLMENT_REVIEW: "ACTIVITY_ENROLLMENT_REVIEW",
  ACTIVITY_SESSION_CONTROL: "ACTIVITY_SESSION_CONTROL",
  HEALTH_CONTENT_WRITE: "HEALTH_CONTENT_WRITE",
  HEALTH_PUBLISH: "HEALTH_PUBLISH",
  CONTENT_WRITE: "CONTENT_WRITE",
  CONTENT_PUBLISH: "CONTENT_PUBLISH",
  CHANNEL_MANAGE: "CHANNEL_MANAGE",
  CHANNEL_ANALYTICS_READ: "CHANNEL_ANALYTICS_READ",
};

const ROLE_CAPABILITIES = {
  admin: new Set(Object.values(ADMIN_CAPABILITIES)),
  job: new Set([
    ADMIN_CAPABILITIES.ADMIN_READ,
    ADMIN_CAPABILITIES.CONFIG_WRITE,
    ADMIN_CAPABILITIES.RUNTIME_CYCLE_EXECUTE,
    ADMIN_CAPABILITIES.ACTIVITY_ENROLLMENT_REVIEW,
  ]),
  operator: new Set([
    ADMIN_CAPABILITIES.ADMIN_READ,
    ADMIN_CAPABILITIES.AUDIT_READ,
    ADMIN_CAPABILITIES.CONFIG_WRITE,
    ADMIN_CAPABILITIES.ACTIVITY_CONTENT_WRITE,
    ADMIN_CAPABILITIES.ACTIVITY_ENROLLMENT_REVIEW,
    ADMIN_CAPABILITIES.ACTIVITY_SESSION_CONTROL,
    ADMIN_CAPABILITIES.HEALTH_CONTENT_WRITE,
    ADMIN_CAPABILITIES.CONTENT_WRITE,
    ADMIN_CAPABILITIES.CONTENT_PUBLISH,
    ADMIN_CAPABILITIES.CHANNEL_MANAGE,
    ADMIN_CAPABILITIES.CHANNEL_ANALYTICS_READ,
  ]),
  viewer: new Set([
    ADMIN_CAPABILITIES.ADMIN_READ,
    ADMIN_CAPABILITIES.AUDIT_READ,
    ADMIN_CAPABILITIES.CHANNEL_ANALYTICS_READ,
  ]),
};

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

module.exports = {
  ADMIN_CAPABILITIES,
  capabilityListForRole,
  capabilitiesForRole,
  hasAdminCapability,
  normalizeRole,
  requireAdminCapability,
};
