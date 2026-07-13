const assert = require("node:assert/strict");

const requestPath = require.resolve("../utils/request.js");
const subscribePath = require.resolve("../utils/checkin-reminder-subscribe.js");
const requestModule = require(requestPath);
const originalRequest = requestModule.request;

const template = {
  templateKey: "CHECKIN_REMINDER_NEXT_DAY",
  templateId: "template-checkin-reminder",
  version: "v2026-06-28-tpl10850",
  enabled: true,
};

function loadSubscribeModule(request) {
  requestModule.request = request;
  delete require.cache[subscribePath];
  return require(subscribePath);
}

async function run() {
  const events = [];
  const records = [];
  const recordRequestIds = [];
  let nativeCalls = 0;
  let storageReads = 0;
  let nativeResult = "accept";

  global.wx = {
    getStorageSync() {
      storageReads += 1;
      return "accept";
    },
    requestSubscribeMessage(options) {
      nativeCalls += 1;
      events.push("native");
      options.success({
        errMsg: "requestSubscribeMessage:ok",
        [template.templateId]: nativeResult,
      });
    },
  };

  const subscribe = loadSubscribeModule(async (options) => {
    if (options.url === "/api/v1/notifications/checkin-reminder-template") {
      events.push("template");
      return { template };
    }
    if (options.url === "/api/v1/notifications/subscriptions") {
      events.push("record");
      records.push(options.data);
      recordRequestIds.push(options.requestId);
      return { subscription: { status: options.data.subscribed ? "ACCEPTED" : "REJECTED" } };
    }
    throw new Error(`unexpected request ${options.url}`);
  });

  assert.deepEqual(await subscribe.preloadCheckinReminderTemplate(), { ready: true });
  assert.deepEqual(events, ["template"]);

  events.length = 0;
  const acceptedPromise = subscribe.requestCheckinReminderSubscribe({
    trigger: "CAMPAIGN_JOIN",
    campaignId: "ROOT_7D_RESET",
  });
  assert.deepEqual(events, ["native"]);
  const accepted = await acceptedPromise;
  assert.deepEqual(events, ["native", "record"]);
  assert.equal(accepted.result, "accept");
  assert.equal(accepted.message, "已开启，明天会提醒你打卡");
  assert.equal(records[0].subscribed, true);
  assert.match(records[0].grantRequestId, /^checkin-subscribe-/);
  assert.equal(recordRequestIds[0], records[0].grantRequestId);

  events.length = 0;
  nativeResult = "reject";
  const rejected = await subscribe.requestCheckinReminderSubscribe({
    trigger: "CHECKIN_SUBMIT",
    campaignId: "ROOT_7D_RESET",
  });
  assert.deepEqual(events, ["native", "record"]);
  assert.equal(rejected.result, "reject");
  assert.equal(rejected.message, "本次未开启，可再次尝试");
  assert.equal(records[1].subscribed, false);
  assert.equal(nativeCalls, 2);
  assert.equal(storageReads, 0);

  events.length = 0;
  global.wx.requestSubscribeMessage = () => {
    nativeCalls += 1;
    events.push("native");
    throw new Error("native request failed");
  };
  const nativeFailure = await subscribe.requestCheckinReminderSubscribe({ trigger: "CHECKIN_SUBMIT" });
  assert.deepEqual(events, ["native", "record"]);
  assert.equal(nativeFailure.result, "unknown");
  assert.equal(nativeFailure.message, "未能打开微信授权，请再次尝试");

  const coldSubscribe = loadSubscribeModule(async () => ({ template }));
  const coldResult = await coldSubscribe.requestCheckinReminderSubscribe({ trigger: "CHECKIN_SUBMIT" });
  assert.equal(coldResult.skipped, true);
  assert.equal(coldResult.reason, "TEMPLATE_NOT_READY");
  assert.equal(nativeCalls, 3);

  const unavailableSubscribe = loadSubscribeModule(async () => ({ template: { ...template, enabled: false } }));
  const unavailable = await unavailableSubscribe.preloadCheckinReminderTemplate();
  assert.equal(unavailable.ready, false);
  assert.equal(unavailable.reason, "TEMPLATE_NOT_CONFIGURED");
  assert.equal(nativeCalls, 3);

  const retryRecordRequests = [];
  let retryRecordAttempts = 0;
  global.wx.requestSubscribeMessage = (options) => {
    nativeCalls += 1;
    options.success({
      errMsg: "requestSubscribeMessage:ok",
      [template.templateId]: "accept",
    });
  };
  const retrySubscribe = loadSubscribeModule(async (options) => {
    if (options.url === "/api/v1/notifications/checkin-reminder-template") return { template };
    retryRecordAttempts += 1;
    retryRecordRequests.push({ requestId: options.requestId, grantRequestId: options.data.grantRequestId });
    if (retryRecordAttempts === 1) throw new Error("temporary record failure");
    return { subscription: { status: "ACCEPTED" }, grant: { status: "AVAILABLE" } };
  });
  await retrySubscribe.preloadCheckinReminderTemplate();
  const retried = await retrySubscribe.requestCheckinReminderSubscribe({ campaignId: "ROOT_7D_RESET" });
  assert.equal(retried.result, "accept");
  assert.equal(retryRecordAttempts, 2);
  assert.equal(retryRecordRequests[0].requestId, retryRecordRequests[1].requestId);
  assert.equal(retryRecordRequests[0].grantRequestId, retryRecordRequests[1].grantRequestId);
  assert.equal(retryRecordRequests[0].requestId, retryRecordRequests[0].grantRequestId);

  const failedRecordSubscribe = loadSubscribeModule(async (options) => {
    if (options.url === "/api/v1/notifications/checkin-reminder-template") return { template };
    throw new Error("record remains unavailable");
  });
  await failedRecordSubscribe.preloadCheckinReminderTemplate();
  const recordFailure = await failedRecordSubscribe.requestCheckinReminderSubscribe({ campaignId: "ROOT_7D_RESET" });
  assert.equal(recordFailure.result, "RECORD_FAILED");
  assert.equal(recordFailure.message, "微信已授权，提醒记录同步失败，请重新开启");

  console.log("checkin reminder subscribe scenarios: 7/7 PASS");
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    requestModule.request = originalRequest;
    delete require.cache[subscribePath];
    delete global.wx;
  });
