function goHome() {
  wx.switchTab({ url: "/pages/home/index" });
}

function resolveNavigationTop() {
  try {
    const windowInfo = typeof wx.getWindowInfo === "function"
      ? wx.getWindowInfo()
      : (typeof wx.getSystemInfoSync === "function" ? wx.getSystemInfoSync() : {});
    const statusBarHeight = Number(windowInfo && windowInfo.statusBarHeight);
    if (Number.isFinite(statusBarHeight) && statusBarHeight > 0) {
      return Math.round(Math.min(76, Math.max(52, statusBarHeight + 19)));
    }
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
