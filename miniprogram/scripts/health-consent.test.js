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

const { getHealthConsentStatus } = require("../utils/health-consent");

getHealthConsentStatus()
  .then((status) => {
    assert.deepEqual(status.notice.purposes, ["旧服务端用途"]);
    assert.equal(status.notice.retentionText, "旧服务端保存口径");
    assert.equal(status.notice.policyVersion, "root4u-health-sensitive-test-v1");
    assert.equal(status.notice.controllerName, "杭州连生健康科技有限公司");
    delete global.__wxConfig;
    console.log("server health consent presentation tests passed");
  })
  .catch((error) => {
    delete global.__wxConfig;
    console.error(error);
    process.exit(1);
  });
