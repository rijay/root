const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/app");
const activityModule = require("../src/activityModule");
const { createStore } = require("../src/domain");

const VIEWER_HEADERS = Object.freeze({ "X-Admin-Token": "activity-query-viewer" });
const OPERATOR_HEADERS = Object.freeze({ "X-Admin-Token": "activity-query-operator" });

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
    if (!server.listening) return resolve();
    return server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function request(baseUrl, path, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  return { status: response.status, body: await response.json() };
}

function seedAdminActivityData() {
  const store = createStore();
  store.users.push({
    user_id: "root-user-pseudonym-001",
    root_user_id: "root-user-pseudonym-001",
    nickname: "节律体验官",
    phone: "13800138000",
  });
  store.activityDefinitionVersions = [
    {
      activity_version_id: "activity-v1-manual",
      activity_id: "activity-manual",
      version: 1,
      status: "PUBLISHED",
      title: "ROOT 手工工作坊",
      summary: "公开活动摘要",
      objective: "建立可执行的生活方式行动计划",
      audience: "希望改善生活节律的参与者",
      agenda: "签到；引导练习；小组交流；行动确认",
      organizer: "ROOT 生活方式团队",
      fee_description: "会员免费",
      bring_items: "请携带饮用水",
      cancel_policy: "请在取消截止时间前自行取消",
      privacy_notice_text: "报名信息仅用于本次活动组织和通知",
      photography_notice_text: "摄影素材仅在获得授权后使用",
      contact_display: "ROOT 活动运营（小程序内联系）",
      detail_version: "detail-v1",
      city: "上海",
      venue_summary: "上海受控场地",
      activity_type: "WORKSHOP",
      hero_asset_ref: "ASSET_MANUAL",
      privacy_notice_ref: "PRIVACY_MANUAL",
      photography_notice_ref: "PHOTO_MANUAL",
      content_approval_ref: "APPROVAL_MANUAL",
      contact_owner_signer_ref: "CONTACT_OWNER_MANUAL",
      visibility: "PUBLIC",
      member_requirement: "",
      prebound_task_definition_id: "task-after-activity",
      prebound_task_definition_version: "task-after-activity-v1",
      source: "OPS_BACKEND",
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-10T00:00:00.000Z",
      published_at: "2026-07-10T00:00:00.000Z",
      openid: "wx-definition-secret",
      health_protocol: "health-definition-secret",
    },
    {
      activity_version_id: "activity-v1-auto",
      activity_id: "activity-auto",
      version: 1,
      status: "PUBLISHED",
      title: "ROOT 自动确认活动",
      summary: "自动确认活动摘要",
      objective: "通过轻量活动支持持续生活方式练习",
      audience: "已关联的有效 ROOT 会员",
      agenda: "集合；带领步行；拉伸；结束提醒",
      organizer: "ROOT 会员运营团队",
      fee_description: "会员专享免费",
      bring_items: "请穿着适合步行的服装并携带饮用水",
      cancel_policy: "请在取消截止时间前自行取消",
      privacy_notice_text: "报名信息仅用于本次活动组织和通知",
      photography_notice_text: "未授权参与者不会进入对外使用的摄影素材",
      contact_display: "ROOT 会员运营（小程序内联系）",
      detail_version: "detail-v1",
      city: "上海",
      venue_summary: "上海另一受控场地",
      activity_type: "WALK",
      hero_asset_ref: "ASSET_AUTO",
      privacy_notice_ref: "PRIVACY_AUTO",
      photography_notice_ref: "PHOTO_AUTO",
      content_approval_ref: "APPROVAL_AUTO",
      contact_owner_signer_ref: "CONTACT_OWNER_AUTO",
      visibility: "MEMBER",
      member_requirement: "ACTIVE",
      prebound_task_definition_id: "",
      prebound_task_definition_version: "",
      source: "OPS_BACKEND",
      created_at: "2026-07-02T00:00:00.000Z",
      updated_at: "2026-07-11T00:00:00.000Z",
      published_at: "2026-07-11T00:00:00.000Z",
    },
    {
      activity_version_id: "activity-v2-draft",
      activity_id: "activity-draft",
      version: 2,
      status: "DRAFT",
      title: "ROOT 草稿活动",
      summary: "草稿摘要",
      objective: "验证草稿活动内容编辑与审核流程",
      audience: "运营审核测试人员",
      agenda: "草稿内容检查；审核意见确认",
      organizer: "ROOT 活动运营团队",
      fee_description: "费用待审核",
      bring_items: "携带物品待审核",
      cancel_policy: "取消政策待审核",
      privacy_notice_text: "报名信息使用范围待审核",
      photography_notice_text: "摄影授权范围待审核",
      contact_display: "ROOT 活动运营（内部审核）",
      detail_version: "detail-v2",
      city: "北京",
      venue_summary: "北京受控场地",
      activity_type: "RETREAT",
      hero_asset_ref: "ASSET_DRAFT",
      privacy_notice_ref: "PRIVACY_DRAFT",
      photography_notice_ref: "PHOTO_DRAFT",
      content_approval_ref: "APPROVAL_DRAFT",
      contact_owner_signer_ref: "CONTACT_OWNER_DRAFT",
      visibility: "PUBLIC",
      member_requirement: "",
      prebound_task_definition_id: "",
      prebound_task_definition_version: "",
      source: "OPS_BACKEND",
      created_at: "2026-07-03T00:00:00.000Z",
      updated_at: "2026-07-12T00:00:00.000Z",
      published_at: null,
    },
  ];
  store.activitySessions = [
    {
      activity_session_id: "session-manual-ready",
      activity_version_id: "activity-v1-manual",
      status: "OPEN",
      approval_mode: "MANUAL",
      capacity: 2,
      registration_open_at: "2020-01-01T00:00:00.000Z",
      registration_close_at: "2099-01-01T00:00:00.000Z",
      cancel_close_at: "2099-01-01T18:00:00.000Z",
      review_deadline: "2099-01-01T12:00:00.000Z",
      session_start_at: "2099-01-02T00:00:00.000Z",
      session_end_at: "2099-01-02T02:00:00.000Z",
      allow_reapply: true,
      created_at: "2026-07-10T00:00:00.000Z",
      updated_at: "2026-07-10T00:00:00.000Z",
      phone: "session-phone-secret",
    },
    {
      activity_session_id: "session-manual-canceled",
      activity_version_id: "activity-v1-manual",
      status: "CANCELED",
      approval_mode: "MANUAL",
      capacity: 8,
      registration_open_at: "2020-01-01T00:00:00.000Z",
      registration_close_at: "2099-02-01T00:00:00.000Z",
      cancel_close_at: "2099-02-01T18:00:00.000Z",
      review_deadline: "2099-02-01T12:00:00.000Z",
      session_start_at: "2099-02-02T00:00:00.000Z",
      session_end_at: "2099-02-02T02:00:00.000Z",
      allow_reapply: false,
      cancel_reason: "VENUE",
      created_at: "2026-07-10T00:00:00.000Z",
      updated_at: "2026-07-13T00:00:00.000Z",
    },
    {
      activity_session_id: "session-auto",
      activity_version_id: "activity-v1-auto",
      status: "OPEN",
      approval_mode: "AUTO",
      capacity: 1,
      registration_open_at: "2020-01-01T00:00:00.000Z",
      registration_close_at: "2099-03-01T00:00:00.000Z",
      cancel_close_at: "2099-03-01T18:00:00.000Z",
      review_deadline: null,
      session_start_at: "2099-03-02T00:00:00.000Z",
      session_end_at: "2099-03-02T02:00:00.000Z",
      allow_reapply: false,
      created_at: "2026-07-11T00:00:00.000Z",
      updated_at: "2026-07-11T00:00:00.000Z",
    },
  ];
  store.activityEnrollments = [
    {
      activity_enrollment_id: "enrollment-manual-pending",
      activity_session_id: "session-manual-ready",
      root_user_id: "root-user-pseudonym-001",
      status: "PENDING",
      reason_code: null,
      attempt_generation: 2,
      created_at: "2026-07-14T00:00:00.000Z",
      updated_at: "2026-07-15T00:00:00.000Z",
      openid: "wx-enrollment-secret",
      unionid: "union-enrollment-secret",
      phone: "13800138000",
      health_answer: "health-enrollment-secret",
    },
    {
      activity_enrollment_id: "enrollment-manual-confirmed",
      activity_session_id: "session-manual-ready",
      root_user_id: "root-user-pseudonym-002",
      status: "CONFIRMED",
      reason_code: null,
      attempt_generation: 1,
      created_at: "2026-07-13T00:00:00.000Z",
      updated_at: "2026-07-14T00:00:00.000Z",
    },
    {
      activity_enrollment_id: "enrollment-manual-canceled-session",
      activity_session_id: "session-manual-canceled",
      root_user_id: "root-user-pseudonym-003",
      status: "PENDING",
      reason_code: null,
      attempt_generation: 1,
      created_at: "2026-07-12T00:00:00.000Z",
      updated_at: "2026-07-13T00:00:00.000Z",
    },
    {
      activity_enrollment_id: "enrollment-auto-pending-corrupt-fixture",
      activity_session_id: "session-auto",
      root_user_id: "root-user-pseudonym-004",
      status: "PENDING",
      reason_code: null,
      attempt_generation: 1,
      created_at: "2026-07-11T00:00:00.000Z",
      updated_at: "2026-07-12T00:00:00.000Z",
    },
  ];
  return store;
}

