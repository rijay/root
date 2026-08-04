const test = require("node:test");
const assert = require("node:assert/strict");

const activity = require("../src/activityModule");

const T = Object.freeze({
  draft: "2026-08-01T00:00:00.000Z",
  open: "2026-08-02T00:00:00.000Z",
  close: "2026-08-10T00:00:00.000Z",
  cancel: "2026-08-11T00:00:00.000Z",
  start: "2026-08-12T01:00:00.000Z",
  end: "2026-08-12T03:00:00.000Z",
});

const AUTHORIZATION = Object.freeze({
  controlledApprovalRef: "CONTENT_APPROVAL_REF_001",
  contentAuthorizationDigest: "1".repeat(64),
  uedAcceptanceDigest: "2".repeat(64),
  photographyAuthorizationDigest: "3".repeat(64),
  artifactProvenanceDigest: "4".repeat(64),
});

function trustedAuthorizationAdapter(overrides = {}) {
  return {
    authorizeActivityPublication(request) {
      return {
        authorized: true,
        adapterId: "ACTIVITY_AUTH_ADAPTER_TEST_V1",
        decisionRef: "ACTIVITY_AUTH_DECISION_TEST_001",
        publishOwnerSignerRef: "SIGNER_REF_PUBLISH_ADAPTER_001",
        verifiedAt: "2026-08-01T01:59:00.000Z",
        evidence: request.evidence,
        principalOperatorId: request.principal.operatorId,
        activityVersionId: request.activity.activityVersionId,
        activityId: request.activity.activityId,
        requestId: request.requestId,
        ...overrides,
      };
    },
  };
}

function publicationContext(now, overrides = {}) {
  return {
    now,
    env: { ROOT_ACTIVITY_PUBLICATION_AUTHORIZATION_ENABLED: "true" },
    adminPrincipal: { operatorId: "activity-publisher", role: "admin", tokenConfigured: true },
    activityPublicationAuthorizationAdapter: trustedAuthorizationAdapter({
      verifiedAt: new Date(new Date(now).getTime() - 60 * 1000).toISOString(),
    }),
    ...overrides,
  };
}

function trustedAdminContext(now, operatorId = "activity-publisher") {
  return {
    now,
    adminPrincipal: { operatorId, role: "admin", tokenConfigured: true },
  };
}

function publicationInput(overrides = {}) {
  return {
    publishOwnerSignerRef: "SIGNER_REF_PUBLISH_001",
    operatorId: "activity-publisher",
    requestId: "ACTIVITY_PUBLISH_REQUEST_001",
    ...AUTHORIZATION,
    ...overrides,
  };
}

function data() {
  return {};
}

function draftInput(overrides = {}) {
  return {
    activityId: "root_activity_001",
    activityVersionId: "root_activity_001_v1",
    version: 1,
    title: "ROOT 线下生活方式工作坊",
    summary: "由运营后台发布的测试活动内容",
    objective: "帮助参与者建立可持续的日常生活方式练习",
    audience: "已完成 ROOT 健康状态评测并希望改善生活节律的会员",
    agenda: "签到与说明；引导练习；小组交流；行动计划确认",
    organizer: "ROOT 生活方式团队",
    feeDescription: "会员免费，名额有限",
    bringItems: "请携带饮用水并穿着便于活动的服装",
    cancelPolicy: "可在取消截止时间前自行取消，逾期请联系活动联系人",
    privacyNoticeText: "报名信息仅用于本次活动组织、通知与安全保障",
    photographyNoticeText: "现场可能进行授权摄影；未授权参与者可向工作人员说明",
    contactDisplay: "ROOT 活动运营（小程序内联系）",
    detailVersion: "detail-v1",
    city: "上海",
    venueSummary: "静安区受控场地",
    activityType: "WORKSHOP",
    heroAssetRef: "ASSET_REF_001",
    privacyNoticeRef: "PRIVACY_REF_001",
    photographyNoticeRef: "PHOTO_NOTICE_REF_001",
    contentApprovalRef: "CONTENT_APPROVAL_REF_001",
    contactOwnerSignerRef: "SIGNER_REF_CONTACT_001",
    source: "OPS_BACKEND",
    ...overrides,
  };
}

function publishDefinition(store, overrides = {}) {
  const draft = activity.upsertDraft(store, draftInput(overrides), { now: T.draft });
  activity.submitForReview(store, draft.activityVersionId, { now: "2026-08-01T01:00:00.000Z" });
  return activity.publish(
    store,
    draft.activityVersionId,
    publicationInput(),
    publicationContext("2026-08-01T02:00:00.000Z")
  );
}

