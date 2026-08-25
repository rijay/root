const assert = require("node:assert/strict");

global.__wxConfig = { envVersion: "release" };
require.cache[require.resolve("../utils/request")] = {
  exports: {
    async request() {
      return {
        required: true,
        configured: true,
        active: false,
        notice: {
          policyVersion: "root4u-health-sensitive-test-v1",
          controllerName: "杭州连生健康科技有限公司",
          contact: "privacy@example.com",
          purposes: ["旧服务端用途"],
          dataCategories: ["健康问卷答案"],
          refusalImpact: "不同意将无法提交健康评测。",
          retentionText: "旧服务端保存口径",
        },
      };
    },
  },
};

const env = require("../config/env");
const {
  getHealthConsentStatus,
  presentHealthPrivacyNotice,
} = require("../utils/health-consent");

getHealthConsentStatus()
  .then((status) => {
    assert.equal(env.healthAssessmentStorageMode, "SERVER");
    assert.deepEqual(status.notice.purposes, ["旧服务端用途"]);
    assert.equal(status.notice.retentionText, "旧服务端保存口径");
    assert.equal(status.notice.policyVersion, "root4u-health-sensitive-test-v1");
    assert.equal(status.notice.controllerName, "杭州连生健康科技有限公司");

    env.healthAssessmentStorageMode = "LOCAL_DEVICE";
    const localNotice = presentHealthPrivacyNotice(status.notice);
    assert.equal(localNotice.storageMode, "LOCAL_DEVICE");
    assert.equal(localNotice.retentionDays, 180);
    assert.match(localNotice.necessity, /仅在当前设备处理/);
    assert.match(localNotice.necessity, /不上传至 myRoot 服务器/);
    assert.match(localNotice.retentionText, /最长保留 180 天/);
    assert.match(localNotice.retentionText, /到期自动从本机删除/);
    env.healthAssessmentStorageMode = "SERVER";
    delete global.__wxConfig;
    console.log("health consent presentation tests passed");
  })
  .catch((error) => {
    delete global.__wxConfig;
    console.error(error);
    process.exit(1);
  });