function assertNoRestrictedActivityFields(value) {
  const serialized = JSON.stringify(value).toLowerCase();
  [
    "openid",
    "unionid",
    "phone",
    "health",
    "assessment",
    "answer",
    "wx-definition-secret",
    "wx-enrollment-secret",
    "union-enrollment-secret",
    "13800138000",
    "health-enrollment-secret",
    "session-phone-secret",
  ].forEach((restricted) => assert.equal(serialized.includes(restricted), false, restricted));
}

test("Admin Activity Query Module validates bounded pagination and enum filters", () => {
  const store = seedAdminActivityData();
  assert.throws(
    () => activityModule.listAdminDefinitions(store, { page: 0 }),
    (error) => error.code === "ACTIVITY_ADMIN_QUERY_INVALID" && error.status === 400
  );
  assert.throws(
    () => activityModule.listAdminSessions(store, { pageSize: 101 }),
    (error) => error.code === "ACTIVITY_ADMIN_QUERY_INVALID" && error.status === 400
  );
  assert.throws(
    () => activityModule.listAdminEnrollments(store, { status: "UNKNOWN" }),
    (error) => error.code === "ACTIVITY_ADMIN_QUERY_INVALID" && error.status === 400
  );
  assert.throws(
    () => activityModule.listAdminEnrollments(store, { attemptGeneration: 0 }),
    (error) => error.code === "ACTIVITY_ADMIN_QUERY_INVALID" && error.status === 400
  );
});