function openSession(store, overrides = {}) {
  const definition = publishDefinition(store, overrides.definition || {});
  const session = activity.createSession(store, {
    activityVersionId: definition.activityVersionId,
    sessionId: overrides.sessionId || "root_session_001",
    approvalMode: overrides.approvalMode || "AUTO",
    capacity: overrides.capacity || 1,
    registrationOpenAt: T.open,
    registrationCloseAt: T.close,
    cancelCloseAt: T.cancel,
    reviewDeadline: overrides.approvalMode === "MANUAL" ? "2026-08-10T12:00:00.000Z" : undefined,
    sessionStartAt: T.start,
    sessionEndAt: T.end,
    allowReapply: overrides.allowReapply === true,
  }, { now: T.draft });
  return activity.setSessionState(store, session.sessionId, "OPEN", { now: T.open });
}

test("formal activity content fails closed unless it comes from the operations backend", () => {
  const store = data();
  assert.throws(
    () => activity.upsertDraft(store, draftInput({ source: "UED_PLACEHOLDER" }), { now: T.draft }),
    { code: "ACTIVITY_SOURCE_NOT_AUTHORIZED" }
  );
  assert.equal(store.activityDefinitionVersions, undefined);
});

test("invalid draft input leaves no partially persisted activity version", () => {
  const store = data();
  const before = JSON.parse(JSON.stringify(store));
  assert.throws(
    () => activity.upsertDraft(store, draftInput({ contactOwnerSignerRef: "" }), { now: T.draft }),
    { code: "ACTIVITY_INPUT_INVALID" }
  );
  assert.deepEqual(store, before);
});

test("activity visibility fails closed instead of widening malformed member content to public", () => {
  const store = data();
  assert.throws(
    () => activity.upsertDraft(store, draftInput({ visibility: "MEMBERS" }), { now: T.draft }),
    { code: "ACTIVITY_VISIBILITY_INVALID" }
  );
  assert.throws(
    () => activity.upsertDraft(store, draftInput({ visibility: "MEMBER" }), { now: T.draft }),
    { code: "ACTIVITY_MEMBER_REQUIREMENT_REQUIRED" }
  );
});

test("publication fails closed without the feature flag, trusted Adapter, server principal, or exact decision", () => {
  const cases = [
    {
      context: publicationContext("2026-08-01T02:00:00.000Z", {
        env: { ROOT_ACTIVITY_PUBLICATION_AUTHORIZATION_ENABLED: "false" },
      }),
      code: "ACTIVITY_PUBLICATION_AUTHORIZATION_DISABLED",
    },
    {
      context: publicationContext("2026-08-01T02:00:00.000Z", {
        activityPublicationAuthorizationAdapter: null,
      }),
      code: "ACTIVITY_PUBLICATION_AUTHORIZATION_ADAPTER_UNAVAILABLE",
    },
    {
      context: publicationContext("2026-08-01T02:00:00.000Z", {
        adminPrincipal: { operatorId: "activity-publisher", role: "admin", tokenConfigured: false },
      }),
      code: "ACTIVITY_PUBLICATION_PRINCIPAL_UNTRUSTED",
    },
    {
      context: publicationContext("2026-08-01T02:00:00.000Z", {
        activityPublicationAuthorizationAdapter: trustedAuthorizationAdapter({
          evidence: { ...AUTHORIZATION, artifactProvenanceDigest: "5".repeat(64) },
        }),
      }),
      code: "ACTIVITY_PUBLICATION_NOT_AUTHORIZED",
    },
    {
      context: publicationContext("2026-08-01T02:00:00.000Z", {
        activityPublicationAuthorizationAdapter: trustedAuthorizationAdapter({
          activityVersionId: "another_activity_version",
        }),
      }),
      code: "ACTIVITY_PUBLICATION_NOT_AUTHORIZED",
    },
    {
      context: publicationContext("2026-08-01T02:00:00.000Z", {
        activityPublicationAuthorizationAdapter: trustedAuthorizationAdapter({ verifiedAt: undefined }),
      }),
      code: "ACTIVITY_PUBLICATION_NOT_AUTHORIZED",
    },
    {
      context: publicationContext("2026-08-01T02:00:00.000Z", {
        activityPublicationAuthorizationAdapter: trustedAuthorizationAdapter({
          verifiedAt: "2026-08-01T02:00:00.001Z",
        }),
      }),
      code: "ACTIVITY_PUBLICATION_NOT_AUTHORIZED",
    },
    {
      context: publicationContext("2026-08-01T02:00:00.000Z", {
        activityPublicationAuthorizationAdapter: trustedAuthorizationAdapter({
          verifiedAt: "2026-08-01T01:54:59.999Z",
        }),
      }),
      code: "ACTIVITY_PUBLICATION_NOT_AUTHORIZED",
    },
    {
      context: publicationContext("2026-08-01T02:00:00.000Z", {
        activityPublicationAuthorizationAdapter: trustedAuthorizationAdapter({
          requestId: "ANOTHER_PUBLISH_REQUEST",
        }),
      }),
      code: "ACTIVITY_PUBLICATION_NOT_AUTHORIZED",
    },
  ];
  cases.forEach(({ context, code }, index) => {
    const store = data();
    const draft = activity.upsertDraft(store, draftInput({
      activityId: `publication_guard_${index}`,
      activityVersionId: `publication_guard_${index}_v1`,
    }), { now: T.draft });
    activity.submitForReview(store, draft.activityVersionId, { now: "2026-08-01T01:00:00.000Z" });
    assert.throws(
      () => activity.publish(store, draft.activityVersionId, publicationInput(), context),
      { code }
    );
    assert.equal(store.activityDefinitionVersions[0].status, "IN_REVIEW");
  });
});

