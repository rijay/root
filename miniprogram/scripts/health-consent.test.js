const assert = require("node:assert/strict");

global.__wxConfig = { envVersion: "release" };
let requestCount = 0;
require.cache[require.resolve("../utils/request")] = {
  exports: {
    async request() {
      requestCount += 1;
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
require.cache[require.resolve("../utils/login-session")] = {
  exports: {
    currentLoginSession() {
      return { sessionId: "login-session-health-consent" };
    },
  },
};

const {
  clearHealthConsentCache,
  getHealthConsentStatus,
  updateHealthConsentCache,
} = require("../utils/health-consent");

getHealthConsentStatus()
  .then(async (status) => {
    assert.deepEqual(status.notice.purposes, ["旧服务端用途"]);
    assert.equal(status.notice.retentionText, "旧服务端保存口径");
    assert.equal(status.notice.policyVersion, "root4u-health-sensitive-test-v1");
    assert.equal(status.notice.controllerName, "杭州连生健康科技有限公司");
    assert.equal((await getHealthConsentStatus()).active, false);
    assert.equal(requestCount, 1);
    assert.equal((await getHealthConsentStatus({ force: true })).active, false);
    assert.equal(requestCount, 2);
    updateHealthConsentCache({ ...status, active: true });
    assert.equal((await getHealthConsentStatus()).active, true);
    clearHealthConsentCache();
    await getHealthConsentStatus();
    assert.equal(requestCount, 3);
    delete global.__wxConfig;
    console.log("server health consent presentation tests passed");
  })
  .catch((error) => {
    delete global.__wxConfig;
    console.error(error);
    process.exit(1);
  });
