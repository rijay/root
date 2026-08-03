const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { createMemoryStore } = require("./store");
const { createMemoryActivityTaskReadAdapter } = require("./activityTaskReadAdapter");
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

function safeAggregateCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
const {
  ADMIN_COMMANDS,
  ADMIN_CAPABILITIES,
  capabilityListForRole,
  normalizeRole,
  requireAdminCapability,
  requireAdminCommandCapability,
} = require("./adminAccessControl");
const {
  adminDashboard,
  adminLaunchReadiness,
  applyCorrection,
  applyRefund,
  archiveActivity,
  archiveReleaseEvidencePack,
  approveRefund,
  claimCoupon,
  completeOperationTask,
  confirmAdminOrderMatch,
  confirmImport,
  continueAsDailyUser,
  cancelActivityEnrollment,
  cancelActivitySession,
  copyAdminLifecycleFilterPreset,
  createAdminLifecycleUserExport,
  createActivitySession,
  createFeedbackFollowTask,
  createStore,
  dailyHistory,
  dailyStats,
  dailyTrend,
  deleteAdminLifecycleFilterPreset,
  deliverAdminLifecycleUserExport,
  executeAdminOrderIncrementSync,
  executeAdminProductSync,
  expireActivityEnrollmentReviews,
  downloadAdminLifecycleUserExport,
  downloadSignedAdminLifecycleUserExport,
  exportAdminLifecycleUsersCsv,
  exportAdminOperationalAnalyticsCsv,
  listAdminLifecycleFilterPresets,
  upsertAdminOperationalAlertRule,
  upsertAdminLifecycleFilterPreset,
  getActiveCampaign,
  getActivityDetail,
  getActivityEnrollments,
  getActionAdapterCalibration,
  getAdminLifecycleExportDeliveryHealth,
  getAdminLifecycleWorkbench,
  getAdminOperationalAnalytics,
  getCheckinReminderTemplate,
  getCloudbaseIdentityProbe,
  getHealthConsentStatus,
  getFormalHealthBootstrap,
  getFormalHealthInitialAssessment,
  getFormalContentDetail,
  getFormalProfile,
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
  getRecordDetail,
  getRecordList,
  getRefundStatus,
  getSession,
  getUserState,
  importExternalSamples,
  enrollActivity,
  loginWithWechat,
  prepareWechatLoginExternalInputs,
  joinCampaign,
  listActivities,
  listAdminActivityDefinitions,
  listAdminActivityEnrollments,
  listAdminActivityReviewQueue,
  listAdminActivitySessions,
  listConsultationAdvisorAssignments,
  listExternalSampleReviews,
  listFormalHomeContent,
  listImportBatches,
  listAdminLegacyDeprecationDecisions,
  listAdminYouzanCustomers,
  listLegacyDataMigrationDecisions,
  listAdminLifecycleUserExports,
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
  previewAdminOrderIncrementSync,
  previewAdminOrderMatch,
  previewAdminProductSync,
  previewCorrection,
  previewExternalSamples,
  previewImport,
  planWeWorkTouches,
  publishActivity,
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
  requestActivityChanges,
  rollbackExternalAdapterRun,
  resolveManualReview,
  reviewActivityEnrollment,
  runDueExternalAdapterRetries,
  runExternalAdapter,
  signReleaseRecord,
  stableRootUserIdForToken,
  runDueWeWorkTouches,
  runHealthDataRetentionCleanup,
  reviewAdminLifecycleUserExportApproval,
  searchAdminOrderMatching,
  startCheckin,
  syncManualOrder,
  syncOrderAfterSalesBatch,
  submitCheckin,
  submitDailyCheckin,
  submitFormalProfile,
  submitFormalHealthInitialAssessment,
  submitProfile,
  submitQuestionnaireAnswer,
  submitQuestionnaire,
  upsertOrderAfterSalesRecord,
  trackEvent,
  updateDisplayProfile,
  updateOrderFulfillment,
  upsertExternalStatusMapping,
  submitActivityForReview,
  unpublishActivity,
  updateActivitySessionState,
  upsertActivityDraft,
  upsertProduct,
  uploadImage,
} = require("./domain");

const publicDir = path.join(__dirname, "..", "public");
const sourceAdminDistDir = path.join(__dirname, "..", "..", "admin", "dist");
const bundledAdminDistDir = path.join(publicDir, "admin-dist");
const defaultAdminDistDirs = [sourceAdminDistDir, bundledAdminDistDir];