test("Admin Activity Query HTTP Interface enforces capabilities, filters and explicit field allowlists", async (t) => {
  const server = createApp({
    store: seedAdminActivityData(),
    env: {
      ROOT_ADMIN_TOKENS: JSON.stringify({
        viewer: { token: "activity-query-viewer", role: "viewer" },
        operator: { token: "activity-query-operator", role: "operator" },
      }),
      ROOT_REQUIRE_ADMIN_TOKEN: "true",
    },
  });
  const baseUrl = await listen(server);
  t.after(() => closeServer(server));

  const unauthorized = await request(baseUrl, "/api/v1/admin/activities");
  assert.equal(unauthorized.status, 401);

  const publicActivities = await request(baseUrl, "/api/v1/activities?city=%E4%B8%8A%E6%B5%B7");
  assert.equal(publicActivities.status, 200);
  const publicSerialized = JSON.stringify(publicActivities.body);
  assert.equal(publicSerialized.includes("contentApprovalRef"), false);
  assert.equal(publicSerialized.includes("contactOwnerSignerRef"), false);
  assert.equal(publicSerialized.includes("APPROVAL_MANUAL"), false);
  assert.equal(publicSerialized.includes("CONTACT_OWNER_MANUAL"), false);

  const definitions = await request(
    baseUrl,
    "/api/v1/admin/activities?status=PUBLISHED&city=%E4%B8%8A%E6%B5%B7&page=1&pageSize=1",
    VIEWER_HEADERS
  );
  assert.equal(definitions.status, 200);
  assert.equal(definitions.body.data.pagination.total, 2);
  assert.equal(definitions.body.data.pagination.pageSize, 1);
  assert.equal(definitions.body.data.pagination.hasNextPage, true);
  assert.deepEqual(Object.keys(definitions.body.data.activities[0]).sort(), [
    "activityId", "activityType", "activityVersionId", "agenda", "audience", "bringItems", "cancelPolicy",
    "city", "contactDisplay", "contactOwnerSignerRef", "contentApprovalRef", "createdAt", "detailVersion",
    "feeDescription", "heroAssetRef", "memberRequirement", "objective", "organizer",
    "photographyNoticeRef", "photographyNoticeText", "privacyNoticeRef",
    "privacyNoticeText", "publishedAt", "source", "status", "summary", "title", "updatedAt",
    "venueSummary", "version", "visibility",
  ].sort());
  assert.equal(definitions.body.data.activities[0].cancelPolicy, "请在取消截止时间前自行取消");

  const sessions = await request(
    baseUrl,
    "/api/v1/admin/activity-sessions?approvalMode=MANUAL&activityId=activity-manual",
    VIEWER_HEADERS
  );
  assert.equal(sessions.status, 200);
  assert.equal(sessions.body.data.pagination.total, 2);
  assert.deepEqual(Object.keys(sessions.body.data.sessions[0]).sort(), [
    "activityId", "activityTitle", "activityVersionId", "allowReapply", "approvalMode", "cancelReason",
    "capacity", "capacityState", "city", "confirmedCount", "createdAt", "listingState",
    "cancelCloseAt", "registrationCloseAt", "registrationOpenAt", "remainingCapacity", "reviewDeadline", "sessionEndAt",
    "sessionId", "sessionStartAt", "status", "updatedAt",
  ].sort());
  assert.equal(sessions.body.data.sessions[0].cancelCloseAt, "2099-01-01T18:00:00.000Z");

  const viewerEnrollments = await request(baseUrl, "/api/v1/admin/activity-enrollments", VIEWER_HEADERS);
  assert.equal(viewerEnrollments.status, 403);
  const viewerQueue = await request(
    baseUrl,
    "/api/v1/admin/activity-enrollments/review-queue",
    VIEWER_HEADERS
  );
  assert.equal(viewerQueue.status, 403);

  const enrollments = await request(
    baseUrl,
    "/api/v1/admin/activity-enrollments?status=PENDING&sessionId=session-manual-ready&attemptGeneration=2",
    OPERATOR_HEADERS
  );
  assert.equal(enrollments.status, 200);
  assert.equal(enrollments.body.data.pagination.total, 1);
  assert.equal(enrollments.body.data.enrollments[0].rootUserId, "root-user-pseudonym-001");
  assert.equal(enrollments.body.data.enrollments[0].memberNickname, "节律体验官");
  assert.equal(enrollments.body.data.enrollments[0].memberContact, "138****8000");
  assert.deepEqual(Object.keys(enrollments.body.data.enrollments[0]).sort(), [
    "activityId", "activityTitle", "activityVersionId", "approvalMode", "attemptGeneration", "capacity",
    "capacityState", "city", "confirmedCount", "createdAt", "enrollmentId", "reasonCode",
    "memberContact", "memberNickname", "remainingCapacity", "reviewDeadline", "reviewState", "rootUserId", "sessionId", "sessionStartAt",
    "status", "updatedAt",
  ].sort());

  const readyQueue = await request(
    baseUrl,
    "/api/v1/admin/activity-enrollments/review-queue?reviewState=READY&city=%E4%B8%8A%E6%B5%B7",
    OPERATOR_HEADERS
  );
  assert.equal(readyQueue.status, 200);
  assert.equal(readyQueue.body.data.pagination.total, 1);
  assert.equal(readyQueue.body.data.reviewQueue[0].enrollmentId, "enrollment-manual-pending");
  assert.equal(readyQueue.body.data.reviewQueue[0].attemptGeneration, 2);

  const unavailableQueue = await request(
    baseUrl,
    "/api/v1/admin/activity-enrollments/review-queue?review_state=SESSION_UNAVAILABLE",
    OPERATOR_HEADERS
  );
  assert.equal(unavailableQueue.status, 200);
  assert.equal(unavailableQueue.body.data.pagination.total, 1);
  assert.equal(unavailableQueue.body.data.reviewQueue[0].enrollmentId, "enrollment-manual-canceled-session");

  [definitions.body, sessions.body, enrollments.body, readyQueue.body, unavailableQueue.body]
    .forEach(assertNoRestrictedActivityFields);
});
