const env = require("./config/env");
const router = require("./utils/router");

App({
  globalData: {
    bootstrapped: false,
  },

  onLaunch() {
    if (env.requestAdapter === "cloudContainer" && wx.cloud && env.cloudEnvId) {
      wx.cloud.init({
        env: env.cloudEnvId,
        traceUser: true,
      });
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
