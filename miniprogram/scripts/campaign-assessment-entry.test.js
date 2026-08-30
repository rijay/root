const assert = require("node:assert/strict");

const routerPath = require.resolve("../utils/router");
const sharePath = require.resolve("../utils/page-share");
const analyticsPath = require.resolve("../utils/analytics");
const attributionPath = require.resolve("../utils/channel-attribution");
const entryPath = require.resolve("../utils/gut-assessment-entry");

let pageDefinition = null;
let openedPath = "";
let toast = null;

require.cache[routerPath] = {
  exports: {
    async routeGuard() { return true; },
    open(path) { openedPath = path; },
  },
};
require.cache[sharePath] = { exports: { showFriendShareMenu() {} } };
require.cache[analyticsPath] = {
  exports: {
    failureReason(error) { return error && error.code || "TEST_FAILURE"; },
    track() {},
  },
};
require.cache[attributionPath] = {
  exports: {
    async beginChannelVisit() { return { active: false }; },
    async recordFunnelStage() {
      const error = new Error("渠道访问记录不存在");
      error.code = "CHANNEL_VISIT_NOT_FOUND";
      throw error;
    },
  },
};
require.cache[entryPath] = {
  exports: {
    GUT_ASSESSMENT_CONTINUE_PATH: "/subpkg/health/pages/assessment/index?assessmentType=GUT_REGULARITY&source=campaign",
    FIXED_GUT_ASSESSMENT_PATH: "/subpkg/health/pages/assessment/index?assessmentType=GUT_REGULARITY",
  },
};

global.Page = (definition) => { pageDefinition = definition; };
global.wx = { showToast(options) { toast = options; } };

require("../subpkg/campaign/pages/root-with-you/index");

async function main() {
  const page = {
    data: { ...pageDefinition.data },
    setData(patch) { Object.assign(this.data, patch); },
  };

  await pageDefinition.startAssessment.call(page);

  assert.equal(
    openedPath,
    "/subpkg/health/pages/assessment/index?assessmentType=GUT_REGULARITY&source=campaign",
    "渠道漏斗记录失败时仍应进入肠道评测"
  );
  assert.equal(toast, null, "辅助上报失败不应显示评测无法打开");
  assert.equal(page.data.opening, false);
}

main()
  .then(() => {
    delete global.Page;
    delete global.wx;
    console.log("campaign assessment entry resilience tests passed");
  })
  .catch((error) => {
    delete global.Page;
    delete global.wx;
    console.error(error);
    process.exit(1);
  });
