const { getToken, request } = require("../../../../utils/request");
const router = require("../../../../utils/router");
const { todayChina } = require("../../../../utils/task-presenter");

const CONSULTATION_TYPES = [
  {
    value: "ORDER",
    title: "订单与物流",
    description: "购买记录、订单同步、物流状态和商品发货问题。",
  },
  {
    value: "TASK",
    title: "打卡与问卷",
    description: "打卡中断、补记、问卷提交和任务进度问题。",
  },
  {
    value: "REWARD",
    title: "奖励与复核",
    description: "优惠券、免单机会、活动结算和人工复核进度。",
  },
  {
    value: "BODY_FEEDBACK",
    title: "身体反馈",
    description: "使用过程中的身体反馈、不适感或希望顾问跟进。",
  },
];

function buildOptions(selectedType) {
  return CONSULTATION_TYPES.map((item) => ({
    ...item,
    className: item.value === selectedType ? "active" : "",
  }));
}

function buildConsultationItems(items) {
  return (items || []).map((item) => ({
    ...item,
    statusClass: item.statusTone ? `status-${item.statusTone}` : "status-pending",
    dateLabel: item.taskDate || "刚刚",
  }));
}

function buildFollowState(data) {
  const summary = data && data.summary ? data.summary : {};
  const consultations = buildConsultationItems(data && data.consultations);
  return {
    followSummaryTitle: summary.title || "暂无咨询记录",
    followSummaryCopy: summary.copy || "选择咨询主题并联系顾问后，这里会展示跟进状态。",
    consultations,
    hasConsultations: consultations.length > 0,
  };
}

Page({
  data: {
    selectedType: "ORDER",
    options: buildOptions("ORDER"),
    recording: false,
    recorded: false,
    loadingFollowups: false,
    followSummaryTitle: "暂无咨询记录",
    followSummaryCopy: "选择咨询主题并联系顾问后，这里会展示跟进状态。",
    consultations: [],
    hasConsultations: false,
    statusText: "选择咨询主题后联系顾问，已登录用户会同步记录一次咨询任务。",
    sessionFrom: "support:ORDER",
  },

  async onShow() {
    await router.routeGuard("/subpkg/profile/pages/support/index");
    this.loadFollowups();
  },

  selectTopic(event) {
    const selectedType = event.currentTarget.dataset.type || "ORDER";
    this.setData({
      selectedType,
      options: buildOptions(selectedType),
      statusText: this.data.recorded ? "咨询任务已记录，顾问会结合你的主题继续跟进。" : "已选择咨询主题，点击下方按钮联系顾问。",
      sessionFrom: `support:${selectedType}`,
    });
  },

  async recordBeforeContact() {
    if (!getToken()) {
      this.setData({ statusText: "你可以直接联系客服；登录后再咨询会同步记录任务进度。" });
      return;
    }
    if (this.data.recording) return;
    this.setData({ recording: true });
    const taskDate = todayChina();
    try {
      const result = await request({
        url: "/api/v1/tasks/events",
        method: "POST",
        data: {
          taskType: "CONSULTATION",
          taskDate,
          sourceChannel: "MINIPROGRAM_SUPPORT",
          payload: {
            taskDate,
            consultationType: this.data.selectedType,
            scene: "SUPPORT_PAGE",
          },
          idempotencyKey: `support-consultation:${this.data.selectedType}:${taskDate}`,
        },
      });
      this.setData({
        recorded: true,
        statusText: result.created ? "咨询任务已记录。" : "今天的同类咨询任务已记录。",
      });
      await this.loadFollowups();
    } catch (error) {
      this.setData({ statusText: error.message || "咨询任务记录失败，但仍可继续联系客服。" });
    } finally {
      this.setData({ recording: false });
    }
  },

  async loadFollowups() {
    if (!getToken()) {
      this.setData(buildFollowState({}));
      return;
    }
    if (this.data.loadingFollowups) return;
    this.setData({ loadingFollowups: true });
    try {
      const result = await request({ url: "/api/v1/user/consultations" });
      this.setData(buildFollowState(result));
    } catch (error) {
      this.setData({
        followSummaryTitle: "跟进状态暂不可用",
        followSummaryCopy: error.message || "稍后可再次进入页面查看。",
      });
    } finally {
      this.setData({ loadingFollowups: false });
    }
  },

  handleContactResult() {
    if (this.data.recorded) return;
    this.recordBeforeContact();
  },

  openOrders() {
    router.go("/subpkg/profile/pages/orders/index");
  },

  openReview() {
    router.go("/subpkg/profile/pages/review/index");
  },

  openTasks() {
    wx.switchTab({ url: "/pages/tasks/index" });
  },
});
