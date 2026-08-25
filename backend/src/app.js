const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { createMemoryStore } = require("./store");
const { runCloudbaseObjectStorageProbe } = require("./cloudbaseObjectStorageProbe");
const { buildRuntimeMetadata } = require("./runtimeMetadata");
const { createHttpResponseSecurityPolicy } = require("./httpResponseSecurity");
const { getRuntimePersistenceStatus, isCloudRuntime } = require("./runtimePersistenceGuard");
const { resolveTrustedWechatIdentity } = require("./trustedWechatIdentity");
const { executeIdempotentCommand } = require("./commandIdempotency");
const { createCommandRequestDigestCodec } = require("./commandRequestDigest");
const { createCommandResultCodec } = require("./commandResultProtection");
const {
  MAX_BATCH_BYTES: PERFORMANCE_MAX_BATCH_BYTES,
  createPerformanceMetricsModule,
} = require("./performanceMetricsModule");
const { authenticateJobRouteToken } = require("./jobRouteToken");
const { isAtomicWriteError } = require("./atomicWriteError");
const { clientErrorResponse, createClientError } = require("./clientError");
const sessionModule = require("./sessionModule");
const adminFormalUserQuery = require("./adminFormalUserQuery");
const v060Api = require("./v060Api");
const { createEnvironmentHealthAdviceModelAdapter } = require("./healthAdviceModelAdapter");
const { createEnvironmentYouzanCommerceAdapter } = require("./youzanCommerceAdapter");

const {
  ADMIN_CAPABILITIES,
  capabilityListForRole,
  normalizeRole,
  requireAdminCapability,
} = require("./adminAccessControl");
const {
  archiveActivity,
  cancelActivityEnrollment,
  cancelActivitySession,
  createActivitySession,
  createStore,
  expireActivityEnrollmentReviews,
  getActivityDetail,
  getActivityEnrollments,
  getCloudbaseIdentityProbe,
  getHealthConsentStatus,
  getFormalHealthBootstrap,
  getFormalHealthInitialAssessment,
  getFormalHealthScale,
  getLatestFormalHealthScaleResult,
  getFormalContentDetail,
  getFormalContentAsset,
  getFormalContentAction,
  getFormalProfile,
  getPrivacyNotice,
  getReleaseRecord,
  getUserState,
  enrollActivity,
  loginWithWechat,
  prepareWechatLoginExternalInputs,
  listActivities,
  listAdminActivityDefinitions,
  listAdminActivityEnrollments,
  listAdminActivityReviewQueue,
  listAdminActivitySessions,
  listAdminFormalHealthInitialization,
  listAdminFormalHealthLifestyleAdvice,
  listAdminFormalHealthRecommendationRules,
  listAdminFormalHealthScales,
  listAdminContentWelcome,
  listAdminContentHomeCarousel,
  listAdminContentSharedDetails,
  listFormalHomeContent,
  listFormalWelcomeContent,
  listAuditLogs,
  publishActivity,
  publishAdminFormalHealthInitialization,
  publishAdminFormalHealthLifestyleAdvice,
  publishAdminFormalHealthRecommendationRule,
  publishAdminFormalHealthScale,
  publishAdminContentCandidate,
  recordHealthConsentDecision,
  requestActivityChanges,
  reviewActivityEnrollment,
  stableRootUserIdForToken,
  runHealthDataRetentionCleanup,
  submitFormalProfile,
  submitFormalHealthInitialAssessment,
  submitFormalHealthScale,
  saveAdminFormalHealthInitializationDraft,
  saveAdminFormalHealthLifestyleAdviceDraft,
  saveAdminFormalHealthRecommendationRuleDraft,
  saveAdminFormalHealthScaleDraft,
  saveAdminContentWelcomeDraft,
  saveAdminContentHomeCarouselDraft,
  saveAdminContentSharedDetailDraft,
  uploadAdminContentAsset,
  validateAdminContentTarget,
  markAdminContentPreviewCompleted,
  unpublishAdminContentVersion,
  submitActivityForReview,
  unpublishActivity,
  updateActivitySessionState,
  upsertActivityDraft,
} = require("./domain");

const publicDir = path.join(__dirname, "..", "public");
const sourceAdminDistDir = path.join(__dirname, "..", "..", "admin", "dist");
const bundledAdminDistDir = path.join(publicDir, "admin-dist");
const defaultAdminDistDirs = [sourceAdminDistDir, bundledAdminDistDir];

const PERFORMANCE_METRICS_ROUTE = "/api/v1/performance/events";
const CANDIDATE_ROUTE_KEY = "myroot_canary";
const CANDIDATE_ROUTE_VALUE_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const REQUEST_BODY_PROMISE = Symbol("root.requestBodyPromise");
const PREPARED_WECHAT_LOGIN = Symbol("root.preparedWechatLogin");

function readBody(req) {
  if (req[REQUEST_BODY_PROMISE]) return req[REQUEST_BODY_PROMISE];
  req[REQUEST_BODY_PROMISE] = new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024 * 2) {
        reject(Object.assign(new Error("请求体过大"), { status: 413, code: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(Object.assign(new Error("JSON格式错误"), { status: 400, code: 400 }));
      }
    });
  });
  return req[REQUEST_BODY_PROMISE];
}

function send(res, status, payload, headers = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  if (typeof res.recordPayload === "function") res.recordPayload(payload);
  res.writeHead(status, {
    "Content-Type": typeof payload === "string" ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
    ...headers,
    ...(res.responseSecurityHeaders || {}),
  });
  res.end(body);
}

function ok(res, payload) {
  send(res, 200, payload);
}

function apiOk(res, data) {
  return ok(res, { code: 0, message: "ok", data });
}

function sendBinary(res, status, body, contentType, headers = {}) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body || "");
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": buffer.length,
    "X-Content-Type-Options": "nosniff",
    ...headers,
    ...(res.responseSecurityHeaders || {}),
  });
  res.end(buffer);
}

function createBufferedResponse() {
  const chunks = [];
  const headers = {};
  let statusCode = 200;
  let payload;
  let ended = false;
  return {
    get statusCode() {
      return statusCode;
    },
    set statusCode(value) {
      statusCode = Number(value || 200);
    },
    get headersSent() {
      return ended;
    },
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = value;
    },
    getHeader(name) {
      return headers[String(name).toLowerCase()];
    },
    writeHead(status, nextHeaders = {}) {
      statusCode = Number(status || 200);
      Object.entries(nextHeaders).forEach(([name, value]) => {
        headers[String(name).toLowerCase()] = value;
      });
      return this;
    },
    write(chunk) {
      if (chunk !== undefined && chunk !== null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      return true;
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      ended = true;
    },
    recordPayload(value) {
      payload = value;
    },
    isSuccessful() {
      if (statusCode >= 400) return false;
      if (payload && typeof payload === "object" && !Array.isArray(payload) && Object.prototype.hasOwnProperty.call(payload, "code")) {
        return payload.code === 0;
      }
      return true;
    },
    flush(realResponse) {
      if (!ended) throw new Error("HTTP Interface did not finish a response");
      realResponse.writeHead(statusCode, headers);
      realResponse.end(Buffer.concat(chunks));
    },
  };
}

