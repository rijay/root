const https = require("node:https");
const { version: RELEASE_VERSION } = require("./package.json");

const DEFAULT_BASE_URL = "https://myroot-api-273748-8-1437260454.sh.run.tcloudbase.com";
const DEFAULT_CAMPAIGN_ID = "ROOT_7D_RESET";

const JOBS = Object.freeze({
  adapter_retry_due: {
    path: "/api/v1/jobs/adapter-retry-due",
    body: { batchSize: 5, maxAttempts: 5 },
  },
  operational_alerts: {
    path: "/api/v1/jobs/operational-alerts",
    body: { campaignId: DEFAULT_CAMPAIGN_ID },
  },
  checkin_reminders: {
    path: "/api/v1/jobs/checkin-reminders",
    body: { limit: 50 },
  },
  wework_touch_due: {
    path: "/api/v1/jobs/wework-touch-due",
    body: { limit: 50, batchSize: 20, cooldownHours: 24 },
  },
  lifecycle_settlement_due: {
    path: "/api/v1/jobs/lifecycle-settlement-due",
    body: { campaignId: DEFAULT_CAMPAIGN_ID, batchSize: 20, jobLimit: 3 },
  },
  lifecycle_settlement_cleanup: {
    path: "/api/v1/jobs/lifecycle-settlement-cleanup",
    body: {
      campaignId: DEFAULT_CAMPAIGN_ID,
      staleMinutes: 120,
      cancelAfterMinutes: 1440,
      jobLimit: 20,
    },
  },
  lifecycle_users_export: {
    path: "/api/v1/jobs/lifecycle-users-export",
    body: {
      filters: { campaignId: DEFAULT_CAMPAIGN_ID },
      retentionDays: 7,
      sensitivity: "MASKED",
      limit: 200,
    },
  },
  lifecycle_user_exports_delivery_retry: {
    path: "/api/v1/jobs/lifecycle-user-exports-delivery-retry",
    body: {
      limit: 20,
      deliveryRetryEnabled: true,
      deliveryMaxAttempts: 3,
      deliveryRetryDelaySeconds: 300,
    },
  },
  lifecycle_user_exports_cleanup: {
    path: "/api/v1/jobs/lifecycle-user-exports-cleanup",
    body: { limit: 50, objectCleanup: false },
  },
  health_data_retention_cleanup: {
    path: "/api/v1/jobs/health-data-retention-cleanup",
    body: { limit: 50, objectCleanup: true },
  },
  youzan_identity_reconcile: {
    path: "/api/v1/jobs/youzan-identity-reconcile",
    body: { batchSize: 5 },
  },
});

function boolEnv(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
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
  const token = String(env.ROOT_ADMIN_JOB_TOKEN || "").trim();
  if (!token) throw new Error("ROOT_ADMIN_JOB_TOKEN is required");

  const dryRun = boolEnv(env.ROOT_JOB_DRY_RUN, true);
  const campaignId = String(env.ROOT_JOB_CAMPAIGN_ID || DEFAULT_CAMPAIGN_ID).trim();
  const timeoutMs = Math.max(1000, Math.min(60000, Number(env.ROOT_JOB_TIMEOUT_MS) || 15000));
  const requestId = requestIdFor(job.jobId, event);
  const body = {
    ...job.body,
    ...(job.body.campaignId ? { campaignId } : {}),
    ...(job.body.filters ? { filters: { ...job.body.filters, campaignId } } : {}),
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
exports.normalizeBaseUrl = normalizeBaseUrl;
exports.requestIdFor = requestIdFor;
exports.resolveJob = resolveJob;
exports.sanitize = sanitize;
exports.summarizeJobData = summarizeJobData;
