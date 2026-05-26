const { clearToken, request } = require("../../utils/request");
const router = require("../../utils/router");
const { uploadCloudAvatar } = require("../../utils/avatar-upload");

function emptySession() {
  return {
    records: [],
    missCount: 0,
    refundStatus: "",
    orderId: "",
  };
}

function isDefaultNickname(value) {
  const text = String(value || "").trim();
  return !text || text === "ROOT体验官" || text === "微信用户";
}

Page({
  data: {
    user: {
      nickname: "ROOT体验官",
      phone: "",
      state: "",
      avatarUrl: "",
    },
    avatarSrc: "/static/brand/logo.png",
    hasCustomAvatar: false,
    displayForm: {
      nickname: "",
      avatarPreview: "/static/brand/logo.png",
      avatarFilePath: "",
    },
    displaySaving: false,
    showDisplayProfileCard: false,
    profile: null,
    session: emptySession(),
    refundStatus: "未申请",
    orders: [],
    dailyStats: null,
    progress: [],
    checkedDays: 0,
    statusBadge: "未登录",
    showRecords: false,
    showOrders: false,
  },

  async onShow() {
    const allowed = await router.routeGuard("/pages/profile/index");
    if (allowed) this.load();
  },

  async load() {
    try {
      const state = await request({ url: "/api/v1/user/state" });
      const userState = state.user.state;
      const [profileResult, ordersResult, sessionResult, refundResult, dailyResult] = await Promise.allSettled([
        request({ url: "/api/v1/user/profile" }),
        request({ url: "/api/v1/user/orders" }),
        ["CHECKIN_ACTIVE", "CHECKIN_COMPLETED", "CHECKIN_FAILED"].includes(userState)
          ? request({ url: "/api/v1/checkin/session" })
          : Promise.resolve(null),
        ["CHECKIN_COMPLETED", "DAILY_USER"].includes(userState) ? request({ url: "/api/v1/refund/status" }) : Promise.resolve(null),
        userState === "DAILY_USER" ? request({ url: "/api/v1/daily/stats" }) : Promise.resolve(null),
      ]);

      const session = sessionResult.status === "fulfilled" && sessionResult.value ? sessionResult.value.session : emptySession();
      const progress = (session.records || []).map((record) => ({
        ...record,
        className: record.checkedIn ? "done" : "",
      }));
      const checkedDays = progress.filter((record) => record.checkedIn).length;
      const dailyStats = dailyResult.status === "fulfilled" ? dailyResult.value : null;
      const statusBadge = this.buildStatusBadge(userState, session, dailyStats);
      const avatarSrc = state.user.avatarUrl || "/static/brand/logo.png";
      const nickname = isDefaultNickname(state.user.nickname) ? "" : state.user.nickname;

      this.setData({
        user: state.user,
        avatarSrc,
        hasCustomAvatar: Boolean(state.user.avatarUrl),
        displayForm: {
          nickname,
          avatarPreview: avatarSrc,
          avatarFilePath: "",
        },
        showDisplayProfileCard: !state.user.avatarUrl || isDefaultNickname(state.user.nickname),
        profile: profileResult.status === "fulfilled" ? profileResult.value.profile : null,
        orders: ordersResult.status === "fulfilled" ? ordersResult.value.orders : [],
        session,
        refundStatus: refundResult.status === "fulfilled" && refundResult.value ? refundResult.value.refundStatus || "未申请" : "未申请",
        dailyStats,
        progress,
        checkedDays,
        statusBadge,
        showRecords: ["CHECKIN_ACTIVE", "CHECKIN_COMPLETED", "DAILY_USER"].includes(userState),
        showOrders: ordersResult.status === "fulfilled" && ordersResult.value.orders.length > 0,
      });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    }
  },

  onChooseAvatar(event) {
    const avatarUrl = event.detail && event.detail.avatarUrl;
    if (!avatarUrl) return;
    this.setData({
      displayForm: {
        ...this.data.displayForm,
        avatarPreview: avatarUrl,
        avatarFilePath: avatarUrl,
      },
    });
  },

  onNicknameInput(event) {
    this.setData({
      displayForm: {
        ...this.data.displayForm,
        nickname: event.detail.value,
      },
    });
  },

  async submitDisplayProfile(event) {
    const formNickname = event.detail && event.detail.value ? event.detail.value.nickname : "";
    const nickname = String(formNickname || this.data.displayForm.nickname || "").trim();
    const avatarFilePath = this.data.displayForm.avatarFilePath;

    if (!nickname && !avatarFilePath) {
      wx.showToast({ title: "请填写昵称或选择头像", icon: "none" });
      return;
    }

    this.setData({ displaySaving: true });
    try {
      let avatarUrl = "";
      if (avatarFilePath) {
        avatarUrl = await uploadCloudAvatar(avatarFilePath, this.data.user.userId);
        if (!avatarUrl) {
          wx.showToast({ title: "头像上传失败，请重试", icon: "none" });
          return;
        }
      }

      const data = await request({
        url: "/api/v1/user/display-profile",
        method: "POST",
        data: { nickname, avatarUrl },
      });
      const avatarSrc = data.user.avatarUrl || "/static/brand/logo.png";
      this.setData({
        user: data.user,
        avatarSrc,
        hasCustomAvatar: Boolean(data.user.avatarUrl),
        displayForm: {
          nickname: isDefaultNickname(data.user.nickname) ? "" : data.user.nickname,
          avatarPreview: avatarSrc,
          avatarFilePath: "",
        },
        showDisplayProfileCard: !data.user.avatarUrl || isDefaultNickname(data.user.nickname),
      });
      wx.showToast({ title: "资料已更新", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "保存失败", icon: "none" });
    } finally {
      this.setData({ displaySaving: false });
    }
  },

  buildStatusBadge(state, session, dailyStats) {
    if (state === "CHECKIN_ACTIVE" && session) return `打卡中 Day${session.currentDayIndex || 1}/7`;
    if (state === "CHECKIN_COMPLETED") return "试饮记录已完成";
    if (state === "DAILY_USER" && dailyStats) return `日常记录中 · 连续 ${dailyStats.currentStreak} 天`;
    if (state === "REGISTERED_IDLE") return "待开启打卡";
    if (state === "UNREGISTERED") return "待完成画像";
    return state || "未登录";
  },

  goLink(event) {
    const url = event.currentTarget.dataset.url;
    if (url) wx.navigateTo({ url });
  },

  logout() {
    wx.showModal({
      title: "确认退出",
      content: "退出后需重新进行手机号快捷登录",
      success: (res) => {
        if (!res.confirm) return;
        clearToken();
        wx.removeStorageSync("userInfo");
        wx.reLaunch({ url: "/pages/home/index" });
      },
    });
  },
});
