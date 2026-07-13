const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { createMemoryStore } = require("./store");
const { runCloudbaseObjectStorageProbe } = require("./cloudbaseObjectStorageProbe");
const { buildRuntimeMetadata } = require("./runtimeMetadata");
const {
  ADMIN_CAPABILITIES,
  capabilityListForRole,
  normalizeRole,
  requireAdminCapability,
} = require("./adminAccessControl");
const {
  adminDashboard,
  adminLaunchReadiness,
  applyCorrection,
  applyRefund,
  archiveReleaseEvidencePack,
  approveRefund,
  claimCoupon,
  completeOperationTask,
  confirmAdminOrderMatch,
  confirmImport,
  continueAsDailyUser,
  cleanupAdminLifecycleUserExports,
  cancelAdminLifecycleSettlementJob,
  copyAdminLifecycleFilterPreset,
  createAdminLifecycleUserExport,
  createAdminLifecycleSettlementJob,
  createFeedbackFollowTask,
  createStore,
  dailyHistory,
  dailyStats,
  dailyTrend,
  deleteAdminLifecycleFilterPreset,
  deliverAdminLifecycleUserExport,
  executeAdminLifecycleSettlementBatch,
  executeAdminOrderIncrementSync,
  executeAdminRewardDelivery,
  executeAdminProductSync,
  executeAdminSettlementBatch,
  downloadAdminLifecycleUserExport,
  downloadSignedAdminLifecycleUserExport,
  exportAdminLifecycleUsersCsv,
  exportAdminOperationalAnalyticsCsv,
  listAdminLifecycleFilterPresets,
  upsertAdminOperationalAlertRule,
  upsertAdminLifecycleFilterPreset,
  runAdminOperationalAlertJob,
  getActiveCampaign,
  getActionAdapterCalibration,
  getAdminConfigWorkbench,
  getAdminLifecycleExportDeliveryHealth,
  getAdminLifecycleWorkbench,
  getAdminOperationalAnalytics,
  getCheckinReminderTemplate,
  getCloudbaseIdentityProbe,
  getHealthConsentStatus,
  getPrivacyNotice,
  getProfile,
  getAdapterCalibration,
  getCouponStatus,
  getExternalAdapters,
  getExternalSampleTemplate,
  getAdminUserDetail,
  getImportBatch,
  getProduct,
  exportImportFailuresCsv,
  getQuestionnaire,
  getQuestionnaireAnswerStatus,
  getQuestionnaireStatus,
  getReadyToStartUsers,
  getReleaseEvidenceArchive,
  getReleaseEvidencePack,
  getReleaseRecord,
  getUserOrders,
  getUserConsultations,
  getConsultationSla,
  getConsultationSlaEscalations,
  getConsultationAdvisorWorkbench,
  getTaskProgress,
  getRecordDetail,
  getRecordList,
  getRefundStatus,
  getSession,
  getSettlementStatus,
  getUserState,
  importExternalSamples,
  loginWithWechat,
  joinCampaign,
  listConsultationAdvisorAssignments,
  listExternalSampleReviews,
  listImportBatches,
  listAdminLegacyDeprecationDecisions,
  listAdminYouzanCustomers,
  listLegacyDataMigrationDecisions,
  listAdminLifecycleUserExports,
  listAdminLifecycleSettlementJobs,
  listAuditLogs,
  listConsultationWeworkWritebacks,
  listOrderAfterSalesRecords,
  listWeWorkTouchJobs,
  listProducts,
  listProductionCutoverProofs,
  listRootMemberCenterJumpProofs,
  listLegacyDataMigrationExecutions,
  listOperationTasks,
  markCouponUsed,
  matchOrder,
  previewAdminLifecycleSettlementBatch,
  previewAdminOrderIncrementSync,
  previewAdminOrderMatch,
  previewAdminProductSync,
  previewAdminSettlement,
  previewAdminSettlementBatch,
  previewCorrection,
  previewExternalSamples,
  previewImport,
  planWeWorkTouches,
  publishCampaignRuleVersion,
  queryAdminRewardDeliveryStatus,
  recordConsultationAdvisorAssignment,
  recordCheckinReminderSubscription,
  recordConsultationWeworkWriteback,
  recordAdminLegacyDeprecationDecision,
  recordCouponRepurchaseClick,
  recordLegacyDataMigrationDecision,
  recordLegacyDataMigrationExecution,
  recordProductionCutoverProof,
  recordRootMemberCenterJumpProof,
  recordProductJump,
  recordHealthConsentDecision,
  recordUserTaskEvent,
  retryFailedAdminLifecycleSettlementJob,
  evaluateUserSettlement,
  rollbackExternalAdapterRun,
  resolveManualReview,
  resolveAdminManualReview,
  resolveAdminManualReviewBatch,
  runDueAdminLifecycleExportDeliveries,
  runDueExternalAdapterRetries,
  runAdminLifecycleSettlementJob,
  runExternalAdapter,
  runDailyAudit,
  runDueCheckinReminders,
  signReleaseRecord,
  runDueAdminLifecycleSettlementJobs,
  runDueWeWorkTouches,
  runAdminLifecycleUserExportJob,
  runHealthDataRetentionCleanup,
  runYouzanIdentityReconciliation,
  runAdminLifecycleSettlementJobCleanup,
  reviewAdminLifecycleUserExportApproval,
  searchAdminOrderMatching,
  startCheckin,
  syncManualOrder,
  syncOrderAfterSalesBatch,
  submitCheckin,
  submitDailyCheckin,
  submitProfile,
  submitQuestionnaireAnswer,
  submitQuestionnaire,
  upsertOrderAfterSalesRecord,
  trackEvent,
  updateDisplayProfile,
  updateOrderFulfillment,
  upsertExternalStatusMapping,
  upsertCampaign,
  upsertProduct,
  upsertTaskDefinition,
  uploadImage,
} = require("./domain");

const publicDir = path.join(__dirname, "..", "public");
const sourceAdminDistDir = path.join(__dirname, "..", "..", "admin", "dist");
const bundledAdminDistDir = path.join(publicDir, "admin-dist");
const defaultAdminDistDirs = [sourceAdminDistDir, bundledAdminDistDir];

function readBody(req) {
  return new Promise((resolve, reject) => {
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
}

function send(res, status, payload, headers = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  if (typeof res.recordPayload === "function") res.recordPayload(payload);
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Request-Id,X-Admin-Token,X-ROOT-ADMIN-TOKEN,X-WX-OPENID,X-WX-UNIONID,X-ROOT-APP-CODE",
    "Content-Type": typeof payload === "string" ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
    ...headers,
  });
  res.end(body);
}

