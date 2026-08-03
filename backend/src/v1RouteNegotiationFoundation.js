const path = require("node:path");

const { loadAndValidateRegistry } = require("../../scripts/lib/route-registry");

const ENABLE_FLAG = "MYROOT_V1_ROUTE_NEGOTIATION_ENABLED";
const V1_CLIENT_VERSION = "1.0.0";
const LEGACY_CLIENT_VERSION = "0.5.13";
const HOME_ROUTE_ID = "HOME";
const OPTION_KEYS = Object.freeze(["env"]);
const RESOLVE_KEYS = Object.freeze(["clientVersion", "parameters", "routeId"]);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const REGISTRY_PATH = path.join(
  PROJECT_ROOT,
  "contracts",
  "route-registry",
  "v1.0.0-draft.8.json"
);
const APP_JSON_PATH = path.join(
  PROJECT_ROOT,
  "miniprogram",
  "fixtures",
  "miniprogram-app-v1-pre-formal-rebuild.json",
);

function routeError(code) {
  const error = new Error("v1 route negotiation operation failed");
  error.code = code;
  return error;
}

function configurationError() {
  return routeError("V1_ROUTE_NEGOTIATION_CONFIGURATION_INVALID");
}

function inputError() {
  return routeError("V1_ROUTE_NEGOTIATION_INPUT_INVALID");
}

function disabledError() {
  return routeError("V1_ROUTE_NEGOTIATION_DISABLED");
}

function contractError() {
  return routeError("V1_ROUTE_NEGOTIATION_CONTRACT_INVALID");
}

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  if (!plainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function safeRouteId(value) {
  return typeof value === "string"
    && /^[A-Z][A-Z0-9_]*$/.test(value)
    && value.length <= 64;
}

function safeClientVersion(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 32
    && value === value.trim()
    && /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(value);
}

function safeParameterValue(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 256
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function freezeResult(value) {
  Object.freeze(value.parameters);
  return Object.freeze(value);
}

function createV1RouteNegotiationFoundation(options = {}) {
  if (!exactKeys(options, Object.keys(options).length === 0 ? [] : OPTION_KEYS)) {
    throw configurationError();
  }
  const env = options.env === undefined ? process.env : options.env;
  if (!plainRecord(env)) throw configurationError();

  let registry;
  try {
    registry = loadAndValidateRegistry(REGISTRY_PATH, { appJsonPath: APP_JSON_PATH });
  } catch {
    throw contractError();
  }
  if (registry.status !== "NON_RUNTIME_FOUNDATION_CONTRACT"
    || registry.registryVersion !== "1.0.0-draft.8"
    || registry.routes.length !== 47
    || !/^[a-f0-9]{64}$/.test(registry.digest)) throw contractError();

  const routeById = new Map(registry.routes.map((route) => [route.routeId, route]));
  const legacyRegisteredPaths = new Set(registry.legacyRegisteredPaths);
  const enabled = env[ENABLE_FLAG] === "true";

  function assertReady() {
    if (!enabled) throw disabledError();
    return Object.freeze({
      enabled: true,
      registryVersion: registry.registryVersion,
      registryDigest: registry.digest,
      supportedClientVersions: Object.freeze([LEGACY_CLIENT_VERSION, V1_CLIENT_VERSION]),
      runtimeIntegrated: false,
    });
  }

  function safeHome(reason) {
    const home = routeById.get(HOME_ROUTE_ID);
    if (!home || !legacyRegisteredPaths.has(home.canonicalPath)) throw contractError();
    return freezeResult({
      requestedRouteId: HOME_ROUTE_ID,
      resolvedRouteId: HOME_ROUTE_ID,
      canonicalPath: home.canonicalPath,
      navigationMode: "SWITCH_TAB",
      compatibilityMode: "SAFE_HOME",
      parameters: {},
      writeReplay: "DENY",
      reason,
      registryDigest: registry.digest,
    });
  }

  function sanitizeParameters(parameters, route) {
    if (!plainRecord(parameters)) throw inputError();
    const allowed = new Set(route.parameterAllowlist);
    const sanitized = {};
    for (const key of Object.keys(parameters).sort()) {
      if (!allowed.has(key)) continue;
      if (!safeParameterValue(parameters[key])) throw inputError();
      sanitized[key] = parameters[key];
    }
    return sanitized;
  }

  function resolve(input) {
    assertReady();
    if (!exactKeys(input, RESOLVE_KEYS)
      || !safeRouteId(input.routeId)
      || !safeClientVersion(input.clientVersion)) throw inputError();
    const requested = routeById.get(input.routeId);
    if (!requested) return safeHome("UNKNOWN_ROUTE");
    if (input.clientVersion !== V1_CLIENT_VERSION
      && input.clientVersion !== LEGACY_CLIENT_VERSION) {
      return safeHome("UNKNOWN_CLIENT_VERSION");
    }

    const compatibilityMode = input.clientVersion === V1_CLIENT_VERSION
      ? "V1_CANONICAL"
      : "LEGACY_0_5";
    const targetId = compatibilityMode === "V1_CANONICAL"
      ? requested.routeId
      : requested.legacyFallbackRouteId;
    const resolved = routeById.get(targetId === "SELF" ? requested.routeId : targetId);
    if (!resolved) throw contractError();
    if (compatibilityMode === "LEGACY_0_5"
      && !legacyRegisteredPaths.has(resolved.canonicalPath)) throw contractError();
    const parameters = sanitizeParameters(input.parameters, resolved);
    return freezeResult({
      requestedRouteId: requested.routeId,
      resolvedRouteId: resolved.routeId,
      canonicalPath: resolved.canonicalPath,
      navigationMode: resolved.isTab ? "SWITCH_TAB" : "REDIRECT",
      compatibilityMode,
      parameters,
      writeReplay: "DENY",
      reason: "RESOLVED",
      registryDigest: registry.digest,
    });
  }

  return Object.freeze({ assertReady, resolve });
}

module.exports = {
  createV1RouteNegotiationFoundation,
};
