const { normalizeRole } = require("./adminAccessControl");

const EXPORT_SENSITIVITY = {
  MASKED: "MASKED",
  RAW: "RAW",
};

const SENSITIVE_FIELDS = ["phone", "verified_phone", "unionid", "openid_list"];

function text(value) {
  return String(value || "").trim();
}

function normalizeSensitivity(value) {
  const normalized = text(value).toUpperCase();
  return normalized === EXPORT_SENSITIVITY.RAW ? EXPORT_SENSITIVITY.RAW : EXPORT_SENSITIVITY.MASKED;
}

function requestedSensitivity(input = {}) {
  return normalizeSensitivity(
    input.sensitivity ||
      input.sensitivityMode ||
      input.sensitivity_mode ||
      input.fieldSensitivity ||
      input.field_sensitivity ||
      input.exportSensitivity ||
      input.export_sensitivity,
  );
}

function rawAllowed(context = {}) {
  const principal = context.adminPrincipal || context.principal || null;
  if (!principal) return false;
  if (principal.tokenConfigured === false) return true;
  return normalizeRole(principal.role) === "admin";
}

function resolveLifecycleExportPolicy(input = {}, context = {}) {
  const requested = requestedSensitivity(input);
  const canUseRaw = rawAllowed(context);
  const sensitivity = requested === EXPORT_SENSITIVITY.RAW && canUseRaw
    ? EXPORT_SENSITIVITY.RAW
    : EXPORT_SENSITIVITY.MASKED;
  return {
    sensitivity,
    requestedSensitivity: requested,
    rawAllowed: canUseRaw,
    masked: sensitivity !== EXPORT_SENSITIVITY.RAW,
    downgraded: requested === EXPORT_SENSITIVITY.RAW && sensitivity !== EXPORT_SENSITIVITY.RAW,
    sensitiveFields: SENSITIVE_FIELDS.slice(),
  };
}

function maskPhone(value) {
  const raw = text(value);
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 7) return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
  if (raw.length <= 4) return "***";
  return `${raw.slice(0, 2)}***${raw.slice(-2)}`;
}

function maskIdentifier(value) {
  const raw = text(value);
  if (!raw) return "";
  if (raw.length <= 8) return `${raw.slice(0, 1)}***${raw.slice(-1)}`;
  return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
}

function maskOpenidEntry(value) {
  const raw = text(value);
  if (!raw) return "";
  const index = raw.indexOf(":");
  if (index < 0) return maskIdentifier(raw);
  const appCode = raw.slice(0, index);
  const openid = raw.slice(index + 1);
  return `${appCode}:${maskIdentifier(openid)}`;
}

function applyLifecycleRowExportPolicy(row, policy = {}) {
  if (!policy.masked) return row;
  return {
    ...row,
    phone: maskPhone(row.phone),
    verifiedPhone: maskPhone(row.verifiedPhone),
    unionid: maskIdentifier(row.unionid),
    openidList: Array.isArray(row.openidList) ? row.openidList.map(maskOpenidEntry) : [],
  };
}

module.exports = {
  EXPORT_SENSITIVITY,
  SENSITIVE_FIELDS,
  applyLifecycleRowExportPolicy,
  maskIdentifier,
  maskOpenidEntry,
  maskPhone,
  normalizeSensitivity,
  requestedSensitivity,
  resolveLifecycleExportPolicy,
};
