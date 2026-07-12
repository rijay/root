const { stoolOptions } = require("../../../../utils/options");
const { getTodayPageCopy } = require("../../../../utils/checkin-presenter");
const { deleteCloudMedia, uploadCloudMedia } = require("../../../../utils/cloud-media-upload");
const { ensureHealthConsent } = require("../../../../utils/health-consent");
const {
  TRANSIENT_HEALTH_KEYS,
  setTransientHealthData,
} = require("../../../../utils/transient-health-state");
const { request } = require("../../../../utils/request");
const router = require("../../../../utils/router");

const feelingChips = ["暂无明显变化", "腹部感觉有变化", "排便节律有变化", "整体状态有变化"];

Page({
  data: {
    mode: "checkin",
    session: {
      currentDayIndex: 1,
    },
    todayCopy: getTodayPageCopy("checkin", { currentDayIndex: 1 }),
    feelingChips,
    stoolOptions,
    tookProduct: null,
    hadStool: null,
    stoolType: "",
    feedback: "",
    imageUrls: [],
    canSubmit: false,
    missingHint: "请选择今日是否服用",
    loading: false,
    userId: "",
  },

  async onShow() {
    const allowed = await router.routeGuard("/subpkg/checkin/pages/today/index");
    if (allowed && await ensureHealthConsent()) this.load();
  },

  async load() {
    try {
      const state = await request({ url: "/api/v1/user/state" });
      this.setData({ userId: state.user.userId || "" });
      if (state.user.state === "DAILY_USER") {
        const stats = await request({ url: "/api/v1/daily/stats" });
        const session = { currentDayIndex: stats.totalDays + 1 };
        this.setData({ mode: "daily", session, todayCopy: getTodayPageCopy("daily", session) });
        return;
      }
      const data = await request({ url: "/api/v1/checkin/session" });
      this.setData({ mode: "checkin", session: data.session, todayCopy: getTodayPageCopy("checkin", data.session) });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    }
  },

  refreshValid(next = {}) {
    const data = { ...this.data, ...next };
    const canSubmit = data.tookProduct !== null && data.hadStool !== null && (!data.hadStool || Boolean(data.stoolType));
    let missingHint = "";
    if (data.tookProduct === null) missingHint = "请选择今日是否服用";
    else if (data.hadStool === null) missingHint = "请选择昨日是否排便";
    else if (data.hadStool && !data.stoolType) missingHint = "请选择昨日便型";
    this.setData({ ...next, canSubmit, missingHint });
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

  selectFeelingChip(event) {
    const text = event.currentTarget.dataset.text || "";
    this.setData({ feedback: text });
  },

  chooseImages() {
    wx.chooseMedia({
      count: 3,
      mediaType: ["image"],
      success: (res) => {
        const accepted = res.tempFiles.filter((file) => !file.size || file.size <= 5 * 1024 * 1024).slice(0, 3);
        const imageUrls = accepted.map((file) => file.tempFilePath);
        this.setData({ imageUrls });
        if (accepted.length < res.tempFiles.length) wx.showToast({ title: "单张图片不能超过 5MB", icon: "none" });
      },
    });
  },

  async submit() {
    if (!(await ensureHealthConsent())) return;
    if (!this.data.canSubmit) {
      wx.showToast({ title: this.data.missingHint || "请补全记录", icon: "none" });
      return;
    }
    this.setData({ loading: true });
    const uploaded = [];
    let recordCommitted = false;
    try {
      for (let index = 0; index < this.data.imageUrls.length; index += 1) {
        const fileId = await uploadCloudMedia(this.data.imageUrls[index], {
          folder: "checkins",
          ownerId: this.data.userId,
          index,
        });
        if (!fileId) throw new Error("图片上传失败，请重试");
        uploaded.push(fileId);
      }
      const payload = {
        dayIndex: this.data.session.currentDayIndex,
        tookProduct: this.data.tookProduct,
        hadStool: this.data.hadStool,
        stoolType: this.data.hadStool ? this.data.stoolType : "",
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
      recordCommitted = true;
      if (data.nextAction === "DAY4_QUESTIONNAIRE") {
        wx.redirectTo({ url: "/subpkg/checkin/pages/questionnaire/index?type=DAY4_MIDPOINT" });
        return;
      }
      if (data.nextAction === "DAY8_QUESTIONNAIRE") {
        wx.redirectTo({ url: "/subpkg/checkin/pages/questionnaire/index?type=DAY8_SUMMARY" });
        return;
      }
      if (data.coupon && data.coupon.visible) {
        wx.showToast({ title: data.coupon.claimable ? "复购礼已解锁" : "复购礼已更新", icon: "none" });
      }
      setTransientHealthData(TRANSIENT_HEALTH_KEYS.LAST_RESULT, {
        mode: this.data.mode,
        record: data.record || payload,
        stats: data.stats || null,
        session: data.session || this.data.session,
        user: data.user || null,
        completedDays: data.session && data.session.records ? data.session.records.filter((item) => item.checkedIn).length : 0,
        savedAt: Date.now(),
      });
      wx.redirectTo({ url: `/subpkg/checkin/pages/result/index?mode=${this.data.mode}` });
    } catch (error) {
      wx.showToast({ title: error.message || "提交失败", icon: "none" });
    } finally {
      if (!recordCommitted && uploaded.length) await deleteCloudMedia(uploaded);
      this.setData({ loading: false });
    }
  },
});
