const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp } = require("../src/app");
const { cleanupExpiredHealthData } = require("../src/healthDataRetention");
const { createSeedData } = require("../src/seed");
const {
  buildHealthDataRetentionCleanupReport,
  determineExitCode,
  parseArgs,
} = require("../scripts/health-data-retention-cleanup");

const NOW = "2026-07-11T12:00:00+08:00";
const OLD = "2026-01-01T09:00:00+08:00";
const RECENT = "2026-07-01T09:00:00+08:00";

function retentionEnv(overrides = {}) {
  return {
    ROOT_REQUIRE_HEALTH_CONSENT: "true",
    ROOT_PRIVACY_CONTROLLER_NAME: "ROOT 测试主体",
    ROOT_PRIVACY_CONTACT: "privacy@example.com",
    ROOT_HEALTH_DATA_RETENTION_DAYS: "180",
    ROOT_HEALTH_DATA_RETENTION_CLEANUP_ENABLED: "true",
    ROOT_CLOUDBASE_ENV_ID: "myroot-test",
    ROOT_COMMAND_RESULT_ENCRYPTION_KEY: "health-retention-command-result-key-at-least-32-characters",
    ROOT_COMMAND_RESULT_KEY_ID: "health-retention-v1",
    ...overrides,
  };
}

function emptyHealthCollections(data = createSeedData()) {
  data.profiles = [];
  data.questionnaireAnswers = [];
  data.questionnaireResponses = [];
  data.healthScaleResponses = [];
  data.checkinRecords = [];
  data.dailyCheckinRecords = [];
  data.uploads = [];
  data.auditLogs = [];
  return data;
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(baseUrl + path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  return response.json();
}

test("health retention cleanup fails closed but permits dry-run before execution is enabled", async () => {
  const data = emptyHealthCollections();
  data.profiles.push({ profile_id: "profile_old", submitted_at: OLD, gut_health_status: "sensitive" });

  await assert.rejects(
    cleanupExpiredHealthData(data, { now: NOW }, {
      env: retentionEnv({ ROOT_PRIVACY_CONTACT: "" }),
    }),
    (error) => error.code === 45102
  );

  const disabledEnv = retentionEnv({ ROOT_HEALTH_DATA_RETENTION_CLEANUP_ENABLED: "false" });
  const before = JSON.parse(JSON.stringify(data));
  const dryRun = await cleanupExpiredHealthData(data, { now: NOW }, { env: disabledEnv });
  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.selectedCount, 1);
  assert.deepEqual(data, before);

  await assert.rejects(
    cleanupExpiredHealthData(data, { execute: true, now: NOW, requestId: "retention-disabled" }, { env: disabledEnv }),
    (error) => error.code === 45105
  );
  await assert.rejects(
    cleanupExpiredHealthData(data, { execute: true, now: NOW }, { env: retentionEnv() }),
    (error) => error.code === 400
  );
  await assert.rejects(
    cleanupExpiredHealthData(data, { now: "not-a-date" }, { env: retentionEnv() }),
    (error) => error.code === 400
  );
});