const V1_RUNTIME_CYCLE_ROUTE = "/api/v1/jobs/v1-runtime-cycle";
const PERFORMANCE_METRICS_ROUTE = "/api/v1/performance/events";
const V1_RUNTIME_CYCLE_BODY_KEYS = Object.freeze([
  "bridgeLimit",
  "dryRun",
  "execute",
  "recoveryLimit",
  "requestId",
  "scheduleId",
  "scheduledAt",
  "workerLimit",
]);
const V1_RUNTIME_TERMINAL_STATUSES = Object.freeze([
  "SUCCEEDED",
  "SKIPPED_BUSY",
  "FAILED_PRECONDITION",
  "REVIEW_REQUIRED",
]);

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactRuntimeRequiredFlag(env = {}) {
  const value = Object.prototype.hasOwnProperty.call(env, "ROOT_V1_RUNTIME_READY_REQUIRED")
    ? env.ROOT_V1_RUNTIME_READY_REQUIRED
    : "";
  if (value === undefined || value === null || value === "" || value === "false") return false;
  if (value === "true") return true;
  throw createClientError(
    50051,
    "v1 runtime readiness configuration invalid",
    500
  );
}

function stableRuntimeCode(value, fallback) {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,95}$/.test(value)
    ? value
    : fallback;
}

function fallbackV1RuntimeStatus(required, status) {
  return Object.freeze({
    contractVersion: "V1_RUNTIME_CONTROL_PLANE:v1",
    enabled: false,
    required,
    ready: !required && status === "V1_RUNTIME_CONTROL_PLANE_NOT_REQUIRED",
    status,
    killSwitch: "UNKNOWN",
    attestation: Object.freeze({
      state: "MISSING",
      cycleId: null,
      completedAt: null,
      ageSeconds: null,
      latestTerminalCycleId: null,
      latestTerminalStatus: null,
      latestTerminalCompletedAt: null,
    }),
    openAlerts: Object.freeze({
      totalCount: 0,
      blockerCount: 0,
      warningCount: 0,
      latestObservedAt: null,
    }),
    reviewRequiredCount: 0,
  });
}

