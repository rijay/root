const { stoolOptions } = require("../../../../utils/options");
const { request } = require("../../../../utils/request");
const router = require("../../../../utils/router");

Page({
  data: {
    mode: "checkin",
    session: {
      currentDayIndex: 1,
    },
    stoolOptions,
    tookProduct: null,
    hadStool: null,
    stoolType: "",
    feedback: "",
    imageUrls: [],
    canSubmit: false,
    loading: false,
  },

  async onShow() {
    const allowed = await router.routeGuard("/subpkg/checkin/pages/today/index");
    if (allowed) this.load();
  },

  async load() {
    try {
      const state = await request({ url: "/api/v1/user/state" });
      if (state.user.state === "DAILY_USER") {
        const stats = await request({ url: "/api/v1/daily/stats" });
        this.setData({ mode: "daily", session: { currentDayIndex: stats.totalDays + 1 } });
        return;
      }
      const data = await request({ url: "/api/v1/checkin/session" });
      this.setData({ mode: "checkin", session: data.session });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    }
  },

  refreshValid(next = {}) {
    const data = { ...this.data, ...next };
    const canSubmit = data.tookProduct !== null && data.hadStool !== null && (!data.hadStool || Boolean(data.stoolType));
    this.setData({ ...next, canSubmit });
  },

  selectTook(event) {
    this.refreshValid({ tookProduct: event.currentTarget.dataset.value === "true" });
  },

  selectHadStool(event) {
    const hadStool = event.currentTarget.dataset.value === "true";
    this.refreshValid({ hadStool, stoolType: hadStool ? this.data.stoolType : "" });
  },

  selectStool(event) {
    this.refreshValid({ stoolType: event.currentTarget.dataset.value });
  },

  onFeedback(event) {
    this.setData({ feedback: event.detail.value });
  },

  chooseImages() {
    wx.chooseMedia({
      count: 3,
      mediaType: ["image"],
      success: (res) => {
        const imageUrls = res.tempFiles.map((file) => file.tempFilePath).slice(0, 3);
        this.setData({ imageUrls });
      },
    });
  },

  async submit() {
    if (!this.data.canSubmit) return;
    this.setData({ loading: true });
    try {
      const uploaded = [];
      for (let index = 0; index < this.data.imageUrls.length; index += 1) {
        const item = await request({
          url: "/api/v1/upload/image",
          method: "POST",
          data: { url: this.data.imageUrls[index] },
        });
        uploaded.push(item.url);
      }
      const payload = {
        dayIndex: this.data.session.currentDayIndex,
        tookProduct: this.data.tookProduct,
        hadStool: this.data.hadStool,
        stoolType: this.data.stoolType,
        feedback: this.data.feedback,
        imageUrls: uploaded,
      };
      const data = await request({
        url: this.data.mode === "daily" ? "/api/v1/daily/submit" : "/api/v1/checkin/submit",
        method: "POST",
        data: payload,
      });
      if (data.accepted === false) {
        wx.showModal({
          title: "先完成服用",
          content: data.message,
          showCancel: false,
          success: () => router.go("/pages/home/index"),
        });
        return;
      }
      if (data.nextAction === "DAY4_QUESTIONNAIRE") {
        wx.redirectTo({ url: "/subpkg/checkin/pages/questionnaire/index?type=DAY4_MIDPOINT" });
        return;
      }
      if (data.nextAction === "DAY8_QUESTIONNAIRE") {
        wx.redirectTo({ url: "/subpkg/checkin/pages/questionnaire/index?type=DAY8_SUMMARY" });
        return;
      }
      if (data.coupon && data.coupon.visible) {
        wx.showModal({
          title: "复购礼已解锁",
          content: data.coupon.claimable ? "你已完成第6天记录，回到首页可以领取复购礼。" : "你的复购礼状态已更新。",
          showCancel: false,
          confirmText: "回首页",
          success: () => router.go("/pages/home/index"),
        });
        return;
      }
      wx.showToast({ title: "打卡成功", icon: "success" });
      router.go("/pages/home/index");
    } catch (error) {
      wx.showToast({ title: error.message || "提交失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
});