test("trusted publication decision is persisted with all authorization and provenance digests", () => {
  const store = data();
  const published = publishDefinition(store);
  const definition = store.activityDefinitionVersions[0];
  assert.equal(published.objective, draftInput().objective);
  assert.equal(published.cancelPolicy, draftInput().cancelPolicy);
  assert.equal(published.privacyNoticeText, draftInput().privacyNoticeText);
  assert.equal(published.photographyNoticeText, draftInput().photographyNoticeText);
  assert.equal(published.contactDisplay, draftInput().contactDisplay);
  assert.equal(definition.publication_authorization_adapter_id, "ACTIVITY_AUTH_ADAPTER_TEST_V1");
  assert.equal(definition.publish_owner_signer_ref, "SIGNER_REF_PUBLISH_ADAPTER_001");
  assert.equal(definition.publication_authorized_principal_ref, "activity-publisher");
  assert.equal(definition.controlled_approval_ref, definition.content_approval_ref);
  assert.equal(definition.artifact_provenance_digest, AUTHORIZATION.artifactProvenanceDigest);
});

test("published versions are immutable and only one version may be published per activity", () => {
  const store = data();
  publishDefinition(store);
  assert.throws(
    () => activity.upsertDraft(store, draftInput({ title: "试图原地改写" }), { now: T.open }),
    { code: "ACTIVITY_VERSION_IMMUTABLE" }
  );

  const v2 = activity.upsertDraft(store, draftInput({
    activityVersionId: "root_activity_001_v2",
    version: 2,
    detailVersion: "detail-v2",
  }), { now: T.open });
  activity.submitForReview(store, v2.activityVersionId, { now: T.open });
  assert.throws(
    () => activity.publish(store, v2.activityVersionId, {
      ...publicationInput({
        publishOwnerSignerRef: "SIGNER_REF_PUBLISH_002",
        requestId: "ACTIVITY_PUBLISH_REQUEST_002",
      }),
    }, publicationContext(T.open)),
    { code: "ACTIVITY_PUBLISHED_VERSION_CONFLICT" }
  );
});

test("one publication decision cannot authorize two activity versions", () => {
  const store = data();
  publishDefinition(store);
  const second = activity.upsertDraft(store, draftInput({
    activityId: "root_activity_002",
    activityVersionId: "root_activity_002_v1",
  }), { now: T.open });
  activity.submitForReview(store, second.activityVersionId, { now: T.open });
  assert.throws(() => activity.publish(
    store,
    second.activityVersionId,
    publicationInput({ requestId: "ACTIVITY_PUBLISH_REQUEST_REUSED_DECISION" }),
    publicationContext(T.open)
  ), { code: "ACTIVITY_PUBLICATION_DECISION_REUSED" });
  assert.equal(store.activityDefinitionVersions[1].status, "IN_REVIEW");
});