function getToken(req) {
  const header = req.headers.authorization || "";
  const [, token] = header.match(/^Bearer\s+(.+)$/i) || [];
  return token || "";
}

function getAdminToken(req) {
  const header = req.headers.authorization || "";
  const [, bearerToken] = header.match(/^Bearer\s+(.+)$/i) || [];
  return String(req.headers["x-root-admin-token"] || req.headers["x-admin-token"] || bearerToken || "");
}

function boolEnv(value) {
  return ["1", "true", "yes", "y", "on"].includes(String(value || "").trim().toLowerCase());
}

function textEnv(env, key, fallback = "") {
  const value = env && Object.prototype.hasOwnProperty.call(env, key) ? env[key] : "";
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function shouldRequireConfiguredAdminToken(env = process.env) {
  // Local compatibility flags must never downgrade authentication in a
  // protected runtime. Production/cloud access fails closed first.
  if (String(env.NODE_ENV || "").trim().toLowerCase() === "production" || isCloudRuntime(env)) return true;
  if (Object.prototype.hasOwnProperty.call(env, "ROOT_REQUIRE_ADMIN_TOKEN")) {
    return boolEnv(env.ROOT_REQUIRE_ADMIN_TOKEN);
  }
  if (boolEnv(env.ROOT_ALLOW_UNCONFIGURED_ADMIN_ACCESS)) return false;
  return false;
}

function parseAdminTokens(env = process.env) {
  const entries = [];
  let configured = Boolean(env.ROOT_ADMIN_TOKEN);
  if (env.ROOT_ADMIN_TOKENS) {
    configured = true;
    try {
      const parsed = JSON.parse(env.ROOT_ADMIN_TOKENS);
      if (Array.isArray(parsed)) {
        parsed.forEach((item) => {
          if (item && item.token) {
            const operatorId = String(item.operatorId || item.operator_id || item.name || "operator").trim();
            if (!operatorId) return;
            entries.push({
              token: String(item.token),
              operatorId,
              role: String(item.role || "operator"),
            });
          }
        });
      } else if (parsed && typeof parsed === "object") {
        Object.entries(parsed).forEach(([operatorId, value]) => {
          const normalizedOperatorId = String(operatorId || "").trim();
          if (!normalizedOperatorId) return;
          if (typeof value === "string") {
            entries.push({ token: value, operatorId: normalizedOperatorId, role: "operator" });
            return;
          }
          if (value && value.token) entries.push({
            token: String(value.token),
            operatorId: normalizedOperatorId,
            role: String(value.role || "operator"),
          });
        });
      }
    } catch (error) {
      // Malformed multi-token config falls through to ROOT_ADMIN_TOKEN.
    }
  }
  if (env.ROOT_ADMIN_TOKEN) entries.push({ token: String(env.ROOT_ADMIN_TOKEN), operatorId: "admin", role: "admin" });
  return { entries, configured };
}

function secureTokenEqual(candidate, provided) {
  if (!candidate || !provided) return false;
  const left = crypto.createHash("sha256").update(String(candidate)).digest();
  const right = crypto.createHash("sha256").update(String(provided)).digest();
  return crypto.timingSafeEqual(left, right);
}

function getAdminPrincipal(req, env = process.env, pathname = "") {
  const token = getAdminToken(req);
  if (pathname.startsWith("/api/v1/jobs/")) {
    const jobToken = authenticateJobRouteToken(env, pathname, token);
    if (jobToken.matched) {
      const operatorRoute = pathname.slice("/api/v1/jobs/".length);
      return {
        operatorId: `cloudbase-job:${operatorRoute}`,
        role: "job",
        tokenConfigured: true,
        jobOnly: true,
        jobRoute: pathname,
        jobTokenMode: jobToken.mode,
      };
    }
    // Strict scoped mode and malformed scoped configuration must not fall back
    // to a generic Admin token on a Job route.
    if (jobToken.failClosed) return null;
  }
  const { entries, configured } = parseAdminTokens(env);
  if (!configured) {
    if (shouldRequireConfiguredAdminToken(env)) return null;
    return { operatorId: "local-admin", role: "admin", tokenConfigured: false };
  }
  if (!entries.length) return null;
  const matched = entries.find((entry) => secureTokenEqual(entry.token, token));
  return matched ? { operatorId: matched.operatorId, role: matched.role, tokenConfigured: true } : null;
}

function requiresAdminAccess(pathname) {
  return pathname.startsWith("/api/v1/admin/") || pathname.startsWith("/api/v1/jobs/");
}

function hasAdminAccess(req, env = process.env, pathname = "") {
  return Boolean(getAdminPrincipal(req, env, pathname));
}

function adminOperatorId(principal, body = {}) {
  if (principal && principal.tokenConfigured) return principal.operatorId;
  return body.operatorId || body.operator_id || (principal ? principal.operatorId : "");
}

function activityCommandIdentity(req, body = {}, label = "活动写操作") {
  const requestId = String(req.headers["x-request-id"] || body.requestId || body.request_id || "").trim();
  const idempotencyKey = String(
    req.headers["x-idempotency-key"] || body.idempotencyKey || body.idempotency_key || ""
  ).trim();
  const valid = (value) => value.length >= 1
    && value.length <= 128
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
  if (!valid(requestId)) {
    throw createClientError("ACTIVITY_REQUEST_ID_REQUIRED", `${label} X-Request-Id 必填且格式有效`, 400);
  }
  if (!valid(idempotencyKey)) {
    throw createClientError(
      "ACTIVITY_IDEMPOTENCY_KEY_REQUIRED",
      `${label} X-Idempotency-Key 必填且格式有效`,
      400
    );
  }
  if (requestId === idempotencyKey) {
    throw createClientError(
      "ACTIVITY_COMMAND_IDENTITY_NOT_SEPARATED",
      `${label} 请求尝试标识与幂等意图标识必须分离`,
      400
    );
  }
  return Object.freeze({ requestId, idempotencyKey });
}

function prepareAdminCommandBody(req, principal, body = {}, label = "后台写操作", commandName = "") {
  const requestId = String(req.headers["x-request-id"] || body.requestId || body.request_id || "").trim();
  if (!requestId) {
    throw Object.assign(new Error(`${label} request_id 必填`), { code: 400 });
  }
  if (commandName && req.commandIdempotencyContext) req.commandIdempotencyContext.commandName = commandName;
  const {
    operator_id: _discardedOperatorId,
    requestId: _discardedRequestId,
    request_id: _discardedRequestIdSnake,
    ...commandBody
  } = body;
  return {
    ...commandBody,
    operatorId: adminOperatorId(principal, body),
    requestId,
  };
}

function prepareActivityAdminCommandBody(req, principal, body = {}, label = "活动后台写操作", commandName = "") {
  const identity = activityCommandIdentity(req, body, label);
  if (commandName && req.commandIdempotencyContext) req.commandIdempotencyContext.commandName = commandName;
  const {
    operator_id: _discardedOperatorId,
    requestId: _discardedRequestId,
    request_id: _discardedRequestIdSnake,
    idempotencyKey: _discardedIdempotencyKey,
    idempotency_key: _discardedIdempotencyKeySnake,
    ...commandBody
  } = body;
  return {
    ...commandBody,
    operatorId: adminOperatorId(principal, body),
    ...identity,
  };
}

function adminPrincipalProfile(principal) {
  if (!principal) return null;
  const role = normalizeRole(principal.role);
  return {
    operatorId: principal.operatorId || "",
    role,
    tokenConfigured: principal.tokenConfigured !== false,
    capabilities: capabilityListForRole(role),
  };
}

function commandActorId(data, token, adminPrincipal, runtimeContext = {}) {
  if (adminPrincipal) return `admin:${String(adminPrincipal.operatorId || adminPrincipal.role || "unknown")}`;
  if (!token) return "anonymous";
  const rootUserId = stableRootUserIdForToken(data, token, runtimeContext);
  if (!rootUserId) throw createClientError(1003, "登录状态无稳定用户主体", 401);
  return `user:${rootUserId}`;
}

function withIdempotency(data, req, action, explicitIdempotencyKey = "") {
  const idempotencyKey = explicitIdempotencyKey || req.headers["x-request-id"];
  if (!idempotencyKey) {
    req.commandIdempotencyReplayed = false;
    return action();
  }
  const context = req.commandIdempotencyContext || {};
  const descriptor = {
    commandName: context.commandName || `${String(req.method || "POST").toUpperCase()}:${new URL(req.url, "http://localhost").pathname}`,
    actorId: context.actorId || "anonymous",
    actorType: context.actorType || undefined,
    idempotencyKey,
    request: context.request || null,
  };
  const execution = context.executor && typeof context.executor.execute === "function"
    ? context.executor.execute(data, descriptor, action)
    : executeIdempotentCommand(data, descriptor, action, { resultCodec: context.resultCodec });
  const unwrap = (outcome) => {
    req.commandIdempotencyReplayed = outcome.replayed === true;
    return outcome.result;
  };
  if (execution && typeof execution.then === "function") return execution.then(unwrap);
  return unwrap(execution);
}

function requestCorrelationId(req) {
  const requestId = String(req && req.headers && req.headers["x-request-id"] || "").trim();
  if (!requestId) return null;
  return `request_${crypto.createHash("sha256").update(requestId).digest("hex").slice(0, 32)}`;
}

function staticFile(filePath, res, baseDir = publicDir) {
  const resolvedBaseDir = path.resolve(baseDir);
  const safePath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, "");
  const absolute = path.resolve(resolvedBaseDir, safePath);
  if (!absolute.startsWith(resolvedBaseDir) || !fs.existsSync(absolute) || fs.statSync(absolute).isDirectory()) {
    send(res, 404, "Not Found", { "Content-Type": "text/plain; charset=utf-8" });
    return true;
  }
  const ext = path.extname(absolute);
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
  };
  res.writeHead(200, {
    "Content-Type": types[ext] || "application/octet-stream",
    ...(res.responseSecurityHeaders || {}),
  });
  fs.createReadStream(absolute).pipe(res);
  return true;
}

