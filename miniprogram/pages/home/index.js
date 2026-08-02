const options = require("../../utils/options");
const { joinCampaign } = require("../../utils/campaign-join");
const { formatDateCn } = require("../../utils/date-display");
const { getHomeStageCopy } = require("../../utils/checkin-presenter");
const { ensureHealthConsent } = require("../../utils/health-consent");
const { gutHealthLabel, stoolLabel } = require("../../utils/option-labels");
const { openLegalPage } = require("../../utils/legal");
const { clearToken, getToken, request, setToken, stringifyError } = require("../../utils/request");
const router = require("../../utils/router");
const { enrichProgress, todayChina } = require("../../utils/task-presenter");
const {
  authenticateWechat,
  ensureLoginAgreement,
  showLoginFailure,
} = require("../../utils/wechat-login-flow");

const questions = [
  { key: "joinReasons", type: "multi", title: "参与本次试饮的原因", options: options.joinReasonOptions },
  { key: "gutHealthStatus", type: "single", title: "您的肠道健康状况", options: options.gutHealthOptions },
  { key: "improvementMethods", type: "multi", title: "您目前肠道健康改善的方式", options: options.improvementOptions },
  { key: "stoolType", type: "stool", title: "便便日常是什么类型", options: options.stoolOptions },
];

function isShopAvailable() {
  return true;
}

function buildProgress(session) {
  if (!session) return [];
  return session.records.map((record) => ({
    ...record,
    dateText: formatDateCn(record.date),
    status: record.checkedIn ? "done" : record.dayIndex === session.currentDayIndex ? "today" : "pending",
    statusText: record.checkedIn ? "已完成" : record.dayIndex === session.currentDayIndex ? "今日" : "未到",
  }));
}

function questionnaireTypeOf(task) {
  const config = task && task.config ? task.config : {};
  return config.questionnaireType || config.questionnaire_type || "DAY4_MIDPOINT";
}