function publicV1RuntimeStatus(report, required) {
  if (!plainRecord(report)
    || typeof report.ready !== "boolean"
    || typeof report.enabled !== "boolean"
    || !plainRecord(report.attestation)
    || !plainRecord(report.openAlerts)
    || !Number.isSafeInteger(report.openAlerts.totalCount)
    || report.openAlerts.totalCount < 0
    || !Number.isSafeInteger(report.openAlerts.blockerCount)
    || report.openAlerts.blockerCount < 0
    || !Number.isSafeInteger(report.openAlerts.warningCount)
    || report.openAlerts.warningCount < 0
    || !Number.isSafeInteger(report.reviewRequiredCount)
    || report.reviewRequiredCount < 0) {
    return fallbackV1RuntimeStatus(required, "V1_RUNTIME_CONTROL_PLANE_INSPECTION_INVALID");
  }
  const sourceAttestation = report.attestation;
  const sourceAlerts = report.openAlerts;
  const attestationState = ["BLOCKED", "BUSY", "MISSING", "SAFE", "STALE", "WARNING"]
    .includes(sourceAttestation.state) ? sourceAttestation.state : "MISSING";
  const cycleId = typeof sourceAttestation.cycleId === "string"
    && /^[0-9a-f]{64}$/.test(sourceAttestation.cycleId)
    ? sourceAttestation.cycleId
    : null;
  const completedAt = typeof sourceAttestation.completedAt === "string"
    && sourceAttestation.completedAt.length <= 32
    && Number.isFinite(Date.parse(sourceAttestation.completedAt))
    && new Date(Date.parse(sourceAttestation.completedAt)).toISOString() === sourceAttestation.completedAt
    ? sourceAttestation.completedAt
    : null;
  const ageSeconds = Number.isSafeInteger(sourceAttestation.ageSeconds)
    && sourceAttestation.ageSeconds >= 0
    ? sourceAttestation.ageSeconds
    : null;
  const latestTerminalCycleId = typeof sourceAttestation.latestTerminalCycleId === "string"
    && /^[0-9a-f]{64}$/.test(sourceAttestation.latestTerminalCycleId)
    ? sourceAttestation.latestTerminalCycleId
    : null;
  const latestTerminalStatus = V1_RUNTIME_TERMINAL_STATUSES
    .includes(sourceAttestation.latestTerminalStatus)
    ? sourceAttestation.latestTerminalStatus
    : null;
  const latestTerminalCompletedAt = typeof sourceAttestation.latestTerminalCompletedAt === "string"
    && sourceAttestation.latestTerminalCompletedAt.length <= 32
    && Number.isFinite(Date.parse(sourceAttestation.latestTerminalCompletedAt))
    && new Date(Date.parse(sourceAttestation.latestTerminalCompletedAt)).toISOString()
      === sourceAttestation.latestTerminalCompletedAt
    ? sourceAttestation.latestTerminalCompletedAt
    : null;
  const status = stableRuntimeCode(
    report.status,
    "V1_RUNTIME_CONTROL_PLANE_INSPECTION_INVALID"
  );
  const enabled = report.enabled === true;
  const killSwitch = ["DISENGAGED", "ENGAGED"].includes(report.killSwitch)
    ? report.killSwitch
    : "UNKNOWN";
  const totalCount = sourceAlerts.totalCount;
  const blockerCount = sourceAlerts.blockerCount;
  const warningCount = sourceAlerts.warningCount;
  const reviewRequiredCount = report.reviewRequiredCount;
  const rawProofFields = [
    sourceAttestation.cycleId,
    sourceAttestation.completedAt,
    sourceAttestation.ageSeconds,
  ];
  const hasProof = [cycleId, completedAt, ageSeconds].every((value) => value !== null);
  const proofShapeValid = hasProof || rawProofFields.every((value) => value === null);
  const rawTerminalFields = [
    sourceAttestation.latestTerminalCycleId,
    sourceAttestation.latestTerminalStatus,
    sourceAttestation.latestTerminalCompletedAt,
  ];
  const terminalFields = [
    latestTerminalCycleId,
    latestTerminalStatus,
    latestTerminalCompletedAt,
  ];
  const hasLatestTerminal = terminalFields.every((value) => value !== null);
  const terminalShapeValid = hasLatestTerminal || rawTerminalFields.every((value) => value === null);
  const validAttestation = proofShapeValid
    && terminalShapeValid
    && (attestationState === "MISSING"
      ? !hasProof && !hasLatestTerminal
      : attestationState === "BLOCKED"
        ? hasProof || hasLatestTerminal
        : hasProof);
  const structurallyValid = report.contractVersion === "V1_RUNTIME_CONTROL_PLANE:v1"
    && status !== "V1_RUNTIME_CONTROL_PLANE_INSPECTION_INVALID"
    && ["DISENGAGED", "ENGAGED"].includes(report.killSwitch)
    && validAttestation
    && totalCount === blockerCount + warningCount
    && (sourceAlerts.latestObservedAt === null
      || (typeof sourceAlerts.latestObservedAt === "string"
        && sourceAlerts.latestObservedAt.length <= 32
        && Number.isFinite(Date.parse(sourceAlerts.latestObservedAt))
        && new Date(Date.parse(sourceAlerts.latestObservedAt)).toISOString()
          === sourceAlerts.latestObservedAt));
  const readyStatusByState = {
    SAFE: "V1_RUNTIME_CONTROL_PLANE_READY",
    WARNING: "V1_RUNTIME_CONTROL_PLANE_READY_WITH_WARNING",
    BUSY: "V1_RUNTIME_CONTROL_PLANE_READY_BUSY",
  };
  const ready = structurallyValid
    && report.ready === true
    && enabled
    && status === readyStatusByState[attestationState]
    && killSwitch === "DISENGAGED"
    && blockerCount === 0
    && reviewRequiredCount === 0;
  return Object.freeze({
    contractVersion: "V1_RUNTIME_CONTROL_PLANE:v1",
    enabled,
    required,
    ready,
    status: structurallyValid ? status : "V1_RUNTIME_CONTROL_PLANE_INSPECTION_INVALID",
    killSwitch,
    attestation: Object.freeze({
      state: attestationState,
      cycleId,
      completedAt,
      ageSeconds,
      latestTerminalCycleId,
      latestTerminalStatus,
      latestTerminalCompletedAt,
    }),
    openAlerts: Object.freeze({
      totalCount,
      blockerCount,
      warningCount,
      latestObservedAt: typeof sourceAlerts.latestObservedAt === "string"
        && sourceAlerts.latestObservedAt.length <= 32
        ? sourceAlerts.latestObservedAt
        : null,
    }),
    reviewRequiredCount,
  });
}

