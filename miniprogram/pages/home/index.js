const env = require("../../config/env");
const options = require("../../utils/options");
const { clearToken, getToken, request, setToken, stringifyError } = require("../../utils/request");

const questions = [
  { key: "joinReasons", type: "multi", title: "参与本次试饮的原因", options: options.joinReasonOptions },
  { key: "gutHealthStatus", type: "single", title: "您的肠道健康状况", options: options.gutHealthOptions },
  { key: "improvementMethods", type: "multi", title: "您目前肠道健康改善的方式", options: options.improvementOptions },
  { key: "stoolType", type: "stool", title: "便便日常是什么类型", options: options.stoolOptions },
];

function buildProgress(session) {
  if (!session) return [];
  return session.records.map((record) => ({
    ...record,
    status: record.checkedIn ? "done" : record.dayIndex === session.currentDayIndex ? "today" : "pending",
    statusText: record.checkedIn ? "已完成" : record.dayIndex === session.currentDayIndex ? "今日" : "未到",
    badge: `/static/badge/day${record.dayIndex}.png`,
  }));
}

Page({
  data: {
    isDevelop: env.envVersion === "develop",
    state: "GUEST",
    viewType: "loading",
    user: null,
    agreed: false,
    loading: false,
    registerSteps: [0, 1, 2, 3],
    registerStep: 0,
    registerTotal: questions.length,
    registerQuestion: null,
    registerAnswers: {
      joinReasons: [],
      gutHealthStatus: "",
      improvementMethods: [],
      stoolType: "",
    },
    canRegisterNext: false,
    profile: null,
    tags: "身体节奏",
    session: {
      currentDayIndex: 1,
      todayChecked: false,
      missCount: 0,
      records: [],
    },
    progress: [],
    remainingDays: 6,
    isCompleted: false,
    isFailed: false,
    completedDays: 0,
    refundStatus: "",
    flowView: "",
    homeView: null,
    dailyStats: {
      totalDays: 0,
      currentStreak: 0,
      longestStreak: 0,
      todayChecked: false,
    },
    dailyTrend: [],
    dailyRange: "7d",
    couponStatus: null,
  },

  onLoad() {
    this.setData({ registerQuestion: this.decorateQuestion(0, this.data.registerAnswers) });
  },

  onShow() {
    this.refresh();
  },

  mapStateToView(state, flowView) {
    if (flowView === "MANUAL_REVIEW_REQUIRED") return "manualReview";
    if (flowView === "DAY4_PENDING" || flowView === "DAY8_PENDING") return "questionnairePrompt";
    const map = {
      GUEST: "login",
      UNREGISTERED: "register",
      REGISTERED_IDLE: "activity",
      CHECKIN_ACTIVE: "checkin",
      CHECKIN_COMPLETED: "checkin",
      CHECKIN_FAILED: "checkin",
      DAILY_USER: "daily",
    };
    return map[state] || "login";
  },

  async refresh() {
    this.setData({ loading: true });
    try {
      const stateData = getToken()
        ? await request({ url: "/api/v1/user/state" })
        : { user: { state: "GUEST" }, route: "/pages/home/index" };
      const state = stateData.user.state;
      const flowView = stateData.flowView || "";
      const viewType = this.mapStateToView(state, flowView);
      this.setData({
        state,
        flowView,
        homeView: stateData.homeView || null,
        viewType,
        user: stateData.user,
        isCompleted: state === "CHECKIN_COMPLETED",
        isFailed: state === "CHECKIN_FAILED",
      });

      if (viewType === "activity") await this.loadProfile();
      if (viewType === "checkin" && state !== "GUEST") await this.loadCheckinState();
      if (viewType === "daily") await this.loadDailyState();
    } catch (error) {
      clearToken();
      this.setData({ state: "GUEST", viewType: "login", user: null });
    } finally {
      this.setData({ loading: false });
    }
  },

  toggleAgree() {
    this.setData({ agreed: !this.data.agreed });
  },

  loginWithPhone(event) {
    this.submitLogin((event && event.detail) || {});
  },

  loginWithDemoPhone() {
    this.submitLogin({ errMsg: "getPhoneNumber:fail devtools mock", code: "dev_phone_code", forceMock: true });
  },

  submitLogin(detail) {
    if (!this.data.agreed) {
      wx.showToast({ title: "请先阅读并同意协议", icon: "none" });
      return;
    }
    const phoneAuthFailed = detail.errMsg && detail.errMsg.includes("fail");
    if (phoneAuthFailed && !env.allowMockPhoneLogin) {
      wx.showToast({ title: "需要手机号才能继续", icon: "none" });
      return;
    }
    if (phoneAuthFailed && env.allowMockPhoneLogin) {
      wx.showToast({ title: "调试模式使用演示手机号", icon: "none" });
    }
    this.setData({ loading: true });
    if (env.allowMockPhoneLogin && env.envVersion === "develop") {
      this.submitMockLogin(detail);
      return;
    }
    wx.login({
      success: async (loginResult) => {
        try {
          const useMockPhone = Boolean(env.allowMockPhoneLogin && (phoneAuthFailed || detail.forceMock || env.envVersion === "develop"));
          const data = await request({
            url: "/api/v1/auth/login",
            method: "POST",
            data: {
              wxCode: loginResult.code || "dev_wx_code",
              phoneCode: detail.code || "",
              ...(useMockPhone ? { phone: env.demoPhone, useMockPhone: true } : {}),
            },
          });
          setToken(data.token);
          await this.refresh();
        } catch (error) {
          const message = stringifyError(error) || "登录失败，请重试";
          wx.showToast({ title: message.slice(0, 28), icon: "none" });
        } finally {
          this.setData({ loading: false });
        }
      },
      fail: async (error) => {
        if (env.allowMockPhoneLogin) {
          try {
            const data = await request({
              url: "/api/v1/auth/login",
              method: "POST",
              data: {
                wxCode: "dev_wx_login_failed",
                phoneCode: detail.code || "dev_phone_code",
                phone: env.demoPhone,
                useMockPhone: true,
              },
            });
            setToken(data.token);
            await this.refresh();
            return;
          } catch (requestError) {
            wx.showToast({ title: (stringifyError(requestError) || "登录失败").slice(0, 28), icon: "none" });
          } finally {
            this.setData({ loading: false });
          }
          return;
        }
        this.setData({ loading: false });
        wx.showToast({ title: (stringifyError(error) || "登录失败，请重试").slice(0, 28), icon: "none" });
      },
    });
  },

  async submitMockLogin(detail) {
    try {
      const data = await request({
        url: "/api/v1/auth/login",
        method: "POST",
        data: {
          wxCode: "dev_wx_code",
          phoneCode: detail.code || "dev_phone_code",
          phone: env.demoPhone,
          useMockPhone: true,
        },
      });
      setToken(data.token);
      await this.refresh();
    } catch (error) {
      const message = stringifyError(error) || "登录失败，请重试";
      wx.showToast({ title: message.slice(0, 28), icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  decorateQuestion(step, answers) {
    const question = questions[step];
    const answer = answers[question.key];
    return {
      ...question,
      options: question.options.map((option) => ({
        ...option,
        selected: Array.isArray(answer) ? answer.includes(option.value) : answer === option.value,
      })),
    };
  },

  isRegisterStepValid(step, answers) {
    const question = questions[step];
    const value = answers[question.key];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  },

  setRegisterStep(step) {
    this.setData({
      registerStep: step,
      registerQuestion: this.decorateQuestion(step, this.data.registerAnswers),
      canRegisterNext: this.isRegisterStepValid(step, this.data.registerAnswers),
    });
  },

  selectRegisterOption(event) {
    const value = event.currentTarget.dataset.value;
    const question = this.data.registerQuestion;
    const answers = { ...this.data.registerAnswers };

    if (question.type === "multi") {
      const option = question.options.find((item) => item.value === value);
      let next = answers[question.key].slice();
      if (option && option.exclusive) {
        next = next.includes(value) ? [] : [value];
      } else {
        next = next.filter((item) => {
          const candidate = question.options.find((opt) => opt.value === item);
          return !(candidate && candidate.exclusive);
        });
        next = next.includes(value) ? next.filter((item) => item !== value) : next.concat(value);
      }
      answers[question.key] = next;
    } else {
      answers[question.key] = value;
    }

    this.setData({
      registerAnswers: answers,
      registerQuestion: this.decorateQuestion(this.data.registerStep, answers),
      canRegisterNext: this.isRegisterStepValid(this.data.registerStep, answers),
    });
  },

  previousRegisterQuestion() {
    if (this.data.registerStep > 0) this.setRegisterStep(this.data.registerStep - 1);
  },

  async nextRegisterQuestion() {
    if (!this.data.canRegisterNext) return;
    if (this.data.registerStep < this.data.registerTotal - 1) {
      this.setRegisterStep(this.data.registerStep + 1);
      return;
    }
    this.setData({ loading: true });
    try {
      await request({ url: "/api/v1/user/profile", method: "POST", data: this.data.registerAnswers });
      await this.refresh();
    } catch (error) {
      wx.showToast({ title: error.message || "提交失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadProfile() {
    const data = await request({ url: "/api/v1/user/profile" });
    const profile = data.profile;
    const tags = profile ? [profile.gut_health_status, profile.stool_type].filter(Boolean).join(" / ") : "身体节奏";
    this.setData({ profile, tags });
  },

  goOrderMatch() {
    wx.navigateTo({ url: "/pages/order/match" });
  },

  confirmStart() {
    wx.showModal({
      title: "开始打卡",
      content: "系统会确认订单已匹配且物流已送达，再为你开启7天打卡。",
      confirmText: "确认开始",
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ loading: true });
        try {
          await request({ url: "/api/v1/checkin/start", method: "POST", data: { confirmReceived: true } });
          await this.refresh();
        } catch (error) {
          wx.showToast({ title: error.message || "启动失败", icon: "none" });
        } finally {
          this.setData({ loading: false });
        }
      },
    });
  },

  async loadCheckinState() {
    const [data, couponResult] = await Promise.allSettled([
      request({ url: "/api/v1/checkin/session" }),
      request({ url: "/api/v1/coupon/status" }),
    ]);
    if (data.status !== "fulfilled") throw data.reason;
    const sessionData = data.value;
    const progress = buildProgress(sessionData.session);
    const completedDays = progress.filter((item) => item.checkedIn).length;
    let refundStatus = "";
    if (this.data.isCompleted) {
      try {
        const refund = await request({ url: "/api/v1/refund/status" });
        refundStatus = refund.refundStatus || "待申请";
      } catch (error) {
        refundStatus = "待申请";
      }
    }
    this.setData({
      session: sessionData.session,
      progress,
      remainingDays: Math.max(0, 7 - sessionData.session.currentDayIndex),
      completedDays,
      refundStatus,
      couponStatus: couponResult.status === "fulfilled" ? couponResult.value : null,
    });
  },

  goToday() {
    wx.navigateTo({ url: "/subpkg/checkin/pages/today/index" });
  },

  goHistory() {
    wx.navigateTo({ url: "/subpkg/checkin/pages/history/index" });
  },

  goRefund() {
    wx.navigateTo({ url: "/subpkg/refund/pages/apply/index" });
  },

  goQuestionnaire() {
    const type = this.data.flowView === "DAY8_PENDING" ? "DAY8_SUMMARY" : "DAY4_MIDPOINT";
    wx.navigateTo({ url: `/subpkg/checkin/pages/questionnaire/index?type=${type}` });
  },

  async continueDaily() {
    this.setData({ loading: true });
    try {
      await request({ url: "/api/v1/user/continue-daily", method: "POST", data: {} });
      await this.refresh();
    } catch (error) {
      wx.showToast({ title: error.message || "暂无法继续", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadDailyState() {
    const [stats, trend] = await Promise.all([
      request({ url: "/api/v1/daily/stats" }),
      request({ url: `/api/v1/daily/trend?range=${this.data.dailyRange}` }),
    ]);
    this.setData({ dailyStats: stats, dailyTrend: trend.points });
  },

  switchDailyRange(event) {
    this.setData({ dailyRange: event.currentTarget.dataset.range }, () => this.loadDailyState());
  },

  async navigateToShop() {
    const couponItem = this.data.couponStatus && this.data.couponStatus.coupon;
    if (couponItem && couponItem.couponId) {
      await request({
        url: "/api/v1/coupon/repurchase-click",
        method: "POST",
        data: { couponId: couponItem.couponId },
      }).catch(() => null);
    }
    if (this.data.dailyStats) {
      await request({
        url: "/api/v1/event/track",
        method: "POST",
        data: {
          eventName: "shop_redirect_click",
          payload: {
            streak: this.data.dailyStats.currentStreak,
            totalDays: this.data.dailyStats.totalDays,
          },
        },
      });
    }
    wx.navigateToMiniProgram({
      appId: env.youzanAppId,
      path: env.youzanProductPath,
      extraData: {
        from: "daily_user",
        userId: this.data.user ? this.data.user.userId : "",
      },
      envVersion: "release",
      fail: () => wx.showToast({ title: "跳转失败，请重试", icon: "none" }),
    });
  },

  async claimCoupon() {
    const couponItem = this.data.couponStatus && this.data.couponStatus.coupon;
    if (!couponItem || !couponItem.claimable) return;
    this.setData({ loading: true });
    try {
      const data = await request({
        url: "/api/v1/coupon/claim",
        method: "POST",
        data: { couponId: couponItem.couponId },
      });
      this.setData({ couponStatus: { ...(this.data.couponStatus || {}), coupon: data.coupon, visible: true } });
      wx.showToast({ title: "已领取", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "领取失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
});
