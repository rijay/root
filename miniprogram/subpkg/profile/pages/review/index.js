const { request } = require("../../../../utils/request");
const router = require("../../../../utils/router");

function reviewStatus(status) {
  return {
    OPEN: { label: "待运营复核", className: "pending" },
    RESOLVED: { label: "已处理", className: "done" },
  }[status] || { label: "待确认", className: "pending" };
}

function reviewTypeLabel(type) {
  return {
    FREE_ORDER_REVIEW: "免单机会复核",
    REWARD_REVIEW: "奖励发放复核",
    MANUAL_REVIEW: "人工复核",
  }[type] || "人工复核";
}

function priorityLabel(priority) {
  return {
    HIGH: "优先处理",
    NORMAL: "正常处理",
    LOW: "低优先级",
  }[priority] || "正常处理";
}

function rewardStatus(status) {
  return {
    PENDING_DELIVERY: "待发放",
    PENDING_REVIEW: "待复核",
    PROMISED: "已承诺",
    DELIVERED: "已发放",
    FAILED: "需处理",
  }[status] || "待确认";
}

function settlementStatus(status) {
  return {
    QUALIFIED: "已达标",
    NOT_QUALIFIED: "未达标",
  }[status] || "待确认";
}

function formatTime(value) {
  return String(value || "").replace("T", " ").slice(0, 16);
}

function slaText(item) {
  if (!item.slaHours) return "";
  if (item.overdue) return `已超过预计处理时间 · ${item.slaHours} 小时 SLA`;
  return `预计 ${formatTime(item.expectedResolutionAt)} 前处理 · ${item.slaHours} 小时 SLA`;
}

function listValue(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function buildView(data = {}) {
  const latestSettlement = data.latestSettlement || null;
  const latestSettlementView = latestSettlement ? {
    ...latestSettlement,
    statusLabel: settlementStatus(latestSettlement.status),
    evaluatedAtText: formatTime(latestSettlement.evaluatedAt),
  } : null;
  const rewardGrants = data.rewardGrants || [];
  const manualReviews = (data.manualReviews || []).map((item) => {
    const status = reviewStatus(item.status);
    const reward = rewardGrants.find((grant) => grant.rewardGrantId && item.reason && item.reason.includes(grant.title));
    const explanation = item.explanation || {};
    const evidenceRequired = listValue(item.evidenceRequired || explanation.evidenceRequired);
    return {
      ...item,
      reviewTypeLabel: reviewTypeLabel(item.reviewType),
      priorityLabel: priorityLabel(item.priority),
      statusLabel: status.label,
      statusClass: status.className,
      rewardTitle: reward ? reward.title : "",
      createdAtText: formatTime(item.createdAt),
      resolvedAtText: formatTime(item.resolvedAt),
      expectedResolutionAtText: formatTime(item.expectedResolutionAt),
      slaText: slaText(item),
      statusCopy: item.statusCopy || "",
      publicNote: item.publicNote || "",
      explanationTitle: item.explanationTitle || explanation.title || "",
      pendingReason: item.pendingReason || explanation.pendingReason || "",
      evidenceRequired,
      nextAction: item.nextAction || explanation.nextAction || "",
      hasExplanation: Boolean(item.explanationTitle || explanation.title || item.pendingReason || explanation.pendingReason || evidenceRequired.length || item.nextAction || explanation.nextAction),
    };
  });
  const openReviews = manualReviews.filter((item) => item.status === "OPEN");
  const reviewHistory = manualReviews.filter((item) => item.status !== "OPEN");
  const rewards = rewardGrants.map((item) => ({
    ...item,
    statusLabel: rewardStatus(item.status),
  }));

  if (openReviews.length) {
    const primaryReview = openReviews[0];
    return {
      latestSettlement: latestSettlementView,
      manualReviews,
      openReviews,
      reviewHistory,
      rewards,
      heroClass: "pending",
      heroTitle: "运营正在复核",
      heroCopy: primaryReview.statusCopy || primaryReview.pendingReason || "免单机会、异常奖励或订单证据需要人工确认。复核期间不需要重复提交，状态会自动同步。",
      openReviewSectionCopy: primaryReview.pendingReason || "运营会根据活动规则、奖励库存和外部订单证据确认。",
      primaryAction: "联系顾问",
      secondaryAction: "查看奖励",
    };
  }

  if (manualReviews.length) {
    const latestHistory = reviewHistory[0] || manualReviews[0];
    return {
      latestSettlement: latestSettlementView,
      manualReviews,
      openReviews,
      reviewHistory,
      rewards,
      heroClass: "done",
      heroTitle: "复核已处理",
      heroCopy: latestHistory.statusCopy || "历史复核已完成。若奖励仍未到账，可联系顾问协助核对外部发放状态。",
      openReviewSectionCopy: "",
      primaryAction: "查看奖励",
      secondaryAction: "联系顾问",
    };
  }

  return {
    latestSettlement: latestSettlementView,
    manualReviews,
    openReviews,
    reviewHistory,
    rewards,
    heroClass: latestSettlementView && latestSettlementView.status === "QUALIFIED" ? "done" : "idle",
    heroTitle: latestSettlementView ? `最近结算：${latestSettlementView.statusLabel}` : "暂无复核事项",
    heroCopy: latestSettlementView
      ? "当前没有需要人工判断的复核项。奖励发放状态以奖励页记录为准。"
      : "完成任务并提交结算后，如有免单机会或异常奖励，会在这里显示复核原因和处理进度。",
    openReviewSectionCopy: "",
    primaryAction: latestSettlementView ? "查看奖励" : "继续任务",
    secondaryAction: "联系顾问",
  };
}

Page({
  data: {
    loading: true,
    errorText: "",
    latestSettlement: null,
    manualReviews: [],
    openReviews: [],
    reviewHistory: [],
    rewards: [],
    heroClass: "idle",
    heroTitle: "暂无复核事项",
    heroCopy: "完成任务并提交结算后，如有免单机会或异常奖励，会在这里显示复核原因和处理进度。",
    openReviewSectionCopy: "",
    primaryAction: "继续任务",
    secondaryAction: "联系顾问",
  },

  async onShow() {
    const allowed = await router.routeGuard("/subpkg/profile/pages/review/index");
    if (allowed) this.load();
  },

  async load() {
    this.setData({ loading: true, errorText: "" });
    try {
      const data = await request({ url: "/api/v1/settlement/status" });
      this.setData(buildView(data));
    } catch (error) {
      this.setData({ errorText: error.message || "复核状态加载失败" });
      wx.showToast({ title: error.message || "复核状态加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  handlePrimaryAction() {
    if (this.data.primaryAction === "联系顾问") {
      this.openSupport();
      return;
    }
    if (this.data.primaryAction === "查看奖励") {
      wx.switchTab({ url: "/pages/rewards/index" });
      return;
    }
    wx.switchTab({ url: "/pages/tasks/index" });
  },

  handleSecondaryAction() {
    if (this.data.secondaryAction === "查看奖励") {
      wx.switchTab({ url: "/pages/rewards/index" });
      return;
    }
    this.openSupport();
  },

  openSupport() {
    router.go("/subpkg/profile/pages/support/index");
  },
});
