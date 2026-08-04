const https = require("node:https");
const { version: RELEASE_VERSION } = require("./package.json");

const DEFAULT_BASE_URL = "https://myroot-api-273748-8-1437260454.sh.run.tcloudbase.com";
const JOBS = Object.freeze({
  health_data_retention_cleanup: {
    path: "/api/v1/jobs/health-data-retention-cleanup",
    body: { limit: 50, objectCleanup: true },
  },
});

function boolEnv(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("ROOT_JOB_DRY_RUN must be the exact string true or false");
}

function jobTokens(env = {}) {
  const tokens = [];
  if (Object.prototype.hasOwnProperty.call(env, "ROOT_ADMIN_JOB_TOKENS")) {
    let parsed;
    try { parsed = JSON.parse(env.ROOT_ADMIN_JOB_TOKENS); } catch {
      throw new Error("ROOT_ADMIN_JOB_TOKENS must be valid JSON");
    }
    const entries = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object"
        ? Object.values(parsed)
        : [];
    if (!entries.length || entries.length > 16) {
      throw new Error("ROOT_ADMIN_JOB_TOKENS must contain between 1 and 16 tokens");
    }
    for (const item of entries) {
      const token = typeof item === "string" ? item : item && item.token;
      if (typeof token !== "string" || !token.trim() || token !== token.trim()) {
        throw new Error("ROOT_ADMIN_JOB_TOKENS contains an invalid token");
      }
      tokens.push(token);
    }
  }
  const singular = Object.prototype.hasOwnProperty.call(env, "ROOT_ADMIN_JOB_TOKEN")
    ? env.ROOT_ADMIN_JOB_TOKEN
    : "";
  if (singular !== "") {
    if (typeof singular !== "string" || !singular.trim() || singular !== singular.trim()) {
      throw new Error("ROOT_ADMIN_JOB_TOKEN is invalid");
    }
    tokens.push(singular);
  }
  return [...new Set(tokens)];
}

function requireScopedJobTokens(env = {}) {
  const value = Object.prototype.hasOwnProperty.call(env, "ROOT_REQUIRE_SCOPED_JOB_TOKENS")
    ? env.ROOT_REQUIRE_SCOPED_JOB_TOKENS
    : "";
  if (value === "" || value === undefined || value === null) return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("ROOT_REQUIRE_SCOPED_JOB_TOKENS must be the exact string true or false");
}

function scopedJobRouteTokens(env = {}, route = "") {
  const raw = Object.prototype.hasOwnProperty.call(env, "ROOT_ADMIN_JOB_ROUTE_TOKENS")
    ? env.ROOT_ADMIN_JOB_ROUTE_TOKENS
    : "";
  if (raw === "" || raw === undefined || raw === null) return [];
  if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > 64 * 1024) {
    throw new Error("ROOT_ADMIN_JOB_ROUTE_TOKENS is invalid");
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    throw new Error("ROOT_ADMIN_JOB_ROUTE_TOKENS must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("ROOT_ADMIN_JOB_ROUTE_TOKENS must be keyed by exact Job route");
  }
  const entries = Object.entries(parsed);
  if (entries.length < 1 || entries.length > 64) {
    throw new Error("ROOT_ADMIN_JOB_ROUTE_TOKENS must contain between 1 and 64 routes");
  }
  const tokenOwners = new Map();
  let selected = [];
  for (const [candidateRoute, rotation] of entries) {
    if (!/^\/api\/v1\/jobs\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidateRoute)) {
      throw new Error("ROOT_ADMIN_JOB_ROUTE_TOKENS contains an invalid exact Job route");
    }
    if (!Array.isArray(rotation) || rotation.length < 1 || rotation.length > 16) {
      throw new Error("ROOT_ADMIN_JOB_ROUTE_TOKENS route rotations must contain between 1 and 16 tokens");
    }
    const tokens = [];
    for (const item of rotation) {
      const token = typeof item === "string" ? item : item && typeof item === "object" ? item.token : "";
      if (typeof token !== "string"
        || token.length < 16
        || token.length > 4096
        || token !== token.trim()
        || /[\u0000-\u001f\u007f]/.test(token)) {
        throw new Error("ROOT_ADMIN_JOB_ROUTE_TOKENS contains an invalid token");
      }
      const owner = tokenOwners.get(token);
      if (owner && owner !== candidateRoute) {
        throw new Error("ROOT_ADMIN_JOB_ROUTE_TOKENS cannot reuse one token across Job routes");
      }
      tokenOwners.set(token, candidateRoute);
      if (!tokens.includes(token)) tokens.push(token);
    }
    if (candidateRoute === route) selected = tokens;
  }
  return selected;
}

function currentJobToken(env = {}, route = "") {
  if (route) {
    const scoped = scopedJobRouteTokens(env, route);
    if (scoped.length) return scoped[scoped.length - 1];
    if (requireScopedJobTokens(env)) {
      throw new Error(`ROOT_ADMIN_JOB_ROUTE_TOKENS is required for exact route ${route}`);
    }
  }
  const tokens = jobTokens(env);
  if (!tokens.length) throw new Error("ROOT_ADMIN_JOB_TOKEN or ROOT_ADMIN_JOB_TOKENS is required");
  return tokens[tokens.length - 1];
}

