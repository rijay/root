const { request } = require("../../../../utils/request");

const SUBMIT_KEY = "ROOT4U_INITIAL_SUBMIT_KEY_V1";

function submitKey() {
  const stored = wx.getStorageSync(SUBMIT_KEY);
  if (stored) return stored;
  const value = `root4u:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  wx.setStorageSync(SUBMIT_KEY, value);
  return value;
}

Page({
  data: {
    loading: true,
    submitting: false,
    definition: null,
    currentIndex: 0,
    currentQuestion: null,
    answers: {},
    canContinue: false,
    progressLabel: "01 / 12",
    progressPercent: 0,
    contentHeight: 844,
  },

  onLoad() {
    this.load();
  },

  goBack() {
    if (this.data.currentIndex > 0) {
      this.previous();
      return;
    }
    wx.navigateBack({ delta: 1 });
  },

  async load() {
    try {
      const result = await request({ url: "/api/v1/health/root4u/initial-assessment", scope: "root4u-assessment" });
      this.setData({ definition: result.definition, loading: false });
      this.presentQuestion();
    } catch (error) {
      this.setData({ loading: false });
      wx.showModal({
        title: "暂时无法开始",
        content: error.message || "评测加载失败，请稍后重试。",
        showCancel: false,
        success: () => wx.navigateBack(),
      });
    }
  },

  presentQuestion() {
    const definition = this.data.definition;
    if (!definition) return;
    const question = definition.questions[this.data.currentIndex];
    const stored = this.data.answers[question.id];
    const selected = Array.isArray(stored) ? stored : stored ? [stored] : [];
    const current = this.data.currentIndex + 1;
    const total = definition.questions.length;
    const optionCount = Array.isArray(question.options) ? question.options.length : 0;
    this.setData({
      currentQuestion: {
        ...question,
        title: question.id === "primary_goal"
          ? "这次使用 Root，\n最想先改善哪类状态？"
          : question.title,
        options: question.options.map((option) => ({ ...option, selected: selected.includes(option.value) })),
      },
      canContinue: selected.length > 0,
      progressLabel: `${String(current).padStart(2, "0")} / ${String(total).padStart(2, "0")}`,
      progressPercent: current * 100 / total,
      contentHeight: Math.max(844, 294 + optionCount * 62 + 150),
    });
  },

  selectOption(event) {
    const value = event.currentTarget.dataset.value;
    const question = this.data.currentQuestion;
    if (!question || !value) return;
    const option = question.options.find((item) => item.value === value);
    const answers = { ...this.data.answers };
    if (question.type === "single") {
      answers[question.id] = value;
    } else {
      const current = Array.isArray(answers[question.id]) ? answers[question.id].slice() : [];
      if (option.exclusive) {
        answers[question.id] = [value];
      } else {
        const withoutExclusive = current.filter((item) => !question.options.find((candidate) => candidate.value === item && candidate.exclusive));
        answers[question.id] = withoutExclusive.includes(value)
          ? withoutExclusive.filter((item) => item !== value)
          : withoutExclusive.concat(value);
      }
    }
    this.setData({ answers });
    this.presentQuestion();
  },

  previous() {
    if (this.data.currentIndex <= 0) return;
    this.setData({ currentIndex: this.data.currentIndex - 1 });
    this.presentQuestion();
  },

  next() {
    if (!this.data.canContinue) {
      wx.showToast({ title: "请选择后继续", icon: "none" });
      return;
    }
    if (this.data.currentIndex < this.data.definition.questions.length - 1) {
      this.setData({ currentIndex: this.data.currentIndex + 1 });
      this.presentQuestion();
      return;
    }
    this.submit();
  },

  async submit() {
    if (this.data.submitting) return;
    const idempotencyKey = submitKey();
    this.setData({ submitting: true });
    try {
      await request({
        url: "/api/v1/health/root4u/initial-assessment",
        method: "POST",
        idempotencyKey,
        data: { answers: this.data.answers, idempotencyKey },
      });
      wx.removeStorageSync(SUBMIT_KEY);
      wx.showToast({ title: "建档完成", icon: "success" });
      setTimeout(() => wx.switchTab({ url: "/pages/health/index" }), 500);
    } catch (error) {
      if (error.code === "FORMAL_HEALTH_ALREADY_COMPLETED") {
        wx.removeStorageSync(SUBMIT_KEY);
        wx.switchTab({ url: "/pages/health/index" });
        return;
      }
      wx.showToast({ title: (error.message || "提交失败，请重试").slice(0, 28), icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
