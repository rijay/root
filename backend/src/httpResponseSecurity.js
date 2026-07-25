const CORS_ALLOWLIST_ENV = "ROOT_CORS_ALLOWED_ORIGINS_JSON";
const MAX_ALLOWED_ORIGINS = 16;

const BASE_HEADERS = Object.freeze({
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});

const PREFLIGHT_HEADERS = Object.freeze({
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Request-Id,X-Idempotency-Key,X-Admin-Token,X-ROOT-APP-CODE",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Max-Age": "600",
});

function configurationError() {
  const error = new Error("HTTP response security configuration is invalid");
  error.code = "HTTP_RESPONSE_SECURITY_CONFIGURATION_INVALID";
  return error;
}

function parseOrigin(value) {
  if (typeof value !== "string"
    || !value
    || value !== value.trim()
    || value.length > 2048
    || value === "null"
    || value === "*") throw configurationError();
  let url;
  try {
    url = new URL(value);
  } catch {
    throw configurationError();
  }
  const localHttp = url.protocol === "http:"
    && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !localHttp)
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
    || url.origin !== value) throw configurationError();
  return value;
}

function parseAllowedOrigins(env = {}) {
  const raw = env && Object.prototype.hasOwnProperty.call(env, CORS_ALLOWLIST_ENV)
    ? env[CORS_ALLOWLIST_ENV]
    : "";
  if (raw === undefined || raw === null || raw === "") return Object.freeze([]);
  if (typeof raw !== "string") throw configurationError();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw configurationError();
  }
  if (!Array.isArray(parsed)
    || parsed.length > MAX_ALLOWED_ORIGINS
    || parsed.some((origin) => typeof origin !== "string")) throw configurationError();
  const origins = parsed.map(parseOrigin);
  if (new Set(origins).size !== origins.length) throw configurationError();
  return Object.freeze(origins);
}

function createHttpResponseSecurityPolicy(env = {}) {
  const allowedOrigins = new Set(parseAllowedOrigins(env));

  function headersFor(req = {}) {
    const headers = { ...BASE_HEADERS };
    const origin = String(req && req.headers && req.headers.origin || "").trim();
    if (origin) headers.Vary = "Origin";
    if (origin && allowedOrigins.has(origin)) {
      headers["Access-Control-Allow-Origin"] = origin;
      if (String(req.method || "GET").toUpperCase() === "OPTIONS") {
        Object.assign(headers, PREFLIGHT_HEADERS);
      }
    }
    return Object.freeze(headers);
  }

  return Object.freeze({ headersFor });
}

module.exports = Object.freeze({
  createHttpResponseSecurityPolicy,
});