test("review, withdraw, and archive signer refs come only from the trusted admin principal", () => {
  const store = data();
  const draft = activity.upsertDraft(store, draftInput(), { now: T.draft });
  activity.submitForReview(store, draft.activityVersionId, { now: "2026-08-01T01:00:00.000Z" });
  assert.throws(() => activity.requestChanges(store, draft.activityVersionId, {
    reason: "恶意伪造审核人",
    reviewerSignerRef: "SPOOFED_REVIEWER",
  }, trustedAdminContext("2026-08-01T01:20:00.000Z", "reviewer-admin")), {
    code: "ACTIVITY_REVIEWER_PRINCIPAL_UNTRUSTED",
  });
  assert.equal(store.activityDefinitionVersions[0].status, "IN_REVIEW");
  const returned = activity.requestChanges(store, draft.activityVersionId, {
    reason: "补充取消政策",
  }, trustedAdminContext("2026-08-01T01:30:00.000Z", "reviewer-admin"));
  assert.equal(returned.status, "DRAFT");
  assert.equal(store.activityDefinitionVersions[0].reviewer_signer_ref, "reviewer-admin");
  const revised = activity.upsertDraft(store, draftInput({ summary: "补充取消政策后的正式摘要" }), {
    now: "2026-08-01T01:40:00.000Z",
  });
  activity.submitForReview(store, revised.activityVersionId, { now: "2026-08-01T01:50:00.000Z" });
  activity.publish(
    store,
    revised.activityVersionId,
    publicationInput(),
    publicationContext("2026-08-01T02:00:00.000Z")
  );
  assert.throws(() => activity.unpublish(store, revised.activityVersionId, {
    withdrawOwnerSignerRef: "SPOOFED_WITHDRAW_OWNER",
    reason: "版本替换",
  }, trustedAdminContext("2026-08-02T00:00:00.000Z", "publisher-admin")), {
    code: "ACTIVITY_WITHDRAW_PRINCIPAL_UNTRUSTED",
  });
  assert.equal(store.activityDefinitionVersions[0].status, "PUBLISHED");
  activity.unpublish(store, revised.activityVersionId, {
    reason: "版本替换",
  }, trustedAdminContext("2026-08-02T00:00:00.000Z", "publisher-admin"));
  assert.equal(store.activityDefinitionVersions[0].withdraw_owner_signer_ref, "publisher-admin");
  assert.throws(() => activity.archive(store, revised.activityVersionId, {
    archiveOwnerSignerRef: "SPOOFED_ARCHIVE_OWNER",
    reason: "历史版本归档",
  }, trustedAdminContext("2026-08-03T00:00:00.000Z", "archive-admin")), {
    code: "ACTIVITY_ARCHIVE_PRINCIPAL_UNTRUSTED",
  });
  assert.equal(store.activityDefinitionVersions[0].status, "UNPUBLISHED");
  const archived = activity.archive(store, revised.activityVersionId, {
    reason: "历史版本归档",
  }, trustedAdminContext("2026-08-03T00:00:00.000Z", "archive-admin"));
  assert.equal(archived.status, "ARCHIVED");
  assert.equal(store.activityDefinitionVersions[0].archive_owner_signer_ref, "archive-admin");
  assert.throws(() => activity.submitForReview(store, revised.activityVersionId), {
    code: "ACTIVITY_STATE_CONFLICT",
  });
});

test("auto approval never oversells the last place and repeated enrollment is idempotent", () => {
  const store = data();
  openSession(store, { capacity: 1 });
  const first = activity.enroll(store, "user_001", {
    sessionId: "root_session_001",
    requestId: "ENROLL_REQUEST_001",
  }, { now: "2026-08-03T00:00:00.000Z" });
  const replay = activity.enroll(store, "user_001", {
    sessionId: "root_session_001",
    requestId: "ENROLL_REQUEST_001",
  }, { now: "2026-08-03T00:00:01.000Z" });
  assert.equal(first.enrollment.status, "CONFIRMED");
  assert.equal(replay.enrollment.enrollmentId, first.enrollment.enrollmentId);
  assert.equal(replay.replayed, true);
  assert.equal(store.activityEnrollments.length, 1);
  assert.equal(store.activityEnrollmentEvents.length, 1);
  assert.throws(
    () => activity.enroll(store, "user_002", {
      sessionId: "root_session_001",
      requestId: "ENROLL_REQUEST_002",
    }, { now: "2026-08-03T00:00:02.000Z" }),
    { code: "CAPACITY_FULL" }
  );
  assert.equal(activity.confirmedCount(store, "root_session_001"), 1);
});

test("manual approval does not reserve pending places and rechecks capacity atomically", () => {
  const store = data();
  openSession(store, { capacity: 1, approvalMode: "MANUAL" });
  const first = activity.enroll(store, "user_001", {
    sessionId: "root_session_001",
    requestId: "MANUAL_ENROLL_001",
  }, { now: "2026-08-03T00:00:00.000Z" });
  const second = activity.enroll(store, "user_002", {
    sessionId: "root_session_001",
    requestId: "MANUAL_ENROLL_002",
  }, { now: "2026-08-03T00:00:01.000Z" });
  assert.equal(first.enrollment.status, "PENDING");
  assert.equal(second.enrollment.status, "PENDING");
  assert.equal(activity.confirmedCount(store, "root_session_001"), 0);

  const confirmed = activity.reviewEnrollment(store, {
    enrollmentId: first.enrollment.enrollmentId,
    expectedAttemptGeneration: first.enrollment.attemptGeneration,
    requestId: "MANUAL_REVIEW_001",
    approve: true,
  }, { now: "2026-08-04T00:00:00.000Z" });
  const rejected = activity.reviewEnrollment(store, {
    enrollmentId: second.enrollment.enrollmentId,
    expectedAttemptGeneration: second.enrollment.attemptGeneration,
    requestId: "MANUAL_REVIEW_002",
    approve: true,
  }, { now: "2026-08-04T00:00:01.000Z" });
  assert.equal(confirmed.enrollment.status, "CONFIRMED");
  assert.equal(rejected.enrollment.status, "REJECTED");
  assert.equal(rejected.enrollment.reasonCode, "CAPACITY_FULL_AT_REVIEW");
  assert.equal(activity.confirmedCount(store, "root_session_001"), 1);
});

