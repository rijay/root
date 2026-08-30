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
  toggleMultiAnswer,
  visibleQuestions,
} = require("../../../../utils/assessment-flow");
const router = require("../../../../utils/router");
const { defaultOnShareAppMessage } = require("../../../../utils/page-share");
const { nextPathAfterAssessment } = require("../../../../utils/assessment-source-survey");
const {
  GUT_INTRO_SOURCE,
  GUT_INTRO_PATH,
  assessmentGuardPath,
  assessmentTypeFromOptions,
  shouldRedirectToIntro,
} = require("../../../../utils/gut-assessment-entry");

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
    showBristol: false,
    bristolLoading: true,
    bristolFailed: false,
    options: [],
    scaleOptions: [],
    progressPercent: 0,
    progressText: "",
    saving: false,
    dirty: false,
    saveFailed: false,
    saveStatusText: "完成当前题目后，进度会安全保存到账号。",
    saveStatusTone: "muted",
  },

  onLoad(options = {}) {
    this.routeOptions = { ...options };
    if (shouldRedirectToIntro(this.routeOptions)) {
      wx.redirectTo({ url: GUT_INTRO_PATH });
      return;
    }
    this.pendingInitialize = true;
    this.initialize(this.routeOptions);
  },

  onShow() {
    if (this.pendingInitialize && !this._initializing && !this.data.assessmentId && !this.data.errorText) {
      this.initialize(this.routeOptions);
    }
  },

  async initialize(options = this.routeOptions || {}) {
    if (this._initializing) return;
    const routeOptions = options && options.currentTarget ? (this.routeOptions || {}) : { ...options };
    this.routeOptions = routeOptions;
    this._initializing = true;
    this.setData({ loading: true, errorText: "" });
    try {
      const requestedType = assessmentTypeFromOptions(routeOptions);
      const requestedId = routeOptions.assessmentId || routeOptions.assessment_id || "";
      const allowed = await router.routeGuard(assessmentGuardPath({
        assessmentType: requestedType,
        assessmentId: requestedId,
        source: routeOptions.source === GUT_INTRO_SOURCE ? GUT_INTRO_SOURCE : "",
      }));
      if (!allowed) {
        this.pendingInitialize = false;
        return;
      }
      const consented = await ensureHealthConsent();
      if (!consented) {
        this.pendingInitialize = true;
        return;
      }
      let assessmentId = requestedId || this.data.assessmentId || "";
      if (!assessmentId) {
        const started = await startAssessment(requestedType);
        assessmentId = started.assessment && started.assessment.assessmentId;
      }
      if (!assessmentId) throw new Error("评测记录未创建");
      this.pendingInitialize = false;
      this.setData({ assessmentId });
      const data = await getAssessment(assessmentId);
      if (data.assessment.status !== "IN_PROGRESS") {
        wx.redirectTo({ url: `/subpkg/health/pages/result/index?assessmentId=${assessmentId}` });
        return;
      }
      this.hydrate(data.assessment);
    } catch (error) {
      this.pendingInitialize = false;
      this.setData({ errorText: error.message || "评测暂时无法加载" });
    } finally {
      this._initializing = false;
      this.setData({ loading: false });
    }
  },

  retryInitialize() {
    this.pendingInitialize = true;
    this.initialize(this.routeOptions);
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
      saveStatusText: Object.keys(answers).length ? "已从账号恢复上次进度。" : "完成当前题目后，进度会安全保存到账号。",
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
      showBristol: Boolean(question && question.field === "Q2" && this.data.assessment.assessmentType === "GUT_REGULARITY"),
      options,
      scaleOptions,
      progressPercent: Math.round(((this.data.currentIndex + 1) / total) * 100),
      progressText: `${Math.min(this.data.currentIndex + 1, total)} / ${total}`,
    });
  },

  previewBristol() {
    if (this.data.bristolFailed || typeof wx.previewImage !== "function") return;
    const url = "/subpkg/health/assets/bristol-stool-scale.jpg";
    wx.previewImage({ current: url, urls: [url] });
  },

  bristolLoaded() {
    this.setData({ bristolLoading: false, bristolFailed: false });
  },

  bristolFailed() {
    this.setData({ bristolLoading: false, bristolFailed: true });
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
      saveStatusText: "本题修改尚未保存到账号。",
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
    this.setAnswer(toggleMultiAnswer(this.data.currentQuestion, this.data.currentValue, value));
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
      saveStatusText: "正在将当前进度保存到账号…",
      saveStatusTone: "pending",
    });
    try {
      const result = await saveDraft(this.data.assessmentId, answers);
      const unchanged = Number(this.answerRevision || 0) === revision;
      this.setData({
        dirty: !unchanged,
        saveFailed: false,
        saveStatusText: unchanged ? "当前进度已保存到账号。" : "保存期间有新修改，进入下一步前会再次保存。",
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
      this.setData({ dirty: false, saveStatusText: "结果已生成，正在确认下一步…", saveStatusTone: "saved" });
      const nextPath = await nextPathAfterAssessment(result.assessment);
      wx.redirectTo({ url: nextPath });
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

  onShareAppMessage: defaultOnShareAppMessage,
});
