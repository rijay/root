const options = require("../../utils/options");
const { request } = require("../../utils/request");
const router = require("../../utils/router");

const questions = [
  { key: "joinReasons", type: "multi", title: "参与本次试饮的原因", options: options.joinReasonOptions },
  { key: "gutHealthStatus", type: "single", title: "您的肠道健康状况", options: options.gutHealthOptions },
  { key: "improvementMethods", type: "multi", title: "您目前肠道健康改善的方式", options: options.improvementOptions },
  { key: "stoolType", type: "stool", title: "便便日常是什么类型", options: options.stoolOptions },
];

Page({
  data: {
    step: 0,
    total: questions.length,
    current: { ...questions[0], options: questions[0].options },
    answers: {
      joinReasons: [],
      gutHealthStatus: "",
      improvementMethods: [],
      stoolType: "",
    },
    canNext: false,
    loading: false,
  },

  onShow() {
    router.routeGuard("/pages/register/index");
  },

  setQuestion(step) {
    this.setData({
      step,
      current: this.decorateQuestion(step, this.data.answers),
      canNext: this.isValid(step, this.data.answers),
    });
  },

  decorateQuestion(step, answers) {
    const question = questions[step];
    const answer = answers[question.key];
    return {
      ...question,
      options: question.options.map((option) => ({
        ...option,
        selected: Array.isArray(answer) ? answer.includes(option.value) : answer === option.value,
      })),
    };
  },

  isValid(step, answers) {
    const question = questions[step];
    const value = answers[question.key];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  },

  optionSelected(value) {
    const answer = this.data.answers[this.data.current.key];
    return Array.isArray(answer) ? answer.includes(value) : answer === value;
  },

  selectOption(event) {
    const value = event.currentTarget.dataset.value;
    const question = this.data.current;
    const answers = { ...this.data.answers };

    if (question.type === "multi") {
      const option = question.options.find((item) => item.value === value);
      let next = answers[question.key].slice();
      if (option && option.exclusive) {
        next = next.includes(value) ? [] : [value];
      } else {
        next = next.filter((item) => {
          const candidate = question.options.find((opt) => opt.value === item);
          return !(candidate && candidate.exclusive);
        });
        next = next.includes(value) ? next.filter((item) => item !== value) : next.concat(value);
      }
      answers[question.key] = next;
    } else {
      answers[question.key] = value;
    }

    this.setData({
      answers,
      current: this.decorateQuestion(this.data.step, answers),
      canNext: this.isValid(this.data.step, answers),
    });
  },

  previous() {
    if (this.data.step <= 0) return;
    this.setQuestion(this.data.step - 1);
  },

  async next() {
    if (!this.data.canNext) return;
    if (this.data.step < this.data.total - 1) {
      this.setQuestion(this.data.step + 1);
      return;
    }

    this.setData({ loading: true });
    try {
      const data = await request({
        url: "/api/v1/user/profile",
        method: "POST",
        data: this.data.answers,
      });
      router.go("/pages/home/index");
    } catch (error) {
      wx.showToast({ title: error.message || "提交失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
});