test("stale manual review cannot confirm a later reapply generation", () => {
  const store = data();
  openSession(store, { capacity: 1, approvalMode: "MANUAL", allowReapply: true });
  const first = activity.enroll(store, "generation_user", {
    sessionId: "root_session_001",
    requestId: "GENERATION_ENROLL_001",
  }, { now: "2026-08-03T00:00:00.000Z" });
  activity.cancelEnrollment(store, "generation_user", {
    sessionId: "root_session_001",
    requestId: "GENERATION_CANCEL_001",
  }, { now: "2026-08-03T01:00:00.000Z" });
  const second = activity.enroll(store, "generation_user", {
    sessionId: "root_session_001",
    requestId: "GENERATION_ENROLL_002",
  }, { now: "2026-08-03T02:00:00.000Z" });
  assert.equal(first.enrollment.attemptGeneration, 1);
  assert.equal(second.enrollment.attemptGeneration, 2);
  assert.throws(() => activity.reviewEnrollment(store, {
    enrollmentId: second.enrollment.enrollmentId,
    expectedAttemptGeneration: 1,
    requestId: "GENERATION_STALE_REVIEW_001",
    approve: true,
  }, { now: "2026-08-04T00:00:00.000Z" }), {
    code: "ACTIVITY_ENROLLMENT_GENERATION_CONFLICT",
  });
  assert.equal(store.activityEnrollments[0].status, "PENDING");
  const confirmed = activity.reviewEnrollment(store, {
    enrollmentId: second.enrollment.enrollmentId,
    expectedAttemptGeneration: 2,
    requestId: "GENERATION_REVIEW_002",
    approve: true,
  }, { now: "2026-08-04T00:00:01.000Z" });
  assert.equal(confirmed.enrollment.status, "CONFIRMED");
  assert.equal(store.activityEnrollmentEvents.at(-1).attempt_generation, 2);
});

test("manual review deadline is frozen inside the registration-close to session-start window", () => {
  const store = data();
  const definition = publishDefinition(store);
  assert.throws(() => activity.createSession(store, {
    activityVersionId: definition.activityVersionId,
    sessionId: "bad_review_deadline_session",
    approvalMode: "MANUAL",
    capacity: 1,
    registrationOpenAt: T.open,
    registrationCloseAt: T.close,
    cancelCloseAt: T.cancel,
    reviewDeadline: "2026-08-13T00:00:00.000Z",
    sessionStartAt: T.start,
    sessionEndAt: T.end,
  }, { now: T.draft }), { code: "ACTIVITY_REVIEW_DEADLINE_INVALID" });
});

test("manual review after the deadline deterministically becomes REVIEW_TIMEOUT", () => {
  const store = data();
  openSession(store, { capacity: 2, approvalMode: "MANUAL" });
  const pending = activity.enroll(store, "user_review_late", {
    sessionId: "root_session_001",
    requestId: "LATE_REVIEW_ENROLL",
  }, { now: "2026-08-03T00:00:00.000Z" });
  const reviewed = activity.reviewEnrollment(store, {
    enrollmentId: pending.enrollment.enrollmentId,
    expectedAttemptGeneration: pending.enrollment.attemptGeneration,
    requestId: "LATE_REVIEW_COMMAND",
    approve: true,
  }, { now: "2026-08-10T12:00:00.001Z" });
  assert.equal(reviewed.enrollment.status, "REJECTED");
  assert.equal(reviewed.enrollment.reasonCode, "REVIEW_TIMEOUT");
  assert.equal(store.activityEnrollmentEvents.at(-1).operation, "REVIEW_TIMEOUT");
});

test("manual approvals that miss the frozen review deadline are rejected idempotently", () => {
  const store = data();
  openSession(store, { capacity: 2, approvalMode: "MANUAL" });
  const pending = activity.enroll(store, "user_timeout_001", {
    sessionId: "root_session_001",
    requestId: "TIMEOUT_ENROLL_001",
  }, { now: "2026-08-03T00:00:00.000Z" });
  assert.equal(pending.enrollment.status, "PENDING");
  const first = activity.expirePendingReviews(store, { requestId: "TIMEOUT_RUN_001" }, {
    now: "2026-08-11T00:00:00.000Z",
  });
  const repeated = activity.expirePendingReviews(store, { requestId: "TIMEOUT_RUN_001" }, {
    now: "2026-08-11T00:00:01.000Z",
  });
  assert.equal(first.processedCount, 1);
  assert.equal(repeated.processedCount, 0);
  assert.equal(store.activityEnrollments[0].status, "REJECTED");
  assert.equal(store.activityEnrollments[0].reason_code, "REVIEW_TIMEOUT");
  assert.equal(store.activityEnrollmentEvents.filter((event) => event.operation === "REVIEW_TIMEOUT").length, 1);
});

