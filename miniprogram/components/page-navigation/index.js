function goHome() {
  wx.switchTab({ url: "/pages/home/index" });
}

function resolveNavigationTop() {
  try {
    const capsule = wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect();
    if (capsule && Number.isFinite(capsule.bottom)) return Math.max(66, Math.round(capsule.bottom + 22));
  } catch (error) {
    // 模拟器或低版本环境回退到 Ardot 390 × 844 画板位置。
  }
  return 66;
}

Component({
  properties: {
    tone: { type: String, value: "dark" },
    showHome: { type: Boolean, value: true },
  },
  data: {
    top: 66,
  },
  lifetimes: {
    attached() {
      this.setData({ top: resolveNavigationTop() });
    },
  },
  methods: {
    goBack() {
      const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
      if (pages.length > 1) {
        wx.navigateBack({ delta: 1, fail: goHome });
        return;
      }
      goHome();
    },

    goHome,
  },
});
