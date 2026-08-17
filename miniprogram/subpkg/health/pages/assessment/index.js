const { ensureHealthConsent } = require("../../../../utils/health-consent");
const {
  completeAssessment,
  getAssessment,
  saveDraft,
  startAssessment,
} = require("../../../../utils/health-assessment");
const {
  firstIncompleteIndex,
  missingAnswer,
  pruneHiddenAnswers,
  visibleQuestions,
} = require("../../../../utils/assessment-flow");
const router = require("../../../../utils/router");

Page({
  data: {
    loading: true,
    errorText: "",
    assessmentId: "",
    assessment: null,
    questions: [],
    visibleQuestions: [],
    answers: {},
    currentIndex: 0,
    currentQuestion: null,
    currentValue: null,
    options: [],
    scaleOptions: [],
    progressPercent: 0,
    progressText: "",
    saving: false,
    dirty: false,
    saveFailed: false,
    saveStatusText: "完成当前题目后，答案会安全保存。",
    saveStatusTone: "muted",
  },

  onLoad(options = {}) {
    this.initialize(options);
  },

  async initialize(options = {}) {
    this.setData({ loading: true, errorText: "" });
    try {
      const allowed = await router.routeGuard("/subpkg/health/pages/assessment/index");
      if (!allowed) return;
      const consented = await ensureHealthConsent();
      if (!consented) return;
      let assessmentId = options.assessmentId || options.assessment_id || this.data.assessmentId || "";
      if (!assessmentId) {
        const type = options.assessmentType || options.assessment_type || "INITIAL";
        const started = await startAssessment(type);
        assessmentId = started.assessment && started.assessment.assessmentId;
      }
      if (!assessmentId) throw new Error("评测记录未创建");
      this.setData({ assessmentId });
      const data = await getAssessment(assessmentId);
      if (data.assessment.status !== "IN_PROGRESS") {
        wx.redirectTo({ url: `/subpkg/health/pages/result/index?assessmentId=${assessmentId}` });
        return;
      }
      this.hydrate(data.assessment);
    } catch (error) {
      this.setData({ errorText: error.message || "评测暂时无法加载" });
    } finally {
      this.setData({ loading: false });
    }
  },

  hydrate(assessment) {
    const questions = (assessment.definition && assessment.definition.questions) || [];
    const answers = pruneHiddenAnswers(questions, assessment.answers || {});
    const visible = visibleQuestions(questions, answers);
    const currentIndex = firstIncompleteIndex(visible, answers);
    this.answerRevision = 0;
    this.setData({
      assessment,
      questions,
      visibleQuestions: visible,
      answers,
      currentIndex,
      dirty: false,
      saveFailed: false,
      saveStatusText: Object.keys(answers).length ? "已恢复上次保存的进度。" : "完成当前题目后，答案会安全保存。",
      saveStatusTone: "muted",
    }, () => this.refreshQuestion());
  },

  refreshQuestion() {
    const question = this.data.visibleQuestions[this.data.currentIndex] || null;
    const currentValue = question ? this.data.answers[question.field] : null;
    const selectedValues = Array.isArray(currentValue) ? currentValue : [];
    const options = question ? (question.options || []).map((item) => ({
      ...item,
      selected: Array.isArray(currentValue) ? selectedValues.includes(item.value) : currentValue === item.value,
    })) : [];
    const scaleOptions = question && question.type === "scale"
      ? Array.from({ length: Math.max(0, Number(question.max) - Number(question.min) + 1) }, (_, index) => Number(question.min) + index)
      : [];
    const total = this.data.visibleQuestions.length || 1;
    this.setData({
      currentQuestion: question,
      currentValue,
      options,
      scaleOptions,
      progressPercent: Math.round(((this.data.currentIndex + 1) / total) * 100),
      progressText: `${Math.min(this.data.currentIndex + 1, total)} / ${total}`,
    });
  },

  setAnswer(value) {
    const question = this.data.currentQuestion;
    if (!question) return;
    const answers = pruneHiddenAnswers(this.data.questions, {
      ...this.data.answers,
      [question.field]: value,
    });
    const visible = visibleQuestions(this.data.questions, answers);
    const currentIndex = Math.max(0, visible.findIndex((item) => item.field === question.field));
    this.answerRevision = Number(this.answerRevision || 0) + 1;
    this.setData({
      answers,
      visibleQuestions: visible,
      currentIndex,
      dirty: true,
      saveFailed: false,
      saveStatusText: "本题修改尚未保存。",
      saveStatusTone: "pending",
    }, () => this.refreshQuestion());
  },

  selectOption(event) {
    this.setAnswer(event.currentTarget.dataset.value);
  },

  selectBoolean(event) {
    this.setAnswer(event.currentTarget.dataset.value === "true");
  },

  toggleMulti(event) {
    const value = event.currentTarget.dataset.value;
    const current = Array.isArray(this.data.currentValue) ? [...this.data.currentValue] : [];
    const index = current.indexOf(value);
    if (index >= 0) current.splice(index, 1);
    else current.push(value);
    this.setAnswer(current);
  },

  selectScale(event) {
    this.setAnswer(Number(event.currentTarget.dataset.value));
  },

  inputText(event) {
    this.setAnswer(event.detail.value || "");
  },

  async previous() {
    if (this.data.saving || this.data.currentIndex <= 0) return;
    if (this.data.dirty && !(await this.persistDraft(true))) return;
    this.setData({ currentIndex: this.data.currentIndex - 1 }, () => this.refreshQuestion());
  },

  async next() {
    if (this.data.saving) return;
    const question = this.data.currentQuestion;
    if (!question) return;
    if (question.required !== false && missingAnswer(this.data.answers[question.field])) {
      wx.showToast({ title: "请先完成当前题目", icon: "none" });
      return;
    }
    const saved = await this.persistDraft(true);
    if (!saved) return;
    if (saved.safetyTriggered || this.data.currentIndex >= this.data.visibleQuestions.length - 1) {
      await this.finish();
      return;
    }
    this.setData({ currentIndex: this.data.currentIndex + 1 }, () => this.refreshQuestion());
  },

  async persistDraft(showError) {
    if (!this.data.assessmentId) return null;
    const answers = pruneHiddenAnswers(this.data.questions, this.data.answers);
    const revision = Number(this.answerRevision || 0);
    this.setData({
      saving: true,
      saveFailed: false,
      saveStatusText: "正在保存当前进度…",
      saveStatusTone: "pending",
    });
    try {
      const result = await saveDraft(this.data.assessmentId, answers);
      const unchanged = Number(this.answerRevision || 0) === revision;
      this.setData({
        dirty: !unchanged,
        saveFailed: false,
        saveStatusText: unchanged ? "当前进度已保存。" : "保存期间有新修改，进入下一步前会再次保存。",
        saveStatusTone: unchanged ? "saved" : "pending",
      });
      return result;
    } catch (error) {
      this.setData({
        dirty: true,
        saveFailed: true,
        saveStatusText: "保存失败，答案仍保留在当前页面，请重试。",
        saveStatusTone: "error",
      });
      if (showError) wx.showToast({ title: error.message || "答案保存失败", icon: "none" });
      return null;
    } finally {
      this.setData({ saving: false });
    }
  },

  retryDraft() {
    if (this.data.saving) return;
    this.persistDraft(true);
  },

  async finish() {
    const answers = pruneHiddenAnswers(this.data.questions, this.data.answers);
    this.setData({
      saving: true,
      saveFailed: false,
      saveStatusText: "正在生成本次结果…",
      saveStatusTone: "pending",
    });
    try {
      const result = await completeAssessment(this.data.assessmentId, answers);
      const assessmentId = result.assessment && result.assessment.assessmentId;
      if (!assessmentId) throw new Error("结果生成失败");
      this.setData({ dirty: false, saveStatusText: "结果已生成。", saveStatusTone: "saved" });
      wx.redirectTo({ url: `/subpkg/health/pages/result/index?assessmentId=${assessmentId}` });
    } catch (error) {
      this.setData({
        dirty: true,
        saveStatusText: "结果提交失败，当前答案没有清除，可直接重试。",
        saveStatusTone: "error",
      });
      wx.showToast({ title: error.message || "结果生成失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },

  onHide() {
    if (this.data.dirty && !this.data.saving && this.data.assessmentId) {
      const answers = pruneHiddenAnswers(this.data.questions, this.data.answers);
      const revision = Number(this.answerRevision || 0);
      saveDraft(this.data.assessmentId, answers)
        .then(() => {
          if (Number(this.answerRevision || 0) === revision) {
            this.setData({ dirty: false, saveFailed: false });
          }
        })
        .catch(() => {
          this.setData({ saveFailed: true });
        });
    }
  },
});
