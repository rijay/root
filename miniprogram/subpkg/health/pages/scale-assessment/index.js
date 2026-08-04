const { request } = require("../../../../utils/request");

const SUBMIT_KEY_PREFIX = "ROOT4U_SCALE_SUBMIT_KEY_V1";

function storageKey(versionId) {
  return `${SUBMIT_KEY_PREFIX}:${versionId}`;
}

function submitKey(versionId) {
  const key = storageKey(versionId);
  const stored = wx.getStorageSync(key);
  if (stored) return stored;
  const value = `root4u-scale:${versionId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  wx.setStorageSync(key, value);
  return value;
}

Page({
  data: {
    loading: true,
    submitting: false,
    confirming: false,
    error: "",
    assessmentName: "",
    totalQuestions: 0,
    currentIndex: 0,
    currentQuestion: null,
    canContinue: false,
    progressLabel: "01 / 01",
    progressPercent: 0,
    contentHeight: 844,
    result: null,
  },

  onLoad(options = {}) {
    this.scaleVersionId = String(options.versionId || "").trim();
    this.answers = {};
    this.definition = null;
    this.questionGroups = {};
    if (!/^[a-zA-Z0-9_-]+$/.test(this.scaleVersionId)) {
      this.setData({ loading: false, error: "评测版本无效" });
      return;
    }
    this.load();
  },

  goBack() {
    if (!this.data.result && this.data.currentIndex > 0) return this.previous();
    wx.navigateBack({ delta: 1 });
  },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const capture = (promise) => promise.then((value) => ({ value }), (error) => ({ error }));
      const [definitionOutcome, latestOutcome] = await Promise.all([
        capture(request({ url: `/api/v1/health/root4u/scales/${this.scaleVersionId}?group=1`, scope: `root4u-scale-${this.scaleVersionId}-1` })),
        capture(request({ url: `/api/v1/health/root4u/scales/${this.scaleVersionId}/responses/latest`, scope: `root4u-scale-result-${this.scaleVersionId}` })),
      ]);
      if (latestOutcome.value && latestOutcome.value.result) {
        this.setData({ loading: false, result: latestOutcome.value.result });
        return;
      }
      if (definitionOutcome.error) throw definitionOutcome.error;
      this.definition = definitionOutcome.value.definition;
      this.questionGroups[this.definition.group] = this.definition.questions;
      this.setData({ loading: false, assessmentName: this.definition.name, totalQuestions: this.definition.questionCount });
      this.presentQuestion();
    } catch (error) {
      this.setData({ loading: false, error: error.message || "评测加载失败，请稍后重试" });
    }
  },

  presentQuestion() {
    const definition = this.definition;
    if (!definition) return;
    const group = Math.floor(this.data.currentIndex / definition.groupSize) + 1;
    const questions = this.questionGroups[group] || [];
    const question = questions[this.data.currentIndex - (group - 1) * definition.groupSize];
    if (!question) return;
    const selected = this.answers[question.id] || "";
    const current = this.data.currentIndex + 1;
    const total = definition.questionCount;
    this.setData({
      currentQuestion: {
        ...question,
        options: question.options.map((option) => ({ ...option, selected: option.value === selected })),
      },
      canContinue: Boolean(selected),
      progressLabel: `${String(current).padStart(2, "0")} / ${String(total).padStart(2, "0")}`,
      progressPercent: current * 100 / total,
      contentHeight: Math.max(844, 294 + question.options.length * 62 + 150),
    });
  },

  selectOption(event) {
    const value = String(event.currentTarget.dataset.value || "");
    const question = this.data.currentQuestion;
    if (!question || !question.options.some((item) => item.value === value)) return;
    this.answers[question.id] = value;
    this.presentQuestion();
  },

  async ensureGroup(index) {
    const group = Math.floor(index / this.definition.groupSize) + 1;
    if (this.questionGroups[group]) return;
    const result = await request({
      url: `/api/v1/health/root4u/scales/${this.scaleVersionId}?group=${group}`,
      scope: `root4u-scale-${this.scaleVersionId}-${group}`,
    });
    this.questionGroups[group] = result.definition.questions;
  },

  async previous() {
    if (this.data.currentIndex <= 0) return;
    const target = this.data.currentIndex - 1;
    try {
      await this.ensureGroup(target);
      this.setData({ currentIndex: target });
      this.presentQuestion();
    } catch (error) {
      wx.showToast({ title: (error.message || "题目加载失败").slice(0, 28), icon: "none" });
    }
  },

  async next() {
    if (!this.data.canContinue) return wx.showToast({ title: "请选择后继续", icon: "none" });
    if (this.data.currentIndex < this.definition.questionCount - 1) {
      const target = this.data.currentIndex + 1;
      try {
        await this.ensureGroup(target);
        this.setData({ currentIndex: target });
        this.presentQuestion();
      } catch (error) {
        wx.showToast({ title: (error.message || "题目加载失败").slice(0, 28), icon: "none" });
      }
      return;
    }
    this.submit();
  },

  async submit() {
    if (this.data.submitting) return;
    const idempotencyKey = submitKey(this.scaleVersionId);
    this.setData({ submitting: true, error: "" });
    try {
      const submitted = await request({
        url: `/api/v1/health/root4u/scales/${this.scaleVersionId}/responses`,
        method: "POST",
        idempotencyKey,
        data: { answers: this.answers, idempotencyKey },
      });
      wx.removeStorageSync(storageKey(this.scaleVersionId));
      this.answers = {};
      this.setData({ result: submitted.result });
    } catch (error) {
      if (error.resultUnknown || error.outcomeUnknown) {
        this.setData({ confirming: true, error: "提交结果正在确认，请勿重复作答" });
      } else {
        this.setData({ error: error.message || "提交失败，请重试" });
        wx.showToast({ title: (error.message || "提交失败，请重试").slice(0, 28), icon: "none" });
      }
    } finally {
      this.setData({ submitting: false });
    }
  },

  async recoverResult() {
    if (this.data.submitting) return;
    this.setData({ submitting: true, error: "" });
    try {
      const latest = await request({ url: `/api/v1/health/root4u/scales/${this.scaleVersionId}/responses/latest`, scope: `root4u-scale-result-${this.scaleVersionId}`, dedupe: false });
      if (!latest.result) {
        this.setData({ error: "暂未确认到结果，请稍后再试" });
        return;
      }
      wx.removeStorageSync(storageKey(this.scaleVersionId));
      this.answers = {};
      this.setData({ result: latest.result, confirming: false });
    } catch (error) {
      this.setData({ error: error.message || "结果确认失败，请稍后重试" });
    } finally {
      this.setData({ submitting: false });
    }
  },

  retry() { this.load(); },
  returnToHealth() { wx.switchTab({ url: "/pages/health/index" }); },
});