test("a closed session with pending enrollments cannot transition to ENDED", () => {
  const store = data();
  openSession(store, { capacity: 2, approvalMode: "MANUAL" });
  activity.enroll(store, "pending_end_guard_user", {
    sessionId: "root_session_001",
    requestId: "PENDING_END_GUARD_ENROLL",
  }, { now: "2026-08-03T00:00:00.000Z" });
  activity.setSessionState(store, "root_session_001", "CLOSED", { now: "2026-08-10T00:00:00.000Z" });
  assert.throws(
    () => activity.setSessionState(store, "root_session_001", "ENDED", { now: T.end }),
    { code: "ACTIVITY_PENDING_ENROLLMENTS_EXIST" }
  );
  assert.equal(store.activitySessions[0].status, "CLOSED");
  const { normalizeStoreData, validateSnapshot } = require("../src/store");
  const invalid = normalizeStoreData(store, { seedSampleData: false });
  invalid.activitySessions[0].status = "ENDED";
  assert.match(validateSnapshot(invalid).errors.join("\n"), /ended activity session has pending enrollment/);
});

test("cancellation frees capacity while reapply remains disabled by default", () => {
  const store = data();
  openSession(store, { capacity: 1 });
  activity.enroll(store, "user_001", {
    sessionId: "root_session_001",
    requestId: "CANCEL_FLOW_ENROLL_001",
  }, { now: "2026-08-03T00:00:00.000Z" });
  const canceled = activity.cancelEnrollment(store, "user_001", {
    sessionId: "root_session_001",
    requestId: "CANCEL_FLOW_CANCEL_001",
  }, { now: "2026-08-04T00:00:00.000Z" });
  assert.equal(canceled.enrollment.status, "CANCELED");
  assert.equal(activity.confirmedCount(store, "root_session_001"), 0);
  assert.throws(
    () => activity.enroll(store, "user_001", {
      sessionId: "root_session_001",
      requestId: "CANCEL_FLOW_REAPPLY_001",
    }, { now: "2026-08-05T00:00:00.000Z" }),
    { code: "ACTIVITY_REAPPLY_NOT_ALLOWED" }
  );
  const replacement = activity.enroll(store, "user_002", {
    sessionId: "root_session_001",
    requestId: "CANCEL_FLOW_ENROLL_002",
  }, { now: "2026-08-05T00:00:01.000Z" });
  assert.equal(replacement.enrollment.status, "CONFIRMED");
});

test("server action projection allows cancellation after an early CLOSED transition but before cutoff", () => {
  const store = data();
  openSession(store, { capacity: 1 });
  activity.enroll(store, "closed_cancel_user", {
    sessionId: "root_session_001",
    requestId: "CLOSED_CANCEL_ENROLL",
  }, { now: "2026-08-03T00:00:00.000Z" });
  activity.setSessionState(store, "root_session_001", "CLOSED", { now: "2026-08-04T00:00:00.000Z" });
  const detail = activity.getDetail(store, { sessionId: "root_session_001" }, "closed_cancel_user", {
    now: "2026-08-05T00:00:00.000Z",
  });
  assert.equal(detail.session.listingState, "REGISTRATION_CLOSED");
  assert.equal(detail.session.cancelCloseAt, T.cancel);
  assert.deepEqual(detail.actions, { cancelAllowed: true, cancelReasonCode: "" });
  assert.equal(activity.cancelEnrollment(store, "closed_cancel_user", {
    sessionId: "root_session_001",
    requestId: "CLOSED_CANCEL_COMMAND",
  }, { now: "2026-08-05T00:00:00.000Z" }).enrollment.status, "CANCELED");
});

test("independent cancellation cutoff blocks self-service cancellation even before the session starts", () => {
  const store = data();
  openSession(store, { capacity: 1 });
  activity.enroll(store, "late_cancel_user", {
    sessionId: "root_session_001",
    requestId: "LATE_CANCEL_ENROLL",
  }, { now: "2026-08-03T00:00:00.000Z" });
  const detail = activity.getDetail(store, { sessionId: "root_session_001" }, "late_cancel_user", {
    now: T.cancel,
  });
  assert.deepEqual(detail.actions, { cancelAllowed: false, cancelReasonCode: "CUTOFF_PASSED" });
  assert.throws(() => activity.cancelEnrollment(store, "late_cancel_user", {
    sessionId: "root_session_001",
    requestId: "LATE_CANCEL_COMMAND",
  }, { now: T.cancel }), { code: "CUTOFF_PASSED" });
  assert.equal(store.activityEnrollments[0].status, "CONFIRMED");
});