test("health retention cleanup redacts expired content and deletes each unshared CloudBase object once", async () => {
  const uniqueRef = "cloud://myroot-test.bucket/checkins/unique.jpg";
  const sharedRef = "cloud://myroot-test.bucket/checkins/shared.jpg";
  const data = emptyHealthCollections();
  data.users = [{ user_id: "user_active", avatar_url: sharedRef }];
  data.profiles = [
    {
      profile_id: "profile_old",
      user_id: "user_old",
      join_reasons: ["health"],
      gut_health_status: "needs attention",
      improvement_methods: ["diet"],
      stool_type: "type7",
      submitted_at: OLD,
    },
    {
      profile_id: "profile_recent",
      user_id: "user_recent",
      gut_health_status: "recent data",
      submitted_at: RECENT,
    },
  ];
  data.questionnaireAnswers = [{
    questionnaire_answer_id: "answer_old",
    answers_json: { symptom: "private answer" },
    needs_follow: true,
    submitted_at: OLD,
  }];
  data.questionnaireResponses = [{
    response_id: "response_old",
    answers: { note: "private legacy answer" },
    needs_follow: true,
    submitted_at: OLD,
  }];
  data.healthScaleResponses = [{
    health_scale_response_id: "scale_response_old",
    answers_json: { sleep_quality: "private scale answer" },
    score: 3,
    result_level_id: "adjust",
    submitted_at: OLD,
  }];
  data.checkinRecords = [
    {
      record_id: "checkin_old",
      checked_in_at: OLD,
      took_product: true,
      had_stool: true,
      stool_type: "type7",
      feedback: "private checkin feedback",
      image_urls: [uniqueRef, uniqueRef],
    },
    {
      record_id: "checkin_recent",
      checked_in_at: RECENT,
      had_stool: true,
      stool_type: "type4",
      feedback: "recent feedback",
      image_urls: [],
    },
  ];
  data.dailyCheckinRecords = [{
    record_id: "daily_old",
    checked_in_at: OLD,
    streak_count: 21,
    had_stool: true,
    stool_type: "type6",
    feedback: "private daily feedback",
  }];
  data.uploads = [{ upload_id: "upload_old", url: uniqueRef, created_at: OLD }];
  data.settlementRecords = [{ settlement_record_id: "settlement_keep", status: "COMPLETED" }];
  data.rewardGrants = [{ reward_grant_id: "reward_keep", status: "DELIVERED" }];
  data.privacyConsentRecords = [{ privacy_consent_record_id: "consent_keep", decision: "GRANTED" }];

  const deleted = [];
  const result = await cleanupExpiredHealthData(data, {
    execute: true,
    now: NOW,
    requestId: "retention-complete-001",
  }, {
    env: retentionEnv(),
    objectStorageAdapter: {
      async deleteObject({ fileId }) {
        deleted.push(fileId);
        return { deleted: true };
      },
    },
  });

  assert.equal(result.eligibleCount, 7);
  assert.equal(result.redactedCount, 6);
  assert.equal(result.partialRedactedCount, 0);
  assert.equal(result.removedCount, 1);
  assert.equal(result.failedCount, 0);
  assert.equal(result.objectDeletedCount, 1);
  assert.equal(result.objectSharedCount, 0);
  assert.deepEqual(deleted, [uniqueRef]);
  assert.equal(data.profiles[0].gut_health_status, "");
  assert.equal(data.profiles[0].health_data_redacted_at, NOW);
  assert.equal(data.profiles[1].gut_health_status, "recent data");
  assert.deepEqual(data.questionnaireAnswers[0].answers_json, {});
  assert.deepEqual(data.questionnaireResponses[0].answers, {});
  assert.deepEqual(data.healthScaleResponses[0].answers_json, {});
  assert.deepEqual(data.healthScaleResponses[0].result_json, {});
  assert.equal(data.healthScaleResponses[0].score, null);
  assert.equal(data.healthScaleResponses[0].result_level_id, "");
  assert.equal(data.checkinRecords[0].took_product, true);
  assert.equal(data.checkinRecords[0].feedback, "");
  assert.deepEqual(data.checkinRecords[0].image_urls, []);
  assert.equal(data.checkinRecords[1].feedback, "recent feedback");
  assert.equal(data.dailyCheckinRecords[0].streak_count, 21);
  assert.equal(data.dailyCheckinRecords[0].feedback, "");
  assert.equal(data.uploads.length, 0);
  assert.equal(data.settlementRecords[0].status, "COMPLETED");
  assert.equal(data.rewardGrants[0].status, "DELIVERED");
  assert.equal(data.privacyConsentRecords[0].decision, "GRANTED");
  assert.equal(data.users[0].avatar_url, sharedRef);

  const auditJson = JSON.stringify(data.auditLogs[0]);
  assert.equal(data.auditLogs[0].action, "HEALTH_DATA_RETENTION_CLEANUP");
  assert.equal(auditJson.includes(uniqueRef), false);
  assert.equal(auditJson.includes(sharedRef), false);
  assert.equal(auditJson.includes("urgent gut note"), false);
  assert.equal(auditJson.includes("type7"), false);
});