function normalizeBaseUrl(value) {
  const url = new URL(String(value || DEFAULT_BASE_URL).replace(/\/+$/, ""));
  if (url.protocol !== "https:") throw new Error("ROOT_JOB_BASE_URL must use HTTPS");
  return url.toString().replace(/\/+$/, "");
}

function buildJobRequestUrl(baseUrl, path, routeQuery = "") {
  const url = new URL(path, `${normalizeBaseUrl(baseUrl)}/`);
  const query = String(routeQuery || "").trim().replace(/^\?/, "");
  if (query.length > 512) throw new Error("ROOT_JOB_ROUTE_QUERY exceeds 512 characters");
  for (const [key, value] of new URLSearchParams(query)) {
    if (key) url.searchParams.set(key, value);
  }
  return url.toString();
}

function resolveJob(event = {}) {
  const jobId = String(event.jobId || event.job_id || event.TriggerName || event.triggerName || "").trim();
  const job = JOBS[jobId];
  if (!job) throw new Error(`Unknown scheduled job: ${jobId || "<empty>"}`);
  return { jobId, ...job };
}

function requestIdFor(jobId, event = {}, now = new Date()) {
  const instant = String(event.Time || event.time || now.toISOString());
  const compact = instant.replace(/[^0-9]/g, "").slice(0, 12) || String(now.getTime());
  return `cloudbase-${jobId}-${compact}`.slice(0, 120);
}

function sanitize(value, depth = 0) {
  if (depth > 4) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (/(token|secret|password|openid|unionid|phone|authorization)/i.test(key)) return [key, "[REDACTED]"];
    return [key, sanitize(item, depth + 1)];
  }));
}

function summarizeJobData(value) {
  const data = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const summary = {};
  const safeTextKeys = new Set([
    "status",
    "sensitivity",
    "approvalStatus",
    "deliveryChannel",
  ]);
  for (const [key, item] of Object.entries(data)) {
    if (typeof item === "number" || typeof item === "boolean") {
      summary[key] = item;
      continue;
    }
    if (safeTextKeys.has(key) && typeof item === "string") summary[key] = item;
  }
  if (data.summary && typeof data.summary === "object" && !Array.isArray(data.summary)) {
    summary.summary = Object.fromEntries(Object.entries(data.summary).filter(([, item]) => (
      typeof item === "number" || typeof item === "boolean"
    )));
  }
  for (const key of ["alerts", "rules", "candidates", "jobs", "results", "pending", "skipped"]) {
    if (Array.isArray(data[key])) summary[`${key}Count`] = data[key].length;
  }
  return sanitize(summary);
}

function postJson(url, body, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = https.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": payload.length,
        ...headers,
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let responseBody;
        try {
          responseBody = text ? JSON.parse(text) : {};
        } catch (error) {
          reject(new Error(`Job Interface returned invalid JSON (${res.statusCode || 0})`));
          return;
        }
        resolve({ statusCode: res.statusCode || 0, body: responseBody });
      });
    });
    req.on("timeout", () => req.destroy(new Error(`Job Interface timed out after ${timeoutMs}ms`)));
    req.on("error", reject);
    req.end(payload);
  });
}

async function dispatch(event = {}, env = process.env, request = postJson) {
  const job = resolveJob(event);
  const token = currentJobToken(env, job.path);

  const dryRun = boolEnv(env.ROOT_JOB_DRY_RUN, true);
  const timeoutMs = Math.max(1000, Math.min(60000, Number(env.ROOT_JOB_TIMEOUT_MS) || 15000));
  const requestId = requestIdFor(job.jobId, event);
  const body = {
    ...job.body,
    dryRun,
    ...(dryRun ? {} : { requestId }),
  };
  const headers = {
    "X-ROOT-ADMIN-TOKEN": token,
    ...(dryRun ? {} : { "X-Request-Id": requestId }),
  };
  const result = await request(
    buildJobRequestUrl(env.ROOT_JOB_BASE_URL, job.path, env.ROOT_JOB_ROUTE_QUERY),
    body,
    headers,
    timeoutMs,
  );
  const response = result.body || {};
  if (result.statusCode < 200 || result.statusCode >= 300 || response.code !== 0) {
    throw new Error(`Job Interface failed (${result.statusCode}/${response.code ?? "UNKNOWN"}): ${response.message || "unknown error"}`);
  }
  return {
    ok: true,
    releaseVersion: RELEASE_VERSION,
    jobId: job.jobId,
    triggerName: String(event.TriggerName || event.triggerName || job.jobId),
    dryRun,
    requestId: dryRun ? "" : requestId,
    statusCode: result.statusCode,
    code: response.code,
    message: response.message || "ok",
    data: summarizeJobData(response.data),
  };
}

exports.main = async (event) => dispatch(event);
exports.dispatch = dispatch;
exports.JOBS = JOBS;
exports.RELEASE_VERSION = RELEASE_VERSION;
exports.buildJobRequestUrl = buildJobRequestUrl;
exports.boolEnv = boolEnv;
exports.currentJobToken = currentJobToken;
exports.jobTokens = jobTokens;
exports.requireScopedJobTokens = requireScopedJobTokens;
exports.scopedJobRouteTokens = scopedJobRouteTokens;
exports.normalizeBaseUrl = normalizeBaseUrl;
exports.requestIdFor = requestIdFor;
exports.resolveJob = resolveJob;
exports.sanitize = sanitize;
exports.summarizeJobData = summarizeJobData;