async function inspectV1RuntimeControlPlane(controlPlane, required) {
  if (!controlPlane || typeof controlPlane.inspect !== "function") {
    return fallbackV1RuntimeStatus(
      required,
      required
        ? "V1_RUNTIME_CONTROL_PLANE_REQUIRED_BUT_UNAVAILABLE"
        : "V1_RUNTIME_CONTROL_PLANE_NOT_REQUIRED"
    );
  }
  try {
    return publicV1RuntimeStatus(await controlPlane.inspect(), required);
  } catch {
    return fallbackV1RuntimeStatus(required, "V1_RUNTIME_CONTROL_PLANE_INSPECTION_FAILED");
  }
}

function normalizeV1RuntimeCycleBody(body) {
  if (!plainRecord(body)
    || Object.keys(body).some((key) => !V1_RUNTIME_CYCLE_BODY_KEYS.includes(key))) {
    throw createClientError(40051, "v1 runtime cycle request invalid", 400);
  }
  if ((Object.prototype.hasOwnProperty.call(body, "dryRun") && typeof body.dryRun !== "boolean")
    || (Object.prototype.hasOwnProperty.call(body, "execute") && typeof body.execute !== "boolean")) {
    throw createClientError(40051, "v1 runtime cycle request invalid", 400);
  }
  if ((body.execute === true && body.dryRun === true)
    || (body.execute === false && body.dryRun === false)) {
    throw createClientError(40051, "v1 runtime cycle request flags conflict", 400);
  }
  if (Object.prototype.hasOwnProperty.call(body, "requestId")
    && (typeof body.requestId !== "string"
      || body.requestId.length < 1
      || body.requestId.length > 128
      || body.requestId !== body.requestId.trim()
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(body.requestId))) {
    throw createClientError(40051, "v1 runtime cycle request invalid", 400);
  }
  const schedule = {
    bridgeLimit: body.bridgeLimit,
    recoveryLimit: body.recoveryLimit,
    scheduleId: body.scheduleId,
    scheduledAt: body.scheduledAt,
    workerLimit: body.workerLimit,
  };
  if (!Number.isSafeInteger(schedule.bridgeLimit)
    || !Number.isSafeInteger(schedule.recoveryLimit)
    || !Number.isSafeInteger(schedule.workerLimit)
    || [schedule.bridgeLimit, schedule.recoveryLimit, schedule.workerLimit]
      .some((value) => value < 1 || value > 100)
    || typeof schedule.scheduleId !== "string"
    || schedule.scheduleId.length < 1
    || schedule.scheduleId.length > 128
    || schedule.scheduleId !== schedule.scheduleId.trim()
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(schedule.scheduleId)
    || typeof schedule.scheduledAt !== "string"
    || schedule.scheduledAt.length > 32
    || !Number.isFinite(Date.parse(schedule.scheduledAt))
    || new Date(Date.parse(schedule.scheduledAt)).toISOString() !== schedule.scheduledAt) {
    throw createClientError(40051, "v1 runtime cycle request invalid", 400);
  }
  return Object.freeze({
    execute: body.execute === true || body.dryRun === false,
    requestId: body.requestId || "",
    schedule: Object.freeze(schedule),
  });
}

