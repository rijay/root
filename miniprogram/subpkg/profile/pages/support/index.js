const MODES = Object.freeze({
  faq: { eyebrow: "ROOT / FAQ", title: "常见问题", copy: "关于账号、健康评测与会员中心入口的说明。" },
  feedback: { eyebrow: "ROOT / FEEDBACK", title: "建议与反馈", copy: "你的体验会帮助我们把 myRoot 做得更清楚、更可靠。" },
  contact: { eyebrow: "ROOT SUPPORT", title: "联系客服", copy: "如需了解产品、活动或会员信息，可以直接联系 Root 客服。" },
});

Page({
  data: {
    mode: "contact",
    view: MODES.contact,
    faqItems: [
      { question: "如何修改头像或昵称？", answer: "登录后在“我的”查看当前资料；资料编辑能力开放后可在该入口修改。" },
      { question: "订单和优惠券在哪里查看？", answer: "myRoot 不复制会员资产，相关信息将跳转至 Root 会员中心查看。" },
      { question: "Root4U 是医疗诊断吗？", answer: "不是。Root4U 提供健康状态评测与生活方式建议，不替代医生诊断或治疗。" },
    ],
  },

  onLoad(options = {}) {
    const mode = MODES[options.type] ? options.type : "contact";
    this.setData({ mode, view: MODES[mode] });
    wx.setNavigationBarTitle({ title: MODES[mode].title });
  },

  onContact() {},
});
