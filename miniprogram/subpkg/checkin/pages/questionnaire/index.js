const { request } = require("../../../../utils/request");
const { ensureHealthConsent } = require("../../../../utils/health-consent");
const router = require("../../../../utils/router");
const { isMissing, visibleQuestionRows } = require("../../../../utils/questionnaire-branching");

const OPTION_LABELS = {
  better: "明显改善",
  same: "基本稳定",
  worse: "有些变差",
  yes: "愿意继续",
  maybe: "再观察一下",
  no: "暂不继续",
};

function labelForOption(value) {
  return OPTION_LABELS[value] || value;
}

function prepareQuestionnaire(questionnaire, answers = {}) {
  if (!questionnaire) return null;
  const requiredFields = questionnaire.required_fields || [];
  const questions = visibleQuestionRows(questionnaire, answers, (question) => ({
    ...question,
    required: requiredFields.includes(question.field) || question.required === true,
    options: (question.options || []).map((value) => ({ value, label: labelForOption(value) })),
    scaleOptions: Array.from({ length: Number(question.max || 5) - Number(question.min || 1) + 1 }, (_, index) => {
      const value = Number(question.min || 1) + index;
      return { value, label: String(value) };
    }),
  }));
  return {
    ...questionnaire,
    requiredCount: questions.filter((question) => question.required).length,
    versionText: `v${questionnaire.version || 1}`,
    questions,
  };
}

Page({
  data: {
    type: "DAY4_MIDPOINT",
    questionnaireDefinition: null,
    questionnaire: null,
    answers: {},
    missingFields: {},
    idempotencyKey: "",
    loading: false,
  },

  async onLoad(query) {
    const type = query.type || "DAY4_MIDPOINT";
    this.setData({
      type,
      idempotencyKey: `${type}_${Date.now()}`,
    });
  },

  async onShow() {
    const allowed = await router.routeGuard("/subpkg/checkin/pages/questionnaire/index");
    if (allowed && await ensureHealthConsent()) this.load();
  },

  async load() {
    try {
      const data = await request({ url: `/api/v1/questionnaire?type=${this.data.type}` });
      this.setData({
        questionnaireDefinition: data.questionnaire,
        questionnaire: prepareQuestionnaire(data.questionnaire, this.data.answers),
        missingFields: {},
      });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    }
  },

  setAnswer(event) {
    const field = event.currentTarget.dataset.field;
    const value = event.currentTarget.dataset.value;
    const answers = { ...this.data.answers, [field]: value };
    this.setData({
      answers,
      questionnaire: prepareQuestionnaire(this.data.questionnaireDefinition, answers),
      missingFields: { ...this.data.missingFields, [field]: false },
    });
  },

  setBoolean(event) {
    const field = event.currentTarget.dataset.field;
    const value = event.currentTarget.dataset.value === "true";
    const answers = { ...this.data.answers, [field]: value };
    this.setData({
      answers,
      questionnaire: prepareQuestionnaire(this.data.questionnaireDefinition, answers),
      missingFields: { ...this.data.missingFields, [field]: false },
    });
  },

  onText(event) {
    const field = event.currentTarget.dataset.field;
    const answers = { ...this.data.answers, [field]: event.detail.value };
    this.setData({
      answers,
      questionnaire: prepareQuestionnaire(this.data.questionnaireDefinition, answers),
      missingFields: { ...this.data.missingFields, [field]: false },
    });
  },

  validateRequired() {
    const questionnaire = this.data.questionnaire;
    if (!questionnaire) return false;
    const missingFields = {};
    (questionnaire.questions || [])
      .filter((question) => question.required === true)
      .forEach((question) => {
        missingFields[question.field] = isMissing(this.data.answers[question.field]);
      });
    this.setData({ missingFields });
    return !Object.values(missingFields).some(Boolean);
  },

  async submit() {
    if (this.data.loading) return;
    if (!(await ensureHealthConsent())) return;
    if (!this.validateRequired()) {
      wx.showToast({ title: "请完成必填项", icon: "none" });
      return;
    }
    this.setData({ loading: true });
    try {
      await request({
        url: "/api/v1/questionnaire/submit",
        method: "POST",
        data: {
          type: this.data.type,
          answers: this.data.answers,
          idempotencyKey: this.data.idempotencyKey,
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