function candidateAdminIndex(res, adminDistDir, routeValue) {
  const indexPath = path.join(adminDistDir, "index.html");
  const assetsDir = path.join(adminDistDir, "assets");
  const suffix = `?${CANDIDATE_ROUTE_KEY}=${encodeURIComponent(routeValue)}`;
  const nonce = crypto.randomBytes(18).toString("base64url");
  const imports = fs.existsSync(assetsDir)
    ? Object.fromEntries(fs.readdirSync(assetsDir)
      .filter((file) => file.endsWith(".js"))
      .sort()
      .map((file) => [`/admin/assets/${file}`, `/admin/assets/${file}${suffix}`]))
    : {};
  let html = fs.readFileSync(indexPath, "utf8");
  html = html.replace(
    /\b(src|href)=(['"])(\/admin\/assets\/[^'"?#]+)(?:\?[^'"]*)?\2/g,
    (_match, attribute, quote, assetPath) => `${attribute}=${quote}${assetPath}${suffix}${quote}`,
  );
  const importMap = `<script type="importmap" nonce="${nonce}">${JSON.stringify({ imports })}</script>`;
  html = html.includes("<script type=\"module\"")
    ? html.replace("<script type=\"module\"", `${importMap}\n    <script type=\"module\"`)
    : html.replace("</head>", `${importMap}\n  </head>`);
  const securityHeaders = { ...(res.responseSecurityHeaders || {}) };
  securityHeaders["Content-Security-Policy"] = String(securityHeaders["Content-Security-Policy"] || "")
    .replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`);
  res.responseSecurityHeaders = securityHeaders;
  send(res, 200, html);
  return true;
}

function hasElementAdminBuild(adminDistDir = sourceAdminDistDir) {
  return fs.existsSync(path.join(adminDistDir, "index.html"));
}

function resolveElementAdminDir(adminDistDir, env = process.env, candidates = defaultAdminDistDirs) {
  if (adminDistDir) return path.resolve(adminDistDir);
  if (env && env.ROOT_ADMIN_DIST_DIR) return path.resolve(env.ROOT_ADMIN_DIST_DIR);
  return candidates.map((candidate) => path.resolve(candidate)).find((candidate) => hasElementAdminBuild(candidate)) || path.resolve(candidates[0]);
}

function createApp(options = {}) {
  const storeAdapter = options.storeAdapter || createMemoryStore(options.store || createStore());
  const data = storeAdapter.data;
  const runtimeEnv = options.env || process.env;
  const commandRequestDigestCodec = options.commandRequestDigestCodec || createCommandRequestDigestCodec(runtimeEnv);
  const commandResultCodec = options.commandResultCodec || createCommandResultCodec(runtimeEnv);
  const responseSecurityPolicy = createHttpResponseSecurityPolicy(runtimeEnv);
  const runtimeMetadata = buildRuntimeMetadata(runtimeEnv);
  const performanceMetricsModule = options.performanceMetricsModule || createPerformanceMetricsModule({
    logger: options.performanceLogger || console,
  });
  const healthAdviceModelAdapter = options.healthAdviceModelAdapter
    || createEnvironmentHealthAdviceModelAdapter(runtimeEnv, { fetchImpl: options.fetchImpl });
  const youzanCommerceAdapter = options.youzanCommerceAdapter
    || createEnvironmentYouzanCommerceAdapter(runtimeEnv, {
      fetchImpl: options.fetchImpl,
      accessTokenProvider: options.youzanAccessTokenProvider,
    });
  const elementAdminDir = resolveElementAdminDir(options.adminDistDir, runtimeEnv);
  const runtimeContext = {
    storeAdapter,
    env: runtimeEnv,
    adapterImplementations: options.adapterImplementations || {},
    fetchImpl: options.fetchImpl,
    objectStorageAdapter: options.objectStorageAdapter,
    cloudbaseAppFactory: options.cloudbaseAppFactory,
    trustedWechatIdentityAdapter: options.trustedWechatIdentityAdapter,
    activityPublicationAuthorizationAdapter: options.activityPublicationAuthorizationAdapter,
    activityAssetAdapter: options.activityAssetAdapter,
    healthAdviceModelAdapter,
    memberCommerceAdapter: options.memberCommerceAdapter || youzanCommerceAdapter,
    productCommerceAdapter: options.productCommerceAdapter || youzanCommerceAdapter,
    runtimeMetadata,
  };
  const initialPersistPromise = Promise.resolve();

  async function handleRequest(req, res, requestContext = {}) {
    const data = requestContext.storeData || storeAdapter.data;
    const url = new URL(req.url, "http://localhost");
    const method = req.method || "GET";
    res.responseSecurityHeaders = responseSecurityPolicy.headersFor(req);

    if (method === "OPTIONS") return send(res, 204, "");
    if (method === "GET" && url.pathname === "/health") {
      return ok(res, { code: 0, message: "ok", data: { service: "root-checkin", ...runtimeMetadata } });
    }
    if (method === "GET" && url.pathname === "/ready") {
      const health = typeof storeAdapter.checkHealth === "function"
        ? await storeAdapter.checkHealth()
        : { ok: true, ...(storeAdapter.getStoreHealth ? storeAdapter.getStoreHealth() : { kind: storeAdapter.kind }) };
      const persistence = getRuntimePersistenceStatus({ env: runtimeEnv, storeAdapter });
      const commandRequestDigest = commandRequestDigestCodec.getStatus();
      const commandResultProtection = commandResultCodec.getStatus();
      const ready = health.ok !== false
        && persistence.ready
        && commandResultProtection.ready
        && commandRequestDigest.ready;
      const code = health.ok === false
        ? 50301
        : !persistence.ready
          ? 50302
          : !commandResultProtection.ready
            ? 50303
            : !commandRequestDigest.ready
              ? 50304
              : 0;
      return send(res, ready ? 200 : 503, {
        code,
        message: health.ok === false
          ? "store unavailable"
          : persistence.ready
            ? commandResultProtection.ready
              ? commandRequestDigest.ready
                ? "ready"
                : "command request digest unavailable"
              : "command result protection unavailable"
            : "transactional multi-instance store required",
        data: {
          service: "root-checkin",
          ...runtimeMetadata,
          store: {
            kind: storeAdapter.kind,
            connected: health.ok !== false,
            migrationVersion: health.migrationVersion || "",
            revision: health.revision ?? null,
            persistenceStatus: persistence.status,
            runtimeMode: persistence.runtimeMode,
            transactional: persistence.transactional,
            multiInstanceSafe: persistence.multiInstanceSafe,
            ...(storeAdapter.kind === "mysql" ? {
              leastPrivilegeReady: health.leastPrivilegeReady === true,
              privilegeScope: health.privilegeScope || "UNKNOWN",
              privilegePolicyEnforced: health.privilegePolicyEnforced === true,
            } : {}),
          },
          commandRequestDigest,
          commandResultProtection,
        },
      });
    }
    if (method === "GET" && ["/", "/admin", "/admin/", "/admin/index.html"].includes(url.pathname)) {
      if (hasElementAdminBuild(elementAdminDir)) {
        const candidateRouteValue = String(url.searchParams.get(CANDIDATE_ROUTE_KEY) || "");
        if (CANDIDATE_ROUTE_VALUE_PATTERN.test(candidateRouteValue)) {
          return candidateAdminIndex(res, elementAdminDir, candidateRouteValue);
        }
        return staticFile("index.html", res, elementAdminDir);
      }
      return staticFile("missing-admin-dist", res, elementAdminDir);
    }
    if (method === "GET" && url.pathname.startsWith("/admin/assets/")) {
      if (hasElementAdminBuild(elementAdminDir)) return staticFile(url.pathname.replace(/^\/admin\//, ""), res, elementAdminDir);
      return staticFile("missing-admin-dist", res, elementAdminDir);
    }
    if (requiresAdminAccess(url.pathname) && !hasAdminAccess(req, runtimeContext.env, url.pathname)) {
      return send(res, 401, { code: 40101, message: "请先输入后台访问口令", data: null });
    }

    try {
      const token = getToken(req);
      const adminPrincipal = requiresAdminAccess(url.pathname) ? getAdminPrincipal(req, runtimeContext.env, url.pathname) : null;
      const route = `${method} ${url.pathname}`;
      if (route === `POST ${PERFORMANCE_METRICS_ROUTE}`) {
        const declaredBytes = Number(req.headers["content-length"] || 0);
        if (Number.isFinite(declaredBytes) && declaredBytes > PERFORMANCE_MAX_BATCH_BYTES) {
          return send(res, 413, { code: "PERFORMANCE_BATCH_TOO_LARGE", message: "performance batch is too large", data: null });
        }
        const performanceBody = await readBody(req);
        const result = performanceMetricsModule.acceptBatch(performanceBody, {
          sessionId: req.headers["x-performance-session"],
        });
        return send(res, 202, { code: 0, message: "accepted", data: result });
      }
      const body = ["POST", "PUT", "PATCH"].includes(method) ? await readBody(req) : {};
      const commandActor = commandActorId(data, token, adminPrincipal, runtimeContext);
      req.commandIdempotencyContext = {
        commandName: `${method}:${url.pathname}`,
        actorId: commandActor,
        actorType: commandActor.startsWith("admin:")
          ? "ADMIN"
          : commandActor.startsWith("user:")
            ? "USER"
            : "ANONYMOUS",
        request: {
          method,
          pathname: url.pathname,
          query: Array.from(url.searchParams.entries()),
          body,
        },
        resultCodec: commandResultCodec,
      };

      if (route === "POST /api/v1/auth/login") {
        const preparedWechatLogin = req[PREPARED_WECHAT_LOGIN] || null;
        const trustedWechatIdentity = preparedWechatLogin
          ? preparedWechatLogin.trustedWechatIdentity
          : await resolveTrustedWechatIdentity({
            adapter: runtimeContext.trustedWechatIdentityAdapter,
            request: req,
            env: runtimeContext.env,
          });
        return ok(res, await loginWithWechat(data, body, {
          env: runtimeContext.env,
          headers: req.headers,
          trustedWechatIdentity,
          trustedPhoneNumber: preparedWechatLogin
            ? preparedWechatLogin.trustedPhoneNumber
            : "",
        }));
      }
      if (route === "GET /api/v1/privacy/notice") return ok(res, getPrivacyNotice(runtimeContext));
      if (route === "GET /api/v1/public/content/welcome") return ok(res, listFormalWelcomeContent(data, runtimeContext));
      if (route === "GET /api/v1/public/content/home") return ok(res, listFormalHomeContent(data, runtimeContext));
      if (route === "GET /api/v1/public/content/detail") {
        return ok(res, getFormalContentDetail(data, url.searchParams.get("contentId"), runtimeContext));
      }
      if (route === "GET /api/v1/public/content/action") {
        return ok(res, getFormalContentAction(data, url.searchParams.get("actionId")));
      }
      const contentAssetMatch = url.pathname.match(/^\/api\/v1\/public\/content\/assets\/([A-Za-z0-9_-]{3,80})$/);
      if (method === "GET" && contentAssetMatch) {
        const asset = getFormalContentAsset(data, contentAssetMatch[1]);
        return sendBinary(res, 200, asset.body, asset.mimeType, {
          "Cache-Control": "public, max-age=31536000, immutable",
          ETag: asset.etag,
        });
      }
      if (route === "GET /api/v1/user/state") return ok(res, getUserState(data, token, runtimeContext));
      if (route === "GET /api/v1/products") {
        return apiOk(res, await v060Api.listProducts(data, Object.fromEntries(url.searchParams), runtimeContext));
      }
      if (route === "GET /api/v1/member-commerce/summary") {
        return apiOk(res, await v060Api.memberCommerceSummary(data, token, runtimeContext));
      }
      if (route === "POST /api/v1/products/jump") {
        return apiOk(res, await withIdempotency(
          data,
          req,
          () => v060Api.recordProductJump(data, token, body, runtimeContext),
          req.headers["x-idempotency-key"] || ""
        ));
      }
      const productDetailMatch = url.pathname.match(/^\/api\/v1\/products\/([A-Za-z0-9_-]{1,64})$/);
      if (method === "GET" && productDetailMatch) {
        return apiOk(res, await v060Api.getProduct(data, productDetailMatch[1], runtimeContext));
      }
      if (route === "GET /api/v1/health/assessments/catalog") {
        return apiOk(res, v060Api.assessmentCatalog(data, token));
      }
      if (route === "GET /api/v1/health/assessments/history") {
        return apiOk(res, v060Api.assessmentHistory(data, token, Object.fromEntries(url.searchParams)));
      }
      if (route === "GET /api/v1/health/overview") {
        return apiOk(res, v060Api.healthOverview(data, token));
      }
      if (route === "POST /api/v1/health/advice/generate") {
        return apiOk(res, await withIdempotency(
          data,
          req,
          () => v060Api.generateHealthAdvice(data, token, runtimeContext),
          req.headers["x-idempotency-key"] || ""
        ));
      }
      if (route === "POST /api/v1/health/assessments/start") {
        return apiOk(res, await withIdempotency(
          data,
          req,
          () => v060Api.startAssessment(data, token, body, runtimeContext),
          req.headers["x-idempotency-key"] || ""
        ));
      }
      if (route === "POST /api/v1/health/assessments/compare") {
        return apiOk(res, v060Api.compareAssessments(data, token, body));
      }
      const assessmentDraftMatch = url.pathname.match(/^\/api\/v1\/health\/assessments\/([A-Za-z0-9_-]{1,64})\/draft$/);
      if (method === "POST" && assessmentDraftMatch) {
        return apiOk(res, v060Api.saveAssessmentDraft(
          data,
          token,
          assessmentDraftMatch[1],
          body,
          runtimeContext
        ));
      }
      const assessmentCompleteMatch = url.pathname.match(/^\/api\/v1\/health\/assessments\/([A-Za-z0-9_-]{1,64})\/complete$/);
      if (method === "POST" && assessmentCompleteMatch) {
        return apiOk(res, await withIdempotency(
          data,
          req,
          () => v060Api.completeAssessment(data, token, assessmentCompleteMatch[1], body, runtimeContext),
          req.headers["x-idempotency-key"] || ""
        ));
      }
      const assessmentDetailMatch = url.pathname.match(/^\/api\/v1\/health\/assessments\/([A-Za-z0-9_-]{1,64})$/);
      if (method === "GET" && assessmentDetailMatch) {
        return apiOk(res, v060Api.getAssessment(data, token, assessmentDetailMatch[1]));
      }
      if (method === "DELETE" && assessmentDetailMatch) {
        return apiOk(res, v060Api.deleteAssessment(data, token, assessmentDetailMatch[1]));
      }
      if (route === "POST /api/v1/operations/popup/claim") {
        return apiOk(res, await withIdempotency(
          data,
          req,
          () => v060Api.claimPopup(data, token, runtimeContext),
          req.headers["x-idempotency-key"] || ""
        ));
      }
      if (route === "POST /api/v1/operations/popup/action") {
        return apiOk(res, await withIdempotency(
          data,
          req,
          () => v060Api.recordPopupAction(data, token, body, runtimeContext),
          req.headers["x-idempotency-key"] || ""
        ));
      }
      if (route === "GET /api/v1/channels/attribution") {
        return apiOk(res, v060Api.firstAttribution(data, token));
      }
      if (route === "POST /api/v1/channels/attribution") {
        return apiOk(res, await withIdempotency(
          data,
          req,
          () => v060Api.attributeChannel(data, token, body, runtimeContext),
          req.headers["x-idempotency-key"] || ""
        ));
      }
      if (route === "POST /api/v1/event/track") {
        return apiOk(res, v060Api.recordAnalytics(data, token, body, runtimeContext));
      }
      if (route === "GET /api/v1/privacy/health-consent") return ok(res, getHealthConsentStatus(data, token, runtimeContext));
      if (route === "POST /api/v1/privacy/health-consent") return ok(res, withIdempotency(data, req, () => recordHealthConsentDecision(data, token, body, runtimeContext)));
      if (route === "GET /api/v1/user/formal-profile") return ok(res, getFormalProfile(data, token));
      if (route === "GET /api/v1/health/root4u") return ok(res, getFormalHealthBootstrap(data, token, runtimeContext));
      if (route === "GET /api/v1/health/root4u/initial-assessment") {
        return ok(res, getFormalHealthInitialAssessment(data, token, runtimeContext));
      }
      if (route === "POST /api/v1/health/root4u/initial-assessment") {
        return ok(res, withIdempotency(data, req, () => submitFormalHealthInitialAssessment(data, token, body, runtimeContext)));
      }
      const healthScaleMatch = url.pathname.match(/^\/api\/v1\/health\/root4u\/scales\/([a-zA-Z0-9_-]+)$/);
      if (method === "GET" && healthScaleMatch) {
        return ok(res, getFormalHealthScale(data, token, healthScaleMatch[1], { group: url.searchParams.get("group") }, runtimeContext));
      }
      const healthScaleLatestMatch = url.pathname.match(/^\/api\/v1\/health\/root4u\/scales\/([a-zA-Z0-9_-]+)\/responses\/latest$/);
      if (method === "GET" && healthScaleLatestMatch) {
        return ok(res, getLatestFormalHealthScaleResult(data, token, healthScaleLatestMatch[1], runtimeContext));
      }
      const healthScaleSubmitMatch = url.pathname.match(/^\/api\/v1\/health\/root4u\/scales\/([a-zA-Z0-9_-]+)\/responses$/);
      if (method === "POST" && healthScaleSubmitMatch) {
        return ok(res, withIdempotency(data, req, () => submitFormalHealthScale(
          data,
          token,
          healthScaleSubmitMatch[1],
          body,
          runtimeContext,
        )));
      }
      if (route === "GET /api/v1/activities") {
        return ok(res, listActivities(data, token, Object.fromEntries(url.searchParams), runtimeContext));
      }
      if (route === "GET /api/v1/activities/detail") {
        return ok(res, getActivityDetail(data, token, Object.fromEntries(url.searchParams), runtimeContext));
      }
      if (route === "GET /api/v1/activities/enrollments") {
        return ok(res, getActivityEnrollments(data, token, Object.fromEntries(url.searchParams), runtimeContext));
      }
      if (route === "POST /api/v1/activities/enroll") {
        const { requestId, idempotencyKey } = activityCommandIdentity(req, body, "活动报名");
        return ok(res, await withIdempotency(
          data,
          req,
          () => enrollActivity(
            data,
            token,
            { ...body, requestId, idempotencyKey },
            runtimeContext
          ),
          idempotencyKey
        ));
      }
      if (route === "POST /api/v1/activities/cancel") {
        const { requestId, idempotencyKey } = activityCommandIdentity(req, body, "取消报名");
        return ok(res, await withIdempotency(
          data,
          req,
          () => cancelActivityEnrollment(
            data,
            token,
            { ...body, requestId, idempotencyKey },
            runtimeContext
          ),
          idempotencyKey
        ));
      }
      if (route === "POST /api/v1/user/formal-profile") return ok(res, withIdempotency(data, req, () => submitFormalProfile(data, token, body)));
      if (route === "POST /api/v1/jobs/health-data-retention-cleanup") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        const execute = !(body.dryRun === true || body.dry_run === true);
        if (execute && !requestId) throw Object.assign(new Error("health data retention cleanup request_id 必填"), { code: 400 });
        return ok(res, await withIdempotency(data, req, () => runHealthDataRetentionCleanup(data, {
          ...body,
          dryRun: !execute,
          execute,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, adminPrincipal, requestId }), requestId));
      }
      if (route === "GET /api/v1/admin/me") return ok(res, {
        code: 0,
        message: "ok",
        data: adminPrincipalProfile(adminPrincipal),
      });
      if (route === "GET /api/v1/admin/activities") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.ADMIN_READ);
        return ok(res, listAdminActivityDefinitions(data, Object.fromEntries(url.searchParams), runtimeContext));
      }
      if (route === "GET /api/v1/admin/activity-sessions") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.ADMIN_READ);
        return ok(res, listAdminActivitySessions(data, Object.fromEntries(url.searchParams), runtimeContext));
      }
      if (route === "GET /api/v1/admin/activity-enrollments") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.ACTIVITY_ENROLLMENT_REVIEW);
        return ok(res, listAdminActivityEnrollments(data, Object.fromEntries(url.searchParams), runtimeContext));
      }
      if (route === "POST /api/v1/admin/activity-enrollments/query") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.ACTIVITY_ENROLLMENT_REVIEW);
        return ok(res, listAdminActivityEnrollments(data, body, runtimeContext));
      }
      if (route === "GET /api/v1/admin/activity-enrollments/review-queue") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.ACTIVITY_ENROLLMENT_REVIEW);
        return ok(res, listAdminActivityReviewQueue(data, Object.fromEntries(url.searchParams), runtimeContext));
      }
      if (route === "GET /api/v1/admin/formal-health/initialization") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.ADMIN_READ);
        return ok(res, listAdminFormalHealthInitialization(data, Object.fromEntries(url.searchParams)));
      }
      if (route === "GET /api/v1/admin/formal-health/scales") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.ADMIN_READ);
        return ok(res, listAdminFormalHealthScales(data, Object.fromEntries(url.searchParams)));
      }
      if (route === "GET /api/v1/admin/formal-health/recommendation-rules") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.ADMIN_READ);
        return ok(res, listAdminFormalHealthRecommendationRules(data, Object.fromEntries(url.searchParams)));
      }
      if (route === "GET /api/v1/admin/formal-health/lifestyle-advice") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.ADMIN_READ);
        return ok(res, listAdminFormalHealthLifestyleAdvice(data, Object.fromEntries(url.searchParams)));
      }
      if (route === "GET /api/v1/admin/content/welcome") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.ADMIN_READ);
        return ok(res, listAdminContentWelcome(data));
      }
      if (route === "GET /api/v1/admin/content/home-carousel") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.ADMIN_READ);
        return ok(res, listAdminContentHomeCarousel(data, Object.fromEntries(url.searchParams)));
      }
      if (route === "GET /api/v1/admin/content/shared-details") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.ADMIN_READ);
        return ok(res, listAdminContentSharedDetails(data, Object.fromEntries(url.searchParams)));
      }
      if (route === "GET /api/v1/admin/cloudbase-identity-probe") {
        const trustedWechatIdentity = await resolveTrustedWechatIdentity({
          adapter: runtimeContext.trustedWechatIdentityAdapter,
          request: req,
          env: runtimeContext.env,
        });
        return ok(res, getCloudbaseIdentityProbe({
          headers: req.headers,
          appCode: url.searchParams.get("appCode") || url.searchParams.get("app_code") || "",
          trustedWechatIdentity,
        }));
      }
      if (route === "POST /api/v1/admin/cloudbase-object-storage/probe") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        if (!requestId) throw Object.assign(new Error("CloudBase object storage probe request_id required"), { code: 400 });
        const result = await withIdempotency(data, req, () => runCloudbaseObjectStorageProbe(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, adminPrincipal, requestId }), requestId);
        return ok(res, { code: 0, message: "ok", data: result });
      }
      if (route === "POST /api/v1/admin/formal-users/query") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.ADMIN_READ);
        return ok(res, {
          code: 0,
          message: "ok",
          data: adminFormalUserQuery.queryByPhone(data, body),
        });
      }
      if (route === "POST /api/v1/admin/formal-health/initialization/draft") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.HEALTH_CONTENT_WRITE);
        const command = prepareAdminCommandBody(req, adminPrincipal, body, "初始化建档草稿", "HEALTH_INITIALIZATION_DRAFT_SAVE");
        return ok(res, await withIdempotency(data, req, () => saveAdminFormalHealthInitializationDraft(data, command, runtimeContext)));
      }
      if (route === "POST /api/v1/admin/formal-health/initialization/publish") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.HEALTH_PUBLISH);
        const command = prepareAdminCommandBody(req, adminPrincipal, body, "初始化建档发布", "HEALTH_INITIALIZATION_PUBLISH");
        return ok(res, await withIdempotency(data, req, () => publishAdminFormalHealthInitialization(data, command, runtimeContext)));
      }
      if (route === "POST /api/v1/admin/formal-health/scales/draft") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.HEALTH_CONTENT_WRITE);
        const command = prepareAdminCommandBody(req, adminPrincipal, body, "健康量表草稿", "HEALTH_SCALE_DRAFT_SAVE");
        return ok(res, await withIdempotency(data, req, () => saveAdminFormalHealthScaleDraft(data, command, runtimeContext)));
      }
      if (route === "POST /api/v1/admin/formal-health/scales/publish") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.HEALTH_PUBLISH);
        const command = prepareAdminCommandBody(req, adminPrincipal, body, "健康量表发布", "HEALTH_SCALE_PUBLISH");
        return ok(res, await withIdempotency(data, req, () => publishAdminFormalHealthScale(data, command, runtimeContext)));
      }
      if (route === "POST /api/v1/admin/formal-health/recommendation-rules/draft") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.HEALTH_CONTENT_WRITE);
        const command = prepareAdminCommandBody(req, adminPrincipal, body, "推荐规则草稿", "HEALTH_RECOMMENDATION_DRAFT_SAVE");
        return ok(res, await withIdempotency(data, req, () => saveAdminFormalHealthRecommendationRuleDraft(data, command, runtimeContext)));
      }
      if (route === "POST /api/v1/admin/formal-health/recommendation-rules/publish") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.HEALTH_PUBLISH);
        const command = prepareAdminCommandBody(req, adminPrincipal, body, "推荐规则发布", "HEALTH_RECOMMENDATION_PUBLISH");
        return ok(res, await withIdempotency(data, req, () => publishAdminFormalHealthRecommendationRule(data, command, runtimeContext)));
      }
      if (route === "POST /api/v1/admin/formal-health/lifestyle-advice/draft") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.HEALTH_CONTENT_WRITE);
        const command = prepareAdminCommandBody(req, adminPrincipal, body, "生活方式建议草稿", "HEALTH_LIFESTYLE_DRAFT_SAVE");
        return ok(res, await withIdempotency(data, req, () => saveAdminFormalHealthLifestyleAdviceDraft(data, command, runtimeContext)));
      }
      if (route === "POST /api/v1/admin/formal-health/lifestyle-advice/publish") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.HEALTH_PUBLISH);
        const command = prepareAdminCommandBody(req, adminPrincipal, body, "生活方式建议发布", "HEALTH_LIFESTYLE_PUBLISH");
        return ok(res, await withIdempotency(data, req, () => publishAdminFormalHealthLifestyleAdvice(data, command, runtimeContext)));
      }
      if (route === "POST /api/v1/admin/content/assets") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONTENT_WRITE);
        const command = prepareAdminCommandBody(req, adminPrincipal, body, "内容素材上传", "CONTENT_ASSET_UPLOAD");
        return ok(res, await withIdempotency(data, req, () => uploadAdminContentAsset(data, command, runtimeContext)));
      }
      if (route === "POST /api/v1/admin/content/targets/validate") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONTENT_WRITE);
        return ok(res, validateAdminContentTarget(data, body, runtimeContext));
      }
      if (route === "POST /api/v1/admin/content/welcome/draft") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONTENT_WRITE);
        const command = prepareAdminCommandBody(req, adminPrincipal, body, "欢迎页草稿", "CONTENT_WELCOME_DRAFT_SAVE");
        return ok(res, await withIdempotency(data, req, () => saveAdminContentWelcomeDraft(data, command, runtimeContext)));
      }
      if (route === "POST /api/v1/admin/content/home-carousel/draft") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONTENT_WRITE);
        const command = prepareAdminCommandBody(req, adminPrincipal, body, "首页轮播草稿", "CONTENT_HOME_DRAFT_SAVE");
        return ok(res, await withIdempotency(data, req, () => saveAdminContentHomeCarouselDraft(data, command, runtimeContext)));
      }
      if (route === "POST /api/v1/admin/content/shared-details/draft") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONTENT_WRITE);
        const command = prepareAdminCommandBody(req, adminPrincipal, body, "共用详情草稿", "CONTENT_DETAIL_DRAFT_SAVE");
        return ok(res, await withIdempotency(data, req, () => saveAdminContentSharedDetailDraft(data, command, runtimeContext)));
      }
      if (route === "POST /api/v1/admin/content-release/preview-complete") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONTENT_PUBLISH);
        const command = prepareAdminCommandBody(req, adminPrincipal, body, "内容预览确认", "CONTENT_PREVIEW_COMPLETE");
        return ok(res, await withIdempotency(data, req, () => markAdminContentPreviewCompleted(data, command, runtimeContext)));
      }
      if (route === "POST /api/v1/admin/content-release/publish") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONTENT_PUBLISH);
        const command = prepareAdminCommandBody(req, adminPrincipal, body, "内容版本发布", "CONTENT_RELEASE_PUBLISH");
        return ok(res, await withIdempotency(data, req, () => publishAdminContentCandidate(data, command, runtimeContext)));
      }
      if (route === "POST /api/v1/admin/content-release/unpublish") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONTENT_PUBLISH);
        const command = prepareAdminCommandBody(req, adminPrincipal, body, "内容版本下线", "CONTENT_VERSION_UNPUBLISH");
        return ok(res, await withIdempotency(data, req, () => unpublishAdminContentVersion(data, command, runtimeContext)));
      }
      if (route === "POST /api/v1/admin/activities/draft") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.ACTIVITY_CONTENT_WRITE);
        const command = prepareActivityAdminCommandBody(req, adminPrincipal, body, "活动草稿", "ACTIVITY_DRAFT_UPSERT");
        return ok(res, await withIdempotency(
          data,
          req,
          () => upsertActivityDraft(data, command, runtimeContext),
          command.idempotencyKey
        ));
      }
      if (route === "POST /api/v1/admin/activities/submit-review") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.ACTIVITY_CONTENT_WRITE);
        const command = prepareActivityAdminCommandBody(req, adminPrincipal, body, "活动提交审核", "ACTIVITY_SUBMIT_REVIEW");
        return ok(res, await withIdempotency(
          data,
          req,
          () => submitActivityForReview(data, command, runtimeContext),
          command.idempotencyKey
        ));
      }
      if (route === "POST /api/v1/admin/activities/request-changes") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.ACTIVITY_CONTENT_WRITE);
        const command = prepareActivityAdminCommandBody(req, adminPrincipal, body, "活动审核退回", "ACTIVITY_REQUEST_CHANGES");
        return ok(res, await withIdempotency(
          data,
          req,
          () => requestActivityChanges(data, command, { ...runtimeContext, adminPrincipal }),
          command.idempotencyKey
        ));
      }
      if (route === "POST /api/v1/admin/activities/publish") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.ACTIVITY_PUBLISH);
        const command = prepareActivityAdminCommandBody(req, adminPrincipal, body, "活动发布", "ACTIVITY_PUBLISH");
        return ok(res, await withIdempotency(
          data,
          req,
          () => publishActivity(data, command, { ...runtimeContext, adminPrincipal }),
          command.idempotencyKey
        ));
      }
      if (route === "POST /api/v1/admin/activities/unpublish") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.ACTIVITY_PUBLISH);
        const command = prepareActivityAdminCommandBody(req, adminPrincipal, body, "活动下架", "ACTIVITY_UNPUBLISH");
        return ok(res, await withIdempotency(
          data,
          req,
          () => unpublishActivity(data, command, { ...runtimeContext, adminPrincipal }),
          command.idempotencyKey
        ));
      }
      if (route === "POST /api/v1/admin/activities/archive") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.ACTIVITY_PUBLISH);
        const command = prepareActivityAdminCommandBody(req, adminPrincipal, body, "活动归档", "ACTIVITY_ARCHIVE");
        return ok(res, await withIdempotency(
          data,
          req,
          () => archiveActivity(data, command, { ...runtimeContext, adminPrincipal }),
          command.idempotencyKey
        ));
      }
      if (route === "POST /api/v1/admin/activity-sessions/create") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.ACTIVITY_SESSION_CONTROL);
        const command = prepareActivityAdminCommandBody(req, adminPrincipal, body, "创建活动场次", "ACTIVITY_SESSION_CREATE");
        return ok(res, await withIdempotency(
          data,
          req,
          () => createActivitySession(data, command, runtimeContext),
          command.idempotencyKey
        ));
      }
      if (route === "POST /api/v1/admin/activity-sessions/state") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.ACTIVITY_SESSION_CONTROL);
        const command = prepareActivityAdminCommandBody(req, adminPrincipal, body, "更新活动场次", "ACTIVITY_SESSION_STATE");
        return ok(res, await withIdempotency(
          data,
          req,
          () => updateActivitySessionState(data, command, runtimeContext),
          command.idempotencyKey
        ));
      }
      if (route === "POST /api/v1/admin/activity-sessions/cancel") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.ACTIVITY_SESSION_CONTROL);
        const command = prepareActivityAdminCommandBody(req, adminPrincipal, body, "取消活动场次", "ACTIVITY_SESSION_CANCEL");
        return ok(res, await withIdempotency(
          data,
          req,
          () => cancelActivitySession(
            data,
            command,
            { ...runtimeContext, adminPrincipal }
          ),
          command.idempotencyKey
        ));
      }
      if (route === "POST /api/v1/admin/activity-enrollments/review") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.ACTIVITY_ENROLLMENT_REVIEW);
        const command = prepareActivityAdminCommandBody(req, adminPrincipal, body, "审核活动报名", "ACTIVITY_ENROLLMENT_REVIEW");
        return ok(res, await withIdempotency(
          data,
          req,
          () => reviewActivityEnrollment(
            data,
            command,
            runtimeContext
          ),
          command.idempotencyKey
        ));
      }
      if (route === "POST /api/v1/jobs/activity-review-timeouts") {
        if (!adminPrincipal.jobOnly) {
          throw createClientError("ACTIVITY_JOB_PRINCIPAL_REQUIRED", "该任务只接受定时任务身份", 403);
        }
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.ACTIVITY_ENROLLMENT_REVIEW);
        const command = prepareActivityAdminCommandBody(
          req,
          adminPrincipal,
          body,
          "活动审核超时处理",
          "ACTIVITY_REVIEW_TIMEOUTS"
        );
        return ok(res, await withIdempotency(
          data,
          req,
          () => expireActivityEnrollmentReviews(data, command, runtimeContext),
          command.idempotencyKey
        ));
      }
      if (route === "GET /api/v1/admin/release-record") {
        return ok(res, getReleaseRecord(data, { ...runtimeContext, target: url.searchParams.get("target") || "production" }));
      }
      if (route === "GET /api/v1/admin/audit-logs") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.AUDIT_READ);
        return ok(res, listAuditLogs(data, Object.fromEntries(url.searchParams)));
      }

      send(res, 404, { code: 404, message: "接口不存在", data: null });
    } catch (error) {
      if (isAtomicWriteError(error)) throw error;
      const failedCommandBody = req.commandIdempotencyContext
        && req.commandIdempotencyContext.request
        && req.commandIdempotencyContext.request.body || {};
      if (method === "POST" && url.pathname === "/api/v1/auth/login" && failedCommandBody.flowVersion === "FORMAL_LAUNCH_V1") {
        const conflict = sessionModule.fromIdentityError(error);
        if (conflict) return ok(res, conflict);
      }
      if (req.commandIdempotencyContext && req.commandIdempotencyContext.executor) {
        const response = clientErrorResponse(error, requestCorrelationId(req));
        return send(res, response.status, response.payload);
      }
      send(res, error.status || 200, {
        code: error.code || 500,
        message: error.message || "服务端错误",
        data: null,
      });
    }
  }

  const server = http.createServer(async (req, realResponse) => {
    let rollbackSnapshot = null;
    try {
      await initialPersistPromise;
      const url = new URL(req.url, "http://localhost");
      const method = req.method || "GET";
      if (method === "POST" && url.pathname === "/api/v1/auth/login") {
        try {
          const body = await readBody(req);
          const trustedWechatIdentity = await resolveTrustedWechatIdentity({
            adapter: runtimeContext.trustedWechatIdentityAdapter,
            request: req,
            env: runtimeContext.env,
          });
          req[PREPARED_WECHAT_LOGIN] = await prepareWechatLoginExternalInputs(body, {
            env: runtimeContext.env,
            headers: req.headers,
            trustedWechatIdentity,
          });
        } catch (error) {
          realResponse.responseSecurityHeaders = responseSecurityPolicy.headersFor(req);
          send(realResponse, error.status || 200, {
            code: error.code || 500,
            message: error.message || "服务端错误",
            data: null,
          });
          return;
        }
      }
      const bypassSnapshotTransaction = method === "POST"
        && url.pathname === PERFORMANCE_METRICS_ROUTE;
      if (!url.pathname.startsWith("/api/") || method === "OPTIONS" || bypassSnapshotTransaction) {
        await handleRequest(req, realResponse);
        return;
      }
      const bufferedResponse = createBufferedResponse();
      const execute = (requestStoreData, transactionControl = {}) => handleRequest(req, bufferedResponse, {
        storeData: requestStoreData,
        transactionCheckpoint: transactionControl.checkpoint,
        transactionResume: transactionControl.resume,
        commandRecovery: transactionControl.commandRecovery,
      });
      if (typeof storeAdapter.runRequest === "function") {
        const writesStore = method !== "GET";
        await storeAdapter.runRequest({
          write: writesStore,
          // Handled business failures can include audit or retry evidence and must persist.
          shouldCommit: () => writesStore,
        }, execute);
      } else {
        rollbackSnapshot = typeof storeAdapter.exportSnapshot === "function" ? storeAdapter.exportSnapshot() : null;
        await execute();
        if (typeof storeAdapter.save === "function") {
          await Promise.resolve(storeAdapter.save());
        }
      }
      bufferedResponse.flush(realResponse);
    } catch (error) {
      if (rollbackSnapshot && typeof storeAdapter.importSnapshot === "function") {
        try {
          await Promise.resolve(storeAdapter.importSnapshot(rollbackSnapshot));
        } catch (rollbackError) {
          console.error("Store rollback failed: STORE_ROLLBACK_FAILED");
        }
      }
      const storeErrorCode = String(error && error.code || "");
      console.error(
        "Store transaction failed:",
        /^[A-Z0-9_-]{1,64}$/.test(storeErrorCode) ? storeErrorCode : "STORE_TRANSACTION_FAILED"
      );
      if (!realResponse.headersSent) {
        send(realResponse, 503, { code: 50301, message: "数据保存失败，请稍后重试", data: null });
      } else {
        realResponse.destroy(error);
      }
    }
  });

  server.store = data;
  server.storeAdapter = storeAdapter;
  server.commandResultCodec = commandResultCodec;
  server.readyPromise = initialPersistPromise;
  return server;
}

module.exports = {
  createApp,
  hasElementAdminBuild,
  resolveElementAdminDir,
};