test("health retention cleanup partially redacts failed media and completes on retry", async () => {
  const deletedRef = "cloud://myroot-test.bucket/checkins/deleted.jpg";
  const retryRef = "cloud://myroot-test.bucket/checkins/retry.jpg";
  const data = emptyHealthCollections();
  data.checkinRecords = [{
    record_id: "checkin_retry",
    checked_in_at: OLD,
    had_stool: true,
    stool_type: "type7",
    feedback: "remove this text immediately",
    image_urls: [deletedRef, retryRef],
  }];
  data.uploads = [{ upload_id: "upload_retry", url: retryRef, created_at: OLD }];

  const firstCalls = [];
  const first = await cleanupExpiredHealthData(data, {
    execute: true,
    now: NOW,
    requestId: "retention-partial-001",
  }, {
    env: retentionEnv(),
    objectStorageAdapter: {
      async deleteObject({ fileId }) {
        firstCalls.push(fileId);
        if (fileId === retryRef) throw new Error("temporary storage failure");
        return { deleted: true };
      },
    },
  });

  assert.deepEqual(firstCalls.sort(), [deletedRef, retryRef].sort());
  assert.equal(first.redactedCount, 0);
  assert.equal(first.partialRedactedCount, 1);
  assert.equal(first.failedCount, 2);
  assert.equal(first.objectDeletedCount, 1);
  assert.equal(first.objectFailedCount, 1);
  assert.equal(data.checkinRecords[0].feedback, "");
  assert.equal(data.checkinRecords[0].stool_type, "");
  assert.deepEqual(data.checkinRecords[0].image_urls, [retryRef]);
  assert.equal(data.checkinRecords[0].health_data_redacted_at, undefined);
  assert.equal(data.checkinRecords[0].health_data_redaction_pending_at, NOW);
  assert.equal(data.uploads.length, 1);
  assert.equal(data.uploads[0].health_data_redaction_pending_at, NOW);

  const retryCalls = [];
  const retry = await cleanupExpiredHealthData(data, {
    execute: true,
    now: "2026-07-12T12:00:00+08:00",
    requestId: "retention-partial-002",
  }, {
    env: retentionEnv(),
    objectStorageAdapter: {
      async deleteObject({ fileId }) {
        retryCalls.push(fileId);
        return { deleted: true };
      },
    },
  });

  assert.deepEqual(retryCalls, [retryRef]);
  assert.equal(retry.redactedCount, 1);
  assert.equal(retry.partialRedactedCount, 0);
  assert.equal(retry.removedCount, 1);
  assert.equal(retry.failedCount, 0);
  assert.equal(retry.objectDeletedCount, 1);
  assert.deepEqual(data.checkinRecords[0].image_urls, []);
  assert.equal(data.checkinRecords[0].health_data_redacted_at, "2026-07-12T12:00:00+08:00");
  assert.equal(data.checkinRecords[0].health_data_redaction_pending_at, undefined);
  assert.equal(data.uploads.length, 0);
  assert.equal(data.auditLogs.length, 2);
  assert.equal(JSON.stringify(data.auditLogs).includes(retryRef), false);
});

