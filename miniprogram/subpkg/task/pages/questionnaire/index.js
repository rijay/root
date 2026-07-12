const { request } = require("../../../../utils/request");
const { ensureHealthConsent } = require("../../../../utils/health-consent");
const { todayChina } = require("../../../../utils/task-presenter");
const { isMissing, visibleQuestionRows } = require("../../../../utils/questionnaire-branching");

Page({
  data: {
    campaignId: "",
    questionnaireType: "DAY4_MIDPOINT",
    questionnaire: null,
    questionRows: [],
    answers: {},
    missingFields: {},
    scaleOptions: [1, 2, 3, 4, 5],
    loading: true,
    submitting: false,
  },

  onLoad(options = {}) {
    this.setData({
      campaignId: options.campaignId || options.campaign_id || "",
      questionnaireType: options.questionnaireType || options.questionnaire_type || "DAY4_MIDPOINT",
    });
    this.loadQuestionnaire();
  },

  async onShow() {
    await ensureHealthConsent();
  },

  async loadQuestionnaire() {
    this.setData({ loading: true });
    try {
      const data = await request({ url: `/api/v1/questionnaire?type=${this.data.questionnaireType}` });
      const questionnaire = data.questionnaire || null;
      this.setData({
        questionnaire,
        questionRows: this.buildQuestionRows(questionnaire, this.data.answers),
      });
    } catch (error) {
      wx.showToast({ title: error.message || "问卷加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  setAnswer(field, value) {
    const answers = { ...this.data.answers, [field]: value };
    this.setData({
      answers,
      questionRows: this.buildQuestionRows(this.data.questionnaire, answers),
      missingFields: { ...this.data.missingFields, [field]: false },
    });
  },

  buildQuestionRows(questionnaire, answers) {
    if (!questionnaire || !Array.isArray(questionnaire.questions)) return [];
    const requiredFields = questionnaire.required_fields || questionnaire.requiredFields || [];
    return visibleQuestionRows(questionnaire, answers, (question) => ({
      ...question,
      required: requiredFields.includes(question.field) || question.required === true,
      answer: answers[question.field],
    }));
  },

  selectOption(event) {
    this.setAnswer(event.currentTarget.dataset.field, event.currentTarget.dataset.value);
  },

  selectScale(event) {
    this.setAnswer(event.currentTarget.dataset.field, Number(event.currentTarget.dataset.value));
  },

  toggleBoolean(event) {
    this.setAnswer(event.currentTarget.dataset.field, event.currentTarget.dataset.value === "true");
  },

  inputText(event) {
    this.setAnswer(event.currentTarget.dataset.field, event.detail.value);
  },

  validateAnswers() {
    const missingFields = {};
    this.data.questionRows
      .filter((question) => question.required === true)
      .forEach((question) => {
        missingFields[question.field] = isMissing(this.data.answers[question.field]);
      });
    this.setData({ missingFields });
    if (Object.keys(missingFields).some((field) => missingFields[field])) {
      wx.showToast({ title: "请完成必填题", icon: "none" });
      return false;
    }
    return true;
  },

  async submit() {
    if (this.data.submitting) return;
    if (!(await ensureHealthConsent())) return;
    if (!this.validateAnswers()) return;
    const taskDate = todayChina();
    this.setData({ submitting: true });
    try {
      await request({
        url: "/api/v1/questionnaire/answers",
        method: "POST",
        data: {
          campaignId: this.data.campaignId,
          questionnaireType: this.data.questionnaireType,
          taskDate,
          submittedAt: taskDate,
          answers: this.data.answers,
          idempotencyKey: `questionnaire-answer:${this.data.campaignId || "default"}:${this.data.questionnaireType}`,
        },
      });
      wx.showToast({ title: "已提交", icon: "success" });
      wx.redirectTo({ url: `/subpkg/task/pages/progress/index?campaignId=${this.data.campaignId}` });
    } catch (error) {
      wx.showToast({ title: error.message || "提交失败", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
