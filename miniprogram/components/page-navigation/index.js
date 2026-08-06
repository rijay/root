function goHome() {
  wx.switchTab({ url: "/pages/home/index" });
}

const NAVIGATION_BUTTON_SIZE = 40;

function resolveNavigationTop() {
  try {
    if (typeof wx.getMenuButtonBoundingClientRect === "function") {
      const capsule = wx.getMenuButtonBoundingClientRect();
      const capsuleTop = Number(capsule && capsule.top);
      const capsuleHeight = Number(capsule && capsule.height);
      if (Number.isFinite(capsuleTop) && capsuleTop >= 0 && Number.isFinite(capsuleHeight) && capsuleHeight > 0) {
        return Math.max(0, Math.round(capsuleTop + (capsuleHeight - NAVIGATION_BUTTON_SIZE) / 2));
      }
    }
    const windowInfo = typeof wx.getWindowInfo === "function"
      ? wx.getWindowInfo()
      : (typeof wx.getSystemInfoSync === "function" ? wx.getSystemInfoSync() : {});
    const statusBarHeight = Number(windowInfo && windowInfo.statusBarHeight);
    if (Number.isFinite(statusBarHeight) && statusBarHeight > 0) {
      return Math.round(Math.min(76, Math.max(20, statusBarHeight)));
    }
  } catch (error) {
    // 模拟器或低版本环境回退到 Ardot 390 × 844 画板位置。
  }
  return 48;
}

Component({
  options: {
    // 真机中自定义组件宿主节点会参与布局。虚拟化宿主后，固定定位始终
    // 以视口为参照，避免不同基础库把按钮组放进未知宽度的宿主盒子。
    virtualHost: true,
  },
  properties: {
    tone: { type: String, value: "dark" },
    showHome: { type: Boolean, value: true },
    interceptBack: { type: Boolean, value: false },
  },
  data: {
    top: 48,
  },
  lifetimes: {
    attached() {
      this.setData({ top: resolveNavigationTop() });
    },
  },
  methods: {
    goBack() {
      if (this.properties.interceptBack) {
        this.triggerEvent("back");
        return;
      }
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