Page({
  data: {
    state: "GUEST",
    viewType: "loading",
    user: null,
    agreed: false,
    loading: false,
    loginStatusText: "",
    loadErrorText: "",
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
    profileSummary: {
      title: "你的身体反馈画像",
      lines: [],
    },
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
    activityHome: {
      campaignTitle: "ROOT 身体记录计划",
      campaignCopy: "先加入活动，再按自己的节奏完成打卡、问卷、分享或咨询。",
      progressPercent: 0,
      requiredText: "0/0",
      completedText: "0",
      participantText: "未加入",
      primaryTask: null,
      tasks: [],
      products: [],
      syncedAt: "",
    },
    dailyStats: {
      totalDays: 0,
      currentStreak: 0,
      longestStreak: 0,
      todayChecked: false,
    },
    dailyHome: getHomeStageCopy("DAILY_USER", "", null, { todayChecked: false }),
    dailyTrend: [],
    dailyRange: "7d",
    couponStatus: null,
    shopAvailable: isShopAvailable(),
  },

  onLoad() {
    this.healthConsentPrompted = false;
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
      if (viewType === "register") {
        const shouldNavigate = !this.healthConsentPrompted;
        this.healthConsentPrompted = true;
        this.setData({
          state,
          flowView,
          homeView: stateData.homeView || null,
          viewType: "healthConsent",
          user: stateData.user,
        });
        if (!(await ensureHealthConsent({ navigate: shouldNavigate }))) return;
      }
      this.setData({
        state,
        flowView,
        homeView: stateData.homeView || null,
        viewType,
        user: stateData.user,
        isCompleted: state === "CHECKIN_COMPLETED",
        isFailed: state === "CHECKIN_FAILED",
      });

      if (viewType === "activity") await this.loadActivityHome();
      if (viewType === "checkin" && state !== "GUEST") await this.loadCheckinState();
      if (viewType === "daily") await this.loadDailyState();
      return true;
    } catch (error) {
      this.healthConsentPrompted = false;
      const stillAuthenticated = Boolean(getToken()) && error.code !== 1003 && error.status !== 401;
      if (stillAuthenticated) {
        this.setData({
          viewType: "loadError",
          loadErrorText: "微信身份已验证，但页面内容暂未完成加载。请点击重新加载。",
        });
      } else {
        clearToken();
        this.setData({ state: "GUEST", viewType: "login", user: null });
      }
      return false;
    } finally {
      this.setData({ loading: false });
    }
  },

  toggleAgree() {
    this.setData({ agreed: !this.data.agreed });
  },

  openUserAgreement() {
    openLegalPage("agreement");
  },

  openPrivacyPolicy() {
    openLegalPage("privacy");
  },

  async continueHealthConsent() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      if (await ensureHealthConsent()) await this.refresh();
    } finally {
      this.setData({ loading: false });
    }
  },

  browseWithoutHealthConsent() {
    router.open("/pages/products/index?source=health_consent_declined");
  },

  retryRefresh() {
    this.refresh();
  },

  async loginWithWechat() {
    if (this.data.loading) return;
    const confirmed = await ensureLoginAgreement(this.data.agreed);
    if (!confirmed) return;
    if (!this.data.agreed) this.setData({ agreed: true });
    return this.submitLogin({});
  },

  async submitLogin(detail) {
    if (this.data.loading) return;
    this.setData({ loading: true, loginStatusText: "正在连接微信…" });
    try {
      const data = await authenticateWechat({
        request,
        phoneCode: detail.code || "",
        onStage: (loginStatusText) => this.setData({ loginStatusText }),
      });
      setToken(data.token);
      this.healthConsentPrompted = false;
      this.setData({ loginStatusText: "身份验证完成，正在加载首页…" });
      await this.refresh();
    } catch (error) {
      const message = stringifyError(error) || "登录失败，请重试";
      showLoginFailure(message, () => this.submitLogin(detail));
    } finally {
      this.setData({ loading: false, loginStatusText: "" });
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
    if (!(await ensureHealthConsent())) return;
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
    this.setData({ profile, profileSummary: this.buildProfileSummary(profile) });
  },

  async loadActivityHome() {
    const [profileResult, campaignResult, progressResult, productResult] = await Promise.allSettled([
      request({ url: "/api/v1/user/profile" }),
      request({ url: "/api/v1/campaigns/active" }),
      request({ url: "/api/v1/tasks/progress" }),
      request({ url: "/api/v1/products" }),
    ]);
    const profile = profileResult.status === "fulfilled" ? profileResult.value.profile : null;
    const campaign = progressResult.status === "fulfilled"
      ? progressResult.value.campaign
      : campaignResult.status === "fulfilled" ? campaignResult.value.campaign : null;
    const progress = progressResult.status === "fulfilled" ? enrichProgress(progressResult.value.progress || {}) : enrichProgress({});
    const tasks = progress.tasks || [];
    const products = productResult.status === "fulfilled" ? (productResult.value.products || []).slice(0, 2) : [];
    this.setData({
      profile,
      profileSummary: this.buildProfileSummary(profile),
      activityHome: this.buildActivityHome(campaign, progress, tasks, products, productResult.status === "fulfilled" ? productResult.value.syncedAt : ""),
    });
  },

  buildActivityHome(campaign, progress, tasks, products, syncedAt) {
    const summary = progress.summary || {};
    const actionable = (task) => !["DONE", "CANCELED"].includes(task.status);
    const primaryTask = tasks.find((task) => task.required && actionable(task)) || tasks.find(actionable) || null;
    const participant = campaign && campaign.participant;
    return {
      campaignTitle: campaign && campaign.title ? campaign.title : "ROOT 身体记录计划",
      campaignCopy: campaign && campaign.description ? campaign.description : "打卡、问卷、分享和咨询会进入同一套活动进度，购买不是参与前置条件。",
      campaignId: campaign && campaign.campaignId ? campaign.campaignId : "ROOT_7D_RESET",
      progressPercent: summary.progressPercent || 0,
      requiredText: `${summary.requiredCompletedTasks || 0}/${summary.requiredTasks || 0}`,
      completedText: String(summary.completedTasks || 0),
      participantText: participant ? "已加入" : "可加入",
      primaryTask,
      tasks: tasks.slice(0, 4),
      products,
      syncedAt: syncedAt || "",
    };
  },

  buildProfileSummary(profile) {
    if (!profile) {
      return {
        title: "我们会先了解你的身体反馈画像",
        lines: ["完成画像后，ROOT 会把你的关注点、肠道状态和日常便型整理成清晰记录。"],
      };
    }
    return {
      title: "你的身体反馈画像",
      lines: [
        `肠道状态：${gutHealthLabel(profile.gut_health_status)}`,
        `日常便型：${stoolLabel(profile.stool_type).replace("：", "，")}`,
      ],
    };
  },

  goOrderMatch() {
    wx.navigateTo({ url: "/pages/order/match" });
  },

  goOrders() {
    wx.navigateTo({ url: "/subpkg/profile/pages/orders/index" });
  },

  goSupport() {
    wx.navigateTo({ url: "/subpkg/profile/pages/support/index" });
  },

  goTasks() {
    wx.switchTab({ url: "/pages/tasks/index" });
  },

  goProducts() {
    router.open("/pages/products/index?source=home");
  },

  goRewards() {
    router.open("/pages/rewards/index?source=home");
  },

  async ensureActivityJoined() {
    const home = this.data.activityHome || {};
    if (home.participantText === "已加入") return true;
    this.setData({ loading: true });
    try {
      const data = await joinCampaign({ campaignId: home.campaignId || "" });
      const nextHome = {
        ...home,
        campaignId: data.campaign ? data.campaign.campaignId : home.campaignId,
        participantText: "已加入",
      };
      this.setData({ activityHome: nextHome });
      return true;
    } catch (error) {
      wx.showToast({ title: error.message || "加入失败", icon: "none" });
      return false;
    } finally {
      this.setData({ loading: false });
    }
  },

  async openHomePrimaryTask() {
    const task = this.data.activityHome && this.data.activityHome.primaryTask;
    if (!task) {
      this.goTasks();
      return;
    }
    await this.navigateActivityTask(task);
  },

  async openHomeTask(event) {
    const taskKey = event.currentTarget.dataset.taskKey || event.currentTarget.dataset.taskId;
    const tasks = (this.data.activityHome && this.data.activityHome.tasks) || [];
    const task = tasks.find((item) => (item.taskKey || item.taskDefinitionId) === taskKey);
    if (task) await this.navigateActivityTask(task);
  },

  async navigateActivityTask(task) {
    const home = this.data.activityHome || {};
    if (task.status === "DONE") {
      wx.showToast({ title: "任务已完成", icon: "none" });
      return;
    }
    if (task.status === "CANCELED") {
      wx.showToast({ title: "来源活动已取消", icon: "none" });
      return;
    }
    if (task.taskType !== "PURCHASE" && !(await this.ensureActivityJoined())) return;
    if (["CHECKIN", "QUESTIONNAIRE"].includes(task.taskType) && !(await ensureHealthConsent())) return;
    if (task.taskType === "CHECKIN") {
      wx.navigateTo({ url: `/subpkg/task/pages/checkin/index?campaignId=${home.campaignId || ""}&taskDefinitionId=${encodeURIComponent(task.taskDefinitionId || "")}&taskActivityAssignmentId=${encodeURIComponent(task.taskActivityAssignmentId || "")}&taskDefinitionVersion=${encodeURIComponent(task.taskDefinitionVersion || "")}` });
      return;
    }
    if (task.taskType === "QUESTIONNAIRE") {
      wx.navigateTo({ url: `/subpkg/task/pages/questionnaire/index?campaignId=${home.campaignId || ""}&questionnaireType=${questionnaireTypeOf(task)}&taskDefinitionId=${encodeURIComponent(task.taskDefinitionId || "")}&taskActivityAssignmentId=${encodeURIComponent(task.taskActivityAssignmentId || "")}&taskDefinitionVersion=${encodeURIComponent(task.taskDefinitionVersion || "")}` });
      return;
    }
    if (task.taskType === "PURCHASE") {
      this.goProducts();
      return;
    }
    if (task.taskType === "CONSULTATION") {
      await this.recordActivitySimpleTask(task, "CONSULTATION");
      this.goSupport();
      return;
    }
    if (task.taskType === "SHARE") {
      await this.recordActivitySimpleTask(task, "SHARE");
      wx.showShareMenu({ withShareTicket: true });
      wx.showToast({ title: "已记录分享任务", icon: "success" });
    }
  },

  async recordActivitySimpleTask(task, taskType) {
    const taskDate = todayChina();
    try {
      await request({
        url: "/api/v1/tasks/events",
        method: "POST",
        data: {
          taskType,
          taskDate,
          payload: {
            taskDate,
            taskDefinitionId: task.taskDefinitionId,
            taskActivityAssignmentId: task.taskActivityAssignmentId || undefined,
            taskDefinitionVersion: task.taskDefinitionVersion || undefined,
          },
          idempotencyKey: `home:${taskType}:${task.taskDefinitionId}:${taskDate}`,
        },
      });
      await this.loadActivityHome();
    } catch (error) {
      wx.showToast({ title: error.message || "任务记录失败", icon: "none" });
    }
  },

  openHomeProduct(event) {
    const productId = event.currentTarget.dataset.productId;
    if (!productId) return;
    wx.navigateTo({ url: `/pages/product-detail/index?productId=${productId}` });
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

  handleStatusCta() {
    if (this.data.session && this.data.session.todayChecked) {
      this.goHistory();
      return;
    }
    this.goToday();
  },

  goRefund() {
    wx.navigateTo({ url: "/subpkg/refund/pages/apply/index" });
  },

  goQuestionnaire() {
    const type = this.data.flowView === "DAY8_PENDING" ? "DAY8_SUMMARY" : "DAY4_MIDPOINT";
    wx.navigateTo({ url: `/subpkg/checkin/pages/questionnaire/index?type=${type}` });
  },

  async loadDailyState() {
    const [stats, trend] = await Promise.all([
      request({ url: "/api/v1/daily/stats" }),
      request({ url: `/api/v1/daily/trend?range=${this.data.dailyRange}` }),
    ]);
    this.setData({
      dailyStats: stats,
      dailyHome: getHomeStageCopy("DAILY_USER", "", null, stats),
      dailyTrend: trend.points,
    });
  },

  handleDailyCta() {
    this.goHistory();
  },

  switchDailyRange(event) {
    this.setData({ dailyRange: event.currentTarget.dataset.range }, () => this.loadDailyState());
  },

  async navigateToShop() {
    if (!this.data.shopAvailable) {
      wx.showToast({ title: "店铺暂未开放", icon: "none" });
      return;
    }
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
    router.open("/pages/products/index?source=daily_home");
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