function ok(res, payload) {
  send(res, 200, payload);
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

function isCloudRuntime(env = process.env) {
  return Boolean(
    env.ROOT_CLOUDBASE_ENV_ID ||
      env.CLOUDBASE_ENV_ID ||
      env.TCB_ENV ||
      env.SCF_NAMESPACE ||
      env.K_SERVICE ||
      env.WX_CLOUD_ENV
  );
}

function shouldRequireConfiguredAdminToken(env = process.env) {
  if (Object.prototype.hasOwnProperty.call(env, "ROOT_REQUIRE_ADMIN_TOKEN")) {
    return boolEnv(env.ROOT_REQUIRE_ADMIN_TOKEN);
  }
  if (boolEnv(env.ROOT_ALLOW_UNCONFIGURED_ADMIN_ACCESS)) return false;
  return env.NODE_ENV === "production" || isCloudRuntime(env);
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
          if (item && item.token) entries.push({
            token: String(item.token),
            operatorId: String(item.operatorId || item.operator_id || item.name || "operator"),
            role: String(item.role || "operator"),
          });
        });
      } else if (parsed && typeof parsed === "object") {
        Object.entries(parsed).forEach(([operatorId, value]) => {
          if (typeof value === "string") {
            entries.push({ token: value, operatorId, role: "operator" });
            return;
          }
          if (value && value.token) entries.push({
            token: String(value.token),
            operatorId,
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

function parseJobTokens(env = process.env) {
  const tokens = [];
  if (env.ROOT_ADMIN_JOB_TOKENS) {
    try {
      const parsed = JSON.parse(env.ROOT_ADMIN_JOB_TOKENS);
      if (Array.isArray(parsed)) {
        parsed.forEach((item) => {
          const token = typeof item === "string" ? item : item && item.token;
          if (token) tokens.push(String(token));
        });
      } else if (parsed && typeof parsed === "object") {
        Object.values(parsed).forEach((item) => {
          const token = typeof item === "string" ? item : item && item.token;
          if (token) tokens.push(String(token));
        });
      }
    } catch (_) {
      // Invalid rotation config fails closed unless the singular token is present.
    }
  }
  if (env.ROOT_ADMIN_JOB_TOKEN) tokens.push(String(env.ROOT_ADMIN_JOB_TOKEN));
  return Array.from(new Set(tokens.filter((token) => token.trim())));
}

function secureTokenEqual(candidate, provided) {
  if (!candidate || !provided) return false;
  const left = crypto.createHash("sha256").update(String(candidate)).digest();
  const right = crypto.createHash("sha256").update(String(provided)).digest();
  return crypto.timingSafeEqual(left, right);
}

function getAdminPrincipal(req, env = process.env, pathname = "") {
  const token = getAdminToken(req);
  const jobTokens = parseJobTokens(env);
  if (pathname.startsWith("/api/v1/jobs/") && jobTokens.some((candidate) => secureTokenEqual(candidate, token))) {
    return { operatorId: "cloudbase-job", role: "job", tokenConfigured: true, jobOnly: true };
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

function resolveMemberCenterProductPath(env = process.env) {
  return textEnv(
    env,
    "ROOT_MEMBER_CENTER_PRODUCT_PATH",
    textEnv(env, "ROOT_YOUZAN_PRODUCT_PATH", textEnv(env, "YOUZAN_PRODUCT_PATH", textEnv(env, "YOUZAN_MINIPROGRAM_PRODUCT_PATH")))
  );
}

function ensureDefaultMemberCenterProduct(data, context = {}) {
  const env = context.env || process.env;
  if (boolEnv(env.ROOT_DISABLE_MEMBER_CENTER_PRODUCT_SEED)) return false;
  const pathValue = resolveMemberCenterProductPath(env);
  if (!pathValue && !boolEnv(env.ROOT_MEMBER_CENTER_PRODUCT_AUTO_SEED)) return false;

  const productId = textEnv(env, "ROOT_MEMBER_CENTER_DEFAULT_PRODUCT_ID", "ROOT_MEMBER_CENTER_DEFAULT");
  const title = textEnv(env, "ROOT_MEMBER_CENTER_DEFAULT_PRODUCT_TITLE", "Root 会员中心商品");
  const skuId = textEnv(env, "ROOT_MEMBER_CENTER_DEFAULT_SKU_ID", `${productId}_SKU`);
  upsertProduct(data, {
    productId,
    title,
    subtitle: textEnv(env, "ROOT_MEMBER_CENTER_DEFAULT_PRODUCT_SUBTITLE", "跳转 Root 会员中心购买"),
    summary: textEnv(env, "ROOT_MEMBER_CENTER_DEFAULT_PRODUCT_SUMMARY", "myRoot 展示商品，购买在 Root 会员中心完成。"),
    description: textEnv(env, "ROOT_MEMBER_CENTER_DEFAULT_PRODUCT_DESCRIPTION", "商品、库存、价格与优惠以 Root 会员中心展示为准。"),
    imageUrl: textEnv(env, "ROOT_MEMBER_CENTER_DEFAULT_PRODUCT_IMAGE_URL", "/static/icon/shop.png"),
    priceText: textEnv(env, "ROOT_MEMBER_CENTER_DEFAULT_PRODUCT_PRICE_TEXT", "以 Root 会员中心为准"),
    status: textEnv(env, "ROOT_MEMBER_CENTER_DEFAULT_PRODUCT_STATUS", "ACTIVE"),
    badge: textEnv(env, "ROOT_MEMBER_CENTER_DEFAULT_PRODUCT_BADGE", "Root会员中心"),
    youzanAppId: textEnv(env, "ROOT_MEMBER_CENTER_APPID", textEnv(env, "ROOT_YOUZAN_APP_ID", textEnv(env, "YOUZAN_MINIPROGRAM_APPID"))),
    youzanPath: pathValue,
    campaignId: textEnv(env, "ROOT_MEMBER_CENTER_DEFAULT_CAMPAIGN_ID", "ROOT_ROADSHOW_DEFAULT"),
    displayOrder: Number(textEnv(env, "ROOT_MEMBER_CENTER_DEFAULT_PRODUCT_DISPLAY_ORDER", "10")),
    skus: [{
      skuId,
      skuName: textEnv(env, "ROOT_MEMBER_CENTER_DEFAULT_SKU_NAME", "默认规格"),
      priceText: textEnv(env, "ROOT_MEMBER_CENTER_DEFAULT_SKU_PRICE_TEXT", "以 Root 会员中心为准"),
      stockStatus: textEnv(env, "ROOT_MEMBER_CENTER_DEFAULT_SKU_STOCK_STATUS", "UNKNOWN"),
    }],
  }, context);
  return true;
}

function adminOperatorId(principal, body = {}) {
  if (principal && principal.tokenConfigured) return principal.operatorId;
  return body.operatorId || body.operator_id || (principal ? principal.operatorId : "");
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

function withIdempotency(data, req, action, explicitRequestId = "") {
  const requestId = explicitRequestId || req.headers["x-request-id"];
  if (!requestId) return action();
  if (data.idempotency[requestId]) return data.idempotency[requestId];
  const result = action();
  if (result && typeof result.then === "function") {
    return result.then((value) => {
      data.idempotency[requestId] = value;
      return value;
    }, (error) => {
      delete data.idempotency[requestId];
      throw error;
    });
  }
  data.idempotency[requestId] = result;
  return result;
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
    "Access-Control-Allow-Origin": "*",
    "Content-Type": types[ext] || "application/octet-stream",
  });
  fs.createReadStream(absolute).pipe(res);
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
  const runtimeMetadata = buildRuntimeMetadata(runtimeEnv);
  const elementAdminDir = resolveElementAdminDir(options.adminDistDir, runtimeEnv);
  const runtimeContext = {
    storeAdapter,
    env: runtimeEnv,
    adapterImplementations: options.adapterImplementations || {},
    fetchImpl: options.fetchImpl,
    objectStorageAdapter: options.objectStorageAdapter,
    cloudbaseAppFactory: options.cloudbaseAppFactory,
    runtimeMetadata,
    adminTransitionOptions: {
      sourceAdminDistDir,
      bundledAdminDistDir,
      elementAdminDir,
      legacyAdminFile: path.join(publicDir, "admin.html"),
    },
  };
  const initialPersistPromise = typeof storeAdapter.runRequest === "function"
    ? storeAdapter.runRequest({ write: true }, () => ensureDefaultMemberCenterProduct(data, runtimeContext))
    : ensureDefaultMemberCenterProduct(data, runtimeContext)
      ? Promise.resolve().then(() => storeAdapter.save())
      : Promise.resolve();

  async function handleRequest(req, res, requestContext = {}) {
    const url = new URL(req.url, "http://localhost");
    const method = req.method || "GET";

    if (method === "OPTIONS") return send(res, 204, "");
    if (method === "GET" && url.pathname === "/health") {
      return ok(res, { code: 0, message: "ok", data: { service: "root-checkin", ...runtimeMetadata } });
    }
    if (method === "GET" && url.pathname === "/ready") {
      const health = typeof storeAdapter.checkHealth === "function"
        ? await storeAdapter.checkHealth()
        : { ok: true, ...(storeAdapter.getStoreHealth ? storeAdapter.getStoreHealth() : { kind: storeAdapter.kind }) };
      return send(res, health.ok === false ? 503 : 200, {
        code: health.ok === false ? 50301 : 0,
        message: health.ok === false ? "store unavailable" : "ready",
        data: {
          service: "root-checkin",
          ...runtimeMetadata,
          store: {
            kind: storeAdapter.kind,
            connected: health.ok !== false,
            migrationVersion: health.migrationVersion || "",
            revision: health.revision ?? null,
            ...(storeAdapter.kind === "mysql" ? {
              leastPrivilegeReady: health.leastPrivilegeReady === true,
              privilegeScope: health.privilegeScope || "UNKNOWN",
              privilegePolicyEnforced: health.privilegePolicyEnforced === true,
            } : {}),
          },
        },
      });
    }
    if (method === "GET" && url.pathname === "/") return staticFile("admin.html", res);
    if (method === "GET" && ["/admin", "/admin/", "/admin/index.html"].includes(url.pathname)) {
      if (hasElementAdminBuild(elementAdminDir)) return staticFile("index.html", res, elementAdminDir);
      return staticFile("admin.html", res);
    }
    if (method === "GET" && url.pathname.startsWith("/admin/assets/")) {
      if (hasElementAdminBuild(elementAdminDir)) return staticFile(url.pathname.replace(/^\/admin\//, ""), res, elementAdminDir);
      return staticFile("missing-admin-dist", res, elementAdminDir);
    }
    if (method === "GET" && ["/admin-legacy", "/admin-legacy/"].includes(url.pathname)) return staticFile("admin.html", res);
    if (method === "GET" && url.pathname.startsWith("/assets/")) return staticFile(url.pathname.slice(1), res);
    if (method === "GET" && ["/admin.css", "/admin.js"].includes(url.pathname)) return staticFile(url.pathname.slice(1), res);
    if (requiresAdminAccess(url.pathname) && !hasAdminAccess(req, runtimeContext.env, url.pathname)) {
      return send(res, 401, { code: 40101, message: "请先输入后台访问口令", data: null });
    }

    try {
      const token = getToken(req);
      const adminPrincipal = requiresAdminAccess(url.pathname) ? getAdminPrincipal(req, runtimeContext.env, url.pathname) : null;
      const body = ["POST", "PUT", "PATCH"].includes(method) ? await readBody(req) : {};
      const route = `${method} ${url.pathname}`;

      if (route === "POST /api/v1/auth/login") {
        return ok(res, await withIdempotency(data, req, () => loginWithWechat(data, body, {
          env: runtimeContext.env,
          headers: req.headers,
        })));
      }
      if (route === "GET /api/v1/privacy/notice") return ok(res, getPrivacyNotice(runtimeContext));
      if (route === "GET /api/v1/user/state") return ok(res, getUserState(data, token, runtimeContext));
      if (route === "GET /api/v1/privacy/health-consent") return ok(res, getHealthConsentStatus(data, token, runtimeContext));
      if (route === "POST /api/v1/privacy/health-consent") return ok(res, withIdempotency(data, req, () => recordHealthConsentDecision(data, token, body, runtimeContext)));
      if (route === "GET /api/v1/user/profile") return ok(res, getProfile(data, token));
      if (route === "GET /api/v1/user/orders") return ok(res, getUserOrders(data, token));
      if (route === "GET /api/v1/user/consultations") return ok(res, getUserConsultations(data, token));
      if (route === "GET /api/v1/campaigns/active") return ok(res, getActiveCampaign(data, token, Object.fromEntries(url.searchParams), runtimeContext));
      if (route === "POST /api/v1/campaigns/join") return ok(res, withIdempotency(data, req, () => joinCampaign(data, token, body, runtimeContext)));
      if (route === "GET /api/v1/tasks/progress") return ok(res, getTaskProgress(data, token, Object.fromEntries(url.searchParams), runtimeContext));
      if (route === "POST /api/v1/tasks/events") return ok(res, withIdempotency(data, req, () => recordUserTaskEvent(data, token, body, runtimeContext)));
      if (route === "GET /api/v1/notifications/checkin-reminder-template") return ok(res, getCheckinReminderTemplate(data, token, runtimeContext));
      if (route === "POST /api/v1/notifications/subscriptions") return ok(res, withIdempotency(data, req, () => recordCheckinReminderSubscription(data, token, body, runtimeContext)));
      if (route === "GET /api/v1/settlement/status") return ok(res, getSettlementStatus(data, token, Object.fromEntries(url.searchParams), runtimeContext));
      if (route === "POST /api/v1/settlement/evaluate") return ok(res, withIdempotency(data, req, () => evaluateUserSettlement(data, token, body, runtimeContext)));
      if (route === "GET /api/v1/products") return ok(res, listProducts(data, token, Object.fromEntries(url.searchParams), runtimeContext));
      if (method === "GET" && url.pathname.startsWith("/api/v1/products/") && url.pathname !== "/api/v1/products/jump") {
        return ok(res, getProduct(data, token, url.pathname.split("/").pop(), runtimeContext));
      }
      if (route === "POST /api/v1/products/jump") return ok(res, withIdempotency(data, req, () => recordProductJump(data, token, body, runtimeContext)));
      if (route === "POST /api/v1/user/profile") return ok(res, withIdempotency(data, req, () => submitProfile(data, token, body, runtimeContext)));
      if (route === "POST /api/v1/user/display-profile") return ok(res, withIdempotency(data, req, () => updateDisplayProfile(data, token, body)));
      if (route === "POST /api/v1/order/match") return ok(res, withIdempotency(data, req, () => matchOrder(data, token, body)));
      if (route === "POST /api/v1/checkin/start") return ok(res, withIdempotency(data, req, () => startCheckin(data, token, body)));
      if (route === "GET /api/v1/checkin/session") return ok(res, getSession(data, token));
      if (route === "POST /api/v1/checkin/submit") return ok(res, withIdempotency(data, req, () => submitCheckin(data, token, body, undefined, runtimeContext)));
      if (route === "GET /api/v1/checkin/records") return ok(res, getRecordList(data, token));
      if (method === "GET" && url.pathname.startsWith("/api/v1/checkin/records/")) {
        return ok(res, getRecordDetail(data, token, url.pathname.split("/").pop()));
      }
      if (route === "GET /api/v1/questionnaire") return ok(res, getQuestionnaire(data, token, url.searchParams.get("type")));
      if (route === "GET /api/v1/questionnaire/answers/status") return ok(res, getQuestionnaireAnswerStatus(data, token, Object.fromEntries(url.searchParams)));
      if (route === "POST /api/v1/questionnaire/answers") return ok(res, withIdempotency(data, req, () => submitQuestionnaireAnswer(data, token, body, undefined, runtimeContext)));
      if (route === "GET /api/v1/questionnaire/status") return ok(res, getQuestionnaireStatus(data, token));
      if (route === "POST /api/v1/questionnaire/submit") return ok(res, withIdempotency(data, req, () => submitQuestionnaire(data, token, body, undefined, runtimeContext)));
      if (route === "POST /api/v1/refund/apply") return ok(res, withIdempotency(data, req, () => applyRefund(data, token)));
      if (route === "GET /api/v1/refund/status") return ok(res, getRefundStatus(data, token));
      if (route === "GET /api/v1/coupon/status") return ok(res, getCouponStatus(data, token));
      if (route === "POST /api/v1/coupon/claim") return ok(res, withIdempotency(data, req, () => claimCoupon(data, token, body)));
      if (route === "POST /api/v1/coupon/repurchase-click") return ok(res, recordCouponRepurchaseClick(data, token, body));
      if (route === "POST /api/v1/user/continue-daily") return ok(res, withIdempotency(data, req, () => continueAsDailyUser(data, token)));
      if (route === "GET /api/v1/daily/stats") return ok(res, dailyStats(data, token));
      if (route === "POST /api/v1/daily/submit") return ok(res, withIdempotency(data, req, () => submitDailyCheckin(data, token, body)));
      if (route === "GET /api/v1/daily/history") return ok(res, dailyHistory(data, token, Object.fromEntries(url.searchParams)));
      if (route === "GET /api/v1/daily/trend") return ok(res, dailyTrend(data, token, url.searchParams.get("range") || "7d"));
      if (route === "POST /api/v1/event/track") return ok(res, trackEvent(data, token, body));
      if (route === "POST /api/v1/upload/image") return ok(res, uploadImage(data, token, body, runtimeContext));
      if (route === "POST /api/v1/jobs/daily-audit") return ok(res, runDailyAudit(data, body.date));
      if (route === "POST /api/v1/jobs/checkin-reminders") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        const execute = !(body.dryRun === true || body.dry_run === true);
        if (execute && !requestId) throw Object.assign(new Error("checkin reminder job request_id 必填"), { code: 400 });
        return ok(res, await withIdempotency(data, req, () => runDueCheckinReminders(data, {
          ...body,
          dryRun: !execute,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, {
          ...runtimeContext,
          requestId,
          requireTransactionalCheckpoint: execute,
          transactionCheckpoint: requestContext.transactionCheckpoint,
          transactionResume: requestContext.transactionResume,
        }), requestId));
      }
      if (route === "POST /api/v1/jobs/adapter-retry-due") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        const execute = !(body.dryRun === true || body.dry_run === true);
        if (execute && !requestId) throw Object.assign(new Error("adapter retry job request_id 必填"), { code: 400 });
        return ok(res, await withIdempotency(data, req, () => runDueExternalAdapterRetries(data, {
          ...body,
          dryRun: !execute,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, requestId }), requestId));
      }
      if (route === "POST /api/v1/jobs/operational-alerts") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        const execute = !(body.dryRun === true || body.dry_run === true);
        if (execute && !requestId) throw Object.assign(new Error("operational alert job request_id 必填"), { code: 400 });
        return ok(res, await withIdempotency(data, req, () => runAdminOperationalAlertJob(data, {
          ...body,
          dryRun: !execute,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, requestId }), requestId));
      }
      if (route === "POST /api/v1/jobs/wework-touch-due") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        const execute = !(body.dryRun === true || body.dry_run === true);
        if (execute && !requestId) throw Object.assign(new Error("wework touch job request_id 必填"), { code: 400 });
        return ok(res, await withIdempotency(data, req, () => runDueWeWorkTouches(data, {
          ...body,
          dryRun: !execute,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, requestId }), requestId));
      }
      if (route === "POST /api/v1/jobs/lifecycle-settlement-due") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.SETTLEMENT_EXECUTE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        const execute = !(body.dryRun === true || body.dry_run === true);
        if (execute && !requestId) throw Object.assign(new Error("lifecycle settlement job request_id 必填"), { code: 400 });
        return ok(res, await withIdempotency(data, req, () => runDueAdminLifecycleSettlementJobs(data, {
          ...body,
          dryRun: !execute,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, requestId }), requestId));
      }
      if (route === "POST /api/v1/jobs/lifecycle-settlement-cleanup") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.SETTLEMENT_EXECUTE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        const execute = !(body.dryRun === true || body.dry_run === true);
        if (execute && !requestId) throw Object.assign(new Error("lifecycle settlement cleanup request_id 必填"), { code: 400 });
        return ok(res, await withIdempotency(data, req, () => runAdminLifecycleSettlementJobCleanup(data, {
          ...body,
          dryRun: !execute,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, requestId }), requestId));
      }
      if (route === "POST /api/v1/jobs/lifecycle-users-export") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.ADMIN_READ);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        const execute = !(body.dryRun === true || body.dry_run === true);
        if (execute && !requestId) throw Object.assign(new Error("lifecycle users export request_id 必填"), { code: 400 });
        return ok(res, withIdempotency(data, req, () => runAdminLifecycleUserExportJob(data, {
          ...body,
          dryRun: !execute,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, adminPrincipal, requestId }), requestId));
      }
      if (route === "POST /api/v1/jobs/lifecycle-user-exports-cleanup") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.DATA_EXPORT_APPROVE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        const execute = !(body.dryRun === true || body.dry_run === true);
        if (execute && !requestId) throw Object.assign(new Error("lifecycle user exports cleanup request_id 必填"), { code: 400 });
        return ok(res, await withIdempotency(data, req, () => cleanupAdminLifecycleUserExports(data, {
          ...body,
          dryRun: !execute,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, adminPrincipal, requestId }), requestId));
      }
      if (route === "POST /api/v1/jobs/lifecycle-user-exports-delivery-retry") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.DATA_EXPORT_APPROVE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        const execute = !(body.dryRun === true || body.dry_run === true);
        if (execute && !requestId) throw Object.assign(new Error("lifecycle user exports delivery retry request_id 必填"), { code: 400 });
        return ok(res, await withIdempotency(data, req, () => runDueAdminLifecycleExportDeliveries(data, {
          ...body,
          dryRun: !execute,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, adminPrincipal, requestId }), requestId));
      }
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
      if (route === "POST /api/v1/jobs/youzan-identity-reconcile") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        const execute = body.execute === true || body.dryRun === false || body.dry_run === false;
        if (execute && !requestId) throw Object.assign(new Error("youzan identity reconcile job request_id 必填"), { code: 400 });
        return ok(res, await withIdempotency(data, req, () => runYouzanIdentityReconciliation(data, {
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
      if (route === "GET /api/v1/admin/dashboard") return ok(res, adminDashboard(data, runtimeContext));
      if (route === "GET /api/v1/admin/cloudbase-identity-probe") {
        return ok(res, getCloudbaseIdentityProbe({
          headers: req.headers,
          appCode: url.searchParams.get("appCode") || url.searchParams.get("app_code") || "",
        }));
      }
      if (route === "GET /api/v1/admin/config-workbench") return ok(res, getAdminConfigWorkbench(data, runtimeContext));
      if (route === "GET /api/v1/admin/lifecycle-filter-presets") {
        return ok(res, listAdminLifecycleFilterPresets(data, {
          ...Object.fromEntries(url.searchParams),
          operatorId: adminOperatorId(adminPrincipal, {}),
        }));
      }
      if (route === "GET /api/v1/admin/lifecycle-user-exports") {
        return ok(res, listAdminLifecycleUserExports(data, Object.fromEntries(url.searchParams), { ...runtimeContext, adminPrincipal }));
      }
      if (route === "GET /api/v1/admin/lifecycle-user-exports/delivery-health") {
        return ok(res, getAdminLifecycleExportDeliveryHealth(data, Object.fromEntries(url.searchParams), { ...runtimeContext, adminPrincipal }));
      }
      if (route === "GET /api/v1/admin/lifecycle-users/export") {
        return send(res, 200, exportAdminLifecycleUsersCsv(data, Object.fromEntries(url.searchParams), { ...runtimeContext, adminPrincipal }), {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": "attachment; filename=\"root-lifecycle-users.csv\"",
        });
      }
      if (method === "GET" && url.pathname.startsWith("/api/v1/lifecycle-user-exports/") && url.pathname.endsWith("/signed-download")) {
        const exportId = url.pathname.split("/").at(-2);
        const result = downloadSignedAdminLifecycleUserExport(data, exportId, Object.fromEntries(url.searchParams), runtimeContext);
        return send(res, 200, result.csvText, {
          "Content-Type": result.contentType,
          "Content-Disposition": `attachment; filename="${result.filename}"`,
        });
      }
      if (method === "GET" && url.pathname.startsWith("/api/v1/admin/lifecycle-user-exports/") && url.pathname.endsWith("/download")) {
        const exportId = url.pathname.split("/").at(-2);
        const result = downloadAdminLifecycleUserExport(data, exportId, { ...runtimeContext, adminPrincipal });
        return send(res, 200, result.csvText, {
          "Content-Type": result.contentType,
          "Content-Disposition": `attachment; filename="${result.filename}"`,
        });
      }
      if (route === "GET /api/v1/admin/lifecycle-settlement-jobs") {
        return ok(res, listAdminLifecycleSettlementJobs(data, Object.fromEntries(url.searchParams)));
      }
      if (route === "GET /api/v1/admin/lifecycle-users") return ok(res, getAdminLifecycleWorkbench(data, Object.fromEntries(url.searchParams)));
      if (route === "POST /api/v1/admin/lifecycle-users/settlement-batch-preview") {
        return ok(res, previewAdminLifecycleSettlementBatch(data, body, runtimeContext));
      }
      if (route === "POST /api/v1/admin/lifecycle-users/settlement-batch-execute") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.SETTLEMENT_EXECUTE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        return ok(res, withIdempotency(data, req, () => executeAdminLifecycleSettlementBatch(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, requestId }), requestId));
      }
      if (route === "POST /api/v1/admin/lifecycle-settlement-jobs/create") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.SETTLEMENT_EXECUTE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        return ok(res, withIdempotency(data, req, () => createAdminLifecycleSettlementJob(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, requestId }), requestId));
      }
      if (route === "POST /api/v1/admin/lifecycle-settlement-jobs/run") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.SETTLEMENT_EXECUTE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        return ok(res, withIdempotency(data, req, () => runAdminLifecycleSettlementJob(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, requestId }), requestId));
      }
      if (route === "POST /api/v1/admin/lifecycle-settlement-jobs/cancel") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.SETTLEMENT_EXECUTE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        return ok(res, withIdempotency(data, req, () => cancelAdminLifecycleSettlementJob(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, requestId }), requestId));
      }
      if (route === "POST /api/v1/admin/lifecycle-settlement-jobs/retry-failed") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.SETTLEMENT_EXECUTE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        return ok(res, withIdempotency(data, req, () => retryFailedAdminLifecycleSettlementJob(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, requestId }), requestId));
      }
      if (route === "POST /api/v1/admin/lifecycle-user-exports/create") {
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        return ok(res, withIdempotency(data, req, () => createAdminLifecycleUserExport(data, {
          ...body,
          dryRun: false,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, adminPrincipal, requestId }), requestId));
      }
      if (route === "POST /api/v1/admin/lifecycle-user-exports/review") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.DATA_EXPORT_APPROVE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        return ok(res, withIdempotency(data, req, () => reviewAdminLifecycleUserExportApproval(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, adminPrincipal, requestId }), requestId));
      }
      if (route === "POST /api/v1/admin/lifecycle-user-exports/deliver") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.DATA_EXPORT_APPROVE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        return ok(res, await withIdempotency(data, req, () => deliverAdminLifecycleUserExport(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, adminPrincipal, requestId }), requestId));
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
      if (route === "POST /api/v1/admin/lifecycle-filter-presets/upsert") {
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        return ok(res, withIdempotency(data, req, () => upsertAdminLifecycleFilterPreset(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }), requestId));
      }
      if (route === "POST /api/v1/admin/lifecycle-filter-presets/copy") {
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        return ok(res, withIdempotency(data, req, () => copyAdminLifecycleFilterPreset(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }), requestId));
      }
      if (route === "POST /api/v1/admin/lifecycle-filter-presets/delete") {
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        return ok(res, withIdempotency(data, req, () => deleteAdminLifecycleFilterPreset(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }), requestId));
      }
      if (route === "GET /api/v1/admin/operational-analytics") return ok(res, getAdminOperationalAnalytics(data, Object.fromEntries(url.searchParams)));
      if (route === "GET /api/v1/admin/operational-analytics/export") {
        return send(res, 200, exportAdminOperationalAnalyticsCsv(data, Object.fromEntries(url.searchParams)), {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": "attachment; filename=\"root-operational-analytics.csv\"",
        });
      }
      if (route === "POST /api/v1/admin/operational-alert-rules/upsert") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        if (!requestId) throw Object.assign(new Error("operational alert rule request_id 必填"), { code: 400 });
        return ok(res, withIdempotency(data, req, () => upsertAdminOperationalAlertRule(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }), requestId));
      }
      if (route === "GET /api/v1/admin/launch-readiness") {
        return ok(res, adminLaunchReadiness(data, { ...runtimeContext, target: url.searchParams.get("target") || "production" }));
      }
      if (route === "GET /api/v1/admin/ready-to-start") return ok(res, getReadyToStartUsers(data, url.searchParams.get("date") || undefined));
      if (route === "GET /api/v1/admin/tasks") return ok(res, listOperationTasks(data, Object.fromEntries(url.searchParams)));
      if (route === "GET /api/v1/admin/order-matching/search") return ok(res, searchAdminOrderMatching(data, Object.fromEntries(url.searchParams)));
      if (route === "POST /api/v1/admin/order-matching/preview") return ok(res, previewAdminOrderMatch(data, body));
      if (route === "POST /api/v1/admin/order-matching/confirm") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        return ok(res, withIdempotency(data, req, () => confirmAdminOrderMatch(data, body)));
      }
      if (route === "GET /api/v1/admin/order-after-sales") {
        return ok(res, listOrderAfterSalesRecords(data, Object.fromEntries(url.searchParams)));
      }
      if (route === "POST /api/v1/admin/order-after-sales/upsert") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        if (!requestId) throw Object.assign(new Error("order after-sales request_id 必填"), { code: 400 });
        return ok(res, withIdempotency(data, req, () => upsertOrderAfterSalesRecord(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, requestId }), requestId));
      }
      if (route === "POST /api/v1/admin/order-after-sales/sync") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        if (!requestId) throw Object.assign(new Error("order after-sales sync request_id 必填"), { code: 400 });
        return ok(res, withIdempotency(data, req, () => syncOrderAfterSalesBatch(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, requestId }), requestId));
      }
      if (method === "GET" && url.pathname.startsWith("/api/v1/admin/users/") && url.pathname.endsWith("/detail")) {
        const userId = url.pathname.split("/").at(-2);
        return ok(res, getAdminUserDetail(data, userId));
      }
      if (method === "POST" && url.pathname.startsWith("/api/v1/admin/users/") && url.pathname.endsWith("/follow")) {
        const userId = url.pathname.split("/").at(-2);
        return ok(res, createFeedbackFollowTask(data, userId, body));
      }
      if (route === "GET /api/v1/admin/consultation-wework-writebacks") {
        return ok(res, listConsultationWeworkWritebacks(data, Object.fromEntries(url.searchParams)));
      }
      if (route === "GET /api/v1/admin/wework-touch-jobs") {
        return ok(res, listWeWorkTouchJobs(data, Object.fromEntries(url.searchParams)));
      }
      if (route === "POST /api/v1/admin/wework-touch-jobs/plan") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        return ok(res, withIdempotency(data, req, () => planWeWorkTouches(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, requestId }), requestId));
      }
      if (route === "POST /api/v1/admin/wework-touch-jobs/run") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        if (!(body.dryRun === true || body.dry_run === true) && !requestId) throw Object.assign(new Error("wework touch run request_id 必填"), { code: 400 });
        return ok(res, await withIdempotency(data, req, () => runDueWeWorkTouches(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, requestId }), requestId));
      }
      if (route === "GET /api/v1/admin/consultation-advisor-assignments") {
        return ok(res, listConsultationAdvisorAssignments(data, Object.fromEntries(url.searchParams)));
      }
      if (route === "GET /api/v1/admin/consultation-sla") {
        return ok(res, getConsultationSla(data, Object.fromEntries(url.searchParams), runtimeContext));
      }
      if (route === "GET /api/v1/admin/consultation-sla-escalations") {
        return ok(res, getConsultationSlaEscalations(data, Object.fromEntries(url.searchParams), runtimeContext));
      }
      if (route === "GET /api/v1/admin/consultation-advisor-workbench") {
        return ok(res, getConsultationAdvisorWorkbench(data, Object.fromEntries(url.searchParams), runtimeContext));
      }
      if (route === "POST /api/v1/admin/consultation-advisor-assignments") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.REVIEW_RESOLVE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        if (!requestId) throw Object.assign(new Error("consultation advisor assignment request_id 必填"), { code: 400 });
        return ok(res, withIdempotency(data, req, () => recordConsultationAdvisorAssignment(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, requestId }), requestId));
      }
      if (route === "POST /api/v1/admin/consultation-wework-writebacks") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.REVIEW_RESOLVE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        if (!requestId) throw Object.assign(new Error("consultation wework writeback request_id 必填"), { code: 400 });
        return ok(res, await withIdempotency(data, req, () => recordConsultationWeworkWriteback(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, requestId }), requestId));
      }
      if (route === "POST /api/v1/admin/orders/sync") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        return ok(res, withIdempotency(data, req, () => syncManualOrder(data, body)));
      }
      if (route === "POST /api/v1/admin/orders/fulfillment") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        return ok(res, withIdempotency(data, req, () => updateOrderFulfillment(data, body)));
      }
      if (route === "POST /api/v1/admin/orders/increment-preview") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        return ok(res, await previewAdminOrderIncrementSync(data, body, runtimeContext));
      }
      if (route === "POST /api/v1/admin/orders/increment-execute") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        return ok(res, await withIdempotency(data, req, () => executeAdminOrderIncrementSync(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, requestId })));
      }
      if (route === "POST /api/v1/admin/campaigns/upsert") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        return ok(res, withIdempotency(data, req, () => upsertCampaign(data, body)));
      }
      if (route === "POST /api/v1/admin/task-definitions/upsert") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        return ok(res, withIdempotency(data, req, () => upsertTaskDefinition(data, body)));
      }
      if (route === "POST /api/v1/admin/campaign-rules/publish") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        return ok(res, withIdempotency(data, req, () => publishCampaignRuleVersion(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId: req.headers["x-request-id"] || body.requestId || body.request_id || "",
        })));
      }
      if (route === "POST /api/v1/admin/settlement/preview") return ok(res, previewAdminSettlement(data, body, runtimeContext));
      if (route === "POST /api/v1/admin/settlement/batch-preview") return ok(res, previewAdminSettlementBatch(data, body, runtimeContext));
      if (route === "POST /api/v1/admin/settlement/batch-execute") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.SETTLEMENT_EXECUTE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        return ok(res, withIdempotency(data, req, () => executeAdminSettlementBatch(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, requestId })));
      }
      if (route === "POST /api/v1/admin/reward-delivery/execute") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.REWARD_DELIVERY_WRITE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        return ok(res, await withIdempotency(data, req, () => executeAdminRewardDelivery(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, requestId })));
      }
      if (route === "POST /api/v1/admin/reward-delivery/status-query") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.REWARD_DELIVERY_WRITE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        return ok(res, await withIdempotency(data, req, () => queryAdminRewardDeliveryStatus(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, requestId })));
      }
      if (route === "POST /api/v1/admin/products/upsert") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        return ok(res, withIdempotency(data, req, () => upsertProduct(data, body, runtimeContext)));
      }
      if (route === "POST /api/v1/admin/products/sync-preview") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        return ok(res, await previewAdminProductSync(data, body, runtimeContext));
      }
      if (route === "POST /api/v1/admin/products/sync-execute") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        return ok(res, await withIdempotency(data, req, () => executeAdminProductSync(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, requestId })));
      }
      if (route === "GET /api/v1/admin/adapter-calibration") return ok(res, getAdapterCalibration(data, runtimeContext));
      if (route === "GET /api/v1/admin/action-adapter-calibration") {
        return ok(res, getActionAdapterCalibration(data, {
          ...runtimeContext,
          target: url.searchParams.get("target") || "production",
        }));
      }
      if (route === "GET /api/v1/admin/release-record") {
        return ok(res, getReleaseRecord(data, { ...runtimeContext, target: url.searchParams.get("target") || "production" }));
      }
      if (route === "GET /api/v1/admin/release-evidence-pack") {
        return ok(res, getReleaseEvidencePack(data, {
          ...runtimeContext,
          target: url.searchParams.get("target") || "production",
          baseUrl: url.searchParams.get("baseUrl") || "",
          strict: ["1", "true", "yes"].includes(String(url.searchParams.get("strict") || "").toLowerCase()),
        }));
      }
      if (route === "GET /api/v1/admin/release-evidence-pack/archive") {
        const archiveId = url.searchParams.get("archiveId") || url.searchParams.get("archive_id") || "";
        if (!archiveId) throw Object.assign(new Error("archiveId 必填"), { code: 400 });
        return ok(res, getReleaseEvidenceArchive(data, archiveId));
      }
      if (route === "POST /api/v1/admin/release-evidence-pack/archive") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        return ok(res, withIdempotency(data, req, () => archiveReleaseEvidencePack(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, {
          ...runtimeContext,
          target: body.target || "production",
          baseUrl: body.baseUrl || "",
          strict: Boolean(body.strict),
        }), requestId));
      }
      if (route === "POST /api/v1/admin/release-signoffs") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        return ok(res, withIdempotency(data, req, () => signReleaseRecord(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }), requestId));
      }
      if (route === "GET /api/v1/admin/admin-legacy-deprecation-decisions") {
        return ok(res, listAdminLegacyDeprecationDecisions(data, Object.fromEntries(url.searchParams)));
      }
      if (route === "POST /api/v1/admin/admin-legacy-deprecation-decisions") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        return ok(res, withIdempotency(data, req, () => recordAdminLegacyDeprecationDecision(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }), requestId));
      }
      if (route === "GET /api/v1/admin/production-cutover-proofs") {
        return ok(res, listProductionCutoverProofs(data, Object.fromEntries(url.searchParams)));
      }
      if (route === "POST /api/v1/admin/production-cutover-proofs") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        return ok(res, withIdempotency(data, req, () => recordProductionCutoverProof(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
          releaseVersion: runtimeMetadata.version,
          releaseId: runtimeMetadata.releaseId,
          releaseIdConfigured: runtimeMetadata.releaseIdConfigured,
        }), requestId));
      }
      if (route === "GET /api/v1/admin/root-member-center-jump-proofs") {
        return ok(res, listRootMemberCenterJumpProofs(data, Object.fromEntries(url.searchParams)));
      }
      if (route === "POST /api/v1/admin/root-member-center-jump-proofs") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        return ok(res, withIdempotency(data, req, () => recordRootMemberCenterJumpProof(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }), requestId));
      }
      if (route === "GET /api/v1/admin/legacy-data-migration-decisions") {
        return ok(res, listLegacyDataMigrationDecisions(data, Object.fromEntries(url.searchParams)));
      }
      if (route === "POST /api/v1/admin/legacy-data-migration-decisions") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        return ok(res, withIdempotency(data, req, () => recordLegacyDataMigrationDecision(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }), requestId));
      }
      if (route === "GET /api/v1/admin/legacy-data-migration-executions") {
        return ok(res, listLegacyDataMigrationExecutions(data, Object.fromEntries(url.searchParams)));
      }
      if (route === "POST /api/v1/admin/legacy-data-migration-executions") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        return ok(res, withIdempotency(data, req, () => recordLegacyDataMigrationExecution(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }), requestId));
      }
      if (route === "GET /api/v1/admin/external-adapters") return ok(res, getExternalAdapters(data, runtimeContext));
      if (route === "GET /api/v1/admin/youzan-customers") {
        return ok(res, listAdminYouzanCustomers(data, Object.fromEntries(url.searchParams)));
      }
      if (route === "POST /api/v1/admin/external-adapters/run") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        return ok(res, await withIdempotency(data, req, () => runExternalAdapter(data, body, runtimeContext)));
      }
      if (route === "POST /api/v1/admin/external-adapters/retry-due") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        return ok(res, await withIdempotency(data, req, () => runDueExternalAdapterRetries(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        }, { ...runtimeContext, requestId }), requestId));
      }
      if (route === "POST /api/v1/admin/external-adapters/rollback") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        return ok(res, await withIdempotency(data, req, () => rollbackExternalAdapterRun(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        })));
      }
      if (route === "GET /api/v1/admin/external-samples/template") return ok(res, getExternalSampleTemplate(url.searchParams.get("sourceType") || ""));
      if (route === "GET /api/v1/admin/external-sample-reviews") {
        return ok(res, listExternalSampleReviews(data, Object.fromEntries(url.searchParams)));
      }
      if (route === "POST /api/v1/admin/external-samples/preview") return ok(res, previewExternalSamples(data, body));
      if (route === "POST /api/v1/admin/external-samples/import") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        return ok(res, withIdempotency(data, req, () => importExternalSamples(data, body)));
      }
      if (route === "GET /api/v1/admin/imports") return ok(res, listImportBatches(data, Object.fromEntries(url.searchParams)));
      if (route === "POST /api/v1/admin/imports/preview") return ok(res, withIdempotency(data, req, () => previewImport(data, body)));
      if (method === "GET" && url.pathname.startsWith("/api/v1/admin/imports/") && url.pathname.endsWith("/failures.csv")) {
        const batchId = url.pathname.split("/").at(-2);
        return send(res, 200, exportImportFailuresCsv(data, batchId), {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${batchId}-failures.csv"`,
        });
      }
      if (method === "GET" && url.pathname.startsWith("/api/v1/admin/imports/")) {
        const batchId = url.pathname.split("/").at(-1);
        return ok(res, getImportBatch(data, batchId));
      }
      if (method === "POST" && url.pathname.startsWith("/api/v1/admin/imports/") && url.pathname.endsWith("/confirm")) {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        const batchId = url.pathname.split("/").at(-2);
        return ok(res, withIdempotency(data, req, () => confirmImport(data, batchId, { ...body, operatorId: adminOperatorId(adminPrincipal, body) })));
      }
      if (route === "POST /api/v1/admin/corrections/preview") return ok(res, previewCorrection(data, body));
      if (route === "POST /api/v1/admin/corrections/apply") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        return ok(res, withIdempotency(data, req, () => applyCorrection(data, { ...body, operatorId: adminOperatorId(adminPrincipal, body) })));
      }
      if (route === "GET /api/v1/admin/audit-logs") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.AUDIT_READ);
        return ok(res, listAuditLogs(data, Object.fromEntries(url.searchParams)));
      }
      if (route === "POST /api/v1/admin/external-status-mappings") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        return ok(res, withIdempotency(data, req, () => upsertExternalStatusMapping(data, body)));
      }
      if (method === "POST" && url.pathname.startsWith("/api/v1/admin/tasks/") && url.pathname.endsWith("/complete")) {
        const taskId = url.pathname.split("/").at(-2);
        return ok(res, completeOperationTask(data, taskId, body));
      }
      if (method === "POST" && url.pathname.startsWith("/api/v1/admin/tasks/") && url.pathname.endsWith("/resolve")) {
        const taskId = url.pathname.split("/").at(-2);
        return ok(res, resolveManualReview(data, taskId, body));
      }
      if (route === "POST /api/v1/admin/manual-reviews/batch-resolve") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.REVIEW_RESOLVE);
        const requestId = req.headers["x-request-id"] || body.requestId || body.request_id || "";
        return ok(res, withIdempotency(data, req, () => resolveAdminManualReviewBatch(data, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId,
        })));
      }
      if (method === "POST" && url.pathname.startsWith("/api/v1/admin/manual-reviews/") && url.pathname.endsWith("/resolve")) {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.REVIEW_RESOLVE);
        const reviewItemId = url.pathname.split("/").at(-2);
        return ok(res, resolveAdminManualReview(data, reviewItemId, {
          ...body,
          operatorId: adminOperatorId(adminPrincipal, body),
          requestId: req.headers["x-request-id"] || body.requestId || body.request_id || "",
        }));
      }
      if (method === "POST" && url.pathname.startsWith("/api/v1/admin/refunds/") && url.pathname.endsWith("/approve")) {
        const refundId = url.pathname.split("/").at(-2);
        return ok(res, approveRefund(data, refundId));
      }
      if (method === "POST" && url.pathname.startsWith("/api/v1/admin/coupons/") && url.pathname.endsWith("/use")) {
        const couponId = url.pathname.split("/").at(-2);
        return ok(res, markCouponUsed(data, couponId));
      }

      send(res, 404, { code: 404, message: "接口不存在", data: null });
    } catch (error) {
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
      if (!url.pathname.startsWith("/api/") || (req.method || "GET") === "OPTIONS") {
        await handleRequest(req, realResponse);
        return;
      }
      const bufferedResponse = createBufferedResponse();
      const execute = (_storeData, transactionControl = {}) => handleRequest(req, bufferedResponse, {
        transactionCheckpoint: transactionControl.checkpoint,
        transactionResume: transactionControl.resume,
      });
      if (typeof storeAdapter.runRequest === "function") {
        await storeAdapter.runRequest({
          write: true,
          // Handled business failures can include audit or retry evidence and must persist.
          shouldCommit: () => true,
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
          console.error("Store rollback failed:", rollbackError.message);
        }
      }
      console.error("Store transaction failed:", error.message);
      if (!realResponse.headersSent) {
        send(realResponse, 503, { code: 50301, message: "数据保存失败，请稍后重试", data: null });
      } else {
        realResponse.destroy(error);
      }
    }
  });

  server.store = data;
  server.storeAdapter = storeAdapter;
  server.readyPromise = initialPersistPromise;
  return server;
}

module.exports = {
  createApp,
  hasElementAdminBuild,
  resolveElementAdminDir,
};
