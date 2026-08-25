const assert = require("node:assert/strict");
const {
  presentActivityDetail,
  presentActivityList,
  presentEnrollmentList,
  safeOpaqueId,
} = require("../utils/activity-presenter");

const activity = {
  activityId: "activity_001",
  title: "由运营后台发布的活动",
  summary: "仅用于 Presenter 契约测试",
  objective: "帮助参与者建立可持续的生活方式练习",
  audience: "已完成健康状态评测并希望改善生活节律的会员",
  agenda: "签到；引导练习；小组交流；行动计划确认",
  organizer: "ROOT 生活方式团队",
  feeDescription: "会员免费，名额有限",
  bringItems: "请携带饮用水并穿着便于活动的服装",
  cancelPolicy: "可在取消截止时间前自行取消，逾期请联系活动联系人",
  privacyNoticeText: "报名信息仅用于本次活动组织、通知与安全保障",
  photographyNoticeText: "现场可能进行授权摄影；未授权参与者可向工作人员说明",
  contactDisplay: "ROOT 活动运营（小程序内联系）",
  city: "上海",
  venueSummary: "受控场地",
  activityType: "WORKSHOP",
  heroAssetRef: "ASSET_REF_001",
  heroAssetUrl: "https://assets.example.com/root/activity_001.jpg",
  privacyNoticeRef: "NOTICE_PRIVACY_001",
  photographyNoticeRef: "NOTICE_PHOTO_001",
  visibility: "MEMBER",
  memberRequirement: "ACTIVE",
  session: {
    sessionId: "session_001",
    sessionStartAt: "2026-08-12T01:00:00.000Z",
    sessionEndAt: "2026-08-12T03:00:00.000Z",
    listingState: "AVAILABLE",
    approvalMode: "MANUAL",
    allowReapply: true,
    registrationCloseAt: "2026-08-11T01:00:00.000Z",
    cancelCloseAt: "2026-08-11T01:00:00.000Z",
    remainingCapacity: 2,
  },
};

assert.equal(safeOpaqueId("session_001"), "session_001");
assert.equal(safeOpaqueId("https://example.com/session"), "");
assert.equal(presentActivityList({ activities: [activity] })[0].statusLabel, "可报名");
assert.equal(presentActivityList({ activities: [activity] })[0].startText, "2026年8月12日 09:00");
assert.equal(presentActivityList({ activities: [activity] })[0].compactStartText, "8月12日  周三  09:00");
const listingOnlyActivity = { ...activity };
["objective", "audience", "agenda", "organizer", "feeDescription", "bringItems", "cancelPolicy", "privacyNoticeText", "photographyNoticeText", "contactDisplay"].forEach((key) => {
  delete listingOnlyActivity[key];
});
assert.equal(presentActivityList({ activities: [listingOnlyActivity] })[0].title, activity.title);
assert.throws(() => presentActivityDetail({ activity: listingOnlyActivity }), /ACTIVITY_ITEM_PAYLOAD_INVALID/);
assert.equal(presentActivityList({ activities: [activity] })[0].cancelCloseText, "2026年8月11日 09:00");
assert.equal(
  presentActivityList({ activities: [activity] })[0].heroAssetUrl,
  "https://assets.example.com/root/activity_001.jpg"
);
assert.equal(
  presentActivityList({ activities: [{
    ...activity,
    heroAssetUrl: "cloud://myroot-prod.bucket/content-assets/activity_001.jpg",
  }] })[0].heroAssetUrl,
  "cloud://myroot-prod.bucket/content-assets/activity_001.jpg"
);
assert.throws(() => presentActivityList({ activities: [{ ...activity, session: {} }] }), /ACTIVITY_ITEM_PAYLOAD_INVALID/);
const detail = presentActivityDetail({ activity });
assert.equal(detail.sessionId, "session_001");
assert.equal(detail.objective, activity.objective);
assert.equal(detail.audience, activity.audience);
assert.equal(detail.agenda, activity.agenda);
assert.equal(detail.organizer, activity.organizer);
assert.equal(detail.feeDescription, activity.feeDescription);
assert.equal(detail.bringItems, activity.bringItems);
assert.equal(detail.cancelPolicy, activity.cancelPolicy);
assert.equal(detail.privacyNoticeText, activity.privacyNoticeText);
assert.equal(detail.photographyNoticeText, activity.photographyNoticeText);
assert.equal(detail.contactDisplay, activity.contactDisplay);
assert.equal(presentActivityDetail({ activity: { ...activity, heroAssetUrl: "http://unsafe.example.com/a.jpg" } }).heroAssetUrl, "");
assert.equal(presentActivityDetail({ activity: { ...activity, status: "PUBLISHED" } }).definitionStatus, "PUBLISHED");
assert.equal(presentActivityDetail({ activity }).visibility, "MEMBER");
assert.equal(presentActivityDetail({ activity }).approvalMode, "MANUAL");
assert.equal(presentActivityDetail({ activity }).allowReapply, true);
assert.equal(presentActivityDetail({ activity: null }), null);
assert.equal(presentEnrollmentList({
  enrollments: [{
    enrollment: { enrollmentId: "enrollment_001", status: "CONFIRMED" },
    activity,
  }],
})[0].enrollmentStatusLabel, "已确认");
assert.equal(presentEnrollmentList({
  enrollments: [{
    enrollment: { enrollmentId: "enrollment_002", status: "CONFIRMED" },
    activity: { ...activity, status: "ARCHIVED" },
  }],
})[0].detailAvailable, false);
assert.deepEqual(presentEnrollmentList({ enrollments: [] }), []);
assert.throws(() => presentEnrollmentList({ enrollments: null }), /ACTIVITY_ENROLLMENTS_PAYLOAD_INVALID/);

console.log("activity presenter tests ok");
