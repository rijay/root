const { clearToken, request } = require("../../utils/request");
const router = require("../../utils/router");

function emptySession() {
  return {
    records: [],
    missCount: 0,
    refundStatus: "",
    orderId: "",
  };
}

Page({
  data: {
    user: {
      nickname: "ROOT用户",
      phone: "",
      state: "",
      avatarUrl: "",
    },
    avatarSrc: "/static/brand/logo.png",
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

      this.setData({
        user: state.user,
        avatarSrc: state.user.avatarUrl || "/static/brand/logo.png",
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

  buildStatusBadge(state, session, dailyStats) {
    if (state === "CHECKIN_ACTIVE" && session) return `打卡中 Day${session.currentDayIndex || 1}/7`;
    if (state === "CHECKIN_COMPLETED") return "7天已完成";
    if (state === "DAILY_USER" && dailyStats) return `日常打卡 ${dailyStats.currentStreak} 天连续`;
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
      content: "退出后需重新授权登录",
      success: (res) => {
        if (!res.confirm) return;
        clearToken();
        wx.removeStorageSync("userInfo");
        wx.reLaunch({ url: "/pages/home/index" });
      },
    });
  },
});