test("session cancellation keeps history and cancels every active enrollment", () => {
  const store = data();
  openSession(store, { capacity: 2, approvalMode: "MANUAL" });
  activity.enroll(store, "user_001", {
    sessionId: "root_session_001",
    requestId: "SESSION_CANCEL_ENROLL_001",
  }, { now: "2026-08-03T00:00:00.000Z" });
  activity.enroll(store, "user_002", {
    sessionId: "root_session_001",
    requestId: "SESSION_CANCEL_ENROLL_002",
  }, { now: "2026-08-03T00:00:01.000Z" });
  const result = activity.cancelSession(store, "root_session_001", {
    requestId: "SESSION_CANCEL_001",
    reason: "VENUE",
    operatorId: "activity-operator",
  }, { now: "2026-08-05T00:00:00.000Z" });
  assert.equal(result.status, "CANCELED");
  assert.deepEqual(store.activityEnrollments.map((item) => item.status), ["CANCELED", "CANCELED"]);
  assert.deepEqual(store.activityEnrollments.map((item) => item.reason_code), ["SESSION_CANCELED", "SESSION_CANCELED"]);
  assert.equal(store.activityEnrollmentEvents.length, 4);
  assert.equal(store.activitySessionEvents.length, 1);
  assert.equal(store.activitySessionEvents[0].request_id, "SESSION_CANCEL_001");
  const replay = activity.cancelSession(store, "root_session_001", {
    requestId: "SESSION_CANCEL_001",
    reason: "VENUE",
    operatorId: "activity-operator",
  }, { now: "2026-08-05T00:00:01.000Z" });
  assert.equal(replay.status, "CANCELED");
  assert.equal(store.activitySessionEvents.length, 1);
  assert.throws(() => activity.cancelSession(store, "root_session_001", {
    requestId: "SESSION_CANCEL_DIFFERENT_REQUEST",
    reason: "VENUE",
    operatorId: "activity-operator",
  }, { now: "2026-08-05T00:00:02.000Z" }), { code: "ACTIVITY_SESSION_STATE_CONFLICT" });
  assert.equal(store.activitySessionEvents.length, 1);
});

test("generic session state cannot bypass reasoned cancellation and Store validation matches MySQL shape", () => {
  const store = data();
  openSession(store, { capacity: 2, approvalMode: "MANUAL" });
  activity.enroll(store, "user_cancel_guard", {
    sessionId: "root_session_001",
    requestId: "CANCEL_GUARD_ENROLL",
  }, { now: "2026-08-03T00:00:00.000Z" });
  assert.throws(
    () => activity.setSessionState(store, "root_session_001", "CANCELED", { now: "2026-08-04T00:00:00.000Z" }),
    { code: "ACTIVITY_SESSION_STATE_CONFLICT" }
  );
  const canceled = activity.cancelSession(store, "root_session_001", {
    requestId: "CANCEL_GUARD_COMMAND",
    reason: "VENUE",
    operatorId: "activity-operator",
  }, { now: "2026-08-04T00:00:00.000Z" });
  assert.equal(canceled.status, "CANCELED");
  const { normalizeStoreData, validateSnapshot } = require("../src/store");
  assert.deepEqual(validateSnapshot(normalizeStoreData(store, { seedSampleData: false })).errors, []);
});

test("public listing is deterministic and never exposes UED placeholder content", () => {
  const store = data();
  openSession(store, { capacity: 1 });
  const list = activity.listVisible(store, { city: "上海", activityType: "WORKSHOP" }, {
    now: "2026-08-03T00:00:00.000Z",
  });
  assert.equal(list.length, 1);
  assert.equal(list[0].session.listingState, "AVAILABLE");
  activity.enroll(store, "user_001", {
    sessionId: "root_session_001",
    requestId: "LISTING_ENROLL_001",
  }, { now: "2026-08-03T00:00:01.000Z" });
  assert.equal(activity.listVisible(store, {}, { now: "2026-08-03T00:00:02.000Z" })[0].session.listingState, "FULL");
  assert.equal(activity.listVisible(store, { city: "北京" }, { now: "2026-08-03T00:00:02.000Z" }).length, 0);
  assert.equal(activity.listVisible(store, { type: "WORKSHOP" }, { now: "2026-08-03T00:00:02.000Z" }).length, 1);
  assert.equal(activity.getDetail(store, { activityId: "root_activity_001" }, "", {
    now: "2026-08-03T00:00:02.000Z",
  }).session.sessionId, "root_session_001");
});