function publicV1RuntimeCycleResult(result, dryRun, expectedScheduleId) {
  if (!plainRecord(result)
    || result.contractVersion !== "V1_RUNTIME_CONTROL_PLANE:v1"
    || result.scheduleId !== expectedScheduleId
    || typeof result.inputDigest !== "string"
    || !/^[0-9a-f]{64}$/.test(result.inputDigest)
    || !stableRuntimeCode(result.status, "")) {
    throw createClientError(50351, "v1 runtime cycle result invalid", 503);
  }
  if (dryRun) {
    const keyInventory = result.keyInventory;
    const runtime = result.runtime;
    if (typeof result.enabled !== "boolean"
      || typeof result.ready !== "boolean"
      || !plainRecord(keyInventory)
      || typeof keyInventory.ready !== "boolean"
      || !stableRuntimeCode(keyInventory.status, "")
      || !stableRuntimeCode(keyInventory.schemaStatus, "")
      || !Number.isSafeInteger(keyInventory.issueCount)
      || keyInventory.issueCount < 0
      || !plainRecord(runtime)
      || typeof runtime.ready !== "boolean"
      || !Array.isArray(runtime.blockerCodes)
      || runtime.blockerCodes.length > 64
      || runtime.blockerCodes.some((code) => !stableRuntimeCode(code, ""))) {
      throw createClientError(50351, "v1 runtime cycle result invalid", 503);
    }
    return Object.freeze({
      contractVersion: result.contractVersion,
      dryRun: true,
      enabled: result.enabled === true,
      ready: result.ready === true,
      status: result.status,
      scheduleId: result.scheduleId,
      inputDigest: result.inputDigest,
      keyInventory: Object.freeze({
        ready: keyInventory.ready === true,
        status: keyInventory.status,
        schemaStatus: keyInventory.schemaStatus,
        issueCount: keyInventory.issueCount,
      }),
      runtime: Object.freeze({
        ready: runtime.ready === true,
        blockerCodes: Object.freeze([...runtime.blockerCodes]),
      }),
    });
  }
  if (typeof result.cycleId !== "string"
    || !/^[0-9a-f]{64}$/.test(result.cycleId)
    || typeof result.replayed !== "boolean"
    || !Number.isSafeInteger(result.blockerCount)
    || result.blockerCount < 0
    || !["FAILED_PRECONDITION", "REVIEW_REQUIRED", "RUNNING", "SKIPPED_BUSY", "SUCCEEDED"]
      .includes(result.status)) {
    throw createClientError(50351, "v1 runtime cycle result invalid", 503);
  }
  const resultDigest = typeof result.resultDigest === "string" && /^[0-9a-f]{64}$/.test(result.resultDigest)
    ? result.resultDigest
    : null;
  const errorCode = result.errorCode === null ? null : stableRuntimeCode(result.errorCode, "");
  const completedAt = typeof result.completedAt === "string" && result.completedAt.length <= 32
    ? result.completedAt
    : null;
  const running = result.status === "RUNNING";
  const succeeded = result.status === "SUCCEEDED";
  if ((running && (resultDigest !== null || errorCode !== null || completedAt !== null || result.blockerCount !== 0))
    || (!running && (resultDigest === null || completedAt === null))
    || (succeeded && (errorCode !== null || result.blockerCount !== 0))
    || (!running && !succeeded && errorCode === "")) {
    throw createClientError(50351, "v1 runtime cycle result invalid", 503);
  }
  return Object.freeze({
    contractVersion: result.contractVersion,
    dryRun: false,
    scheduleId: result.scheduleId,
    cycleId: result.cycleId,
    status: result.status,
    replayed: result.replayed,
    inputDigest: result.inputDigest,
    resultDigest,
    blockerCount: result.blockerCount,
    errorCode,
    completedAt,
  });
}

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
  const v1RuntimeReadyRequired = exactRuntimeRequiredFlag(runtimeEnv);
  const v1RuntimeControlPlane = options.v1RuntimeControlPlane
    || storeAdapter.v1RuntimeControlPlane
    || null;
  const commandRequestDigestCodec = options.commandRequestDigestCodec || createCommandRequestDigestCodec(runtimeEnv);
  const commandResultCodec = options.commandResultCodec || createCommandResultCodec(runtimeEnv);
  const responseSecurityPolicy = createHttpResponseSecurityPolicy(runtimeEnv);
  const runtimeMetadata = buildRuntimeMetadata(runtimeEnv);
  const performanceMetricsModule = options.performanceMetricsModule || createPerformanceMetricsModule({
    logger: options.performanceLogger || console,
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
    activityTaskReadAdapter: options.activityTaskReadAdapter,
    notificationDeliveryCore: options.notificationDeliveryCore
      || storeAdapter.notificationDeliveryCore
      || null,
    v1RuntimeControlPlane,
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
      // This read crosses only the Control Plane Interface. It does not run the
      // key inventory scan or any runtime worker from the readiness path.
      const v1Runtime = await inspectV1RuntimeControlPlane(
        runtimeContext.v1RuntimeControlPlane,
        v1RuntimeReadyRequired
      );
      const runtimePrincipalRequired = storeAdapter.kind === "mysql"
        && health.runtimeAlertDeliveryEnabled === true;
      const runtimePrincipalRequiredRoleCount = safeAggregateCount(
        health.runtimePrincipalRequiredRoleCount
      );
      const runtimePrincipalVerifiedRoleCount = safeAggregateCount(
        health.runtimePrincipalVerifiedRoleCount
      );
      const runtimePrincipalRequiredRoutineCount = safeAggregateCount(
        health.runtimePrincipalRequiredRoutineCount
      );
      const runtimePrincipalVerifiedRoutineCount = safeAggregateCount(
        health.runtimePrincipalVerifiedRoutineCount
      );
      const runtimePrincipalIssueCount = safeAggregateCount(
        health.runtimePrincipalIssueCount
      );
      const runtimePrincipalReady = !runtimePrincipalRequired || (
        health.runtimePrincipalReady === true
        && runtimePrincipalRequiredRoleCount > 0
        && runtimePrincipalVerifiedRoleCount === runtimePrincipalRequiredRoleCount
        && runtimePrincipalRequiredRoutineCount > 0
        && runtimePrincipalVerifiedRoutineCount === runtimePrincipalRequiredRoutineCount
        && runtimePrincipalIssueCount === 0
      );
      const ready = health.ok !== false
        && persistence.ready
        && commandResultProtection.ready
        && commandRequestDigest.ready
        && runtimePrincipalReady
        && (!v1RuntimeReadyRequired || v1Runtime.ready);
      const code = health.ok === false
        ? 50301
        : !persistence.ready
          ? 50302
          : !commandResultProtection.ready
            ? 50303
            : !commandRequestDigest.ready
              ? 50304
              : v1RuntimeReadyRequired && !v1Runtime.ready
                ? 50305
                : !runtimePrincipalReady
                  ? 50306
                : 0;
      return send(res, ready ? 200 : 503, {
        code,
        message: health.ok === false
          ? "store unavailable"
          : persistence.ready
            ? commandResultProtection.ready
              ? commandRequestDigest.ready
                ? v1RuntimeReadyRequired && !v1Runtime.ready
                  ? "v1 runtime attestation unavailable"
                  : !runtimePrincipalReady
                    ? "runtime principal authority unavailable"
                  : "ready"
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
              runtimeAlertDeliveryEnabled: runtimePrincipalRequired,
              runtimePrincipalReady,
              runtimePrincipalRequiredRoleCount,
              runtimePrincipalVerifiedRoleCount,
              runtimePrincipalRequiredRoutineCount,
              runtimePrincipalVerifiedRoutineCount,
              runtimePrincipalIssueCount,
            } : {}),
          },
          commandRequestDigest,
          commandResultProtection,
          v1Runtime,
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
      if (route === "GET /api/v1/public/content/home") return ok(res, listFormalHomeContent(data, runtimeContext));
      if (route === "GET /api/v1/public/content/detail") {
        return ok(res, getFormalContentDetail(data, url.searchParams.get("contentId"), runtimeContext));
      }
      if (route === "GET /api/v1/user/state") return ok(res, getUserState(data, token, runtimeContext));
      if (route === "GET /api/v1/privacy/health-consent") return ok(res, getHealthConsentStatus(data, token, runtimeContext));
      if (route === "POST /api/v1/privacy/health-consent") return ok(res, withIdempotency(data, req, () => recordHealthConsentDecision(data, token, body, runtimeContext)));
      if (route === "GET /api/v1/user/profile") return ok(res, getProfile(data, token));
      if (route === "GET /api/v1/user/formal-profile") return ok(res, getFormalProfile(data, token));
      if (route === "GET /api/v1/health/root4u") return ok(res, getFormalHealthBootstrap(data, token, runtimeContext));
      if (route === "GET /api/v1/health/root4u/initial-assessment") {
        return ok(res, getFormalHealthInitialAssessment(data, token, runtimeContext));
      }
      if (route === "POST /api/v1/health/root4u/initial-assessment") {
        return ok(res, withIdempotency(data, req, () => submitFormalHealthInitialAssessment(data, token, body, runtimeContext)));
      }
      if (route === "GET /api/v1/user/orders") return ok(res, getUserOrders(data, token));
      if (route === "GET /api/v1/user/consultations") return ok(res, getUserConsultations(data, token));
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
      if (route === "GET /api/v1/campaigns/active") return ok(res, getActiveCampaign(data, token, Object.fromEntries(url.searchParams), runtimeContext));
      if (route === "POST /api/v1/campaigns/join") return ok(res, withIdempotency(data, req, () => joinCampaign(data, token, body, runtimeContext)));
      if (route === "GET /api/v1/notifications/checkin-reminder-template") return ok(res, getCheckinReminderTemplate(data, token, runtimeContext));
      if (route === "POST /api/v1/notifications/subscriptions") {
        return ok(res, await withIdempotency(
          data,
          req,
          () => recordCheckinReminderSubscription(data, token, body, runtimeContext)
        ));
      }
      if (route === "GET /api/v1/products") return ok(res, listProducts(data, token, Object.fromEntries(url.searchParams), runtimeContext));
      if (method === "GET" && url.pathname.startsWith("/api/v1/products/") && url.pathname !== "/api/v1/products/jump") {
        return ok(res, getProduct(data, token, url.pathname.split("/").pop(), runtimeContext));
      }
      if (route === "POST /api/v1/products/jump") return ok(res, withIdempotency(data, req, () => recordProductJump(data, token, body, runtimeContext)));
      if (route === "POST /api/v1/user/profile") return ok(res, withIdempotency(data, req, () => submitProfile(data, token, body, runtimeContext)));
      if (route === "POST /api/v1/user/formal-profile") return ok(res, withIdempotency(data, req, () => submitFormalProfile(data, token, body)));
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
      if (route === "POST /api/v1/questionnaire/answers") {
        const activityAssignmentRequested = Boolean(
          body.taskActivityAssignmentId
          || body.task_activity_assignment_id
          || body.taskDefinitionVersion
          || body.task_definition_version
        );
        let activityTaskSourceFacts = [];
        if (activityAssignmentRequested) {
          const rootUserId = stableRootUserIdForToken(data, token, runtimeContext);
          const activityTaskReadAdapter = requestContext.activityTaskReadAdapter
            || runtimeContext.activityTaskReadAdapter
            || createMemoryActivityTaskReadAdapter(data);
          activityTaskSourceFacts = await activityTaskReadAdapter.listByRootUser(rootUserId);
        }
        return ok(res, withIdempotency(data, req, () => submitQuestionnaireAnswer(
          data,
          token,
          body,
          undefined,
          { ...runtimeContext, activityTaskSourceFacts, activityTaskSourceFactsLoaded: activityAssignmentRequested }
        )));
      }
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
      if (route === `POST ${V1_RUNTIME_CYCLE_ROUTE}`) {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.CONFIG_WRITE);
        if (!runtimeContext.v1RuntimeControlPlane) {
          throw createClientError(50351, "v1 runtime control plane unavailable", 503);
        }
        const request = normalizeV1RuntimeCycleBody(body);
        if (request.execute) {
          requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.RUNTIME_CYCLE_EXECUTE);
        }
        const rawHeaderRequestId = String(req.headers["x-request-id"] || "");
        const headerRequestId = rawHeaderRequestId.trim();
        if (headerRequestId && (headerRequestId !== rawHeaderRequestId
          || headerRequestId.length > 128
          || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(headerRequestId))) {
          throw createClientError(40051, "v1 runtime cycle request id invalid", 400);
        }
        if (request.requestId && headerRequestId && request.requestId !== headerRequestId) {
          throw createClientError(40051, "v1 runtime cycle request id mismatch", 400);
        }
        const requestId = headerRequestId || request.requestId;
        if (request.execute && !requestId) {
          throw createClientError(40051, "v1 runtime cycle request id required", 400);
        }
        // scheduleId is the durable cross-instance idempotency identity stored
        // by the Control Plane. Execute correlation must be the same value so a
        // caller cannot reuse one request id with multiple durable cycles.
        if (request.execute && requestId !== request.schedule.scheduleId) {
          throw createClientError(40051, "v1 runtime cycle request identity mismatch", 400);
        }
        let result;
        try {
          result = request.execute
            ? await runtimeContext.v1RuntimeControlPlane.runScheduledCycle(request.schedule)
            : await runtimeContext.v1RuntimeControlPlane.previewScheduledCycle(request.schedule);
        } catch {
          throw createClientError(50351, "v1 runtime cycle unavailable", 503);
        }
        return ok(res, {
          code: 0,
          message: "ok",
          data: {
            ...publicV1RuntimeCycleResult(
              result,
              !request.execute,
              request.schedule.scheduleId
            ),
            requestId,
          },
        });
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
      if (route === "GET /api/v1/admin/me") return ok(res, {
        code: 0,
        message: "ok",
        data: adminPrincipalProfile(adminPrincipal),
      });
      if (route === "GET /api/v1/admin/dashboard") return ok(res, adminDashboard(data, runtimeContext));
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
      if (route === "GET /api/v1/admin/activity-enrollments/review-queue") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.ACTIVITY_ENROLLMENT_REVIEW);
        return ok(res, listAdminActivityReviewQueue(data, Object.fromEntries(url.searchParams), runtimeContext));
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
      if (route === "GET /api/v1/admin/lifecycle-users") {
        return ok(res, getAdminLifecycleWorkbench(data, Object.fromEntries(url.searchParams), runtimeContext));
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
      if (route === "POST /api/v1/admin/formal-users/query") {
        requireAdminCapability(adminPrincipal, ADMIN_CAPABILITIES.ADMIN_READ);
        return ok(res, {
          code: 0,
          message: "ok",
          data: adminFormalUserQuery.queryByPhone(data, body),
        });
      }
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
        return ok(res, withIdempotency(data, req, () => syncManualOrder(data, body, runtimeContext)));
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
        return ok(res, withIdempotency(data, req, () => importExternalSamples(data, body, undefined, runtimeContext)));
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
        return ok(res, withIdempotency(data, req, () => confirmImport(
          data,
          batchId,
          { ...body, operatorId: adminOperatorId(adminPrincipal, body) },
          undefined,
          runtimeContext
        )));
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
        requireAdminCommandCapability(adminPrincipal, ADMIN_COMMANDS.TASK_COMPLETE);
        const taskId = url.pathname.split("/").at(-2);
        const commandBody = prepareAdminCommandBody(req, adminPrincipal, body, "待办完成", ADMIN_COMMANDS.TASK_COMPLETE);
        return ok(res, withIdempotency(data, req, () => completeOperationTask(data, taskId, commandBody), commandBody.requestId));
      }
      if (method === "POST" && url.pathname.startsWith("/api/v1/admin/tasks/") && url.pathname.endsWith("/resolve")) {
        requireAdminCommandCapability(adminPrincipal, ADMIN_COMMANDS.TASK_RESOLVE);
        const taskId = url.pathname.split("/").at(-2);
        const commandBody = prepareAdminCommandBody(req, adminPrincipal, body, "人工待办处理", ADMIN_COMMANDS.TASK_RESOLVE);
        return ok(res, withIdempotency(data, req, () => resolveManualReview(data, taskId, commandBody), commandBody.requestId));
      }
      if (method === "POST" && url.pathname.startsWith("/api/v1/admin/refunds/") && url.pathname.endsWith("/approve")) {
        requireAdminCommandCapability(adminPrincipal, ADMIN_COMMANDS.REFUND_APPROVE);
        const refundId = url.pathname.split("/").at(-2);
        const commandBody = prepareAdminCommandBody(req, adminPrincipal, body, "退款审批", ADMIN_COMMANDS.REFUND_APPROVE);
        return ok(res, withIdempotency(data, req, () => approveRefund(data, refundId, commandBody), commandBody.requestId));
      }
      if (method === "POST" && url.pathname.startsWith("/api/v1/admin/coupons/") && url.pathname.endsWith("/use")) {
        requireAdminCommandCapability(adminPrincipal, ADMIN_COMMANDS.COUPON_USE);
        const couponId = url.pathname.split("/").at(-2);
        const commandBody = prepareAdminCommandBody(req, adminPrincipal, body, "优惠券核销", ADMIN_COMMANDS.COUPON_USE);
        return ok(res, withIdempotency(data, req, () => markCouponUsed(data, couponId, commandBody), commandBody.requestId));
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
        && [V1_RUNTIME_CYCLE_ROUTE, PERFORMANCE_METRICS_ROUTE].includes(url.pathname);
      if (!url.pathname.startsWith("/api/") || method === "OPTIONS" || bypassSnapshotTransaction) {
        await handleRequest(req, realResponse);
        return;
      }
      const bufferedResponse = createBufferedResponse();
      const execute = (_storeData, transactionControl = {}) => handleRequest(req, bufferedResponse, {
        transactionCheckpoint: transactionControl.checkpoint,
        transactionResume: transactionControl.resume,
        commandRecovery: transactionControl.commandRecovery,
        activityTaskReadAdapter: transactionControl.activityTaskReadAdapter,
        settlementSourceInvalidationRead:
          transactionControl.settlementSourceInvalidationRead,
        settlementSourceInvalidationResolve:
          transactionControl.settlementSourceInvalidationResolve,
        getEventTransport: () => transactionControl.eventTransport,
        eventTransport: transactionControl.eventTransport,
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