test("health retention cleanup removes derived health text while preserving operational facts", async () => {
  const data = emptyHealthCollections();
  data.operationTasks = [
    {
      task_id: "task_health_old",
      task_type: "FEEDBACK_FOLLOW",
      user_id: "user_health",
      status: "DONE",
      reason: "raw bowel feedback copied by operator",
      suggested_action: "discuss private symptom details",
      suggested_script: "repeat private symptom details",
      note: "private follow-up note",
      result: "WEWORK_CONTACTED",
      metadata: { taskEventId: "event_health", sourceType: "CHECKIN_RECORD", privateNote: "do not retain" },
      completed_at: OLD,
      created_at: OLD,
    },
    {
      task_id: "task_non_health_old",
      task_type: "COUPON_UNUSED",
      status: "OPEN",
      reason: "coupon reminder remains",
      created_at: OLD,
    },
    {
      task_id: "task_health_recent",
      task_type: "QUESTIONNAIRE_FOLLOW",
      status: "OPEN",
      reason: "recent health follow-up remains",
      created_at: RECENT,
    },
  ];
  data.weworkTouchJobs = [{
    wework_touch_job_id: "touch_health_old",
    task_type: "FEEDBACK_FOLLOW",
    status: "DELIVERED",
    message: "copied private health message",
    payload_json: { taskReason: "copied private task reason" },
    delivered_at: OLD,
    created_at: OLD,
  }];
  data.consultationWeworkWritebacks = [{
    writeback_id: "writeback_health_old",
    status: "DELIVERED",
    external_ref: "wework-result-keep",
    message: "private consultation message",
    note: "private consultation note",
    payload_json: { privateDetail: "private consultation payload" },
    delivered_at: OLD,
    created_at: OLD,
  }];
  data.consultationAdvisorAssignments = [{
    assignment_id: "assignment_health_old",
    task_id: "task_health_old",
    advisor_id: "advisor_keep",
    status: "ACTIVE",
    reason: "private health assignment reason",
    created_at: OLD,
  }];
  data.auditLogs = [{
    audit_id: "audit_health_old",
    action: "CONSULTATION_WEWORK_WRITEBACK",
    target_type: "OPERATION_TASK",
    target_id: "task_health_old",
    reason: "private audit reason",
    before: { note: "private audit before" },
    after: { note: "private audit after" },
    metadata: { requestId: "audit-request-keep", privateNote: "private audit metadata" },
    created_at: OLD,
  }];

  const result = await cleanupExpiredHealthData(data, {
    execute: true,
    now: NOW,
    requestId: "retention-derived-001",
  }, { env: retentionEnv() });

  assert.equal(result.eligibleCount, 5);
  assert.equal(result.redactedCount, 5);
  assert.equal(result.failedCount, 0);
  assert.equal(data.operationTasks[0].status, "DONE");
  assert.equal(data.operationTasks[0].result, "WEWORK_CONTACTED");
  assert.equal(data.operationTasks[0].note, "");
  assert.deepEqual(data.operationTasks[0].metadata, {
    taskEventId: "event_health",
    sourceType: "CHECKIN_RECORD",
  });
  assert.equal(data.operationTasks[1].reason, "coupon reminder remains");
  assert.equal(data.operationTasks[2].reason, "recent health follow-up remains");
  assert.equal(data.weworkTouchJobs[0].status, "DELIVERED");
  assert.equal(data.weworkTouchJobs[0].message, "");
  assert.deepEqual(data.weworkTouchJobs[0].payload_json, { retentionRedacted: true });
  assert.equal(data.consultationWeworkWritebacks[0].external_ref, "wework-result-keep");
  assert.equal(data.consultationWeworkWritebacks[0].note, "");
  assert.equal(data.consultationAdvisorAssignments[0].advisor_id, "advisor_keep");
  assert.equal(data.consultationAdvisorAssignments[0].status, "ACTIVE");
  assert.equal(data.auditLogs[1].action, "CONSULTATION_WEWORK_WRITEBACK");
  assert.equal(data.auditLogs[1].target_id, "task_health_old");
  assert.equal(data.auditLogs[1].before, null);
  assert.deepEqual(data.auditLogs[1].after, { retentionRedacted: true });
  assert.deepEqual(data.auditLogs[1].metadata, { requestId: "audit-request-keep" });

  const retainedJson = JSON.stringify(data);
  for (const privateText of [
    "raw bowel feedback copied by operator",
    "private follow-up note",
    "copied private health message",
    "private consultation note",
    "private audit before",
    "private audit metadata",
  ]) {
    assert.equal(retainedJson.includes(privateText), false);
  }
});

