const env = require("./config/env");
const router = require("./utils/router");
const { initializePrivacyAuthorization } = require("./utils/privacy-authorization");
const {
  clearLegacyTransientHealthStorage,
  clearTransientHealthData,
} = require("./utils/transient-health-state");

App({
  globalData: {
    bootstrapped: false,
  },

  onLaunch() {
    clearTransientHealthData();
    clearLegacyTransientHealthStorage();
    initializePrivacyAuthorization();
    if (env.requestAdapter === "cloudContainer" && wx.cloud) {
      const cloudOptions = { traceUser: true };
      if (env.cloudEnvId) cloudOptions.env = env.cloudEnvId;
      wx.cloud.init(cloudOptions);
    }
    this.globalData.bootstrapped = true;
  },

  fetchUserState() {
    return router.fetchState();
  },

  decideHomeRoute() {
    return router.decideHomeRoute();
  },
});