test("public activity page stays within the 100 KiB response budget at 20 maximum-length summaries", () => {
  const store = data();
  openSession(store, { capacity: 20 });
  const sourceDefinition = store.activityDefinitionVersions[0];
  const sourceSession = store.activitySessions[0];
  sourceDefinition.title = "活".repeat(160);
  sourceDefinition.summary = "动".repeat(512);
  for (let index = 1; index < 20; index += 1) {
    const suffix = String(index).padStart(2, "0");
    const activityVersionId = `root_activity_${suffix}_v1`;
    store.activityDefinitionVersions.push({
      ...sourceDefinition,
      activity_id: `root_activity_${suffix}`,
      activity_version_id: activityVersionId,
    });
    store.activitySessions.push({
      ...sourceSession,
      activity_session_id: `root_session_${suffix}`,
      activity_version_id: activityVersionId,
    });
  }
  const page = activity.listVisiblePage(store, { page: 1, pageSize: 20 }, {
    now: "2026-08-03T00:00:00.000Z",
  });
  assert.equal(page.items.length, 20);
  assert.equal(page.items.every((item) => item.objective === undefined && item.cancelPolicy === undefined), true);
  assert.ok(Buffer.byteLength(JSON.stringify(page), "utf8") <= 100 * 1024);
});

test("an OPEN session remains COMING_SOON before its frozen registration window", () => {
  const store = data();
  openSession(store, { capacity: 1 });
  store.activitySessions[0].registration_open_at = "2026-08-04T00:00:00.000Z";
  const now = "2026-08-03T00:00:00.000Z";
  const listed = activity.listVisible(store, {}, { now });
  assert.equal(listed[0].session.listingState, "COMING_SOON");
  assert.throws(
    () => activity.enroll(store, "early_user", {
      sessionId: "root_session_001",
      requestId: "EARLY_ENROLL_001",
    }, { now }),
    { code: "REGISTRATION_NOT_OPEN" }
  );
});

test("my enrollment history remains readable after unpublish and archive", () => {
  const store = data();
  openSession(store, { capacity: 1 });
  activity.enroll(store, "history_user", {
    sessionId: "root_session_001",
    requestId: "HISTORY_ENROLL",
  }, { now: "2026-08-03T00:00:00.000Z" });
  activity.unpublish(store, "root_activity_001_v1", {
    reason: "活动结束后下架",
  }, trustedAdminContext("2026-08-13T00:00:00.000Z"));
  activity.archive(store, "root_activity_001_v1", {
    reason: "保留历史报名",
  }, trustedAdminContext("2026-08-14T00:00:00.000Z"));
  const history = activity.getMyEnrollments(store, "history_user", {}, {
    now: "2026-08-14T00:00:00.000Z",
  });
  assert.equal(history.length, 1);
  assert.equal(history[0].activity.status, "ARCHIVED");
});

test("request identifiers cannot be reused across different activity writes", () => {
  const store = data();
  openSession(store, { capacity: 2 });
  activity.enroll(store, "user_001", {
    sessionId: "root_session_001",
    requestId: "GLOBAL_ACTIVITY_REQUEST_001",
  }, { now: "2026-08-03T00:00:00.000Z" });
  assert.throws(
    () => activity.enroll(store, "user_002", {
      sessionId: "root_session_001",
      requestId: "GLOBAL_ACTIVITY_REQUEST_001",
    }, { now: "2026-08-03T00:00:01.000Z" }),
    { code: "ACTIVITY_IDEMPOTENCY_CONFLICT" }
  );
});

test("session event request identifiers cannot be reused by a later enrollment event", () => {
  const store = data();
  openSession(store, { capacity: 2 });
  activity.cancelSession(store, "root_session_001", {
    requestId: "GLOBAL_ACTIVITY_SESSION_REQUEST_001",
    reason: "WEATHER",
    operatorId: "activity-operator",
  }, { now: "2026-08-03T00:00:00.000Z" });
  const secondSession = activity.createSession(store, {
    activityVersionId: "root_activity_001_v1",
    sessionId: "root_session_002",
    approvalMode: "AUTO",
    capacity: 2,
    registrationOpenAt: "2026-08-02T00:00:00.000Z",
    registrationCloseAt: "2026-08-10T00:00:00.000Z",
    cancelCloseAt: "2026-08-12T00:00:00.000Z",
    sessionStartAt: "2026-08-13T01:00:00.000Z",
    sessionEndAt: "2026-08-13T03:00:00.000Z",
  }, { now: "2026-08-01T03:00:00.000Z" });
  activity.setSessionState(store, secondSession.sessionId, "OPEN", { now: T.open });
  assert.throws(
    () => activity.enroll(store, "user_002", {
      sessionId: secondSession.sessionId,
      requestId: "GLOBAL_ACTIVITY_SESSION_REQUEST_001",
    }, { now: "2026-08-03T00:00:01.000Z" }),
    { code: "ACTIVITY_IDEMPOTENCY_CONFLICT" }
  );
  assert.equal(store.activityEnrollments.length, 0);
});

test("OTHER session cancellation requires an auditable explanation", () => {
  const store = data();
  openSession(store);
  assert.throws(
    () => activity.cancelSession(store, "root_session_001", {
      requestId: "SESSION_OTHER_CANCEL_001",
      reason: "OTHER",
    }, { now: "2026-08-05T00:00:00.000Z" }),
    { code: "ACTIVITY_CANCEL_REASON_DETAIL_REQUIRED" }
  );
});