test("health retention Job Interface is dry-run by default and execute is idempotent", async (t) => {
  const jobRouteToken = "health-retention-route-secret-2026";
  const data = emptyHealthCollections();
  data.profiles.push({
    profile_id: "profile_http_old",
    submitted_at: OLD,
    gut_health_status: "private",
  });
  const server = createApp({
    env: retentionEnv({
      ROOT_REQUIRE_SCOPED_JOB_TOKENS: "true",
      ROOT_ADMIN_JOB_ROUTE_TOKENS: JSON.stringify({
        "/api/v1/jobs/health-data-retention-cleanup": [jobRouteToken],
      }),
    }),
    store: data,
    objectStorageAdapter: { async deleteObject() { return { deleted: true }; } },
  });
  const baseUrl = await listen(server);
  t.after(() => close(server));
  const headers = { "X-ROOT-ADMIN-TOKEN": jobRouteToken };

  const dryRun = await request(baseUrl, "/api/v1/jobs/health-data-retention-cleanup", {
    method: "POST",
    headers,
    body: JSON.stringify({ now: NOW, dryRun: true }),
  });
  assert.equal(dryRun.code, 0);
  assert.equal(dryRun.data.dryRun, true);
  assert.equal(dryRun.data.selectedCount, 1);
  assert.equal(server.store.profiles[0].gut_health_status, "private");
  assert.equal(server.store.auditLogs.length, 0);

  const missingRequestId = await request(baseUrl, "/api/v1/jobs/health-data-retention-cleanup", {
    method: "POST",
    headers,
    body: JSON.stringify({ now: NOW, dryRun: false }),
  });
  assert.equal(missingRequestId.code, 400);

  const executeHeaders = { ...headers, "X-Request-Id": "retention-http-001" };
  const first = await request(baseUrl, "/api/v1/jobs/health-data-retention-cleanup", {
    method: "POST",
    headers: executeHeaders,
    body: JSON.stringify({ now: NOW, dryRun: false }),
  });
  const repeated = await request(baseUrl, "/api/v1/jobs/health-data-retention-cleanup", {
    method: "POST",
    headers: executeHeaders,
    body: JSON.stringify({ now: NOW, dryRun: false }),
  });

  assert.equal(first.code, 0);
  assert.equal(first.data.executed, true);
  assert.equal(first.data.redactedCount, 1);
  assert.deepEqual(repeated, first);
  assert.equal(server.store.profiles[0].gut_health_status, "");
  assert.equal(server.store.auditLogs.length, 1);
});

test("health retention command runner keeps execute explicit and reports cleanup warnings", () => {
  const dryRun = parseArgs([], {});
  const execute = parseArgs([
    "--execute",
    "--request-id", "retention-cli-001",
    "--limit", "12",
    "--no-object-cleanup",
  ], {});
  const bundle = {
    ok: true,
    message: "ok",
    request: { requestId: "retention-cli-001" },
    data: {
      dryRun: false,
      retentionDays: 180,
      cutoffDate: "2026-01-12",
      selectedCount: 2,
      eligibleCount: 2,
      unmanagedHttpsCount: 1,
    },
  };

  assert.equal(dryRun.dryRun, true);
  assert.equal(execute.dryRun, false);
  assert.equal(execute.requestId, "retention-cli-001");
  assert.equal(execute.limit, 12);
  assert.equal(execute.objectCleanup, false);
  assert.match(buildHealthDataRetentionCleanupReport(bundle), /外部 HTTPS 引用移除：1/);
  assert.equal(determineExitCode(bundle), 3);
});
