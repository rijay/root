const assert = require("node:assert/strict");
const test = require("node:test");
const {
  initializePrivacyAuthorization,
  requirePrivacyAuthorization,
  resetPrivacyAuthorizationForTests,
  setPrivacyPresenter,
} = require("../../miniprogram/utils/privacy-authorization");
const {
  deleteCloudMedia,
  uploadCloudMedia,
} = require("../../miniprogram/utils/cloud-media-upload");

test("mini-program privacy authorization continues the pending Interface only after platform agreement", async () => {
  resetPrivacyAuthorizationForTests();
  let listener = null;
  const events = [];
  const api = {
    onNeedPrivacyAuthorization(callback) { listener = callback; },
    requirePrivacyAuthorize({ success, fail }) {
      listener((result) => {
        events.push(result);
        if (result.event === "agree") success();
        if (result.event === "disagree") fail();
      }, { referrer: "chooseMedia" });
    },
  };
  assert.equal(initializePrivacyAuthorization(api), true);
  const clear = setPrivacyPresenter(({ resolve, eventInfo }) => {
    assert.equal(eventInfo.referrer, "chooseMedia");
    resolve({ event: "exposureAuthorization" });
    resolve({ event: "agree", buttonId: "root-privacy-agree" });
  });
  assert.equal(await requirePrivacyAuthorization(api), true);
  assert.deepEqual(events, [
    { event: "exposureAuthorization" },
    { event: "agree", buttonId: "root-privacy-agree" },
  ]);
  clear();
});

test("mini-program privacy authorization fails closed when no active presenter exists", async () => {
  resetPrivacyAuthorizationForTests();
  let listener = null;
  const api = {
    onNeedPrivacyAuthorization(callback) { listener = callback; },
    requirePrivacyAuthorize({ success, fail }) {
      listener((result) => result.event === "agree" ? success() : fail(), { referrer: "button.getPhoneNumber" });
    },
  };
  initializePrivacyAuthorization(api);
  assert.equal(await requirePrivacyAuthorization(api), false);
});

test("mini-program cloud media upload returns a CloudBase file ID and supports cleanup", async () => {
  const calls = [];
  const api = {
    cloud: {
      init(options) { calls.push({ action: "init", options }); },
      uploadFile(options) {
        calls.push({ action: "upload", options });
        options.success({ fileID: `cloud://myroot-prod.bucket/${options.cloudPath}` });
      },
      deleteFile(options) {
        calls.push({ action: "delete", options });
        options.success({ fileList: options.fileList });
      },
    },
  };
  const fileId = await uploadCloudMedia("wxfile://tmp/checkin.jpeg", {
    folder: "checkins",
    ownerId: "root-user-1",
    index: 2,
  }, { wxApi: api, env: { cloudEnvId: "myroot-prod" } });
  assert.match(fileId, /^cloud:\/\/myroot-prod\.bucket\/checkins\/root-user-1\/.+\.jpg$/);
  assert.equal(await deleteCloudMedia([fileId], { wxApi: api }), true);
  assert.deepEqual(calls.map((item) => item.action), ["init", "upload", "delete"]);
  assert.equal(calls[1].options.filePath, "wxfile://tmp/checkin.jpeg");
  assert.deepEqual(calls[2].options.fileList, [fileId]);
});
