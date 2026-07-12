const { request } = require("../../utils/request");
const router = require("../../utils/router");
const { enrichProgress } = require("../../utils/task-presenter");

function conditionStatus(condition) {
  if (condition.passed) return { label: "已达成", className: "done" };
  if (condition.missing > 0) return { label: `差 ${condition.missing}`, className: "pending" };
  return { label: "待完成", className: "pending" };
}

function rewardStatusLabel(status) {
  return {
    PENDING_DELIVERY: "待发放",
    PENDING_REVIEW: "待复核",
    PROMISED: "已承诺",
    DELIVERED: "已发放",
    FAILED: "需处理",
  }[status] || "待确认";
}

function reviewStatusLabel(status) {
  return {
    OPEN: "待复核",
    RESOLVED: "已处理",
  }[status] || "待确认";
}

function settlementStatusLabel(status) {
  return {
    QUALIFIED: "已达标",
    NOT_QUALIFIED: "未达标",
  }[status] || "待确认";
}

function buildView(data) {
  const result = data.result || {};
  const progress = enrichProgress(result.progress || {});
  const latestSettlement = data.latestSettlement || null;
  const qualified = Boolean(result.qualified);
  const canEvaluate = qualified && !latestSettlement;
  const conditions = (result.conditions || []).map((condition) => {
    const status = conditionStatus(condition);
    return {
      ...condition,
      title: condition.label,
      statusLabel: status.label,
      statusClass: status.className,
      progressText: `${condition.actual || 0}/${condition.target || 1}`,
    };
  });
  const rewardGrants = (data.rewardGrants || []).map((reward) => ({
    ...reward,
    statusLabel: rewardStatusLabel(reward.status),
  }));
  const manualReviews = (data.manualReviews || []).map((review) => ({
    ...review,
    statusLabel: reviewStatusLabel(review.status),
  }));

  const latestSettlementView = latestSettlement ? {
    ...latestSettlement,
    statusLabel: settlementStatusLabel(latestSettlement.status),
  } : null;

  if (!qualified) {
    return {
      progress,
      conditions,
      rewardGrants,
      manualReviews,
      latestSettlement: latestSettlementView,
      canEvaluate,
      primaryAction: "继续任务",
      statusTitle: "继续完成条件",
      statusCopy: "运营规则会逐项判断完成情况，全部达成后即可提交结算。",
    };
  }
  if (canEvaluate) {
    return {
      progress,
      conditions,
      rewardGrants,
      manualReviews,
      latestSettlement: latestSettlementView,
      canEvaluate,
      primaryAction: "提交结算",
      statusTitle: "可提交结算",
      statusCopy: "已满足当前活动规则，提交后会生成奖励和人工复核记录。",
    };
  }
  return {
    progress,
    conditions,
    rewardGrants,
    manualReviews,
    latestSettlement: latestSettlementView,
    canEvaluate,
    primaryAction: "查看任务",
    statusTitle: latestSettlement.status === "QUALIFIED" ? "结算已提交" : "最近结算未达标",
    statusCopy: latestSettlement.status === "QUALIFIED"
      ? "奖励已进入发放或复核流程，运营处理进度会在这里同步。"
      : "最近一次判断未满足条件，请继续完成任务后再提交。",
  };
}

Page({
  data: {
    loading: true,
    evaluating: false,
    progress: { tasks: [], summary: { progressPercent: 0, settlementReady: false } },
    conditions: [],
    rewardGrants: [],
    manualReviews: [],
    latestSettlement: null,
    canEvaluate: false,
    primaryAction: "继续任务",
    statusTitle: "待完成任务",
    statusCopy: "完成必做任务后，系统会进入活动结算。",
    errorText: "",
  },

  async onShow() {
    const allowed = await router.routeGuard("/pages/rewards/index");
    if (allowed) this.load();
  },

  async load() {
    this.setData({ loading: true, errorText: "" });
    try {
      const data = await request({ url: "/api/v1/settlement/status" });
      this.setData({
        ...buildView(data),
      });
    } catch (error) {
      this.setData({ errorText: error.message || "奖励状态加载失败" });
      wx.showToast({ title: error.message || "奖励状态加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  async submitSettlement() {
    if (!this.data.canEvaluate || this.data.evaluating) {
      this.goTasks();
      return;
    }
    this.setData({ evaluating: true, errorText: "" });
    try {
      await request({
        url: "/api/v1/settlement/evaluate",
        method: "POST",
        data: { sourceChannel: "MINIPROGRAM_REWARD" },
      });
      wx.showToast({ title: "已提交结算", icon: "success" });
      await this.load();
    } catch (error) {
      this.setData({ errorText: error.message || "提交结算失败" });
      wx.showToast({ title: error.message || "提交结算失败", icon: "none" });
    } finally {
      this.setData({ evaluating: false });
    }
  },

  goTasks() {
    wx.switchTab({ url: "/pages/tasks/index" });
  },

  openProgress() {
    wx.navigateTo({ url: "/subpkg/task/pages/progress/index" });
  },

  openReviewPage() {
    router.go("/subpkg/profile/pages/review/index");
  },
});
