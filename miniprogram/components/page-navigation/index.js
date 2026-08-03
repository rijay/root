function goHome() {
  wx.switchTab({ url: "/pages/home/index" });
}

Component({
  properties: {
    tone: { type: String, value: "dark" },
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
