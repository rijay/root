const router = require("../../../../utils/router");
const { showFriendShareMenu } = require("../../../../utils/page-share");
const { failureReason, track } = require("../../../../utils/analytics");
const { beginChannelVisit, recordFunnelStage } = require("../../../../utils/channel-attribution");
const {
  GUT_ASSESSMENT_CONTINUE_PATH,
  FIXED_GUT_ASSESSMENT_PATH,
} = require("../../../../utils/gut-assessment-entry");

const ROOT_WITH_YOU_IMAGE_URL = "/subpkg/campaign/assets/root-with-you-intro.jpg";

Page({
  data: {
    opening: false,
    imageLoading: false,
    imageFailed: false,
    imageUrl: ROOT_WITH_YOU_IMAGE_URL,
  },

  async onLoad(options = {}) {
    track("campaign_page_view", {
      campaignId: "ROOT_WITH_YOU_V060",
      sourcePage: options.source || "direct",
    });
    try {
      await beginChannelVisit(options);
      await recordFunnelStage("INTRO_VIEW");
    } catch (_) {
      // 渠道归因不可用不阻断公开的自测介绍和评测入口。
    }
  },

  onShow() {
    showFriendShareMenu();
  },

  async startAssessment() {
    if (this.data.opening) return;
    this.setData({ opening: true });
    try {
      try {
        await recordFunnelStage("START_CLICK");
      } catch (_) {
        // 渠道漏斗记录是辅助数据，失败时仍需允许用户进入核心评测流程。
      }
      const target = GUT_ASSESSMENT_CONTINUE_PATH;
      const allowed = await router.routeGuard(target);
      track("campaign_assessment_start", {
        campaignId: "ROOT_WITH_YOU_V060",
        result: allowed ? "ALLOWED" : "BLOCKED",
        failureReason: allowed ? "" : "ROUTE_GUARD_BLOCKED",
      });
      if (allowed) router.open(target);
    } catch (error) {
      track("campaign_assessment_start", {
        campaignId: "ROOT_WITH_YOU_V060",
        result: "FAILED",
        failureReason: failureReason(error),
      });
      wx.showToast({ title: "评测暂时无法打开", icon: "none" });
    } finally {
      this.setData({ opening: false });
    }
  },

  imageLoaded() {
    this.setData({ imageLoading: false, imageFailed: false });
  },

  imageFailed() {
    this.setData({ imageLoading: false, imageFailed: true });
  },

  onShareAppMessage() {
    return {
      title: "ROOT 陪伴计划｜先了解自己的肠道状态",
      path: FIXED_GUT_ASSESSMENT_PATH,
      imageUrl: "/static/campaign/root-with-you-home.jpg",
    };
  },
});
