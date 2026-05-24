const { request } = require("../../../../utils/request");
const router = require("../../../../utils/router");

Page({
  data: {
    type: "DAY4_MIDPOINT",
    questionnaire: null,
    answers: {},
    loading: false,
  },

  async onLoad(query) {
    this.setData({ type: query.type || "DAY4_MIDPOINT" });
  },

  async onShow() {
    const allowed = await router.routeGuard("/subpkg/checkin/pages/questionnaire/index");
    if (allowed) this.load();
  },

  async load() {
    try {
      const data = await request({ url: `/api/v1/questionnaire?type=${this.data.type}` });
      this.setData({ questionnaire: data.questionnaire });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    }
  },

  setAnswer(event) {
    const field = event.currentTarget.dataset.field;
    const value = event.currentTarget.dataset.value;
    this.setData({ answers: { ...this.data.answers, [field]: value } });
  },

  setBoolean(event) {
    const field = event.currentTarget.dataset.field;
    const value = event.currentTarget.dataset.value === "true";
    this.setData({ answers: { ...this.data.answers, [field]: value } });
  },

  onText(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ answers: { ...this.data.answers, [field]: event.detail.value } });
  },

  async submit() {
    this.setData({ loading: true });
    try {
      await request({
        url: "/api/v1/questionnaire/submit",
        method: "POST",
        data: {
          type: this.data.type,
          answers: this.data.answers,
          idempotencyKey: `${this.data.type}_${Date.now()}`,
        },
      });
      wx.showToast({ title: "已提交", icon: "success" });
      router.go("/pages/home/index");
    } catch (error) {
      wx.showModal({ title: "提交失败", content: error.message || "请补全问卷后再提交", showCancel: false });
    } finally {
      this.setData({ loading: false });
    }
  },
});
