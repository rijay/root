const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/app");

const AUTHORIZATION = Object.freeze({
  controlledApprovalRef: "CONTENT_APPROVAL_HTTP_001",
  contentAuthorizationDigest: "a".repeat(64),
  uedAcceptanceDigest: "b".repeat(64),
  photographyAuthorizationDigest: "c".repeat(64),
  artifactProvenanceDigest: "d".repeat(64),
});

function trustedPublicationAuthorizationAdapter() {
  return {
    authorizeActivityPublication(input) {
      assert.equal(input.operation, "ACTIVITY_PUBLISH");
      assert.equal(input.principal.operatorId, "admin");
      assert.equal(input.principal.tokenConfigured, true);
      return {
        authorized: true,
        adapterId: "ACTIVITY_AUTH_HTTP_TEST_V1",
        decisionRef: "ACTIVITY_AUTH_HTTP_DECISION_001",
        publishOwnerSignerRef: "ACTIVITY_PUBLISH_SIGNER_FROM_ADAPTER",
        verifiedAt: new Date(Date.now() - 1_000).toISOString(),
        evidence: input.evidence,
        principalOperatorId: input.principal.operatorId,
        activityVersionId: input.activity.activityVersionId,
        activityId: input.activity.activityId,
        requestId: input.requestId,
      };
    },
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  return { status: response.status, body: await response.json() };
}

async function command(baseUrl, path, requestId, body, headers = {}) {
  return request(baseUrl, path, {
    method: "POST",
    headers: {
      "X-Request-Id": requestId,
      "X-Idempotency-Key": `${requestId}-intent`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function login(baseUrl, phone) {
  const result = await request(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
  assert.equal(result.body.code, 0);
  return result.body.data.token;
}

test("Activity Module HTTP Interface publishes only authorized operations content and preserves capacity", async (t) => {
  const server = createApp({
    env: {
      ROOT_ALLOW_DIRECT_PHONE_LOGIN: "true",
      ROOT_ADMIN_TOKENS: JSON.stringify({
        admin: { token: "activity-admin-secret", role: "admin" },
        operator: { token: "activity-operator-secret", role: "operator" },
        viewer: { token: "activity-viewer-secret", role: "viewer" },
      }),
      ROOT_ADMIN_JOB_TOKEN: "activity-job-secret",
      ROOT_ACTIVITY_PUBLICATION_AUTHORIZATION_ENABLED: "true",
    },
    activityPublicationAuthorizationAdapter: trustedPublicationAuthorizationAdapter(),
  });
  const baseUrl = await listen(server);
  t.after(() => closeServer(server));
  const admin = { "X-Admin-Token": "activity-admin-secret" };
  const operator = { "X-Admin-Token": "activity-operator-secret" };
  const viewer = { "X-Admin-Token": "activity-viewer-secret" };

  const missingIdempotencyKey = await request(baseUrl, "/api/v1/admin/activities/draft", {
    method: "POST",
    headers: { ...operator, "X-Request-Id": "activity-command-attempt-only" },
    body: JSON.stringify({ activityId: "identity-contract-probe" }),
  });
  assert.equal(missingIdempotencyKey.status, 400);
  assert.equal(missingIdempotencyKey.body.code, "ACTIVITY_IDEMPOTENCY_KEY_REQUIRED");

  const unseparatedIdentity = await request(baseUrl, "/api/v1/admin/activities/draft", {
    method: "POST",
    headers: {
      ...operator,
      "X-Request-Id": "activity-command-not-separated",
      "X-Idempotency-Key": "activity-command-not-separated",
    },
    body: JSON.stringify({ activityId: "identity-contract-probe" }),
  });
  assert.equal(unseparatedIdentity.status, 400);
  assert.equal(unseparatedIdentity.body.code, "ACTIVITY_COMMAND_IDENTITY_NOT_SEPARATED");

  const denied = await command(baseUrl, "/api/v1/admin/activities/draft", "activity-draft-denied", {
    activityId: "activity_http_001",
  }, viewer);
  assert.equal(denied.status, 403);
  assert.equal(server.store.activityDefinitionVersions.length, 0);

  const draftBody = {
    activityId: "activity_http_001",
    activityVersionId: "activity_http_001_v1",
    version: 1,
    title: "ROOT 线下活动",
    summary: "运营后台测试活动",
    objective: "帮助参与者把健康建议转化为可执行的生活方式练习",
    audience: "希望改善生活节律的 ROOT 用户",
    agenda: "签到；引导练习；主题交流；行动计划确认",
    organizer: "ROOT 生活方式团队",
    feeDescription: "测试活动免费",
    bringItems: "请携带饮用水",
    cancelPolicy: "可在取消截止时间前自行取消，逾期请联系活动联系人",
    privacyNoticeText: "报名信息仅用于本次活动的组织和通知",
    photographyNoticeText: "现场摄影仅用于已授权范围，未授权可向工作人员说明",
    contactDisplay: "ROOT 活动运营（小程序内联系）",
    detailVersion: "detail-v1",
    city: "上海",
    venueSummary: "受控测试场地",
    activityType: "WORKSHOP",
    heroAssetRef: "ASSET_REF_HTTP_001",
    privacyNoticeRef: "PRIVACY_REF_HTTP_001",
    photographyNoticeRef: "PHOTO_REF_HTTP_001",
    contentApprovalRef: "CONTENT_APPROVAL_HTTP_001",
    contactOwnerSignerRef: "CONTACT_SIGNER_HTTP_001",
    preboundTaskDefinitionId: "task-after-activity",
    preboundTaskDefinitionVersion: "task-after-activity-v1",
    source: "OPS_BACKEND",
  };
  const draft = await command(baseUrl, "/api/v1/admin/activities/draft", "activity-draft-001", draftBody, operator);
  assert.equal(draft.body.code, 0);

  const submitted = await command(baseUrl, "/api/v1/admin/activities/submit-review", "activity-review-submit-001", {
    activityVersionId: "activity_http_001_v1",
  }, operator);
  assert.equal(submitted.body.data.activity.status, "IN_REVIEW");

  const spoofedReviewer = await command(baseUrl, "/api/v1/admin/activities/request-changes", "activity-review-spoofed", {
    activityVersionId: "activity_http_001_v1",
    reason: "恶意伪造审核人",
    reviewerSignerRef: "spoofed-reviewer",
  }, operator);
  assert.equal(spoofedReviewer.status, 403);
  assert.equal(server.store.activityDefinitionVersions[0].status, "IN_REVIEW");
  const returnedForChanges = await command(baseUrl, "/api/v1/admin/activities/request-changes", "activity-review-returned", {
    activityVersionId: "activity_http_001_v1",
    reason: "补充取消政策",
  }, operator);
  assert.equal(returnedForChanges.body.data.activity.status, "DRAFT");
  assert.equal(server.store.activityDefinitionVersions[0].reviewer_signer_ref, "operator");
  const revised = await command(baseUrl, "/api/v1/admin/activities/draft", "activity-draft-revised", {
    ...draftBody,
    summary: "已补充取消政策的运营后台测试活动",
  }, operator);
  assert.equal(revised.body.data.activity.status, "DRAFT");
  const resubmitted = await command(baseUrl, "/api/v1/admin/activities/submit-review", "activity-review-resubmit", {
    activityVersionId: "activity_http_001_v1",
  }, operator);
  assert.equal(resubmitted.body.data.activity.status, "IN_REVIEW");

  const operatorPublish = await command(baseUrl, "/api/v1/admin/activities/publish", "activity-publish-denied", {
    activityVersionId: "activity_http_001_v1",
    publishOwnerSignerRef: "PUBLISH_SIGNER_HTTP_001",
  }, operator);
  assert.equal(operatorPublish.status, 403);
  assert.equal(server.store.activityDefinitionVersions[0].status, "IN_REVIEW");

  const published = await command(baseUrl, "/api/v1/admin/activities/publish", "activity-publish-001", {
    activityVersionId: "activity_http_001_v1",
    publishOwnerSignerRef: "UNTRUSTED_CLIENT_SIGNER_MUST_NOT_WIN",
    ...AUTHORIZATION,
  }, admin);
  assert.equal(published.body.data.activity.status, "PUBLISHED");
  assert.equal(server.store.activityDefinitionVersions[0].publish_owner_signer_ref, "ACTIVITY_PUBLISH_SIGNER_FROM_ADAPTER");

  const createdSession = await command(baseUrl, "/api/v1/admin/activity-sessions/create", "activity-session-create-001", {
    activityVersionId: "activity_http_001_v1",
    sessionId: "activity_http_session_001",
    approvalMode: "AUTO",
    capacity: 1,
    registrationOpenAt: "2020-01-01T00:00:00.000Z",
    registrationCloseAt: "2099-01-01T00:00:00.000Z",
    cancelCloseAt: "2099-01-01T12:00:00.000Z",
    sessionStartAt: "2099-01-02T00:00:00.000Z",
    sessionEndAt: "2099-01-02T02:00:00.000Z",
  }, operator);
  assert.equal(createdSession.body.data.session.status, "SCHEDULED");
  const opened = await command(baseUrl, "/api/v1/admin/activity-sessions/state", "activity-session-open-001", {
    sessionId: "activity_http_session_001",
    nextStatus: "OPEN",
  }, operator);
  assert.equal(opened.body.data.session.status, "OPEN");

  const publicList = await request(baseUrl, "/api/v1/activities?city=%E4%B8%8A%E6%B5%B7");
  assert.equal(publicList.body.code, 0);
  assert.equal(publicList.body.data.activities.length, 1);
  assert.equal(publicList.body.data.activities[0].session.listingState, "AVAILABLE");
  assert.equal(publicList.body.data.activities[0].objective, draftBody.objective);
  assert.equal(publicList.body.data.activities[0].cancelPolicy, draftBody.cancelPolicy);
  assert.equal(publicList.body.data.activities[0].session.cancelCloseAt, "2099-01-01T12:00:00.000Z");
  const detailByActivity = await request(baseUrl, "/api/v1/activities/detail?activityId=activity_http_001");
  assert.equal(detailByActivity.body.code, 0);
  assert.equal(detailByActivity.body.data.activity.session.sessionId, "activity_http_session_001");
  assert.equal(detailByActivity.body.data.activity.privacyNoticeText, draftBody.privacyNoticeText);
  assert.equal(detailByActivity.body.data.activity.photographyNoticeText, draftBody.photographyNoticeText);

  const adminJobDenied = await command(baseUrl, "/api/v1/jobs/activity-review-timeouts", "activity-job-admin-denied", {}, admin);
  assert.equal(adminJobDenied.status, 403);
  const timerJobAllowed = await command(
    baseUrl,
    "/api/v1/jobs/activity-review-timeouts",
    "activity-job-timer-allowed",
    {},
    { "X-Admin-Token": "activity-job-secret" }
  );
  assert.equal(timerJobAllowed.body.code, 0);

  const firstToken = await login(baseUrl, "13800010001");
  const firstEnrollment = await command(baseUrl, "/api/v1/activities/enroll", "activity-enroll-http-001", {
    sessionId: "activity_http_session_001",
  }, { Authorization: `Bearer ${firstToken}` });
  assert.equal(firstEnrollment.body.data.enrollment.status, "CONFIRMED");
  assert.equal(server.store.eventOutbox.length, 1);
  assert.equal(server.store.eventOutbox[0].event_type, "activity.enrollment.confirmed.v1");

  const repeated = await command(baseUrl, "/api/v1/activities/enroll", "activity-enroll-http-002", {
    sessionId: "activity_http_session_001",
  }, {
    Authorization: `Bearer ${firstToken}`,
    "X-Idempotency-Key": "activity-enroll-http-001-intent",
  });
  assert.equal(repeated.body.data.enrollment.enrollmentId, firstEnrollment.body.data.enrollment.enrollmentId);
  assert.equal(server.store.activityEnrollments.length, 1);
  assert.equal(server.store.activityEnrollmentEvents[0].request_id, "activity-enroll-http-001");
  assert.equal(server.store.eventOutbox.length, 1);

  const secondToken = await login(baseUrl, "13800010002");
  const full = await command(baseUrl, "/api/v1/activities/enroll", "activity-enroll-http-003", {
    sessionId: "activity_http_session_001",
  }, { Authorization: `Bearer ${secondToken}` });
  assert.equal(full.status, 409);
  assert.equal(full.body.code, "CAPACITY_FULL");
  assert.equal(server.store.activityEnrollments.length, 1);

  const mine = await request(baseUrl, "/api/v1/activities/enrollments", {
    headers: { Authorization: `Bearer ${firstToken}` },
  });
  assert.equal(mine.body.data.enrollments.length, 1);
  assert.equal(mine.body.data.enrollments[0].enrollment.status, "CONFIRMED");

  const canceled = await command(baseUrl, "/api/v1/activities/cancel", "activity-cancel-http-001", {
    sessionId: "activity_http_session_001",
  }, { Authorization: `Bearer ${firstToken}` });
  assert.equal(canceled.body.data.enrollment.status, "CANCELED");
  assert.equal(server.store.activityEnrollmentEvents.length, 2);
  assert.equal(server.store.eventOutbox.length, 2);
  assert.equal(server.store.eventOutbox[1].event_type, "activity.enrollment.canceled.v1");

  const canceledSession = await command(baseUrl, "/api/v1/admin/activity-sessions/cancel", "activity-session-cancel-001", {
    sessionId: "activity_http_session_001",
    reason: "WEATHER",
    operator_id: "spoofed-client-operator",
  }, operator);
  assert.equal(canceledSession.body.data.session.status, "CANCELED");
  assert.equal(server.store.activitySessionEvents.length, 1);
  assert.equal(server.store.activitySessionEvents[0].actor_ref, "operator");

  const manualSession = await command(baseUrl, "/api/v1/admin/activity-sessions/create", "activity-manual-session-create-001", {
    activityVersionId: "activity_http_001_v1",
    sessionId: "activity_http_session_manual_001",
    approvalMode: "MANUAL",
    capacity: 1,
    registrationOpenAt: "2020-01-01T00:00:00.000Z",
    registrationCloseAt: "2099-02-01T00:00:00.000Z",
    cancelCloseAt: "2099-02-01T12:00:00.000Z",
    reviewDeadline: "2099-02-01T18:00:00.000Z",
    sessionStartAt: "2099-02-02T00:00:00.000Z",
    sessionEndAt: "2099-02-02T02:00:00.000Z",
  }, operator);
  assert.equal(manualSession.body.data.session.status, "SCHEDULED");
  await command(baseUrl, "/api/v1/admin/activity-sessions/state", "activity-manual-session-open-001", {
    sessionId: "activity_http_session_manual_001",
    nextStatus: "OPEN",
  }, operator);
  const pending = await command(baseUrl, "/api/v1/activities/enroll", "activity-manual-enroll-001", {
    sessionId: "activity_http_session_manual_001",
  }, { Authorization: `Bearer ${secondToken}` });
  assert.equal(pending.body.data.enrollment.status, "PENDING");
  assert.equal(server.store.eventOutbox.length, 2);
  const confirmed = await command(baseUrl, "/api/v1/admin/activity-enrollments/review", "activity-manual-review-001", {
    enrollmentId: pending.body.data.enrollment.enrollmentId,
    expectedAttemptGeneration: 1,
    approve: true,
  }, operator);
  assert.equal(confirmed.body.data.enrollment.status, "CONFIRMED");
  assert.equal(server.store.eventOutbox.length, 3);
  const reviewReplay = await command(baseUrl, "/api/v1/admin/activity-enrollments/review", "activity-manual-review-retry-001", {
    enrollmentId: pending.body.data.enrollment.enrollmentId,
    expectedAttemptGeneration: 1,
    approve: true,
  }, {
    ...operator,
    "X-Idempotency-Key": "activity-manual-review-001-intent",
  });
  assert.equal(reviewReplay.body.data.enrollment.status, "CONFIRMED");
  assert.equal(server.store.eventOutbox.length, 3);
  const canceledManualSession = await command(baseUrl, "/api/v1/admin/activity-sessions/cancel", "activity-manual-session-cancel-001", {
    sessionId: "activity_http_session_manual_001",
    reason: "VENUE",
  }, operator);
  assert.equal(canceledManualSession.body.data.session.status, "CANCELED");
  assert.equal(server.store.eventOutbox.length, 4);
  assert.equal(server.store.eventOutbox[3].event_type, "activity.enrollment.canceled.v1");
  assert.equal(server.store.eventOutbox[3].partition_key, server.store.eventOutbox[2].partition_key);

  const spoofedWithdrawOwner = await command(baseUrl, "/api/v1/admin/activities/unpublish", "activity-unpublish-spoofed", {
    activityVersionId: "activity_http_001_v1",
    reason: "活动结束",
    withdrawOwnerSignerRef: "spoofed-withdraw-owner",
  }, admin);
  assert.equal(spoofedWithdrawOwner.status, 403);
  assert.equal(server.store.activityDefinitionVersions[0].status, "PUBLISHED");
  const unpublished = await command(baseUrl, "/api/v1/admin/activities/unpublish", "activity-unpublish-001", {
    activityVersionId: "activity_http_001_v1",
    reason: "活动结束",
  }, admin);
  assert.equal(unpublished.body.data.activity.status, "UNPUBLISHED");
  assert.equal(server.store.activityDefinitionVersions[0].withdraw_owner_signer_ref, "admin");

  const spoofedArchiveOwner = await command(baseUrl, "/api/v1/admin/activities/archive", "activity-archive-spoofed", {
    activityVersionId: "activity_http_001_v1",
    reason: "归档历史",
    archiveOwnerSignerRef: "spoofed-archive-owner",
  }, admin);
  assert.equal(spoofedArchiveOwner.status, 403);
  assert.equal(server.store.activityDefinitionVersions[0].status, "UNPUBLISHED");
  const archived = await command(baseUrl, "/api/v1/admin/activities/archive", "activity-archive-001", {
    activityVersionId: "activity_http_001_v1",
    reason: "归档历史",
  }, admin);
  assert.equal(archived.body.data.activity.status, "ARCHIVED");
  assert.equal(server.store.activityDefinitionVersions[0].archive_owner_signer_ref, "admin");
  const enrollmentAudits = server.store.auditLogs.filter((item) => item.action === "ACTIVITY_ENROLLMENT_ENROLL");
  assert.equal(enrollmentAudits.length, 2);
  const firstEnrollmentAudit = enrollmentAudits.find((item) => item.metadata.requestId === "activity-enroll-http-001");
  assert.equal(firstEnrollmentAudit.metadata.idempotencyKey, "activity-enroll-http-001-intent");
  assert.ok(server.store.auditLogs.some((item) => item.action === "ACTIVITY_PUBLISH"));
  assert.ok(server.store.auditLogs.some((item) => item.action === "ACTIVITY_SESSION_CANCEL"));
  assert.ok(server.store.auditLogs.some((item) => item.action === "ACTIVITY_ARCHIVE"));
});

test("incomplete frozen task binding rolls back the enrollment event and outbox obligation", async (t) => {
  t.mock.method(console, "error", () => {});
  const server = createApp({ env: { ROOT_ALLOW_DIRECT_PHONE_LOGIN: "true" } });
  const baseUrl = await listen(server);
  t.after(() => closeServer(server));
  const token = await login(baseUrl, "13800010009");
  server.store.activityDefinitionVersions.push({
    activity_version_id: "activity_incomplete_binding_v1",
    activity_id: "activity_incomplete_binding",
    version: 1,
    status: "PUBLISHED",
    visibility: "PUBLIC",
    prebound_task_definition_id: "task-without-frozen-version",
    prebound_task_definition_version: "",
  });
  server.store.activitySessions.push({
    activity_session_id: "activity_incomplete_binding_session",
    activity_version_id: "activity_incomplete_binding_v1",
    status: "OPEN",
    approval_mode: "AUTO",
    capacity: 5,
    registration_open_at: "2020-01-01T00:00:00.000Z",
    registration_close_at: "2099-01-01T00:00:00.000Z",
    cancel_close_at: "2099-01-01T12:00:00.000Z",
    review_deadline: null,
    session_start_at: "2099-01-02T00:00:00.000Z",
    session_end_at: "2099-01-02T02:00:00.000Z",
    allow_reapply: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });

  const result = await command(baseUrl, "/api/v1/activities/enroll", "activity-incomplete-binding-enroll", {
    sessionId: "activity_incomplete_binding_session",
  }, { Authorization: `Bearer ${token}` });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 50301);
  assert.equal(server.store.activityEnrollments.length, 0);
  assert.equal(server.store.activityEnrollmentEvents.length, 0);
  assert.equal(server.store.eventOutbox.length, 0);
  assert.equal(
    server.store.auditLogs.filter((item) => item.action === "ACTIVITY_ENROLLMENT_ENROLL").length,
    0
  );
});

test("member-only activity enrollment fails closed without a trusted Member Identity summary", () => {
  const module = require("../src/activityModule");
  const store = {};
  const draft = module.upsertDraft(store, {
    activityId: "member_only_001",
    activityVersionId: "member_only_001_v1",
    version: 1,
    title: "会员活动",
    summary: "会员专属",
    objective: "为有效会员提供专属生活方式体验",
    audience: "已关联的有效 ROOT 会员",
    agenda: "签到；会员练习；交流与结束提醒",
    organizer: "ROOT 会员运营团队",
    feeDescription: "会员专享免费",
    bringItems: "请携带饮用水",
    cancelPolicy: "可在取消截止时间前自行取消",
    privacyNoticeText: "报名信息仅用于本次会员活动组织与通知",
    photographyNoticeText: "未授权参与者不会进入对外使用的摄影素材",
    contactDisplay: "ROOT 会员运营（小程序内联系）",
    detailVersion: "v1",
    city: "上海",
    venueSummary: "测试场地",
    activityType: "MEMBER_EVENT",
    heroAssetRef: "ASSET_MEMBER_001",
    privacyNoticeRef: "PRIVACY_MEMBER_001",
    photographyNoticeRef: "PHOTO_MEMBER_001",
    contentApprovalRef: "CONTENT_MEMBER_001",
    contactOwnerSignerRef: "CONTACT_MEMBER_001",
    source: "OPS_BACKEND",
    visibility: "MEMBER",
    memberRequirement: "ACTIVE",
  }, { now: "2026-01-01T00:00:00.000Z" });
  module.submitForReview(store, draft.activityVersionId, { now: "2026-01-01T01:00:00.000Z" });
  const memberAuthorization = {
    controlledApprovalRef: "CONTENT_MEMBER_001",
    contentAuthorizationDigest: "1".repeat(64),
    uedAcceptanceDigest: "2".repeat(64),
    photographyAuthorizationDigest: "3".repeat(64),
    artifactProvenanceDigest: "4".repeat(64),
  };
  module.publish(store, draft.activityVersionId, {
    operatorId: "member-publisher",
    requestId: "MEMBER_ACTIVITY_PUBLISH_001",
    ...memberAuthorization,
  }, {
    now: "2026-01-01T02:00:00.000Z",
    env: { ROOT_ACTIVITY_PUBLICATION_AUTHORIZATION_ENABLED: "true" },
    adminPrincipal: { operatorId: "member-publisher", role: "admin", tokenConfigured: true },
    activityPublicationAuthorizationAdapter: {
      authorizeActivityPublication(input) {
        return {
          authorized: true,
          adapterId: "MEMBER_ACTIVITY_AUTH_TEST_V1",
          decisionRef: "MEMBER_ACTIVITY_DECISION_001",
          publishOwnerSignerRef: "PUBLISH_MEMBER_001",
          verifiedAt: "2026-01-01T01:59:00.000Z",
          evidence: input.evidence,
          principalOperatorId: input.principal.operatorId,
          activityVersionId: input.activity.activityVersionId,
          activityId: input.activity.activityId,
          requestId: input.requestId,
        };
      },
    },
  });
  const session = module.createSession(store, {
    activityVersionId: draft.activityVersionId,
    sessionId: "member_session_001",
    approvalMode: "AUTO",
    capacity: 5,
    registrationOpenAt: "2026-01-02T00:00:00.000Z",
    registrationCloseAt: "2026-01-10T00:00:00.000Z",
    cancelCloseAt: "2026-01-10T12:00:00.000Z",
    sessionStartAt: "2026-01-11T00:00:00.000Z",
    sessionEndAt: "2026-01-11T02:00:00.000Z",
  }, { now: "2026-01-01T03:00:00.000Z" });
  module.setSessionState(store, session.sessionId, "OPEN", { now: "2026-01-02T00:00:00.000Z" });
  assert.throws(() => module.enroll(store, "user_member_001", {
    sessionId: session.sessionId,
    requestId: "MEMBER_ENROLL_001",
  }, { now: "2026-01-03T00:00:00.000Z" }), { code: "ACTIVE_MEMBERSHIP_REQUIRED" });
  assert.equal(store.activityEnrollments.length, 0);
});
