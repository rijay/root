const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const domain = require("../src/domain");
const { addDays } = require("../src/dates");

function register(store, phone) {
  const login = domain.login(store, { phone }).data;
  domain.submitProfile(store, login.token, {
    joinReasons: ["health", "gut_flora"],
    gutHealthStatus: "normal",
    improvementMethods: ["diet"],
    stoolType: "type4",
  });
  return login.token;
}

function submitCheckinDays(store, token, startDate, fromDay, toDay) {
  for (let day = fromDay; day <= toDay; day += 1) {
    domain.submitCheckin(
      store,
      token,
      { dayIndex: day, tookProduct: true, hadStool: true, stoolType: "type4", feedback: `release day ${day}` },
      addDays(startDate, day - 1)
    );
  }
}

test("release smoke: shipped order waits for delivery before Day1", () => {
  const store = domain.createStore();
  const token = register(store, "13800000002");

  const matched = domain.matchOrder(store, token, { phone: "13800000002" }, "2026-04-26").data;
  const beforeDelivery = domain.getUserState(store, token).data;

  assert.equal(matched.nextAction, "WAITING_DELIVERY");
  assert.equal(beforeDelivery.flowView, "WAITING_DELIVERY");
  assert.equal(store.checkinSessions.length, 0);
  assert.throws(() => domain.startCheckin(store, token, { confirmReceived: true }, "2026-04-26"), /物流送达后才能开始打卡/);

  domain.updateOrderFulfillment(store, { orderId: "ord_root_002", deliveryStatus: "DELIVERED" }, "2026-04-27");
  const ready = domain.getReadyToStartUsers(store, "2026-04-27").data.users;
  const started = domain.startCheckin(store, token, { confirmReceived: true }, "2026-04-27").data;

  assert.equal(ready.length, 1);
  assert.equal(started.user.state, domain.STATES.CHECKIN_ACTIVE);
  assert.equal(started.session.startDate, "2026-04-27");
});

test("release smoke: Day4, Day8, refund, coupon, and completed state stay connected", () => {
  const store = domain.createStore();
  const token = register(store, "13800000001");

  domain.matchOrder(store, token, { phone: "13800000001" }, "2026-04-26");
  domain.startCheckin(store, token, { confirmReceived: true }, "2026-04-26");
  submitCheckinDays(store, token, "2026-04-26", 1, 4);

  assert.equal(domain.getUserState(store, token).data.flowView, "DAY4_PENDING");
  domain.submitCheckin(
    store,
    token,
    { dayIndex: 5, tookProduct: true, hadStool: true, stoolType: "type4", feedback: "release day 5" },
    "2026-04-30"
  );

  const day6 = domain.submitCheckin(
    store,
    token,
    { dayIndex: 6, tookProduct: true, hadStool: true, stoolType: "type4", feedback: "release day 6" },
    "2026-05-01"
  ).data;
  assert.equal(day6.coupon.visible, true);

  const claimed = domain.claimCoupon(store, token, { couponId: day6.coupon.couponId }).data.coupon;
  assert.equal(claimed.status, "CLAIMED");

  const day7 = domain.submitCheckin(
    store,
    token,
    { dayIndex: 7, tookProduct: true, hadStool: true, stoolType: "type4", feedback: "release day 7" },
    "2026-05-02"
  ).data;
  assert.equal(day7.nextAction, "DAY8_QUESTIONNAIRE");
  assert.throws(() => domain.applyRefund(store, token), /Day8 收尾问卷/);

  domain.submitQuestionnaire(store, token, {
    type: "DAY8_SUMMARY",
    answers: { overallFeeling: "better", repurchaseIntent: "yes", needsContact: false },
    idempotencyKey: "release-day8",
  });
  const refund = domain.applyRefund(store, token).data.refundWorkItem;
  domain.runDailyAudit(store, "2026-05-03");

  const couponTask = store.operationTasks.find((task) => task.task_type === "COUPON_UNUSED");
  assert.equal(refund.status, "PENDING");
  assert.equal(couponTask.status, "OPEN");

  domain.markCouponUsed(store, claimed.couponId);
  domain.approveRefund(store, refund.refund_work_item_id);
  const completedState = domain.getUserState(store, token).data.user;

  assert.equal(completedState.state, domain.STATES.CHECKIN_COMPLETED);
  assert.equal(couponTask.status, "DONE");
});

test("release smoke: formal mini-program exposes only the approved four-Tab scope", () => {
  const appJsonPath = path.join(__dirname, "..", "..", "miniprogram", "app.json");
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
  const miniprogramRoot = path.join(__dirname, "..", "..", "miniprogram");
  const supportPage = fs.readFileSync(path.join(miniprogramRoot, "subpkg/profile/pages/support/index.wxml"), "utf8");
  const activityPackage = appJson.subPackages.find((item) => item.root === "subpkg/activity");
  const profilePackage = appJson.subPackages.find((item) => item.root === "subpkg/profile");

  assert.equal(appJson.pages[0], "pages/welcome/index");
  assert.equal(appJson.tabBar.custom, true);
  assert.ok(activityPackage);
  assert.ok(profilePackage);
  assert.deepEqual(
    appJson.tabBar.list.map((item) => item.pagePath),
    [
      "pages/home/index",
      "pages/health/index",
      "pages/activities/index",
      "pages/profile/index",
    ]
  );
  assert.deepEqual(activityPackage.pages.sort(), ["pages/detail/index", "pages/enrollments/index"].sort());
  assert.deepEqual(profilePackage.pages.sort(), ["pages/about/index", "pages/support/index"].sort());
  assert.match(supportPage, /open-type="contact"/);
});

test("release smoke: support consultation records optional task progress", async () => {
  const store = domain.createStore();
  const login = await domain.loginWithWechat(store, {
    openid: "release_support_consultation_openid",
    appCode: "MYROOT",
  }, { ROOT_ALLOW_OPENID_LOGIN: "true" });

  const recorded = domain.recordUserTaskEvent(store, login.data.token, {
    taskType: "CONSULTATION",
    taskDate: "2026-06-19",
    sourceChannel: "MINIPROGRAM_SUPPORT",
    payload: { taskDate: "2026-06-19", consultationType: "REWARD", scene: "SUPPORT_PAGE" },
    idempotencyKey: "release-support-consultation-reward",
  }).data;
  const consultation = recorded.progress.tasks.find((task) => task.taskType === "CONSULTATION");
  const status = domain.getUserConsultations(store, login.data.token).data;

  assert.equal(recorded.created, true);
  assert.equal(recorded.followUp.created, true);
  assert.equal(consultation.status, "DONE");
  assert.equal(status.summary.pendingCount, 1);
  assert.equal(status.consultations[0].status, "PENDING");
  assert.equal(store.operationTasks[0].task_type, "CONSULTATION_FOLLOW");
  assert.equal(store.taskEvents[0].source_channel, "MINIPROGRAM_SUPPORT");
});
