const crypto = require("node:crypto");
const { runtimeMode } = require("./runtimePersistenceGuard");

const JOB_ROUTE_PREFIX = "/api/v1/jobs/";
const SCOPED_JOB_TOKENS_ENV = "ROOT_ADMIN_JOB_ROUTE_TOKENS";
const REQUIRE_SCOPED_JOB_TOKENS_ENV = "ROOT_REQUIRE_SCOPED_JOB_TOKENS";
const MAX_CONFIG_BYTES = 64 * 1024;
const MAX_ROUTES = 64;
const MAX_TOKENS_PER_ROUTE = 16;

function exactBooleanEnv(env, name, fallback = false) {
  const value = env && Object.prototype.hasOwnProperty.call(env, name) ? env[name] : "";
  if (value === "" || value === undefined || value === null) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be the exact string true or false`);
}

function exactJobRoute(value) {
  const route = String(value || "");
  return route.startsWith(JOB_ROUTE_PREFIX)
    && /^\/api\/v1\/jobs\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(route);
}

function validToken(value) {
  return typeof value === "string"
    && value.length >= 16
    && value.length <= 4096
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function tokenFromEntry(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) return value.token;
  return "";
}

function parseScopedJobRouteTokens(env = process.env) {
  const raw = env && Object.prototype.hasOwnProperty.call(env, SCOPED_JOB_TOKENS_ENV)
    ? env[SCOPED_JOB_TOKENS_ENV]
    : "";
  if (raw === "" || raw === undefined || raw === null) {
    return Object.freeze({ configured: false, routes: Object.freeze({}) });
  }
  if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > MAX_CONFIG_BYTES) {
    throw new Error(`${SCOPED_JOB_TOKENS_ENV} is invalid`);
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    throw new Error(`${SCOPED_JOB_TOKENS_ENV} must be valid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${SCOPED_JOB_TOKENS_ENV} must be a JSON object keyed by exact Job route`);
  }
  const entries = Object.entries(parsed);
  if (entries.length < 1 || entries.length > MAX_ROUTES) {
    throw new Error(`${SCOPED_JOB_TOKENS_ENV} must contain between 1 and ${MAX_ROUTES} routes`);
  }
  const tokenOwners = new Map();
  const routes = {};
  for (const [route, rotation] of entries) {
    if (!exactJobRoute(route)) {
      throw new Error(`${SCOPED_JOB_TOKENS_ENV} contains an invalid exact Job route`);
    }
    if (!Array.isArray(rotation) || rotation.length < 1 || rotation.length > MAX_TOKENS_PER_ROUTE) {
      throw new Error(`${SCOPED_JOB_TOKENS_ENV} route rotations must contain between 1 and ${MAX_TOKENS_PER_ROUTE} tokens`);
    }
    const tokens = [];
    for (const item of rotation) {
      const token = tokenFromEntry(item);
      if (!validToken(token)) {
        throw new Error(`${SCOPED_JOB_TOKENS_ENV} contains an invalid token`);
      }
      const owner = tokenOwners.get(token);
      if (owner && owner !== route) {
        throw new Error(`${SCOPED_JOB_TOKENS_ENV} cannot reuse one token across Job routes`);
      }
      tokenOwners.set(token, route);
      if (!tokens.includes(token)) tokens.push(token);
    }
    routes[route] = Object.freeze(tokens);
  }
  return Object.freeze({ configured: true, routes: Object.freeze(routes) });
}

function parseLegacyJobTokens(env = process.env) {
  const tokens = [];
  if (env && env.ROOT_ADMIN_JOB_TOKENS) {
    try {
      const parsed = JSON.parse(env.ROOT_ADMIN_JOB_TOKENS);
      const entries = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object"
          ? Object.values(parsed)
          : [];
      for (const item of entries) {
        const token = tokenFromEntry(item);
        if (typeof token === "string" && token.trim()) tokens.push(token);
      }
    } catch {
      // Preserve the controlled legacy fallback to ROOT_ADMIN_JOB_TOKEN.
    }
  }
  if (env && env.ROOT_ADMIN_JOB_TOKEN) tokens.push(String(env.ROOT_ADMIN_JOB_TOKEN));
  return Object.freeze([...new Set(tokens.filter((token) => token.trim()))]);
}

function resolveJobRouteTokenCandidates(env = process.env, pathname = "") {
  const route = String(pathname || "");
  if (!exactJobRoute(route)) {
    return Object.freeze({ candidates: Object.freeze([]), failClosed: true, mode: "INVALID_ROUTE", route });
  }
  let requireScoped;
  let scoped;
  try {
    const protectedRuntime = !["local", "test"].includes(runtimeMode(env));
    const configuredRequirement = exactBooleanEnv(
      env,
      REQUIRE_SCOPED_JOB_TOKENS_ENV,
      protectedRuntime
    );
    if (protectedRuntime && configuredRequirement !== true) {
      return Object.freeze({ candidates: Object.freeze([]), failClosed: true, mode: "INVALID_CONFIG", route });
    }
    requireScoped = protectedRuntime || configuredRequirement;
    scoped = parseScopedJobRouteTokens(env);
  } catch {
    return Object.freeze({ candidates: Object.freeze([]), failClosed: true, mode: "INVALID_CONFIG", route });
  }
  const candidates = scoped.routes[route] || Object.freeze([]);
  if (candidates.length) {
    return Object.freeze({ candidates, failClosed: requireScoped, mode: "SCOPED", route });
  }
  if (requireScoped) {
    return Object.freeze({ candidates: Object.freeze([]), failClosed: true, mode: "SCOPED_REQUIRED", route });
  }
  return Object.freeze({
    candidates: parseLegacyJobTokens(env),
    failClosed: false,
    mode: scoped.configured ? "LEGACY_ROUTE_FALLBACK" : "LEGACY",
    route,
  });
}

function assertProtectedJobRouteTokenPolicy(env = process.env) {
  const mode = runtimeMode(env);
  if (["local", "test"].includes(mode)) {
    return Object.freeze({ ready: true, runtimeMode: mode, strict: false, routeCount: 0 });
  }
  let strict;
  let scoped;
  try {
    strict = exactBooleanEnv(env, REQUIRE_SCOPED_JOB_TOKENS_ENV, true);
    scoped = parseScopedJobRouteTokens(env);
  } catch {
    strict = false;
    scoped = Object.freeze({ configured: false, routes: Object.freeze({}) });
  }
  if (strict !== true || !scoped.configured || Object.keys(scoped.routes).length < 1) {
    const error = new Error("Protected runtime requires exact-route Job token rotations");
    error.code = "PROTECTED_JOB_ROUTE_TOKEN_POLICY_REQUIRED";
    throw error;
  }
  return Object.freeze({
    ready: true,
    runtimeMode: mode,
    strict: true,
    routeCount: Object.keys(scoped.routes).length,
  });
}

function secureTokenEqual(candidate, provided) {
  if (!candidate || !provided) return false;
  const left = crypto.createHash("sha256").update(String(candidate)).digest();
  const right = crypto.createHash("sha256").update(String(provided)).digest();
  return crypto.timingSafeEqual(left, right);
}

function authenticateJobRouteToken(env, pathname, providedToken) {
  const resolution = resolveJobRouteTokenCandidates(env, pathname);
  const matched = resolution.candidates.some((candidate) => secureTokenEqual(candidate, providedToken));
  return Object.freeze({ ...resolution, matched });
}

module.exports = {
  JOB_ROUTE_PREFIX,
  REQUIRE_SCOPED_JOB_TOKENS_ENV,
  SCOPED_JOB_TOKENS_ENV,
  assertProtectedJobRouteTokenPolicy,
  authenticateJobRouteToken,
  exactBooleanEnv,
  exactJobRoute,
  parseLegacyJobTokens,
  parseScopedJobRouteTokens,
  resolveJobRouteTokenCandidates,
};
