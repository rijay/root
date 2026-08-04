function resolveHeaderTop() {
  try {
    const capsule = wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect();
    if (capsule && Number.isFinite(capsule.bottom)) return Math.max(64, Math.round(capsule.bottom + 24));
  } catch (error) {
    // 模拟器或低版本环境回退到 Ardot 390 × 844 画板位置。
  }
  return 74;
}

Component({
  properties: {
    tone: {
      type: String,
      value: "dark",
    },
  },

  data: {
    top: 74,
  },

  lifetimes: {
    attached() {
      this.setData({ top: resolveHeaderTop() });
    },
  },
});
