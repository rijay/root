const https = require("node:https");
const { version: RELEASE_VERSION } = require("./package.json");

const TRIGGER_NAME = "v1_runtime_cycle";
const ROUTE = "/api/v1/jobs/v1-runtime-cycle";

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function strictBooleanEnv(env, name, fallback) {
  const value = Object.prototype.hasOwnProperty.call(env, name) ? env[name] : "";
  if (value === "" || value === undefined || value === null) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be the exact string true or false`);
}

function boundedLimit(env, name, fallback) {
  const value = Object.prototype.hasOwnProperty.call(env, name) ? env[name] : "";
  if (value === "" || value === undefined || value === null) return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer from 1 to 100`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error(`${name} must be an integer from 1 to 100`);
  }
  return parsed;
}

function schedulerTimeoutSeconds(env) {
  const name = "ROOT_V1_RUNTIME_SCHEDULER_TIMEOUT_SECONDS";
  const value = Object.prototype.hasOwnProperty.call(env, name) ? env[name] : "";
  if (value === "" || value === undefined || value === null) return 15;
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer from 1 to 25`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 25) {
    throw new Error(`${name} must be an integer from 1 to 25`);
  }
  return parsed;
}

function canonicalTimerSchedule(event) {
  if (!plainRecord(event)
    || event.TriggerName !== TRIGGER_NAME
    || Object.prototype.hasOwnProperty.call(event, "jobId")
    || Object.prototype.hasOwnProperty.call(event, "job_id")) {
    throw new Error("v1 runtime scheduler accepts only its fixed CloudBase timer trigger");
  }
  const source = event.Time;
  if (typeof source !== "string" || source.length < 1 || source.length > 64) {
    throw new Error("v1 runtime scheduler requires event.Time");
  }
  const epoch = Date.parse(source);
  if (!Number.isFinite(epoch)) throw new Error("v1 runtime scheduler event.Time is invalid");
  const scheduledAt = new Date(epoch).toISOString();
  const scheduleId = `cloudbase-v1-runtime-${scheduledAt.replace(/[-:.]/g, "")}`;
  return Object.freeze({ scheduleId, scheduledAt });
}

function normalizeBaseUrl(value) {
  const raw = String(value || "");
  if (!raw || raw !== raw.trim()) throw new Error("ROOT_JOB_BASE_URL is required");
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error("ROOT_JOB_BASE_URL is invalid"); }
  if (parsed.protocol !== "https:"
    || !parsed.hostname
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || !["", "/"].includes(parsed.pathname)) {
    throw new Error("ROOT_JOB_BASE_URL must be an HTTPS origin");
  }
  return parsed.origin;
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
      : plainRecord(parsed)
        ? Object.values(parsed)
        : [];
    if (entries.length < 1 || entries.length > 16) {
      throw new Error("ROOT_ADMIN_JOB_TOKENS must contain between 1 and 16 tokens");
    }
    for (const item of entries) {
      const token = typeof item === "string" ? item : plainRecord(item) ? item.token : "";
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
  const unique = [...new Set(tokens)];
  if (!unique.length) throw new Error("ROOT_ADMIN_JOB_TOKEN or ROOT_ADMIN_JOB_TOKENS is required");
  return unique;
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
  if (!plainRecord(parsed)) {
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
      const token = typeof item === "string" ? item : plainRecord(item) ? item.token : "";
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

function currentJobToken(env = {}, route = ROUTE) {
  const scoped = scopedJobRouteTokens(env, route);
  if (scoped.length) return scoped[scoped.length - 1];
  if (requireScopedJobTokens(env)) {
    throw new Error(`ROOT_ADMIN_JOB_ROUTE_TOKENS is required for exact route ${route}`);
  }
  const tokens = jobTokens(env);
  return tokens[tokens.length - 1];
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
        let responseBody;
        try { responseBody = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch {
          reject(new Error(`v1 runtime Interface returned invalid JSON (${res.statusCode || 0})`));
          return;
        }
        resolve({ statusCode: res.statusCode || 0, body: responseBody });
      });
    });
    req.on("timeout", () => req.destroy(new Error(`v1 runtime Interface timed out after ${timeoutMs}ms`)));
    req.on("error", reject);
    req.end(payload);
  });
}

function publicResult(data) {
  if (!plainRecord(data)) return {};
  const output = {};
  for (const key of ["status", "dryRun", "enabled", "ready", "blockerCount"]) {
    if (typeof data[key] === "string" || typeof data[key] === "boolean" || Number.isSafeInteger(data[key])) {
      output[key] = data[key];
    }
  }
  return output;
}

async function dispatch(event = {}, env = process.env, request = postJson) {
  const schedule = canonicalTimerSchedule(event);
  const dryRun = strictBooleanEnv(env, "ROOT_V1_RUNTIME_SCHEDULER_DRY_RUN", true);
  const token = currentJobToken(env, ROUTE);
  const requestId = schedule.scheduleId;
  const body = {
    bridgeLimit: boundedLimit(env, "ROOT_V1_RUNTIME_BRIDGE_LIMIT", 20),
    dryRun,
    recoveryLimit: boundedLimit(env, "ROOT_V1_RUNTIME_RECOVERY_LIMIT", 10),
    requestId,
    scheduleId: schedule.scheduleId,
    scheduledAt: schedule.scheduledAt,
    workerLimit: boundedLimit(env, "ROOT_V1_RUNTIME_WORKER_LIMIT", 20),
  };
  const timeoutMs = schedulerTimeoutSeconds(env) * 1000;
  const result = await request(
    `${normalizeBaseUrl(env.ROOT_JOB_BASE_URL)}${ROUTE}`,
    body,
    {
      "X-ROOT-ADMIN-TOKEN": token,
      "X-Request-Id": requestId,
    },
    timeoutMs
  );
  const response = result && plainRecord(result.body) ? result.body : {};
  if (!result
    || !Number.isSafeInteger(result.statusCode)
    || result.statusCode < 200
    || result.statusCode >= 300
    || response.code !== 0) {
    throw new Error(`v1 runtime Interface failed (${result && result.statusCode || 0}/${response.code ?? "UNKNOWN"})`);
  }
  if (!plainRecord(response.data)
    || response.data.scheduleId !== schedule.scheduleId
    || response.data.requestId !== requestId
    || response.data.dryRun !== dryRun) {
    throw new Error("v1 runtime Interface returned a mismatched schedule identity");
  }
  return Object.freeze({
    ok: true,
    releaseVersion: RELEASE_VERSION,
    triggerName: TRIGGER_NAME,
    dryRun,
    requestId,
    scheduleId: schedule.scheduleId,
    scheduledAt: schedule.scheduledAt,
    statusCode: result.statusCode,
    code: response.code,
    data: Object.freeze(publicResult(response.data)),
  });
}

exports.main = async (event) => dispatch(event);
exports.dispatch = dispatch;
exports.canonicalTimerSchedule = canonicalTimerSchedule;
exports.currentJobToken = currentJobToken;
exports.jobTokens = jobTokens;
exports.normalizeBaseUrl = normalizeBaseUrl;
exports.strictBooleanEnv = strictBooleanEnv;
exports.requireScopedJobTokens = requireScopedJobTokens;
exports.scopedJobRouteTokens = scopedJobRouteTokens;
exports.RELEASE_VERSION = RELEASE_VERSION;
exports.ROUTE = ROUTE;
exports.TRIGGER_NAME = TRIGGER_NAME;
