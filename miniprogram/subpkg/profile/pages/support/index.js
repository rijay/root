const { wecomCustomerService = {} } = require("../../../../config/env");

const MODES = Object.freeze({
  faq: { eyebrow: "ROOT / FAQ", title: "常见问题", copy: "关于账号、健康评测与会员中心入口的说明。" },
  feedback: { eyebrow: "ROOT / FEEDBACK", title: "建议与反馈", copy: "你的体验会帮助我们把 myRoot 做得更清楚、更可靠。" },
  contact: { eyebrow: "ROOT SUPPORT", title: "联系客服", copy: "如需了解产品、活动或会员信息，可以直接联系 Root 客服。" },
});

Page({
  data: {
    mode: "contact",
    view: MODES.contact,
    openingCustomerService: false,
    showNativeContactFallback: false,
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

  openWeComCustomerService() {
    if (this.data.openingCustomerService) return;

    const corpId = String(wecomCustomerService.corpId || "").trim();
    const url = String(wecomCustomerService.url || "").trim();
    const apiAvailable = typeof wx.openCustomerServiceChat === "function";
    const configReady = /^ww[a-zA-Z0-9]+$/.test(corpId)
      && /^https:\/\/work\.weixin\.qq\.com\/kfid\/[a-zA-Z0-9]+$/.test(url);

    if (!apiAvailable || !configReady) {
      this.setData({ showNativeContactFallback: true });
      wx.showToast({ title: "企微客服暂不可用，请使用微信客服", icon: "none" });
      return;
    }

    this.setData({ openingCustomerService: true });
    wx.openCustomerServiceChat({
      corpId,
      extInfo: { url },
      success: () => {
        this.setData({ showNativeContactFallback: false });
      },
      fail: (error) => {
        console.warn("openCustomerServiceChat failed", error && error.errMsg ? error.errMsg : "unknown");
        this.setData({ showNativeContactFallback: true });
        wx.showToast({ title: "企微客服暂未打开，请使用微信客服", icon: "none" });
      },
      complete: () => {
        this.setData({ openingCustomerService: false });
      },
    });
  },

  onNativeContact() {},
});
